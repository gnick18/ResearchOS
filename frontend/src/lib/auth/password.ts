import { fileService } from "../file-system/file-service";

/**
 * Per-user password gate.
 *
 * The password is *not* used to encrypt data on disk — anyone with access to
 * the OneDrive folder can still read raw markdown and images. The point is to
 * stop a lab member from accidentally signing into the wrong account through
 * the app UI and editing someone else's notes. If a user forgets their
 * password, the user (or a lab admin) can delete `_auth.json` directly in
 * OneDrive to reset the gate.
 *
 * We hash with PBKDF2-SHA-256 via the platform WebCrypto so there's no new
 * dependency. 600k iterations matches the OWASP 2023 recommendation for
 * PBKDF2-SHA-256; it makes offline brute force expensive enough that a 3rd-
 * party in the shared folder won't get past it casually.
 */

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

interface AuthFile {
  version: 1;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  hash: string;
}

function authPath(username: string): string {
  return `users/${username}/_auth.json`;
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
  iterations: number
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    // Cast: TS narrows Uint8Array's underlying buffer to ArrayBufferLike,
    // but WebCrypto's BufferSource expects a concrete ArrayBuffer. The
    // runtime accepts a Uint8Array directly; this just satisfies the type.
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    baseKey,
    HASH_BITS
  );
  return new Uint8Array(bits);
}

/** Does this user have a password set? */
export async function hasPassword(username: string): Promise<boolean> {
  return fileService.fileExists(authPath(username));
}

/** Set or replace the password for the given user. */
export async function setPassword(username: string, password: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveHash(password, salt, PBKDF2_ITERATIONS);
  const data: AuthFile = {
    version: 1,
    kdf: "PBKDF2-SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    hash: toBase64(hash),
  };
  await fileService.writeJson(authPath(username), data);
}

/**
 * Verify a password attempt. Returns true on match, false on mismatch.
 * Returns true if no password is set (i.e. the gate is open).
 */
export async function verifyPassword(username: string, password: string): Promise<boolean> {
  const data = await fileService.readJson<AuthFile>(authPath(username));
  if (!data) return true; // no gate
  if (data.kdf !== "PBKDF2-SHA-256") return false;
  const salt = fromBase64(data.salt);
  const expected = fromBase64(data.hash);
  const actual = await deriveHash(password, salt, data.iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/** Remove the password (disables the gate). Caller is responsible for re-auth. */
export async function removePassword(username: string): Promise<void> {
  await fileService.deleteFile(authPath(username));
}
