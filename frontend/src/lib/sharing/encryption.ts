// Cross-boundary sharing, bundle encryption (sealed box over raw X25519).
//
// When a user shares an artifact, the sender encrypts the zipped bundle to the
// recipient's X25519 public key (looked up from the directory), the relay
// stores only the opaque ciphertext, and the recipient decrypts with their
// X25519 private key. This module implements that seal and open. See section 5
// of docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md.
//
// Our identity keypairs are raw X25519 keys from @noble/curves (see
// identity/keys.ts), so this layer works with raw keys directly. We do NOT use
// the age file format and we add NO new crypto dependency, everything is built
// from the already-installed audited @noble primitives.
//
// Construction (the standard sealed-box / HPKE-base / libsodium crypto_box_seal
// shape, assembled from @noble parts):
//   seal(plaintext, rpk):
//     1. fresh ephemeral X25519 keypair (esk, epk) per message
//     2. shared = X25519(esk, rpk)
//     3. key = HKDF-SHA256(shared, salt = epk || rpk, info, 32)
//        binding both public keys into the salt ties the derived key to this
//        exact sender-ephemeral and recipient pair
//     4. nonce = 24 random bytes
//     5. ct = XChaCha20-Poly1305(key, nonce).encrypt(plaintext)
//     6. output = epk (32) || nonce (24) || ct
//   open(sealed, rsk):
//     parse epk, nonce, ct, rebuild rpk = X25519.getPublicKey(rsk), redo the
//     ECDH and HKDF, then decrypt. The AEAD throws on tamper or wrong key.
//
// This primitive is single-recipient by design. Multi-recipient sends are
// handled at the send layer (loop, one sealed copy per recipient). The
// EncryptionProvider interface below is the documented multi-recipient contract
// for that layer, this file only provides the single-recipient core.
//
// Pure crypto, no network, no storage, no React.

import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

/**
 * A recipient X25519 public key. In this raw-key world it is the 32-byte public
 * half of the recipient's encryption keypair (see identity/keys.ts), addressed
 * directly rather than in age recipient format.
 */
export type RecipientPublicKey = string;

/**
 * A recipient private key, the 32-byte secret half of the encryption keypair.
 * Held only by the recipient, never by the relay.
 */
export type PrivateKey = string;

/**
 * Encrypts and decrypts portable bundles for cross-boundary sharing.
 *
 * The plaintext is always the zipped RO-Crate-in-BagIt bundle produced by
 * buildBundle. The ciphertext is opaque to the relay, which stores and
 * forwards it without ever holding a key.
 *
 * This is the multi-recipient contract for the send layer. The send layer
 * fulfills it by sealing one independent copy per recipient with
 * sealToRecipient below, the relay never sees a key either way.
 */
export interface EncryptionProvider {
  /**
   * Encrypts a bundle to one or more recipients. The output is opaque binary
   * that only a holder of a matching private key can open.
   */
  encrypt(
    plaintext: Uint8Array,
    recipientPublicKeys: RecipientPublicKey[],
  ): Promise<Uint8Array>;

  /**
   * Decrypts a bundle addressed to the holder of the given private key.
   * Rejects if the key does not match.
   */
  decrypt(ciphertext: Uint8Array, privateKey: PrivateKey): Promise<Uint8Array>;
}

// HKDF info string, versioned so a future construction change is unambiguous.
const SEAL_INFO = utf8ToBytes("researchos.sharing.seal.v1");

// X25519 public/secret keys and the XChaCha20-Poly1305 nonce are all fixed
// length. Naming them keeps the parsing in openSealed self-documenting.
const X25519_KEY_LENGTH = 32;
const NONCE_LENGTH = 24;
const DERIVED_KEY_LENGTH = 32;
const HEADER_LENGTH = X25519_KEY_LENGTH + NONCE_LENGTH; // epk || nonce

/**
 * Derives the per-message AEAD key from an ECDH shared secret. The salt binds
 * the ephemeral public key and the recipient public key, so the key is unique
 * to this exact (ephemeral, recipient) pair and cannot be replayed across
 * recipients. Both seal and open call this with the identical inputs.
 */
function deriveKey(
  shared: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  recipientPublicKey: Uint8Array,
): Uint8Array {
  const salt = concatBytes(ephemeralPublicKey, recipientPublicKey);
  return hkdf(sha256, shared, salt, SEAL_INFO, DERIVED_KEY_LENGTH);
}

/**
 * Seals a plaintext bundle to a single recipient X25519 public key.
 *
 * Generates a fresh ephemeral keypair per call, so two seals of the same
 * plaintext to the same recipient produce different ciphertexts. The returned
 * bytes are epk (32) || nonce (24) || ct and are opaque to the relay.
 *
 * @throws if the recipient public key is not 32 bytes.
 */
export function sealToRecipient(
  plaintext: Uint8Array,
  recipientX25519PublicKey: Uint8Array,
): Uint8Array {
  if (recipientX25519PublicKey.length !== X25519_KEY_LENGTH) {
    throw new Error(
      `sealToRecipient: recipient public key must be ${X25519_KEY_LENGTH} bytes, got ${recipientX25519PublicKey.length}`,
    );
  }

  const ephemeral = x25519.keygen();
  const shared = x25519.getSharedSecret(
    ephemeral.secretKey,
    recipientX25519PublicKey,
  );
  const key = deriveKey(shared, ephemeral.publicKey, recipientX25519PublicKey);

  const nonce = randomBytes(NONCE_LENGTH);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);

  return concatBytes(ephemeral.publicKey, nonce, ciphertext);
}

/**
 * Opens a sealed bundle with the recipient's X25519 private key.
 *
 * Rebuilds the recipient public key from the private key to reconstruct the
 * same HKDF salt, redoes the ECDH, and decrypts. The AEAD verifies the tag, so
 * any tampering with the sealed bytes or a wrong private key causes a throw.
 *
 * @throws if the input is shorter than the header, or if decryption fails
 *   (tamper or wrong key).
 */
export function openSealed(
  sealed: Uint8Array,
  recipientX25519PrivateKey: Uint8Array,
): Uint8Array {
  if (sealed.length < HEADER_LENGTH) {
    throw new Error(
      `openSealed: input too short, need at least ${HEADER_LENGTH} bytes, got ${sealed.length}`,
    );
  }

  const ephemeralPublicKey = sealed.subarray(0, X25519_KEY_LENGTH);
  const nonce = sealed.subarray(X25519_KEY_LENGTH, HEADER_LENGTH);
  const ciphertext = sealed.subarray(HEADER_LENGTH);

  const recipientPublicKey = x25519.getPublicKey(recipientX25519PrivateKey);
  const shared = x25519.getSharedSecret(
    recipientX25519PrivateKey,
    ephemeralPublicKey,
  );
  const key = deriveKey(shared, ephemeralPublicKey, recipientPublicKey);

  // Throws on a bad authentication tag (tamper or wrong key). Let it propagate.
  return xchacha20poly1305(key, nonce).decrypt(ciphertext);
}
