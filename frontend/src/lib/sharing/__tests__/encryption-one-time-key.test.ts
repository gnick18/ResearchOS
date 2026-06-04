// Cross-boundary sharing, the one-time-key seal/open (the INVITE path).
//
// The invite flow seals a bundle under a fresh random symmetric key (the
// recipient has no identity key yet) and carries that key in the accept-link
// fragment. These tests pin the round-trip, the per-seal key/nonce freshness,
// and the tamper / wrong-key rejection. Pure crypto, no network.

import { describe, expect, it } from "vitest";
import { utf8ToBytes } from "@noble/hashes/utils.js";

import {
  sealUnderOneTimeKey,
  openWithOneTimeKey,
} from "@/lib/sharing/encryption";

const PLAINTEXT = utf8ToBytes("a sealed note bundle, opaque to the relay");

describe("sealUnderOneTimeKey / openWithOneTimeKey", () => {
  it("round-trips the plaintext with the returned key", () => {
    const { sealed, key } = sealUnderOneTimeKey(PLAINTEXT);
    expect(key.length).toBe(32);
    // sealed is nonce(24) || ciphertext, so it is strictly longer than the input.
    expect(sealed.length).toBeGreaterThan(PLAINTEXT.length + 24 - 1);
    const opened = openWithOneTimeKey(sealed, key);
    expect(opened).toEqual(PLAINTEXT);
  });

  it("mints a fresh key and ciphertext per seal (no reuse)", () => {
    const a = sealUnderOneTimeKey(PLAINTEXT);
    const b = sealUnderOneTimeKey(PLAINTEXT);
    // Independent keys.
    expect(Buffer.from(a.key)).not.toEqual(Buffer.from(b.key));
    // Independent ciphertext (fresh nonce + fresh key).
    expect(Buffer.from(a.sealed)).not.toEqual(Buffer.from(b.sealed));
  });

  it("rejects a wrong key", () => {
    const { sealed } = sealUnderOneTimeKey(PLAINTEXT);
    const wrong = new Uint8Array(32).fill(9);
    expect(() => openWithOneTimeKey(sealed, wrong)).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const { sealed, key } = sealUnderOneTimeKey(PLAINTEXT);
    const tampered = sealed.slice();
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => openWithOneTimeKey(tampered, key)).toThrow();
  });

  it("rejects a key of the wrong length", () => {
    const { sealed } = sealUnderOneTimeKey(PLAINTEXT);
    expect(() => openWithOneTimeKey(sealed, new Uint8Array(16))).toThrow();
  });

  it("rejects input shorter than the nonce", () => {
    const { key } = sealUnderOneTimeKey(PLAINTEXT);
    expect(() => openWithOneTimeKey(new Uint8Array(10), key)).toThrow();
  });
});
