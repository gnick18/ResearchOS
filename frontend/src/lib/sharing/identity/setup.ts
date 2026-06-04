// Cross-boundary sharing, identity-setup orchestration (Phase 1c-i).
//
// Pure helpers that stitch the Phase 1a crypto primitives into the three flows
// the setup UI drives, create a fresh identity, build the directory bind
// request, and rescue an identity from Recovery Words on a new device. This
// module does NO I/O, no network, no File System Access, no IndexedDB. Every
// side effect (publishing to the directory, stashing private keys, writing the
// sidecar) is the caller's job. That keeps the security-sensitive sequencing
// testable in isolation.
//
// PERFORMANCE, createIdentityMaterial and restoreFromRecoveryWords each run
// Argon2id (deriveWrappingKey). With PROD_KDF_PARAMS that is a heavy, 64 MiB
// step that MUST run off the main thread in a Web Worker, or the UI freezes.
// The params are an argument so tests pass fast values, never the prod default.

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, concatBytes } from "@noble/hashes/utils.js";

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
import { encodePublicKey, fingerprint, generateIdentityKeys } from "./keys";
import { canonicalizeEmail } from "../directory/email";
import { buildBindingPayload, signBinding } from "../directory/signature";

// The private bundle is the X25519 secret key followed by the Ed25519 secret
// key, each 32 raw bytes. wrapKeys / unwrapKeys treat it as an opaque blob, so
// this fixed order is the only contract that matters, and both wrap and restore
// honour it.
const X25519_PRIVATE_BYTES = 32;

/**
 * The freshly generated identity material handed back to the setup caller.
 *
 * - x25519PublicKey / ed25519PublicKey, hex-encoded, for the directory and the
 *   sidecar.
 * - x25519PrivateKey / ed25519PrivateKey, RAW bytes, for the caller to stash in
 *   IndexedDB. These never get hex-encoded here and never leave the device
 *   except wrapped inside backupBlob.
 * - fingerprint, the grouped safety-check string.
 * - recoveryWords, the 12-word mnemonic shown once at setup.
 * - backupBlob, the serialized (JSON string) wrapped private bundle, published
 *   to the directory so a new device can rescue the keys from the words alone.
 */
export interface IdentityMaterial {
  x25519PublicKey: string;
  ed25519PublicKey: string;
  x25519PrivateKey: Uint8Array;
  ed25519PrivateKey: Uint8Array;
  fingerprint: string;
  recoveryWords: string;
  backupBlob: string;
}

/**
 * The recovered keypair from the cross-device rescue path. Public keys are
 * hex-encoded, private keys are raw bytes for the caller to stash.
 */
export interface RestoredIdentity {
  x25519PublicKey: string;
  ed25519PublicKey: string;
  x25519PrivateKey: Uint8Array;
  ed25519PrivateKey: Uint8Array;
}

/**
 * The request body for the directory bind routes. This is the exact shape
 * /api/directory/oauth-bind expects (parseOAuthBindBody). The email-OTP path at
 * /api/directory/verify layers `email` and `otp` on top of these fields, the
 * caller adds those, this helper never touches the email-OTP surface.
 */
export interface BindRequestBody {
  x25519PublicKey: string;
  ed25519PublicKey: string;
  keyBackupBlob: string;
  signature: string;
  issuedAt: string;
}

export interface CreateIdentityParams {
  /**
   * Argon2id cost params for wrapping the private bundle under the Recovery
   * Words. Defaults to PROD_KDF_PARAMS. Tests MUST pass fast params.
   */
  params?: KdfParams;
}

/**
 * Generates a complete sharing identity, an X25519 + Ed25519 keypair plus 12
 * Recovery Words, and wraps the private keys under those words into a serialized
 * backup blob for the directory.
 *
 * The words are fed VERBATIM as the wrapping passphrase (no device salt, this is
 * the device-independent mnemonic blob, so the words alone unlock it on a fresh
 * device). The caller is responsible for everything that follows, persisting the
 * raw private keys to IndexedDB, publishing the public keys plus backupBlob to
 * the directory, and writing the sidecar.
 *
 * PERFORMANCE, the deriveWrappingKey step is Argon2id and is heavy under
 * PROD_KDF_PARAMS, so the UI MUST call this inside a Web Worker.
 */
export function createIdentityMaterial(
  params: CreateIdentityParams = {},
): IdentityMaterial {
  const kdf = params.params ?? PROD_KDF_PARAMS;

  const identity = generateIdentityKeys();
  const recoveryWords = generateRecoveryWords();

  const privateBundle = concatBytes(
    identity.encryption.privateKey,
    identity.signing.privateKey,
  );

  const salt = generateSalt();
  // null device salt, the mnemonic blob is device-independent on purpose.
  const wrappingKey = deriveWrappingKey(recoveryWords, salt, null, kdf);
  const wrapped = wrapKeys(privateBundle, wrappingKey);
  const blob = makeBackupBlob(wrapped, salt, kdf);

  return {
    x25519PublicKey: encodePublicKey(identity.encryption.publicKey),
    ed25519PublicKey: encodePublicKey(identity.signing.publicKey),
    x25519PrivateKey: identity.encryption.privateKey,
    ed25519PrivateKey: identity.signing.privateKey,
    fingerprint: fingerprint(identity.signing.publicKey),
    recoveryWords,
    backupBlob: JSON.stringify(blob),
  };
}

export interface BuildBindRequestInput {
  email: string;
  x25519PublicKey: string;
  ed25519PublicKey: string;
  ed25519PrivateKey: Uint8Array;
  backupBlob: string;
  issuedAt: string;
}

