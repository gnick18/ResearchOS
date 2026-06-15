// Phase 2 Chunk 2C, the at-rest device vault.
//
// The IndexedDB persist/load/clear layer needs a browser and is verified in the
// app; here we exercise the PURE pieces the vault is built on, which is where the
// crypto correctness lives: deterministic keypair serialization plus the
// AES-GCM encrypt/decrypt round-trip against a non-extractable WebCrypto key.
//
// Runs in the node-env vitest project (.test.ts), where globalThis.crypto.subtle
// is available (Node 20+).

import { describe, expect, it } from "vitest";

import { generateIdentityKeys } from "../keys";
import {
  decryptUnderVaultKey,
  deserializeIdentityKeys,
  encryptUnderVaultKey,
  serializeIdentityKeys,
} from "../device-vault";

describe("device-vault serialization", () => {
  it("round-trips a keypair byte-for-byte through serialize/deserialize", () => {
    const keys = generateIdentityKeys();
    const back = deserializeIdentityKeys(serializeIdentityKeys(keys));
    expect(back.encryption.publicKey).toEqual(keys.encryption.publicKey);
    expect(back.encryption.privateKey).toEqual(keys.encryption.privateKey);
    expect(back.signing.publicKey).toEqual(keys.signing.publicKey);
    expect(back.signing.privateKey).toEqual(keys.signing.privateKey);
  });

  it("is deterministic for a given keypair", () => {
    const keys = generateIdentityKeys();
    const a = serializeIdentityKeys(keys);
    const b = serializeIdentityKeys(keys);
    expect(a).toEqual(b);
  });
});

describe("device-vault AES-GCM round-trip", () => {
  it("encrypts then decrypts back to the original keypair under a non-extractable key", async () => {
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false, // non-extractable, the exact policy the vault stores
      ["encrypt", "decrypt"],
    );
    expect(key.extractable).toBe(false);

    const keys = generateIdentityKeys();
    const plaintext = serializeIdentityKeys(keys);
    const payload = await encryptUnderVaultKey(key, plaintext);

    // The stored payload is ciphertext, never the raw bytes.
    expect(payload.ciphertext).not.toEqual(plaintext);
    expect(payload.iv.length).toBe(12);

    const decrypted = await decryptUnderVaultKey(key, payload);
    expect(decrypted).toEqual(plaintext);

    const back = deserializeIdentityKeys(decrypted);
    expect(back.encryption.privateKey).toEqual(keys.encryption.privateKey);
    expect(back.signing.privateKey).toEqual(keys.signing.privateKey);
  });

  it("uses a fresh IV per encrypt so two encrypts of the same plaintext differ", async () => {
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const plaintext = serializeIdentityKeys(generateIdentityKeys());
    const a = await encryptUnderVaultKey(key, plaintext);
    const b = await encryptUnderVaultKey(key, plaintext);
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it("fails to decrypt under a different key (tamper / wrong-key resistance)", async () => {
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const other = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const payload = await encryptUnderVaultKey(
      key,
      serializeIdentityKeys(generateIdentityKeys()),
    );
    await expect(decryptUnderVaultKey(other, payload)).rejects.toBeTruthy();
  });
});
