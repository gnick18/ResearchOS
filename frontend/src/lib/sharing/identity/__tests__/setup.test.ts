// Phase 1c-i identity-setup orchestration tests.
//
// FAST PARAMS ONLY. Every Argon2id-backed call here passes tiny KDF params so
// the suite stays quick. Never use PROD_KDF_PARAMS, the 64 MiB cost would make
// the suite unbearable.
//
// Runs in the node-env vitest project (.test.ts), where WebCrypto backs the
// noble CSPRNG.

import { hexToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";

import { type KdfParams } from "../backup";
import { canonicalizeEmail } from "../../directory/email";
import {
  buildBindingPayload,
  verifyBindingSignature,
} from "../../directory/signature";
import {
  buildBindRequest,
  buildRotateRequest,
  createIdentityMaterial,
  restoreFromRecoveryWords,
} from "../setup";

const FAST: KdfParams = { t: 1, m: 8192, p: 1, dkLen: 32 };

describe("createIdentityMaterial", () => {
  it("produces valid hex public keys, raw private keys, and 12 Recovery Words", () => {
    const material = createIdentityMaterial({ params: FAST });

    // Public keys are 32-byte hex (64 hex chars).
    expect(material.x25519PublicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(material.ed25519PublicKey).toMatch(/^[0-9a-f]{64}$/);

    // Private keys are raw 32-byte arrays, never hex-encoded here.
    expect(material.x25519PrivateKey).toBeInstanceOf(Uint8Array);
    expect(material.x25519PrivateKey.length).toBe(32);
    expect(material.ed25519PrivateKey).toBeInstanceOf(Uint8Array);
    expect(material.ed25519PrivateKey.length).toBe(32);

    // 12 Recovery Words.
    expect(material.recoveryWords.trim().split(/\s+/)).toHaveLength(12);

    // Fingerprint is the grouped safety-check string.
    expect(material.fingerprint).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){3}$/);

    // backupBlob is a serialized JSON string of a v1 argon2id blob.
    const blob = JSON.parse(material.backupBlob);
    expect(blob.v).toBe(1);
    expect(blob.alg).toBe("argon2id");
    expect(typeof blob.salt).toBe("string");
    expect(typeof blob.nonce).toBe("string");
    expect(typeof blob.ciphertext).toBe("string");
  });

  it("generates a distinct identity each call", () => {
    const a = createIdentityMaterial({ params: FAST });
    const b = createIdentityMaterial({ params: FAST });
    expect(a.ed25519PublicKey).not.toBe(b.ed25519PublicKey);
    expect(a.recoveryWords).not.toBe(b.recoveryWords);
  });
});

describe("buildBindRequest", () => {
  it("returns a signature that verifies over the rebuilt v2 payload", () => {
    const material = createIdentityMaterial({ params: FAST });
    const email = "Lab.Member@Example.COM";
    const issuedAt = "2026-06-03T12:00:00.000Z";

    const body = buildBindRequest({
      email,
      x25519PublicKey: material.x25519PublicKey,
      ed25519PublicKey: material.ed25519PublicKey,
      ed25519PrivateKey: material.ed25519PrivateKey,
      backupBlob: material.backupBlob,
      issuedAt,
    });

    expect(body.keyBackupBlob).toBe(material.backupBlob);
    expect(body.issuedAt).toBe(issuedAt);
    expect(body.signature).toMatch(/^[0-9a-f]{128}$/);

    // Rebuild the payload over the CANONICAL email, as the server does.
    const payload = buildBindingPayload({
      email: canonicalizeEmail(email),
      x25519PublicKey: body.x25519PublicKey,
      ed25519PublicKey: body.ed25519PublicKey,
      issuedAt: body.issuedAt,
    });
    const ok = verifyBindingSignature(
      payload,
      hexToBytes(body.signature),
      hexToBytes(body.ed25519PublicKey),
    );
    expect(ok).toBe(true);
  });

  it("fails verification if the email differs from the signed one", () => {
    const material = createIdentityMaterial({ params: FAST });
    const issuedAt = "2026-06-03T12:00:00.000Z";

    const body = buildBindRequest({
      email: "alice@example.com",
      x25519PublicKey: material.x25519PublicKey,
      ed25519PublicKey: material.ed25519PublicKey,
      ed25519PrivateKey: material.ed25519PrivateKey,
      backupBlob: material.backupBlob,
      issuedAt,
    });

    // Rebuild over a DIFFERENT email, signature must not verify.
    const payload = buildBindingPayload({
      email: canonicalizeEmail("mallory@example.com"),
      x25519PublicKey: body.x25519PublicKey,
      ed25519PublicKey: body.ed25519PublicKey,
      issuedAt: body.issuedAt,
    });
    const ok = verifyBindingSignature(
      payload,
      hexToBytes(body.signature),
      hexToBytes(body.ed25519PublicKey),
    );
    expect(ok).toBe(false);
  });

  it("canonicalizes the email so case and whitespace do not change the signature", () => {
    const material = createIdentityMaterial({ params: FAST });
    const issuedAt = "2026-06-03T12:00:00.000Z";

    const a = buildBindRequest({
      email: "  USER@Example.com ",
      x25519PublicKey: material.x25519PublicKey,
      ed25519PublicKey: material.ed25519PublicKey,
      ed25519PrivateKey: material.ed25519PrivateKey,
      backupBlob: material.backupBlob,
      issuedAt,
    });
    const b = buildBindRequest({
      email: "user@example.com",
      x25519PublicKey: material.x25519PublicKey,
      ed25519PublicKey: material.ed25519PublicKey,
      ed25519PrivateKey: material.ed25519PrivateKey,
      backupBlob: material.backupBlob,
      issuedAt,
    });
    expect(a.signature).toBe(b.signature);
  });
});

