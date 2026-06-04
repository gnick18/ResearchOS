// Cross-boundary sharing, identity key backup and recovery (Phase 1a).
//
// Vercel has no trusted-execution hardware, so a Signal-SVR-style rate-limited
// server rescue is off the table. We use a passphrase-wrapped scheme with a
// 1Password-style device-salt twist, plus a BIP39 mnemonic ("Recovery Words")
// as the cross-device rescue path. See section 5 of
// docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md.
//
// Two independent wrapped blobs cover the two recovery surfaces.
//   1. A passphrase blob, which MAY mix in the device salt, so a directory
//      breach plus a guessed passphrase still cannot decrypt without the device
//      bytes.
//   2. A mnemonic blob, independently salted with NO device-salt dependency, so
//      the 12 words alone unlock it on a brand new device.
//
// Pure crypto, no network and no storage. Persistence lives in storage.ts.

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { argon2id } from "@noble/hashes/argon2.js";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

/**
 * Argon2id cost parameters. Memory `m` is in KiB per @noble/hashes.
 *   t      iterations (opslimit analog)
 *   m      memory in KiB
 *   p      parallelism lanes
 *   dkLen  derived key length in bytes (32 for an XChaCha20-Poly1305 key)
 *
 * Params are an ARGUMENT to deriveWrappingKey on purpose, so tests can pass
 * fast values while production uses the heavy defaults below.
 */
export interface KdfParams {
  t: number;
  m: number;
  p: number;
  dkLen: number;
}

/**
 * Production Argon2id parameters, t=3 and m=65536 KiB (64 MiB), per the
 * proposal. These are intentionally heavy.
 *
 * PERFORMANCE, these defaults take hundreds of milliseconds and allocate 64 MiB,
 * so in production deriveWrappingKey MUST run off the main thread in a Web
 * Worker or the UI will freeze. The Worker wiring is a later task. Tests MUST
 * pass fast params instead, never PROD_KDF_PARAMS.
 */
export const PROD_KDF_PARAMS: KdfParams = { t: 3, m: 65536, p: 1, dkLen: 32 };

const NONCE_BYTES = 24; // XChaCha20-Poly1305 nonce
const SALT_BYTES = 16; // KDF salt
const DEVICE_SALT_BYTES = 16; // device-salt (2SKD analog)
const KEY_BYTES = 32; // XChaCha20-Poly1305 key

/**
 * The output of wrapping a private bundle, the ciphertext plus the random nonce
 * it was sealed under. Both are needed to unwrap.
 */
