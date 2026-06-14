// At-rest device identity envelope (OAuth-only identity model, P1 / P3b).
//
// The keypair is WRAPPED at rest under the recovery mnemonic (Argon2id, 128-bit).
// The passkey door was removed in P3b (2026-06-08); the recovery code / 12 words
// are the single unlock path. storage.ts persists a WrappedDeviceKey and unlocks
// it into session-key.ts. See docs/proposals/IDENTITY_OAUTH_ONLY.md.

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { concatBytes } from "@noble/hashes/utils.js";

import {
  type BackupBlob,
  type KdfParams,
  PROD_KDF_PARAMS,
  deriveWrappingKey,
  generateRecoveryWords,
  generateSalt,
  makeBackupBlob,
  openBackupBlob,
  unwrapKeys,
  wrapKeys,
} from "./backup";
import {
  type IdentityKeys,
  decodePublicKey,
  encodePublicKey,
  fingerprint,
} from "./keys";
import {
  mnemonicToRecoveryCode,
  normalizeRecoveryInput,
} from "./recovery-code";

// The private bundle is the X25519 secret followed by the Ed25519 secret, each 32
// raw bytes, the fixed order the rest of the identity code uses.
const X25519_PRIVATE_BYTES = 32;

/**
 * The wrapped device identity as persisted by storage.ts. The private bundle is
 * sealed under the recovery mnemonic (Argon2id, 128-bit). One door, no plaintext
 * bundle on disk.
 */
export interface WrappedDeviceKey {
  version: 2;
  x25519PublicKey: string;
  ed25519PublicKey: string;
  fingerprint: string;
  recoveryBlob: BackupBlob;
}

function bundleOf(keys: IdentityKeys): Uint8Array {
  return concatBytes(keys.encryption.privateKey, keys.signing.privateKey);
}

function reassemble(
  bundle: Uint8Array,
  x25519PublicKey: string,
  ed25519PublicKey: string,
): IdentityKeys {
  return {
    encryption: {
      publicKey: decodePublicKey(x25519PublicKey),
      privateKey: bundle.slice(0, X25519_PRIVATE_BYTES),
    },
    signing: {
      publicKey: decodePublicKey(ed25519PublicKey),
      privateKey: bundle.slice(X25519_PRIVATE_BYTES),
    },
  };
}

function wrapUnderRecovery(
  bundle: Uint8Array,
  mnemonic: string,
  params: KdfParams,
): BackupBlob {
  const salt = generateSalt();
  // null device salt, the blob is folder/disk-stored and must be openable with
  // the secret alone (e.g. the recovery code typed on a fresh device).
  const key = deriveWrappingKey(mnemonic, salt, null, params);
  return makeBackupBlob(wrapKeys(bundle, key), salt, params);
}

function unwrapUnderRecovery(blob: BackupBlob, mnemonic: string): Uint8Array {
  const opened = openBackupBlob(blob);
  const key = deriveWrappingKey(mnemonic, opened.salt, null, opened.params);
  return unwrapKeys(opened.ciphertext, opened.nonce, key);
}

export interface WrappedDeviceKeyResult {
  wrapped: WrappedDeviceKey;
  /** Shown once at setup, the friendlier base32 rendering of the same secret. */
  recoveryCode: string;
  /** The equivalent 12 words, same 128-bit secret. */
  recoveryWords: string;
}

/**
 * Wraps a keypair at rest under a fresh recovery mnemonic.
 *
 * Argon2id runs once here (heavy under PROD params), so the UI calls this off the
 * main thread. Tests pass fast params.
 */
export function wrapDeviceKey(
  keys: IdentityKeys,
  params: KdfParams = PROD_KDF_PARAMS,
): WrappedDeviceKeyResult {
  const recoveryWords = generateRecoveryWords();
  const bundle = bundleOf(keys);
  const wrapped: WrappedDeviceKey = {
    version: 2,
    x25519PublicKey: encodePublicKey(keys.encryption.publicKey),
    ed25519PublicKey: encodePublicKey(keys.signing.publicKey),
    fingerprint: fingerprint(keys.signing.publicKey),
    recoveryBlob: wrapUnderRecovery(bundle, recoveryWords, params),
  };
  return {
    wrapped,
    recoveryCode: mnemonicToRecoveryCode(recoveryWords),
    recoveryWords,
  };
}

/**
 * Wraps a keypair at rest under EXISTING recovery words (rather than minting new
 * ones). Used at profile setup so the sidecar blob and the directory backup blob
 * share ONE recovery secret, the user only ever has a single recovery code.
 */
export function wrapDeviceKeyWithWords(
  keys: IdentityKeys,
  recoveryWords: string,
  params: KdfParams = PROD_KDF_PARAMS,
): WrappedDeviceKey {
  return {
    version: 2,
    x25519PublicKey: encodePublicKey(keys.encryption.publicKey),
    ed25519PublicKey: encodePublicKey(keys.signing.publicKey),
    fingerprint: fingerprint(keys.signing.publicKey),
    recoveryBlob: wrapUnderRecovery(bundleOf(keys), recoveryWords, params),
  };
}

/** Unlocks with the recovery code OR the 12 words. Null on an invalid secret. */
export function unlockDeviceKeyWithRecovery(
  wrapped: WrappedDeviceKey,
  codeOrWords: string,
): IdentityKeys | null {
  const mnemonic = normalizeRecoveryInput(codeOrWords);
  if (!mnemonic) return null;
  try {
    const bundle = unwrapUnderRecovery(wrapped.recoveryBlob, mnemonic);
    return reassemble(bundle, wrapped.x25519PublicKey, wrapped.ed25519PublicKey);
  } catch {
    return null;
  }
}

/**
 * Unlocks a keypair from a bare recovery BackupBlob, WITHOUT the public keys.
 *
 * The folderless cross-device restore (Phase 2 Chunk 2A) fetches only the
 * directory's opaque key_backup_blob (the mnemonic-wrapped private bundle), it
 * does NOT carry the public keys alongside. Since the unwrapped bundle is the two
 * private keys, the matching public keys are re-derived from them on the curve
 * (X25519 and Ed25519 both derive a public key from the secret key), so no
 * separately-stored public material is needed. Returns null on an invalid secret
 * or a tampered blob (the Poly1305 tag enforces this).
 */
export function unlockKeysFromRecoveryBlob(
  recoveryBlob: BackupBlob,
  codeOrWords: string,
): IdentityKeys | null {
  const mnemonic = normalizeRecoveryInput(codeOrWords);
  if (!mnemonic) return null;
  try {
    const bundle = unwrapUnderRecovery(recoveryBlob, mnemonic);
    const encPriv = bundle.slice(0, X25519_PRIVATE_BYTES);
    const sigPriv = bundle.slice(X25519_PRIVATE_BYTES);
    return {
      encryption: {
        publicKey: x25519.getPublicKey(encPriv),
        privateKey: encPriv,
      },
      signing: {
        publicKey: ed25519.getPublicKey(sigPriv),
        privateKey: sigPriv,
      },
    };
  } catch {
    return null;
  }
}

