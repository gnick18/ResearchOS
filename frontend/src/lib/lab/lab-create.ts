// Lab tier (cross-folder group) Phase 5: entry point for creating a lab.
//
// A logged-in user with an unlocked identity calls createLabForCurrentUser to
// become the head of a brand-new lab. The function generates the lab key, seals
// it to the head, and publishes the genesis record to the Lab Record DO.
//
// Responsibilities of THIS function:
//   - accept an injected username + StoredIdentity (keeps this pure + testable),
//   - build the head LabMember from the identity's public keys,
//   - generate a stable lab id (crypto.randomUUID by default, overrideable for
//     tests via idImpl),
//   - call createLab (lab-key.ts) to produce the genesis record + sealed envelope
//     + lab key in memory,
//   - ship the PUBLIC artifacts (record + envelope, NOT the lab key) to the relay
//     via createLabRemote,
//   - return the labId and labKey so the caller can persist them.
//
// OUT OF SCOPE here (handled by a later UI/persistence slice):
//   - persisting the labId to the user's profile,
//   - setting account_type to "lab_head",
//   - inviting additional members.
//
// On a later login the head re-derives the lab key via openLabKey (lab-key.ts)
// from the DO envelope, so the labKey returned here only needs to be held for
// the current session.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { createLab, generateLabKey } from "./lab-key";
import type { CreatedLab } from "./lab-key";
import { sealMemberEmailHash } from "./lab-binding";
import { createLabRemote } from "./lab-do-client";
import type { LabMember } from "./lab-membership";
import { encodePublicKey } from "@/lib/sharing/identity/keys";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";

export interface CreateLabParams {
  /** The caller's username, injected from useCurrentUser. */
  username: string;
  /** The caller's unlocked identity, injected from getSessionIdentity. */
  identity: StoredIdentity;
  /**
   * The head's third-party-OAuth-verified email (from getSession().user.email).
   * Bound to the head membership (lab-key-encrypted, Phase 8a) so a later head
   * login MUST authenticate with this same email. Required: a lab cannot be
   * created without an OAuth identity to anchor the head to.
   */
  oauthEmail: string;
  /**
   * Optional lab display name. When provided, a directory row is created
   * (listed=false by default) via the /api/directory/labs/publish endpoint.
   * The publish is best-effort: a failure does NOT block lab creation.
   */
  labName?: string;
  /**
   * Optional institution name surfaced in the lab directory listing.
   */
  institution?: string | null;
  /**
   * Optional cosmetic PI title (Dr. / Prof. / ...). Stored in DO meta as
   * pi_title, used to brand the join welcome. Display only, never gates access.
   */
  piTitle?: string;
  /**
   * Optional cosmetic PI display name (the human name shown next to the title).
   * Stored in DO meta as pi_display. Defaults to the username when omitted.
   */
  piDisplay?: string;
  /**
   * Override for the lab-id generator. Defaults to crypto.randomUUID. Injected
   * in tests to produce a deterministic id.
   */
  idImpl?: () => string;
}

export interface CreateLabResult {
  /** The stable, opaque lab id assigned to the new lab. */
  labId: string;
  /**
   * The 32-byte lab key in memory. The caller holds this for the current
   * session; on a later login the head re-derives it via openLabKey from the
   * DO envelope. Persisting the labId + updating account_type to "lab_head"
   * are the CALLER's responsibility (a later UI/persistence slice).
   */
  labKey: Uint8Array;
}

/** The local half of lab creation, the labId plus the in-memory CreatedLab. */
export interface CreateLabLocalResult {
  labId: string;
  created: CreatedLab;
}

/**
 * The PURE, network-free half of lab creation. Validates the OAuth email,
 * generates the labId + lab key, builds the head LabMember, and runs createLab
 * to produce the genesis record + sealed envelope + lab key in memory. Does NOT
 * touch the network, so the caller can promote the user to lab_head and persist
 * the genesis artifacts INSTANTLY, before any relay round-trip. The relay
 * publish is a separate, retryable step (publishLabRemote).
 *
 * @throws if no OAuth-verified email is supplied (the head cannot be bound).
 */
