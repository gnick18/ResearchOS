// SENSITIVE: bot tokens flow through this module (encrypted disk sidecar
// using the user's account password). See SECURITY_AUDIT.md §1.3.
//
// Opt-in encrypted backup of the Telegram bot token at
// `users/<u>/_telegram-encrypted.json`. The blob is AES-GCM-encrypted with
// a key derived from the user's account password via PBKDF2-SHA-256. KDF
// parameters mirror `auth/password.ts` (600k iterations, 16-byte salt,
// SHA-256) so a single password change cadence applies across both.
//
// Lifecycle:
//   - written when the user opts in via the pairing modal checkbox OR via
//     the Settings auto-reconnect toggle flipping ON
//   - read by the auto-reconnect path when the on-disk `_telegram.json`
//     pairing sidecar is missing
//   - deleted when the toggle flips OFF
//
// Decryption is by design gated on the user's password — there is no
// in-memory password cache in this codebase, so the auto-reconnect path
// MUST prompt the user. This is intentional: the encrypted backup is a
// "remember the token across browser wipes" feature, not a silent
// auto-restore. The IDB-scoped token cache (telegram-token-cache.ts)
// covers the silent same-browser case already.

import { fileService } from "@/lib/file-system/file-service";

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

export interface EncryptedTokenSidecar {
  version: 1;
  encrypted_token: string;
  saved_at: string;
}

function backupPath(username: string): string {
  return `users/${username}/_telegram-encrypted.json`;
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

async function deriveAesKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt `token` with a key derived from `password` and return a
 * serialized `${b64(salt)}:${b64(iv)}:${b64(ciphertext)}` blob.
 */
export async function encryptToken(token: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      new TextEncoder().encode(token),
    ),
  );
  return `${toBase64(salt)}:${toBase64(iv)}:${toBase64(ciphertext)}`;
}

/**
 * Reverse of `encryptToken`. Returns `null` on any failure (wrong password,
 * malformed blob, tampered ciphertext, missing parts). Never throws.
 */
export async function decryptToken(blob: string, password: string): Promise<string | null> {
  try {
    const parts = blob.split(":");
    if (parts.length !== 3) return null;
    const [saltB64, ivB64, cipherB64] = parts;
    if (!saltB64 || !ivB64 || !cipherB64) return null;
    const salt = fromBase64(saltB64);
    const iv = fromBase64(ivB64);
    const ciphertext = fromBase64(cipherB64);
    const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS);
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        key,
        ciphertext as BufferSource,
      ),
    );
    return new TextDecoder().decode(plain);
  } catch (err) {
    console.warn("[encrypted-backup] decrypt failed", err);
    return null;
  }
}

// ── On-disk sidecar I/O ────────────────────────────────────────────────────

/**
 * Write an encrypted backup of `token` to
 * `users/<username>/_telegram-encrypted.json`. Caller must have verified
 * the password against `_auth.json` first (we don't re-verify here so a
 * single user-prompt UX flow can short-circuit on mismatch before reaching
 * this layer).
 */
export async function writeEncryptedBackup(
  username: string,
  token: string,
  password: string,
): Promise<void> {
  const encrypted = await encryptToken(token, password);
  const payload: EncryptedTokenSidecar = {
    version: 1,
    encrypted_token: encrypted,
    saved_at: new Date().toISOString(),
  };
  await fileService.writeJson(backupPath(username), payload);
}

/** Returns the sidecar shape, or null if missing/malformed. */
export async function readEncryptedBackup(
  username: string,
): Promise<EncryptedTokenSidecar | null> {
  const raw = await fileService.readJson<EncryptedTokenSidecar>(backupPath(username));
  if (!raw || raw.version !== 1 || typeof raw.encrypted_token !== "string") {
    return null;
  }
  return raw;
}

export async function hasEncryptedBackup(username: string): Promise<boolean> {
  return fileService.fileExists(backupPath(username));
}

export async function deleteEncryptedBackup(username: string): Promise<void> {
  await fileService.deleteFile(backupPath(username));
}
