// Identity model simplification, the unified login rebuild, crypto core.
//
// The local account file is a per-user folder file (a `_account.json` that
// retires `_auth.json`) holding the user's keypair wrapped by their password and
// their recovery code. Logging in means unwrapping the password blob, a wrong
// password fails the Poly1305 tag. Password, recovery code, and (later) passkey
// are three doors to the SAME local keypair, the exact envelope idea from the
// passkey arc.
//
// This module is pure crypto and serialization, no I/O. The per-user file read,
// the migration from `_auth.json`, and the login UX are later chunks. It reuses
// the Argon2id passphrase path in sharing/identity/backup.ts, so there is no new
// KDF or cipher here. Device salt is NOT mixed in, the blobs live in the folder
// and must unwrap with the secret alone on any device.
//
// See docs/proposals/IDENTITY_MODEL_SIMPLIFICATION.md.

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
} from "@/lib/sharing/identity/backup";
import {
  encodePublicKey,
  fingerprint,
  generateIdentityKeys,
} from "@/lib/sharing/identity/keys";
import {
  mnemonicToRecoveryCode,
  normalizeRecoveryInput,
} from "@/lib/sharing/identity/recovery-code";

// The private bundle is the X25519 secret followed by the Ed25519 secret, each 32
// raw bytes, the same fixed order setup.ts uses.
const X25519_PRIVATE_BYTES = 32;

/**
 * The per-user local account file. Public fields plus the wrapped private keys.
 * `passwordBlob` and `recoveryBlob` wrap the same private bundle under two
 * different secrets. A passkey blob is attached later by enrollment.
 */
export interface LocalAccountFile {
  version: 1;
  x25519PublicKey: string;
  ed25519PublicKey: string;
  fingerprint: string;
  passwordBlob: BackupBlob;
  recoveryBlob: BackupBlob;
}

/** The unwrapped keys handed to a session after a successful unlock. */
export interface UnlockedKeys {
  x25519PublicKey: string;
  ed25519PublicKey: string;
  x25519PrivateKey: Uint8Array;
  ed25519PrivateKey: Uint8Array;
}

/** What createLocalAccount hands back. The recovery code is shown once. */
export interface CreatedLocalAccount {
  file: LocalAccountFile;
  recoveryCode: string; // base32, the friendlier rendering shown at setup
  recoveryWords: string; // the equivalent 12 words, same 128-bit secret
  keys: UnlockedKeys; // so the caller can start a session without re-unlocking
}

function wrapBundleUnder(
  bundle: Uint8Array,
  passphrase: string,
  params: KdfParams,
): BackupBlob {
  const salt = generateSalt();
  // null device salt, the blob is folder-stored and must be device-portable.
  const key = deriveWrappingKey(passphrase, salt, null, params);
  return makeBackupBlob(wrapKeys(bundle, key), salt, params);
}

function unwrapBundle(blob: BackupBlob, passphrase: string): Uint8Array {
  const opened = openBackupBlob(blob);
  // The blob carries its own KDF params, so the derive reproduces the key from
  // the stored salt and params. Throws (Poly1305) on a wrong secret.
  const key = deriveWrappingKey(passphrase, opened.salt, null, opened.params);
  return unwrapKeys(opened.ciphertext, opened.nonce, key);
}

function splitBundle(bundle: Uint8Array, file: LocalAccountFile): UnlockedKeys {
  return {
    x25519PublicKey: file.x25519PublicKey,
    ed25519PublicKey: file.ed25519PublicKey,
    x25519PrivateKey: bundle.slice(0, X25519_PRIVATE_BYTES),
    ed25519PrivateKey: bundle.slice(X25519_PRIVATE_BYTES),
  };
}

/**
 * Creates a fresh local account, a keypair wrapped under the password and under a
 * recovery code. Also covers the migration case, a caller that has verified an old
 * `_auth.json` password just calls this with that password to upgrade the user in
 * place.
 *
 * PERFORMANCE, this runs Argon2id twice (heavy under PROD_KDF_PARAMS), so the UI
 * must call it off the main thread. Tests pass fast params.
 */
export function createLocalAccount(
  password: string,
  params: KdfParams = PROD_KDF_PARAMS,
): CreatedLocalAccount {
  const identity = generateIdentityKeys();
  const recoveryWords = generateRecoveryWords();
  const bundle = concatBytes(
    identity.encryption.privateKey,
    identity.signing.privateKey,
  );

  const file: LocalAccountFile = {
    version: 1,
    x25519PublicKey: encodePublicKey(identity.encryption.publicKey),
    ed25519PublicKey: encodePublicKey(identity.signing.publicKey),
    fingerprint: fingerprint(identity.signing.publicKey),
    passwordBlob: wrapBundleUnder(bundle, password, params),
    recoveryBlob: wrapBundleUnder(bundle, recoveryWords, params),
  };

  return {
    file,
    recoveryCode: mnemonicToRecoveryCode(recoveryWords),
    recoveryWords,
    keys: splitBundle(bundle, file),
  };
}

/**
 * Unlocks the account with a password. Returns the keys on success, or null when
 * the password is wrong. This replaces the old hash compare, the password is
 * correct exactly when it unwraps the blob.
 */
export function unlockWithPassword(
  file: LocalAccountFile,
  password: string,
): UnlockedKeys | null {
  try {
    return splitBundle(unwrapBundle(file.passwordBlob, password), file);
  } catch {
    return null;
  }
}

/**
 * Unlocks with the recovery code OR the 12 recovery words, both canonicalize to
 * the same mnemonic. The forgotten-password fallback. Returns null on an invalid
 * or non-matching secret.
 */
export function unlockWithRecovery(
  file: LocalAccountFile,
  codeOrWords: string,
): UnlockedKeys | null {
  const mnemonic = normalizeRecoveryInput(codeOrWords);
  if (!mnemonic) return null;
  try {
    return splitBundle(unwrapBundle(file.recoveryBlob, mnemonic), file);
  } catch {
    return null;
  }
}

/**
 * Re-wraps the keypair under a new password, keeping the same identity and the
 * same recovery blob. Returns the updated file, or null when the current password
 * is wrong. The recovery code is unchanged.
 */
export function changePassword(
  file: LocalAccountFile,
  currentPassword: string,
  newPassword: string,
  params: KdfParams = PROD_KDF_PARAMS,
): LocalAccountFile | null {
  const unlocked = unlockWithPassword(file, currentPassword);
  if (!unlocked) return null;
  const bundle = concatBytes(
    unlocked.x25519PrivateKey,
    unlocked.ed25519PrivateKey,
  );
  return { ...file, passwordBlob: wrapBundleUnder(bundle, newPassword, params) };
}
