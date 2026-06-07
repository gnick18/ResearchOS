// At-rest device identity envelope (OAuth-only identity model, P1).
//
// Today storage.ts persists the keypair as RAW bytes. That is fine when a
// folder-level password gates the app, but under the new model the everyday gate
// is a passkey, so the on-device key must be WRAPPED at rest, nothing usable on
// disk without a passkey ceremony (or the recovery code offline).
//
// This module is pure crypto + serialization, no I/O and no WebAuthn calls. It
// composes the already-shipped primitives: backup.ts (Argon2id recovery wrap) and
// passkey.ts (HKDF-over-PRF wrap). storage.ts will persist a WrappedDeviceKey and
// unlock it into session-key.ts; webauthn.ts supplies the PRF output at the call
// site. See docs/proposals/IDENTITY_OAUTH_ONLY.md.

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
  type PrfBackupBlob,
  unwrapKeysWithPrf,
  wrapKeysWithPrf,
} from "./passkey";
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
 * sealed under the recovery mnemonic (always) and the passkey PRF (once enrolled).
 * Two doors to the same key, no plaintext bundle on disk.
 */
export interface WrappedDeviceKey {
  version: 2;
  x25519PublicKey: string;
  ed25519PublicKey: string;
  fingerprint: string;
  recoveryBlob: BackupBlob;
  passkeyBlob?: PrfBackupBlob;
  /** Which platform passkey to ask for at unlock (discoverable creds aside). */
  passkeyCredentialId?: string;
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
 * Wraps a keypair at rest under a fresh recovery mnemonic. A passkey is added
 * later via addPasskeyToDeviceKey once the WebAuthn ceremony yields a PRF output.
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
 * Adds (or replaces) the passkey door on an already-wrapped device key. The PRF
 * output comes from the WebAuthn ceremony at the call site (webauthn.ts).
 */
export function addPasskeyToDeviceKey(
  wrapped: WrappedDeviceKey,
  keys: IdentityKeys,
  prfOutput: Uint8Array,
  credentialId: string,
): WrappedDeviceKey {
  return {
    ...wrapped,
    passkeyBlob: wrapKeysWithPrf(bundleOf(keys), prfOutput),
    passkeyCredentialId: credentialId,
  };
}

/** Removes the passkey door, leaving only the recovery door. */
export function removePasskeyFromDeviceKey(
  wrapped: WrappedDeviceKey,
): WrappedDeviceKey {
  const next = { ...wrapped };
  delete next.passkeyBlob;
  delete next.passkeyCredentialId;
  return next;
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

/** Unlocks with a passkey PRF output. Null when no passkey door or wrong PRF. */
export function unlockDeviceKeyWithPasskey(
  wrapped: WrappedDeviceKey,
  prfOutput: Uint8Array,
): IdentityKeys | null {
  if (!wrapped.passkeyBlob) return null;
  try {
    const bundle = unwrapKeysWithPrf(wrapped.passkeyBlob, prfOutput);
    return reassemble(bundle, wrapped.x25519PublicKey, wrapped.ed25519PublicKey);
  } catch {
    return null;
  }
}

/** Whether a passkey door is enrolled on this device key. */
export function hasPasskeyDoor(wrapped: WrappedDeviceKey): boolean {
  return !!wrapped.passkeyBlob;
}