export function createLabLocal(params: CreateLabParams): CreateLabLocalResult {
  const { username, identity, oauthEmail } = params;
  if (!oauthEmail || !oauthEmail.trim()) {
    throw new Error(
      "createLabLocal: an OAuth-verified email is required to bind the head membership",
    );
  }
  const labId = (params.idImpl ?? (() => crypto.randomUUID()))();

  // Generate the lab key up front so the head's email binding can be sealed
  // under it and ride INSIDE the head-signed genesis roster (Phase 8a). The same
  // key is injected into createLab via opts.labKey so no second key is minted.
  const labKey = generateLabKey();

  const head: LabMember = {
    username,
    x25519PublicKey: encodePublicKey(identity.keys.encryption.publicKey),
    ed25519PublicKey: encodePublicKey(identity.keys.signing.publicKey),
    role: "head",
    emailHashEnc: sealMemberEmailHash(oauthEmail, labKey),
  };

  // A lab of one for now: the head is the sole member. addMember/invite is a
  // later slice.
  const created = createLab(
    labId,
    head,
    [head],
    identity.keys.signing.privateKey,
    { labKey },
  );

  return { labId, created };
}

/**
 * The NETWORK half of lab creation, a retryable background publish. POSTs the
 * head-signed genesis entry + sealed envelope to the relay, then best-effort
 * upserts a directory row. Separated from createLabLocal so a PI is a lab head
 * locally the instant they commit, independent of whether the relay is
 * reachable. The genesis artifacts (created.record + created.envelope) are
 * fully JSON-serializable, so the caller can persist them and retry this until
 * it lands.
 *
 * @throws if the relay rejects the create request (non-2xx HTTP status). The
 *   directory upsert failure is swallowed (best-effort).
 */
export async function publishLabRemote(
  labId: string,
  created: CreatedLab,
  opts?: {
    labName?: string;
    institution?: string | null;
    piDisplayName?: string;
    /** Cosmetic PI title (Dr. / Prof. / ...) stored in DO meta as pi_title. */
    piTitle?: string;
  },
): Promise<void> {
  // Cosmetic branding rides into the relay create body (DO meta), NOT the signed
  // log. piDisplayName is the human PI name shown next to the title; it doubles as
  // the directory row's piDisplayName below.
  const res = await createLabRemote(labId, created, {
    labName: opts?.labName,
    piTitle: opts?.piTitle,
    piDisplay: opts?.piDisplayName,
  });
  if (!res.ok) {
    throw new Error(
      `publishLabRemote: relay rejected lab create (HTTP ${res.status})`,
    );
  }

  // Best-effort: publish a directory row (listed=false) so the lab can later
  // be opted into the listing by the PI. A failure here must never block lab
  // creation -- we simply skip the upsert and the PI can trigger it later.
  if (opts?.labName?.trim()) {
    try {
      await fetch("/api/directory/labs/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          labId,
          name: opts.labName.trim(),
          institution: opts.institution ?? null,
          piDisplayName: opts.piDisplayName ?? "",
        }),
      });
    } catch {
      // Intentionally swallowed: directory upsert is best-effort.
    }
  }
}

/**
 * Creates a brand-new lab for the current user and publishes the genesis record
 * to the Lab Record DO. The caller becomes the sole head member. A thin
 * backward-compatible wrapper over createLabLocal + publishLabRemote, preserved
 * so existing tests and callers keep their exact signature and behavior.
 *
 * @throws if no OAuth email is supplied, or if the relay rejects the create.
 */
export async function createLabForCurrentUser(
  params: CreateLabParams,
): Promise<CreateLabResult> {
  const { labId, created } = createLabLocal(params);
  await publishLabRemote(labId, created, {
    labName: params.labName,
    institution: params.institution,
    piDisplayName: params.piDisplay ?? params.username,
    piTitle: params.piTitle,
  });
  return { labId, labKey: created.labKey };
}
