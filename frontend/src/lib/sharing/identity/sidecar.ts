// Cross-boundary sharing, the per-user identity sidecar (Phase 1c-i).
//
// When a folder-local ResearchOS account claims a global sharing identity, we
// record the link in a small JSON file inside that user's folder,
// users/<username>/_sharing_identity.json. Its presence means "this account is
// claimed", its absence means "not claimed". This mirrors the per-user gate
// convention already used by _auth.json (see lib/auth/password.ts), a thin
// File System Access wrapper over fileService.readJson / writeJson.
//
// SECURITY (updated 2026-06-06, Grant-approved Option A in IDENTITY_OAUTH_ONLY.md):
// the public fields are still public, but this file now ALSO carries the device
// keypair WRAPPED at rest (recoveryBlob). The blob is ciphertext sealed under the
// 128-bit recovery code (Argon2id), the same posture the directory uses for the
// backup blob. This makes the folder a self-contained identity -- a new device
// opening the same folder unlocks offline with the recovery code, no directory
// needed. Anyone who can read the folder can copy the ciphertext, but offline
// brute force is infeasible at 128 bits. The raw private key NEVER lands here, it
// only ever exists unwrapped in process memory (session-key.ts) after an unlock.
// Because the file now holds key material, callers MUST gitignore it
// (_sharing_identity.json) when they write the wrapped blobs.

import { fileService } from "../../file-system/file-service";
import type { BackupBlob } from "./backup";

/**
 * The per-user identity link. Public fields only, never a private key.
 *
 * MODEL (IDENTITY_OAUTH_ONLY.md, revised 2026-06-06): the ACCOUNT is a LOCAL
 * keypair, created offline with no OAuth. A LOCAL-ONLY identity carries the
 * public keys + fingerprint + recoveryBlob and NO email. Publishing a findable
 * directory profile (OAuth) is optional and is what adds the email + claimedAt.
 * So `email` and `claimedAt` are OPTIONAL, present only once the identity has
 * been PUBLISHED.
 *
 * - email, the canonical address this identity was PUBLISHED under (lowercased,
 *   trimmed, see canonicalizeEmail). Stored so the UI can show which address an
 *   account is published under without a directory round-trip. ABSENT on a
 *   local-only (unpublished) identity.
 * - x25519PublicKey / ed25519PublicKey, hex-encoded published public keys
 *   (encodePublicKey convention from identity/keys.ts).
 * - fingerprint, the grouped safety-check string for this identity.
 * - claimedAt, ISO-8601 timestamp the identity was PUBLISHED to the directory.
 *   ABSENT on a local-only identity (use createdAt for "when set up").
 * - createdAt, ISO-8601 timestamp the LOCAL identity was created on this folder.
 *   Optional so pre-cutover sidecars (which only carried claimedAt) still parse.
 * - recoveryConfirmedAt, ISO-8601 timestamp the user confirmed they saved their
 *   Recovery Words, or null if they have not confirmed yet.
 *
 * The wrapped device key (Option A, 2026-06-06). These are CIPHERTEXT, the device
 * keypair sealed at rest so the folder is a self-contained identity:
 * - recoveryBlob, the keypair sealed under the recovery code (Argon2id, 128-bit).
 *   Present once the account is set up (local-only or published). Optional so
 *   pre-cutover sidecars (public-only) still parse. Its presence is the canonical
 *   "an account exists here" signal.
 * Never store the raw (unwrapped) private key here, see the SECURITY note above.
 */
export interface SharingIdentitySidecar {
  version: 1;
  email?: string;
  x25519PublicKey: string;
  ed25519PublicKey: string;
  fingerprint: string;
  claimedAt?: string;
  createdAt?: string;
  recoveryConfirmedAt: string | null;
  recoveryBlob?: BackupBlob;
}

function sidecarPath(username: string): string {
  return `users/${username}/_sharing_identity.json`;
}

/**
 * Reads the sharing identity for a user. Returns null when the file is absent,
 * which means the account has not claimed a sharing identity.
 */
export async function readSharingIdentity(
  username: string,
): Promise<SharingIdentitySidecar | null> {
  return fileService.readJson<SharingIdentitySidecar>(sidecarPath(username));
}

/**
 * Writes (or replaces) the sharing identity sidecar for a user.
 */
/**
 * Window event fired after a sharing-identity sidecar write (claim, rotate,
 * restore). Live readers (useSharingIdentity) subscribe so a surface like the
 * require-account gate releases the instant a claim publishes, without waiting
 * for a remount. detail.username names the affected user.
 */
export const SHARING_IDENTITY_WRITTEN_EVENT = "researchos:sharing-identity-written";

export async function writeSharingIdentity(
  username: string,
  data: SharingIdentitySidecar,
): Promise<void> {
  await fileService.writeJson(sidecarPath(username), data);
  // Notify live readers across hook instances. Best-effort and browser-only.
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(SHARING_IDENTITY_WRITTEN_EVENT, { detail: { username } }),
    );
  }
}

/**
 * Whether the user has claimed a sharing identity (the sidecar exists).
 */
export async function hasSharingIdentity(username: string): Promise<boolean> {
  return fileService.fileExists(sidecarPath(username));
}

/**
 * Deletes the sharing identity sidecar for a user, abandoning the claim so the
 * account reads as unclaimed again. Used by the "start over" reset flow, which
 * then mints a fresh keypair through the setup wizard (the server upsert
 * replaces the old email -> key binding). Returns true if a file was removed,
 * false if it was already absent. Does NOT touch the on-device private key in
 * IndexedDB, the caller pairs this with clearIdentity() from storage.ts.
 */
export async function deleteSharingIdentity(username: string): Promise<boolean> {
  return fileService.deleteFile(sidecarPath(username));
}
