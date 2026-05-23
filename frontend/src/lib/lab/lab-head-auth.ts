// Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): PBKDF2 hash +
// verify for the lab-head edit-mode password.
//
// Decision #3 (Grant 2026-05-23): the lab-head password REUSES the user's
// account password on first unlock. On the first attempt for a lab-head
// user whose `_lab_head_auth.json` does not yet exist, the password modal
// verifies against the account password (`@/lib/auth/password`) and on
// success persists a hash here so subsequent unlocks check the lab-head
// file directly. The user can later change it via Settings → Lab Head;
// once changed the two passwords diverge.
//
// Storage: per-user file at `users/<pi_username>/_lab_head_auth.json`.
// The PI's own folder owns the gate; co-PIs each manage their own file.
//
// PBKDF2-SHA-256 mirrors `frontend/src/lib/auth/password.ts`. We re-use
// the same iteration count (600k, OWASP 2023 PBKDF2-SHA-256 recommendation)
// and constant-time compare. The hash is salted per-user so two PIs with
// the same chosen password don't share a hash on disk.

import { fileService } from "../file-system/file-service";
import { verifyPassword as verifyAccountPassword } from "../auth/password";

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

interface LabHeadAuthFile {
  version: 1;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  hash: string;
  created_at: string;
  updated_at: string;
}

function authPath(username: string): string {
  return `users/${username}/_lab_head_auth.json`;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveHash(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    // Cast: TS narrows Uint8Array's underlying buffer to ArrayBufferLike,
    // but WebCrypto's BufferSource expects a concrete ArrayBuffer. The
    // runtime accepts a Uint8Array directly; this just satisfies the type.
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    baseKey,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

/**
 * Constant-time byte-string compare. Returns true iff `a` and `b` are
 * byte-for-byte identical. Length mismatch returns false. Designed so a
 * timing oracle cannot leak the prefix of the expected hash to an
 * attacker — every byte is touched regardless of where the mismatch
 * lands.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** True if the user already has a lab-head password persisted. */
export async function hasLabHeadPassword(username: string): Promise<boolean> {
  return fileService.fileExists(authPath(username));
}

/**
 * Set or replace the lab-head password for the given user. Used by:
 *   - First-time unlock (after account-password fallback verify) to
 *     bootstrap the gate file.
 *   - Settings → Lab Head → Change password (with current-password
 *     reverify as the precondition).
 */
export async function setLabHeadPassword(
  username: string,
  password: string,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveHash(password, salt, PBKDF2_ITERATIONS);
  const now = new Date().toISOString();
  const existing = await fileService.readJson<LabHeadAuthFile>(authPath(username));
  const data: LabHeadAuthFile = {
    version: 1,
    kdf: "PBKDF2-SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    hash: toBase64(hash),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  await fileService.writeJson(authPath(username), data);
}

/**
 * Verify a lab-head password attempt.
 *
 * - If `_lab_head_auth.json` exists, verifies against the stored hash.
 *   Returns true on match.
 * - If `_lab_head_auth.json` does NOT exist (first-time unlock), falls
 *   back to verifying against the account password (decision #3 — reuse
 *   account password on first use). On success this function ALSO
 *   persists a hash file using the same password, so the next unlock
 *   uses the dedicated gate. On failure returns false.
 *
 * Bootstrapping note: the side-effect file-write on first-success is
 * deliberate. Without it every Settings-page-untouched lab head would
 * stay on the account-password fallback indefinitely, and a later
 * account-password change in `AccountPasswordPopup` would silently
 * also change the edit-mode gate. The Phase 5 contract (per proposal
 * section 2d) is that the two passwords MAY start identical but
 * diverge as soon as the PI uses either change-password surface.
 */
export async function verifyLabHeadPassword(
  username: string,
  password: string,
): Promise<boolean> {
  const data = await fileService.readJson<LabHeadAuthFile>(authPath(username));

  if (!data) {
    // First-use bootstrap path. Defer to the account-password gate.
    const ok = await verifyAccountPassword(username, password);
    if (!ok) return false;
    // Persist a dedicated hash so subsequent attempts hit the fast path
    // and don't depend on account-password state. Failures here don't
    // invalidate the successful auth attempt — the user is still
    // legitimately unlocked even if disk write hiccups (next attempt
    // re-bootstraps).
    try {
      await setLabHeadPassword(username, password);
    } catch (err) {
      console.warn(
        "[lab-head-auth] Bootstrap setLabHeadPassword failed; next unlock will retry the account-password fallback.",
        err,
      );
    }
    return true;
  }

  if (data.kdf !== "PBKDF2-SHA-256") return false;
  const salt = fromBase64(data.salt);
  const expected = fromBase64(data.hash);
  const actual = await deriveHash(password, salt, data.iterations);
  return constantTimeEqual(actual, expected);
}

/**
 * Remove the dedicated lab-head password. The next unlock will fall back
 * to the account-password path (and re-bootstrap a hash on success).
 *
 * Surfaced as a "Reset to account password" action in Settings if we
 * ever want to expose it. Not wired to a UI yet — provided for symmetry
 * with `removePassword` in `@/lib/auth/password`.
 */
export async function removeLabHeadPassword(username: string): Promise<void> {
  await fileService.deleteFile(authPath(username));
}
