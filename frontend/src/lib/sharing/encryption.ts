// Cross-boundary sharing, encryption provider contract (Phase 0).
//
// This file declares the encryption SEAM only. The real implementation will
// use the age file format via the typage (age-encryption npm package)
// implementation, and lands in a later phase once identity keys exist
// (keypair generation, the directory, Recovery Words). See section 5 of
// docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md.
//
// Phase 0 ships the bundle engine unencrypted on purpose. We deliberately do
// NOT implement crypto here, do NOT add a crypto dependency, and do NOT ship a
// passthrough or fake provider in non-test code. A real provider that returns
// opaque age ciphertext is the only thing that should ever satisfy this type
// outside of tests.

/**
 * A recipient X25519 public key in age recipient format (for example
 * "age1...."). Multiple recipients are addressed in one ciphertext, each via
 * an independent age stanza.
 */
export type RecipientPublicKey = string;

/**
 * An age identity (private key, for example "AGE-SECRET-KEY-1...."). Held only
 * by the recipient, never by the relay.
 */
export type PrivateKey = string;

/**
 * Encrypts and decrypts portable bundles for cross-boundary sharing.
 *
 * The plaintext is always the zipped RO-Crate-in-BagIt bundle produced by
 * buildBundle. The ciphertext is opaque to the relay, which stores and
 * forwards it without ever holding a key.
 */
export interface EncryptionProvider {
  /**
   * Encrypts a bundle to one or more recipients. The output is opaque age
   * armor or binary that only a holder of a matching private key can open.
   */
  encrypt(
    plaintext: Uint8Array,
    recipientPublicKeys: RecipientPublicKey[],
  ): Promise<Uint8Array>;

  /**
   * Decrypts a bundle addressed to the holder of the given private key.
   * Rejects if the key does not match any recipient stanza.
   */
  decrypt(ciphertext: Uint8Array, privateKey: PrivateKey): Promise<Uint8Array>;
}
