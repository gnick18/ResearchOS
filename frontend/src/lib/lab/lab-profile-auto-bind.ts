// Lab tier P3a: auto-bind the directory profile on the first lab OAuth login.
//
// Lab accounts are online by definition, so their directory profile should exist
// as soon as they log in. Without this, a newly enrolled lab member sees
// "No profile yet" in the profile UI even though they have an OAuth session.
//
// The bind-once check (sidecar.email) guards idempotency: if the email is already
// written to the sidecar, the profile was published on a prior login and we skip.
// Later user edits via Settings -> Sharing overwrite the auto-published name or
// affiliation without affecting the bind-once guard (the guard is sidecar.email,
// not the display name).
//
// PRIVACY: auto-publishing to the public directory is expected for lab accounts
// (members find each other for invites and sharing). Solo accounts never reach
// this code (LAB_TIER_ENABLED gates the caller).
//
// ERROR HANDLING: all failures are best-effort. A network error, a non-OK response
// from the oauth-bind route (e.g. SHARING_ENABLED not set in prod), or a sidecar
// write failure all cause a silent return. The next lab login retries automatically
// because the sidecar.email guard only passes once a successful bind + write land.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  readSharingIdentity,
  writeSharingIdentity,
  type SharingIdentitySidecar,
} from "../sharing/identity/sidecar";
import { encodePublicKey } from "../sharing/identity/keys";
import {
  buildKeyBackupEnvelope,
  serializeKeyBackupEnvelope,
} from "../sharing/identity/key-backup-envelope";
import { buildBindingPayload } from "../sharing/directory/signature";
import { canonicalizeEmail } from "../sharing/directory/email";
import type { StoredIdentity } from "../sharing/identity/storage";

// ---------------------------------------------------------------------------
// Injectable deps (real implementations + test doubles)
// ---------------------------------------------------------------------------

export interface AutoBindDeps {
  readSidecar: (username: string) => Promise<SharingIdentitySidecar | null>;
  writeSidecar: (username: string, data: SharingIdentitySidecar) => Promise<void>;
  /** POST to /api/directory/oauth-bind and return whether the response was ok. */
  fetchBind: (body: object) => Promise<{ ok: boolean }>;
  /** ISO-8601 timestamp factory (injectable so tests pin time). */
  now: () => string;
}

export function defaultAutoBindDeps(): AutoBindDeps {
  return {
    readSidecar: readSharingIdentity,
    writeSidecar: writeSharingIdentity,
    fetchBind: async (body) => {
      const res = await fetch("/api/directory/oauth-bind", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { ok: res.ok };
    },
    now: () => new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Request body builder (pure, no I/O -- exported for testing)
// ---------------------------------------------------------------------------

/**
 * Builds the oauth-bind request body for the auto-bind path. The body shape
 * matches what parseOAuthBindBody in directory/validation.ts accepts. All
 * security-sensitive fields (public keys, signature, issuedAt) come from the
 * injected identity and timestamp; display name is best-effort metadata only.
 */
export function buildLabAutoBindBody(params: {
  oauthEmail: string;
  oauthName: string | null;
  identity: StoredIdentity;
  sidecar: SharingIdentitySidecar;
  issuedAt: string;
}): Record<string, unknown> {
  const { oauthEmail, oauthName, identity, sidecar, issuedAt } = params;

  const canonical = canonicalizeEmail(oauthEmail);
  const x25519PublicKey = encodePublicKey(identity.keys.encryption.publicKey);
  const ed25519PublicKey = encodePublicKey(identity.keys.signing.publicKey);

  // Build the signed binding payload (email + public keys + issuedAt).
  const payload = buildBindingPayload({
    email: canonical,
    x25519PublicKey,
    ed25519PublicKey,
    issuedAt,
  });
  const signature = bytesToHex(
    ed25519.sign(payload, identity.keys.signing.privateKey),
  );

  // Reconstruct the key-backup envelope from the sidecar's recoveryBlob so the
  // directory stores a copy for cross-device recovery. Absent when the sidecar
  // pre-dates the identity cutover; the route accepts null gracefully.
  const keyBackupBlob = sidecar.recoveryBlob
    ? serializeKeyBackupEnvelope(buildKeyBackupEnvelope(sidecar.recoveryBlob))
    : null;

  // Display name: prefer the OAuth name, fall back to the local part of the
  // email so the directory always has something useful. The route treats it as
  // optional non-security metadata, trimmed and length-capped server-side.
  const trimmedName = oauthName?.trim() ?? "";
  const displayName =
    trimmedName.length > 0 ? trimmedName : canonical.split("@")[0] || null;

  return {
    x25519PublicKey,
    ed25519PublicKey,
    keyBackupBlob,
    signature,
    issuedAt,
    displayName,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Auto-binds the lab member's directory profile on their first OAuth login.
 *
 * Idempotent: skips if sidecar.email is already set (the profile was published
 * on a prior login). Best-effort: all failures are swallowed so the lab login
 * succeeds regardless of network state or directory availability.
 *
 * @param oauthEmail  Verified OAuth email from the NextAuth session.
 * @param oauthName   Display name from the OAuth provider, may be null.
 * @param username    The ResearchOS username (the folder user's name).
 * @param identity    The unlocked keypair from the in-memory session.
 * @param deps        Injectable I/O for testing.
 */
export async function autoBindLabProfile(params: {
  oauthEmail: string;
  oauthName: string | null;
  username: string;
  identity: StoredIdentity;
  deps?: Partial<AutoBindDeps>;
}): Promise<void> {
  const { oauthEmail, oauthName, username, identity } = params;
  const deps = { ...defaultAutoBindDeps(), ...params.deps };

  // Bind-once guard: a non-null sidecar.email means this device already
  // published the profile (or the user set one manually in Settings). Skip to
  // avoid overwriting a user-edited name or affiliation.
  let sidecar: SharingIdentitySidecar | null;
  try {
    sidecar = await deps.readSidecar(username);
  } catch {
    return; // I/O error reading sidecar: best-effort, skip
  }
  if (!sidecar) return; // no sidecar means no keypair set up yet on this device
  if (sidecar.email) return; // already bound on a prior login

  const issuedAt = deps.now();
  const body = buildLabAutoBindBody({ oauthEmail, oauthName, identity, sidecar, issuedAt });

  let result: { ok: boolean };
  try {
    result = await deps.fetchBind(body);
  } catch {
    return; // network error: retry next login
  }
  if (!result.ok) return; // sharing not enabled or server error: retry next login

  // Persist the email binding in the sidecar. Failure here is non-fatal: the
  // directory entry now exists, so the user has a published profile; the
  // sidecar.email guard just won't fire on the next login, causing one extra
  // no-op bind POST which the route handles idempotently.
  try {
    await deps.writeSidecar(username, {
      ...sidecar,
      email: canonicalizeEmail(oauthEmail),
      claimedAt: issuedAt,
    });
  } catch {
    // best-effort sidecar update
  }
}