describe("buildRotateRequest", () => {
  it("signs the NEW binding with the OLD key, verifying against the OLD public key", () => {
    const oldMaterial = createIdentityMaterial({ params: FAST });
    const newMaterial = createIdentityMaterial({ params: FAST });
    const email = "Lab.Member@Example.COM";
    const issuedAt = "2026-06-03T12:00:00.000Z";

    const body = buildRotateRequest({
      email,
      newX25519PublicKey: newMaterial.x25519PublicKey,
      newEd25519PublicKey: newMaterial.ed25519PublicKey,
      oldEd25519PrivateKey: oldMaterial.ed25519PrivateKey,
      backupBlob: newMaterial.backupBlob,
      issuedAt,
    });

    expect(body.email).toBe(canonicalizeEmail(email));
    expect(body.newX25519PublicKey).toBe(newMaterial.x25519PublicKey);
    expect(body.newEd25519PublicKey).toBe(newMaterial.ed25519PublicKey);
    expect(body.keyBackupBlob).toBe(newMaterial.backupBlob);
    expect(body.signature).toMatch(/^[0-9a-f]{128}$/);

    // The route rebuilds the payload over the NEW keys and verifies against the
    // STORED (old) public key, so a valid signature proves the old-key holder
    // authorized the new keys.
    const payload = buildBindingPayload({
      email: canonicalizeEmail(email),
      x25519PublicKey: body.newX25519PublicKey,
      ed25519PublicKey: body.newEd25519PublicKey,
      issuedAt: body.issuedAt,
    });
    const okOld = verifyBindingSignature(
      payload,
      hexToBytes(body.signature),
      hexToBytes(oldMaterial.ed25519PublicKey),
    );
    expect(okOld).toBe(true);

    // It must NOT verify against the new key, a stranger cannot self-sign a
    // replacement of someone else's identity.
    const okNew = verifyBindingSignature(
      payload,
      hexToBytes(body.signature),
      hexToBytes(newMaterial.ed25519PublicKey),
    );
    expect(okNew).toBe(false);
  });
});

describe("restoreFromRecoveryWords", () => {
  it("round-trips the keypair from the words and backup blob", () => {
    const material = createIdentityMaterial({ params: FAST });

    const restored = restoreFromRecoveryWords(
      material.recoveryWords,
      material.backupBlob,
      { params: FAST },
    );

    expect(restored.x25519PublicKey).toBe(material.x25519PublicKey);
    expect(restored.ed25519PublicKey).toBe(material.ed25519PublicKey);
    expect([...restored.x25519PrivateKey]).toEqual([
      ...material.x25519PrivateKey,
    ]);
    expect([...restored.ed25519PrivateKey]).toEqual([
      ...material.ed25519PrivateKey,
    ]);
  });

  it("throws on a wrong Recovery phrase", () => {
    const material = createIdentityMaterial({ params: FAST });
    const wrong =
      "legal winner thank year wave sausage worth useful legal winner thank yellow";
    expect(() =>
      restoreFromRecoveryWords(wrong, material.backupBlob, { params: FAST }),
    ).toThrow();
  });
});