export interface WrappedKeys {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

/**
 * A serializable backup blob, suitable for the directory's opaque key-backup
 * field and for a downloadable Recovery Kit. All byte fields are base64. `v` is
 * a format version for forward migration.
 */
export interface BackupBlob {
  v: 1;
  alg: "argon2id";
  t: number;
  m: number;
  p: number;
  salt: string; // base64, the KDF salt actually used (device salt NOT mixed in here)
  nonce: string; // base64
  ciphertext: string; // base64
}

/**
 * XORs the device salt into the KDF salt in place into a fresh buffer. Both
 * inputs must be the same length. This is the device-salt twist, the bytes
 * that actually feed Argon2id are salt XOR deviceSalt, while the blob persists
 * only the plain `salt`, so the device bytes are required to reproduce the key.
 */
function mixDeviceSalt(salt: Uint8Array, deviceSalt: Uint8Array): Uint8Array {
  if (deviceSalt.length !== salt.length) {
    throw new Error(
      `device salt length ${deviceSalt.length} must equal salt length ${salt.length}`,
    );
  }
  const mixed = new Uint8Array(salt.length);
  for (let i = 0; i < salt.length; i += 1) {
    mixed[i] = salt[i] ^ deviceSalt[i];
  }
  return mixed;
}

/**
 * Derives a 32-byte wrapping key from a passphrase (or a verbatim mnemonic)
 * with Argon2id.
 *
 * If `deviceSalt` is provided it is XOR-mixed into `salt` before the KDF runs,
 * the 1Password-style device-salt twist. Pass `null` for the mnemonic blob and
 * any other device-independent path. The same `salt`, `deviceSalt`, and params
 * must be supplied to reproduce the key.
 *
 * PERFORMANCE, see PROD_KDF_PARAMS. With production params this is a heavy,
 * 64 MiB allocation and must run in a Web Worker in the app. Tests pass fast
 * params.
 */
export function deriveWrappingKey(
  passphrase: string,
  salt: Uint8Array,
  deviceSalt: Uint8Array | null,
  params: KdfParams,
): Uint8Array {
  const effectiveSalt = deviceSalt ? mixDeviceSalt(salt, deviceSalt) : salt;
  return argon2id(utf8ToBytes(passphrase), effectiveSalt, {
    t: params.t,
    m: params.m,
    p: params.p,
    dkLen: params.dkLen,
  });
}

/**
 * Seals a private key bundle (the concatenated X25519 and Ed25519 private keys,
 * assembled by the caller) under a 32-byte wrapping key with
 * XChaCha20-Poly1305. Generates a fresh random 24-byte nonce.
 */
export function wrapKeys(
  privateBundle: Uint8Array,
  wrappingKey: Uint8Array,
): WrappedKeys {
  if (wrappingKey.length !== KEY_BYTES) {
    throw new Error(`wrapping key must be ${KEY_BYTES} bytes`);
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = xchacha20poly1305(wrappingKey, nonce);
  const ciphertext = cipher.encrypt(privateBundle);
  return { ciphertext, nonce };
}

/**
 * Opens a wrapped bundle. Throws on authentication failure, which happens when
 * the wrapping key is wrong (wrong passphrase, wrong device salt, or tampered
 * ciphertext). The Poly1305 tag is what enforces this.
 */
export function unwrapKeys(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  wrappingKey: Uint8Array,
): Uint8Array {
  if (wrappingKey.length !== KEY_BYTES) {
    throw new Error(`wrapping key must be ${KEY_BYTES} bytes`);
  }
  const cipher = xchacha20poly1305(wrappingKey, nonce);
  return cipher.decrypt(ciphertext);
}

/**
 * Generates a fresh KDF salt (16 random bytes).
 */
export function generateSalt(): Uint8Array {
  return randomBytes(SALT_BYTES);
}

/**
 * Generates a fresh device salt (16 random bytes). Stored in IndexedDB on this
 * device only (see storage.ts), never published. The 2SKD analog.
 */
export function generateDeviceSalt(): Uint8Array {
  return randomBytes(DEVICE_SALT_BYTES);
}

/**
 * Produces 12 Recovery Words, a 128-bit English BIP39 mnemonic, shown once at
 * setup. The checksum word catches transcription errors. We call these
 * "Recovery Words" in UI copy, never "seed phrase", to avoid crypto-wallet
 * confusion for lab users.
 *
 * The mnemonic string is fed VERBATIM as the passphrase into deriveWrappingKey.
 * We deliberately do NOT run BIP39 seed derivation (mnemonicToSeed), the words
 * are just a high-entropy passphrase here, Argon2id does the stretching.
 */
export function generateRecoveryWords(): string {
  return generateMnemonic(wordlist, 128);
}

/**
 * Validates Recovery Words, both that every word is in the wordlist and that
 * the BIP39 checksum passes.
 */
export function validateRecoveryWords(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, wordlist);
}

// Base64 helpers for the serializable blob. btoa/atob exist in both modern
// browsers and the node test runtime, and we avoid pulling in @scure/base
// since it is not a direct dependency.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Assembles a serializable backup blob from a wrap result, its KDF salt, and
 * the params used. The blob stores the PLAIN salt, never the device-mixed one,
 * so the device salt (when used) stays required to reproduce the key.
 *
 * This shape is used for both blobs. The passphrase blob is created from a
 * derive that passed a device salt, the mnemonic blob from a derive that passed
 * null, the blob itself does not record which, the caller tracks that.
 */
export function makeBackupBlob(
  wrapped: WrappedKeys,
  salt: Uint8Array,
  params: KdfParams,
): BackupBlob {
  return {
    v: 1,
    alg: "argon2id",
    t: params.t,
    m: params.m,
    p: params.p,
    salt: bytesToBase64(salt),
    nonce: bytesToBase64(wrapped.nonce),
    ciphertext: bytesToBase64(wrapped.ciphertext),
  };
}

/**
 * The decoded contents of a backup blob, ready to feed back into
 * deriveWrappingKey and unwrapKeys. The caller supplies the passphrase (or
 * mnemonic) and, for a device-bound passphrase blob, the device salt.
 */
export interface OpenedBackupBlob {
  salt: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  params: KdfParams;
}

/**
 * Decodes a backup blob back into raw bytes and KDF params. Throws on an
 * unsupported version or algorithm so a future format never silently
 * mis-derives.
 */
export function openBackupBlob(blob: BackupBlob): OpenedBackupBlob {
  if (blob.v !== 1) {
    throw new Error(`unsupported backup blob version ${String(blob.v)}`);
  }
  if (blob.alg !== "argon2id") {
    throw new Error(`unsupported backup blob alg ${String(blob.alg)}`);
  }
  return {
    salt: base64ToBytes(blob.salt),
    nonce: base64ToBytes(blob.nonce),
    ciphertext: base64ToBytes(blob.ciphertext),
    params: { t: blob.t, m: blob.m, p: blob.p, dkLen: KEY_BYTES },
  };
}