/**
 * Builds and signs the directory bind request body.
 *
 * The email is canonicalized (lowercased, trimmed) before it goes into the
 * signed binding payload, so the bytes the client signs match the bytes the
 * server reconstructs from the verified email. The signature is over the v2
 * binding payload (version line plus fixed-order fields), hex-encoded for
 * transport.
 */
export function buildBindRequest(input: BuildBindRequestInput): BindRequestBody {
  const canonical = canonicalizeEmail(input.email);
  const payload = buildBindingPayload({
    email: canonical,
    x25519PublicKey: input.x25519PublicKey,
    ed25519PublicKey: input.ed25519PublicKey,
    issuedAt: input.issuedAt,
  });
  const signature = signBinding(payload, input.ed25519PrivateKey);

  return {
    x25519PublicKey: input.x25519PublicKey,
    ed25519PublicKey: input.ed25519PublicKey,
    keyBackupBlob: input.backupBlob,
    signature: bytesToHex(signature),
    issuedAt: input.issuedAt,
  };
}

/**
 * The request body for the directory rotate route (/api/directory/rotate,
 * parseRotateBody). It carries the NEW public keys plus a signature, but the
 * signature is minted with the user's OLD Ed25519 private key, which is what the
 * route verifies against the currently stored key. The route ignores keyBackupBlob
 * when null (keeping the stored one), but a rotation hands fresh recovery words so
 * the caller passes the new wrapped blob.
 */
export interface RotateRequestBody {
  email: string;
  newX25519PublicKey: string;
  newEd25519PublicKey: string;
  keyBackupBlob: string;
  signature: string;
  issuedAt: string;
}

export interface BuildRotateRequestInput {
  email: string;
  /** The new (post-rotation) X25519 public key, hex-encoded. */
  newX25519PublicKey: string;
  /** The new (post-rotation) Ed25519 public key, hex-encoded. */
  newEd25519PublicKey: string;
  /**
   * The CURRENT (old) Ed25519 private key, raw bytes. The rotate route verifies
   * the signature against the stored (old) public key, so only the holder of the
   * existing key can authorize new keys. This is NOT the new private key.
   */
  oldEd25519PrivateKey: Uint8Array;
  /** The new wrapped backup blob (fresh recovery words wrap the new keys). */
  backupBlob: string;
  issuedAt: string;
}

/**
 * Builds and signs the directory rotate request body. Mirrors buildBindRequest,
 * except the signed binding payload names the NEW public keys while the signature
 * is produced with the OLD signing key. The email is canonicalized so the bytes
 * the client signs match the bytes the server reconstructs from the verified
 * binding (the rotate route rebuilds the same payload over the new keys).
 */
export function buildRotateRequest(
  input: BuildRotateRequestInput,
): RotateRequestBody {
  const canonical = canonicalizeEmail(input.email);
  const payload = buildBindingPayload({
    email: canonical,
    x25519PublicKey: input.newX25519PublicKey,
    ed25519PublicKey: input.newEd25519PublicKey,
    issuedAt: input.issuedAt,
  });
  const signature = signBinding(payload, input.oldEd25519PrivateKey);

  return {
    email: canonical,
    newX25519PublicKey: input.newX25519PublicKey,
    newEd25519PublicKey: input.newEd25519PublicKey,
    keyBackupBlob: input.backupBlob,
    signature: bytesToHex(signature),
    issuedAt: input.issuedAt,
  };
}

/**
 * Rescues an identity from its Recovery Words and the directory backup blob, the
 * cross-device path. Throws if the words are wrong (the Poly1305 tag fails) or
 * the blob is malformed.
 *
 * The blob is the JSON string produced by createIdentityMaterial. Params default
 * to PROD_KDF_PARAMS but are an argument so tests pass fast values. The params
 * baked into the blob (t, m, p) are what actually drive the derive, the argument
 * only fills dkLen via openBackupBlob, so the supplied params must still match
 * what the blob was created under in production.
 */
export function restoreFromRecoveryWords(
  recoveryWords: string,
  backupBlob: string,
  _params: CreateIdentityParams = {},
): RestoredIdentity {
  const blob = JSON.parse(backupBlob) as BackupBlob;
  const opened = openBackupBlob(blob);

  // Reproduce the wrapping key from the words and the blob's own salt/params.
  // null device salt, this is the device-independent mnemonic blob.
  const wrappingKey = deriveWrappingKey(
    recoveryWords,
    opened.salt,
    null,
    opened.params,
  );

  // Throws on a bad phrase (Poly1305 authentication failure).
  const privateBundle = unwrapKeys(
    opened.ciphertext,
    opened.nonce,
    wrappingKey,
  );

  const x25519PrivateKey = privateBundle.slice(0, X25519_PRIVATE_BYTES);
  const ed25519PrivateKey = privateBundle.slice(X25519_PRIVATE_BYTES);

  // Recover the public halves deterministically from the secret keys so the
  // caller never has to trust a separately stored public key.
  const x25519PublicKey = x25519GetPublicKey(x25519PrivateKey);
  const ed25519PublicKey = ed25519GetPublicKey(ed25519PrivateKey);

  return {
    x25519PublicKey: encodePublicKey(x25519PublicKey),
    ed25519PublicKey: encodePublicKey(ed25519PublicKey),
    x25519PrivateKey,
    ed25519PrivateKey,
  };
}

// Local re-derivation of public keys from secret keys, kept here so setup.ts
// stays self-contained and does not widen keys.ts's surface. Both use the same
// @noble/curves v2 API keys.ts uses.
function x25519GetPublicKey(secret: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secret);
}

function ed25519GetPublicKey(secret: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(secret);
}
