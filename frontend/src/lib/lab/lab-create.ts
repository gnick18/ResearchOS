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

import { createLab } from "./lab-key";
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

/**
 * Creates a brand-new lab for the current user and publishes the genesis record
 * to the Lab Record DO. The caller becomes the sole head member.
 *
 * The function is intentionally pure and network-ignorant beyond the one relay
 * POST: it takes the username and identity as parameters rather than reading
 * them from global state, so it can be tested without browser APIs.
 *
 * @throws if the relay rejects the create request (non-2xx HTTP status).
 */
export async function createLabForCurrentUser(
  params: CreateLabParams,
): Promise<CreateLabResult> {
  const { username, identity } = params;
  const labId = (params.idImpl ?? (() => crypto.randomUUID()))();

  const head: LabMember = {
    username,
    x25519PublicKey: encodePublicKey(identity.keys.encryption.publicKey),
    ed25519PublicKey: encodePublicKey(identity.keys.signing.publicKey),
    role: "head",
  };

  // A lab of one for now: the head is the sole member. addMember/invite is a
  // later slice.
  const created = createLab(
    labId,
    head,
    [head],
    identity.keys.signing.privateKey,
  );

  const res = await createLabRemote(labId, created);
  if (!res.ok) {
    throw new Error(
      `createLabForCurrentUser: relay rejected lab create (HTTP ${res.status})`,
    );
  }

  return { labId, labKey: created.labKey };
}
