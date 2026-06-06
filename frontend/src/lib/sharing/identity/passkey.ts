// Cross-boundary sharing, passkey (WebAuthn PRF) key wrapping.
// Passkey identity unlock, chunk 1 (crypto core).
//
// A third way to wrap the on-device identity private bundle, alongside the
// passphrase and mnemonic blobs in backup.ts. Here the 32-byte
// XChaCha20-Poly1305 wrapping key comes from a WebAuthn PRF output rather than
// Argon2id over a secret the user types. The user signs in with their existing
// platform passkey (Google or Apple), the authenticator returns a deterministic
// PRF secret for our fixed salt, and we HKDF that into the wrapping key.
//
// This module is PURE crypto and serialization. It does NOT call the WebAuthn
// API (navigator.credentials), that browser glue is a later chunk. Tests feed a
// fixed PRF output directly.
//
// SECURITY, the PRF output never leaves the device and is never published. The
// directory only ever holds the wrapped blob below, which is useless without the
// user's authenticator. See docs/proposals/PASSKEY_IDENTITY_UNLOCK.md.

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import {
  base64ToBytes,
  bytesToBase64,
  unwrapKeys,
  wrapKeys,
  type WrappedKeys,
} from "./backup";

const KEY_BYTES = 32; // XChaCha20-Poly1305 key
const HKDF_SALT_BYTES = 32;

// Fixed HKDF info bytes, domain-separates this derivation from any other HKDF
// use in the app (the relay seal in encryption.ts uses its own info). Stable
// forever, changing it would orphan every passkey blob.
const PRF_HKDF_INFO = utf8ToBytes("researchos/sharing/passkey-prf/v1");

/**
 * A serializable passkey-wrapped backup blob. Parallel to BackupBlob but with no
 * Argon2id params, the wrapping key comes from the PRF output via HKDF, not a
 * KDF over a typed secret. All byte fields are base64. `v` is a format version.
 *
 * hkdfSalt is a per-blob random salt fed to HKDF-Extract. The PRF output is
 * already high-entropy, so the salt is hygiene rather than a strict requirement,
 * but storing it keeps each blob's derivation independent.
 */
export interface PrfBackupBlob {
  v: 1;
  alg: "webauthn-prf";
  hkdfSalt: string; // base64
  nonce: string; // base64
  ciphertext: string; // base64
}

/**
 * Derives the 32-byte XChaCha20-Poly1305 wrapping key from a WebAuthn PRF output
 * with HKDF-SHA256. Deterministic, the same prfOutput plus hkdfSalt always
 * returns the same key, which is what lets a synced passkey unwrap on every
 * device.
 */
export function derivePrfWrappingKey(
  prfOutput: Uint8Array,
  hkdfSalt: Uint8Array,
): Uint8Array {
  return hkdf(sha256, prfOutput, hkdfSalt, PRF_HKDF_INFO, KEY_BYTES);
}

/** Generates a fresh per-blob HKDF salt (32 random bytes). */
export function generatePrfHkdfSalt(): Uint8Array {
  return randomBytes(HKDF_SALT_BYTES);
}

/** Assembles a serializable PRF blob from a wrap result and its HKDF salt. */
export function makePrfBackupBlob(
  wrapped: WrappedKeys,
  hkdfSalt: Uint8Array,
): PrfBackupBlob {
  return {
    v: 1,
    alg: "webauthn-prf",
    hkdfSalt: bytesToBase64(hkdfSalt),
    nonce: bytesToBase64(wrapped.nonce),
    ciphertext: bytesToBase64(wrapped.ciphertext),
  };
}

export interface OpenedPrfBackupBlob {
  hkdfSalt: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * Decodes a PRF blob back into raw bytes. Throws on an unsupported version or
 * algorithm so a future format never silently mis-derives.
 */
export function openPrfBackupBlob(blob: PrfBackupBlob): OpenedPrfBackupBlob {
  if (blob.v !== 1) {
    throw new Error(`unsupported passkey blob version ${String(blob.v)}`);
  }
  if (blob.alg !== "webauthn-prf") {
    throw new Error(`unsupported passkey blob alg ${String(blob.alg)}`);
  }
  return {
    hkdfSalt: base64ToBytes(blob.hkdfSalt),
    nonce: base64ToBytes(blob.nonce),
    ciphertext: base64ToBytes(blob.ciphertext),
  };
}

/**
 * Seals a private key bundle under a PRF output. Generates a fresh HKDF salt and
 * a fresh nonce (inside wrapKeys), so two seals of the same bundle differ.
 */
export function wrapKeysWithPrf(
  privateBundle: Uint8Array,
  prfOutput: Uint8Array,
): PrfBackupBlob {
  const hkdfSalt = generatePrfHkdfSalt();
  const wrappingKey = derivePrfWrappingKey(prfOutput, hkdfSalt);
  const wrapped = wrapKeys(privateBundle, wrappingKey);
  return makePrfBackupBlob(wrapped, hkdfSalt);
}

/**
 * Opens a PRF-wrapped blob with a PRF output. Throws on authentication failure
 * (wrong passkey, wrong PRF output, or tampered ciphertext), the Poly1305 tag
 * enforces it.
 */
export function unwrapKeysWithPrf(
  blob: PrfBackupBlob,
  prfOutput: Uint8Array,
): Uint8Array {
  const opened = openPrfBackupBlob(blob);
  const wrappingKey = derivePrfWrappingKey(prfOutput, opened.hkdfSalt);
  return unwrapKeys(opened.ciphertext, opened.nonce, wrappingKey);
}
