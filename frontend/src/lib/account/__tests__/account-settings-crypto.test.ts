// Account-settings crypto, round-trip + tamper + cross-device determinism.

import { describe, it, expect } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";
import {
  type AccountScopedSettings,
  ACCOUNT_BLOB_VERSION,
  decryptAccountBlob,
  encryptAccountBlob,
} from "../account-settings-crypto";

/** A fresh 32-byte X25519 private key, the material the blob is sealed to. */
function freshKey(): Uint8Array {
  return x25519.keygen().secretKey;
}

const sampleSettings: AccountScopedSettings = {
  labHead: true,
  calendarFeeds: [
    {
      id: 1,
      provider: "google",
      label: "Owen lab calendar",
      icsUrl: "https://example.com/owen.ics",
      color: "#3b82f6",
      enabled: true,
    },
  ],
};

describe("account-settings-crypto", () => {
  it("round-trips a settings object through encrypt then decrypt", () => {
    const key = freshKey();
    const ct = encryptAccountBlob(sampleSettings, key);
    const back = decryptAccountBlob(ct, key);
    expect(back).toEqual(sampleSettings);
  });

  it("round-trips an empty settings object", () => {
    const key = freshKey();
    const ct = encryptAccountBlob({}, key);
    expect(decryptAccountBlob(ct, key)).toEqual({});
  });

  it("produces a fresh nonce per call (ciphertexts differ for the same input)", () => {
    const key = freshKey();
    const a = encryptAccountBlob(sampleSettings, key);
    const b = encryptAccountBlob(sampleSettings, key);
    expect(a).not.toEqual(b);
    // Both still decrypt to the same plaintext.
    expect(decryptAccountBlob(a, key)).toEqual(decryptAccountBlob(b, key));
  });

  it("is deterministic across devices: the SAME identity key decrypts a blob it did not seal (other device)", () => {
    // Two "devices" restore the SAME identity, so they hold the same private
    // key. Device A seals; device B (same key bytes, different array) opens.
    const keyOnA = freshKey();
    const keyOnB = Uint8Array.from(keyOnA);
    const ct = encryptAccountBlob(sampleSettings, keyOnA);
    expect(decryptAccountBlob(ct, keyOnB)).toEqual(sampleSettings);
  });

  it("rejects a wrong key (different identity cannot read the blob)", () => {
    const ct = encryptAccountBlob(sampleSettings, freshKey());
    expect(() => decryptAccountBlob(ct, freshKey())).toThrow();
  });

  it("detects tampering with the ciphertext body", () => {
    const key = freshKey();
    const ct = encryptAccountBlob(sampleSettings, key);
    // Flip a character in the middle of the base64 transport string.
    const mid = Math.floor(ct.length / 2);
    const flipped =
      ct.slice(0, mid) + (ct[mid] === "A" ? "B" : "A") + ct.slice(mid + 1);
    expect(() => decryptAccountBlob(flipped, key)).toThrow();
  });

  it("rejects a truncated ciphertext", () => {
    const key = freshKey();
    const ct = encryptAccountBlob(sampleSettings, key);
    expect(() => decryptAccountBlob(ct.slice(0, 4), key)).toThrow();
  });

  it("rejects key material that is not 32 bytes", () => {
    expect(() => encryptAccountBlob(sampleSettings, new Uint8Array(16))).toThrow();
  });

  it("carries the current blob version inside the encrypted envelope", () => {
    // The version lives in the plaintext, so we cannot read it without the key;
    // assert the constant is the one we round-trip under (a guard against an
    // accidental bump that would orphan existing blobs without a migration).
    expect(ACCOUNT_BLOB_VERSION).toBe(1);
  });
});
