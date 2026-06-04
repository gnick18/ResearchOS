// Cross-boundary sharing, client-side identity keys (Phase 1a).
//
// Each ResearchOS user holds two long-lived keys generated in the browser at
// identity setup, an X25519 key for encryption and an Ed25519 key for signing.
// The encryption key is what bundles are sealed to, the signing key gives
// sender provenance (sealed-box and age recipient stanzas carry no sender
// authentication on their own). See section 5 of
// docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md.
//
// This module is pure crypto with no network and no storage, so it stays
// trivially testable. Persistence lives in storage.ts, backup and recovery in
// backup.ts.

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/**
 * One asymmetric keypair, raw bytes. Both X25519 and Ed25519 use 32-byte
 * public and 32-byte private (secret) keys under @noble/curves v2.
 */
export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * A user's full identity, an X25519 encryption keypair plus an Ed25519 signing
 * keypair. The public halves are published to the directory, the private halves
 * never leave the device except wrapped (see backup.ts).
 */
export interface IdentityKeys {
  encryption: KeyPair;
  signing: KeyPair;
}

/**
 * Generates a fresh identity, one X25519 encryption keypair and one Ed25519
 * signing keypair.
 *
 * Uses the @noble/curves v2 keygen API. In v2 both `ed25519` and `x25519`
 * expose `keygen()` returning `{ secretKey, publicKey }` (CSPRNG-backed). We
 * normalize that to our `{ publicKey, privateKey }` shape so callers never
 * touch the noble naming.
 */
export function generateIdentityKeys(): IdentityKeys {
  const enc = x25519.keygen();
  const sig = ed25519.keygen();
  return {
    encryption: { publicKey: enc.publicKey, privateKey: enc.secretKey },
    signing: { publicKey: sig.publicKey, privateKey: sig.secretKey },
  };
}

/**
 * Encodes a raw public key as a lowercase hex string for storage in the
 * directory or in a share thread. Public keys are public by definition, so
 * hex is fine, no secret-handling concern here.
 */
export function encodePublicKey(publicKey: Uint8Array): string {
  return bytesToHex(publicKey);
}

/**
 * Decodes a hex-encoded public key back into raw bytes. Throws if the input is
 * not valid hex.
 */
export function decodePublicKey(hex: string): Uint8Array {
  return hexToBytes(hex);
}

/**
 * Produces a short, grouped, human-comparable fingerprint of an Ed25519 public
 * key for a Signal-style safety check (read the groups aloud to confirm you
 * have the right person's key). Deterministic for a given key.
 *
 * Format, the first 8 bytes of SHA-256(publicKey) rendered as four
 * space-separated groups of four hex digits, for example "1a2b 3c4d 5e6f 7a8b".
 * Eight bytes (64 bits) is plenty for an out-of-band visual compare and stays
 * short enough to read aloud.
 */
export function fingerprint(ed25519PublicKey: Uint8Array): string {
  const digest = sha256(ed25519PublicKey);
  const short = digest.slice(0, 8);
  const hex = bytesToHex(short);
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += 4) {
    groups.push(hex.slice(i, i + 4));
  }
  return groups.join(" ");
}
