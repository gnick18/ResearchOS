// SENSITIVE: bot tokens flow through this module (encrypted disk sidecar keyed
// off the user's on-device identity keypair). See SECURITY_AUDIT.md §1.3.
//
// Opt-in encrypted backup of the Telegram bot token at
// `users/<u>/_telegram-encrypted.json`. The blob is AES-GCM-encrypted with a key
// derived from the user's X25519 identity secret via HKDF-SHA-256 (identity model
// phase 1, 2026-06-05). It used to derive from the account password via PBKDF2,
// but the password now only unwraps the keypair, so the backup keys off the
// keypair directly. Consequences:
//   - a password CHANGE no longer touches this backup (the keypair is unchanged),
//   - there is no in-memory password cache to hold, prompt for, or idle-wipe,
//   - a reset / wipe-and-re-establish mints a NEW keypair, so a backup keyed to
//     the old one is orphaned and the caller clears it (the user re-pairs).
//
// Lifecycle:
//   - written when the user opts in via the pairing modal checkbox OR via the
//     Settings auto-reconnect toggle flipping ON
//   - read by the auto-reconnect path when the on-disk `_telegram.json` pairing
//     sidecar is missing
//   - deleted when the toggle flips OFF
//
// Callers pass the X25519 secret (from loadIdentity()), used transiently to
// derive the AES key and then dropped. The IDB-scoped token cache
// (telegram-token-cache.ts) still covers the silent same-browser case, so this
// backup only handles "remember the token across browser wipes".

import { fileService } from "@/lib/file-system/file-service";

const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;
// Domain-separation label for the HKDF derivation. Stable forever, changing it
// orphans every backup.
const HKDF_INFO = "researchos/telegram-backup/v1";

/**
 * Decrypted payload — the minimum needed to reconstruct a TelegramPairing on
 * restore. `pairedAt` and `lastUpdateId` are NOT stored: the restore path stamps
 * fresh values (`pairedAt` = now, `lastUpdateId` = 0; the long-poll cursor
 * self-heals on the first poll).
 *
 * `botFirstName` is intentionally NOT in this payload (security manager
 * constraint #6 — minimum sensitive data on disk). It's a display detail only;
 * on restore it stays empty until getMe() repopulates it on the next tick.
 */
export interface EncryptedPairingPayload {
  botToken: string;
  chatId: number;
  botUsername: string;
}

export interface EncryptedTokenSidecar {
  version: 1;
  /** AES-GCM ciphertext of a JSON-serialized EncryptedPairingPayload. */
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
  identitySecret: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    identitySecret as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: new TextEncoder().encode(HKDF_INFO),
    },
    baseKey,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt `token` with a key derived from the X25519 identity secret and return
 * a serialized `${b64(salt)}:${b64(iv)}:${b64(ciphertext)}` blob.
 */
export async function encryptToken(
  token: string,
  identitySecret: Uint8Array,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesKey(identitySecret, salt);
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
 * Reverse of `encryptToken`. Returns `null` on any failure (wrong identity key,
 * malformed blob, tampered ciphertext, missing parts). Never throws.
 */
export async function decryptToken(
  blob: string,
  identitySecret: Uint8Array,
): Promise<string | null> {
  try {
    const parts = blob.split(":");
    if (parts.length !== 3) return null;
    const [saltB64, ivB64, cipherB64] = parts;
    if (!saltB64 || !ivB64 || !cipherB64) return null;
    const salt = fromBase64(saltB64);
    const iv = fromBase64(ivB64);
    const ciphertext = fromBase64(cipherB64);
    const key = await deriveAesKey(identitySecret, salt);
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
 * Write an encrypted backup of the pairing-restoration payload to
 * `users/<username>/_telegram-encrypted.json`, keyed off the X25519 identity
 * secret.
 */
export async function writeEncryptedBackup(
  username: string,
  payload: EncryptedPairingPayload,
  identitySecret: Uint8Array,
): Promise<void> {
  const encrypted = await encryptToken(JSON.stringify(payload), identitySecret);
  const sidecar: EncryptedTokenSidecar = {
    version: 1,
    encrypted_token: encrypted,
    saved_at: new Date().toISOString(),
  };
  await fileService.writeJson(backupPath(username), sidecar);
}

/** Returns the sidecar envelope, or null if missing/malformed. */
export async function readEncryptedBackup(
  username: string,
): Promise<EncryptedTokenSidecar | null> {
  const raw = await fileService.readJson<EncryptedTokenSidecar>(backupPath(username));
  if (!raw || raw.version !== 1 || typeof raw.encrypted_token !== "string") {
    return null;
  }
  return raw;
}

/**
 * Read + decrypt the encrypted backup for `username` with the X25519 identity
 * secret. Returns null on any failure (missing sidecar, malformed envelope,
 * wrong key, tampered ciphertext, JSON that doesn't decode to the expected
 * shape).
 */
export async function decryptEncryptedBackup(
  username: string,
  identitySecret: Uint8Array,
): Promise<EncryptedPairingPayload | null> {
  const sidecar = await readEncryptedBackup(username);
  if (!sidecar) return null;
  const plain = await decryptToken(sidecar.encrypted_token, identitySecret);
  if (plain === null) return null;
  try {
    const parsed = JSON.parse(plain) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { botToken?: unknown }).botToken !== "string" ||
      typeof (parsed as { chatId?: unknown }).chatId !== "number" ||
      typeof (parsed as { botUsername?: unknown }).botUsername !== "string"
    ) {
      return null;
    }
    // Allow-list serialization. The interface only declares the three canonical
    // fields; if a legacy sidecar carries extras like `botFirstName`, drop them
    // so the in-memory surface matches the typed contract (constraint #6).
    const narrowed = parsed as {
      botToken: string;
      chatId: number;
      botUsername: string;
    };
    return {
      botToken: narrowed.botToken,
      chatId: narrowed.chatId,
      botUsername: narrowed.botUsername,
    };
  } catch {
    return null;
  }
}

export async function hasEncryptedBackup(username: string): Promise<boolean> {
  return fileService.fileExists(backupPath(username));
}

export async function deleteEncryptedBackup(username: string): Promise<void> {
  await fileService.deleteFile(backupPath(username));
}
