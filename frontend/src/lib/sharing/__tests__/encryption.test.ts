// Tests for the sealed-box bundle encryption layer (X25519 + XChaCha20-Poly1305).
//
// Test keypairs are generated with x25519 from @noble directly, matching the
// raw-key convention in identity/keys.ts. These cover the round-trip (including
// a multi-kilobyte buffer), tamper rejection, wrong-recipient rejection, the
// short-input guard, and the fresh-ephemeral property.

import { describe, expect, it } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";

import { openSealed, sealToRecipient } from "../encryption";

function newRecipient(): { publicKey: Uint8Array; privateKey: Uint8Array } {
  const kp = x25519.keygen();
  return { publicKey: kp.publicKey, privateKey: kp.secretKey };
}

describe("sealed-box bundle encryption", () => {
  it("round-trips an arbitrary small payload", () => {
    const recipient = newRecipient();
    const plaintext = new TextEncoder().encode("a small bundle payload");

    const sealed = sealToRecipient(plaintext, recipient.publicKey);
    const opened = openSealed(sealed, recipient.privateKey);

    expect(opened).toEqual(plaintext);
  });

  it("round-trips a multi-kilobyte buffer", () => {
    const recipient = newRecipient();
    const plaintext = new Uint8Array(8 * 1024);
    for (let i = 0; i < plaintext.length; i++) {
      plaintext[i] = (i * 31 + 7) & 0xff;
    }

    const sealed = sealToRecipient(plaintext, recipient.publicKey);
    const opened = openSealed(sealed, recipient.privateKey);

    expect(opened).toEqual(plaintext);
  });

  it("round-trips an empty payload", () => {
    const recipient = newRecipient();
    const plaintext = new Uint8Array(0);

    const sealed = sealToRecipient(plaintext, recipient.publicKey);
    const opened = openSealed(sealed, recipient.privateKey);

    expect(opened).toEqual(plaintext);
  });

  it("produces an output framed as epk (32) || nonce (24) || ct", () => {
    const recipient = newRecipient();
    const plaintext = new TextEncoder().encode("frame check");

    const sealed = sealToRecipient(plaintext, recipient.publicKey);

    // 32 (epk) + 24 (nonce) + plaintext + 16 (poly1305 tag).
    expect(sealed.length).toBe(32 + 24 + plaintext.length + 16);
  });

  it("throws when any single byte in the sealed output is flipped", () => {
    const recipient = newRecipient();
    const plaintext = new TextEncoder().encode(
      "tamper detection across the whole sealed blob",
    );
    const sealed = sealToRecipient(plaintext, recipient.publicKey);

    // Flip one bit at a sampled set of offsets spanning epk, nonce, and ct.
    const offsets = [
      0, // ephemeral public key
      31,
      32, // nonce
      55,
      56, // ciphertext body
      sealed.length - 1, // poly1305 tag
    ];

    for (const offset of offsets) {
      const corrupted = Uint8Array.from(sealed);
      corrupted[offset] ^= 0x01;
      expect(() => openSealed(corrupted, recipient.privateKey)).toThrow();
    }
  });

  it("throws when opened with a different recipient private key", () => {
    const recipient = newRecipient();
    const other = newRecipient();
    const plaintext = new TextEncoder().encode("not for the other party");

    const sealed = sealToRecipient(plaintext, recipient.publicKey);

    expect(() => openSealed(sealed, other.privateKey)).toThrow();
  });

  it("throws when the sealed input is shorter than the header", () => {
    const recipient = newRecipient();
    const tooShort = new Uint8Array(55); // header is 56 bytes

    expect(() => openSealed(tooShort, recipient.privateKey)).toThrow();
  });

  it("throws when the recipient public key is the wrong length", () => {
    const plaintext = new TextEncoder().encode("x");
    const badKey = new Uint8Array(31);

    expect(() => sealToRecipient(plaintext, badKey)).toThrow();
  });

  it("produces different ciphertexts for two seals of the same plaintext (fresh ephemeral)", () => {
    const recipient = newRecipient();
    const plaintext = new TextEncoder().encode("same input, different output");

    const a = sealToRecipient(plaintext, recipient.publicKey);
    const b = sealToRecipient(plaintext, recipient.publicKey);

    // Distinct ephemeral keys and nonces, so the full blobs must differ.
    expect(a).not.toEqual(b);
    // The ephemeral public key prefix must differ specifically.
    expect(a.subarray(0, 32)).not.toEqual(b.subarray(0, 32));

    // Both still open to the same plaintext.
    expect(openSealed(a, recipient.privateKey)).toEqual(plaintext);
    expect(openSealed(b, recipient.privateKey)).toEqual(plaintext);
  });
});
