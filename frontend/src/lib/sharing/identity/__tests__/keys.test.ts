// Phase 1a identity keys, generation, encode/decode round-trip, fingerprint.
//
// Runs in the node-env vitest project (.test.ts), where WebCrypto is available
// for the noble CSPRNG.

import { describe, expect, it } from "vitest";

import {
  decodePublicKey,
  encodePublicKey,
  fingerprint,
  generateIdentityKeys,
} from "../keys";

describe("generateIdentityKeys", () => {
  it("produces 32-byte X25519 and Ed25519 keypairs", () => {
    const id = generateIdentityKeys();
    expect(id.encryption.publicKey).toBeInstanceOf(Uint8Array);
    expect(id.encryption.publicKey.length).toBe(32);
    expect(id.encryption.privateKey.length).toBe(32);
    expect(id.signing.publicKey.length).toBe(32);
    expect(id.signing.privateKey.length).toBe(32);
  });

  it("produces a distinct keypair on each call", () => {
    const a = generateIdentityKeys();
    const b = generateIdentityKeys();
    expect(encodePublicKey(a.encryption.publicKey)).not.toBe(
      encodePublicKey(b.encryption.publicKey),
    );
    expect(encodePublicKey(a.signing.publicKey)).not.toBe(
      encodePublicKey(b.signing.publicKey),
    );
  });

  it("keeps the encryption and signing keys independent", () => {
    const id = generateIdentityKeys();
    expect(encodePublicKey(id.encryption.publicKey)).not.toBe(
      encodePublicKey(id.signing.publicKey),
    );
  });
});

describe("encodePublicKey / decodePublicKey", () => {
  it("round-trips a public key through hex", () => {
    const id = generateIdentityKeys();
    const hex = encodePublicKey(id.signing.publicKey);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    const back = decodePublicKey(hex);
    expect(Array.from(back)).toEqual(Array.from(id.signing.publicKey));
  });
});

describe("fingerprint", () => {
  it("is deterministic for a given key", () => {
    const id = generateIdentityKeys();
    expect(fingerprint(id.signing.publicKey)).toBe(
      fingerprint(id.signing.publicKey),
    );
  });

  it("differs for different keys", () => {
    const a = generateIdentityKeys();
    const b = generateIdentityKeys();
    expect(fingerprint(a.signing.publicKey)).not.toBe(
      fingerprint(b.signing.publicKey),
    );
  });

  it("renders four space-separated groups of four hex digits", () => {
    const id = generateIdentityKeys();
    const fp = fingerprint(id.signing.publicKey);
    expect(fp).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
  });
});
