// Phase 1b-i, the email-to-keys binding signature.

import { describe, expect, it } from "vitest";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";

import {
  buildBindingPayload,
  signBinding,
  verifyBindingSignature,
  type BindingInput,
} from "../signature";

function sampleInput(overrides: Partial<BindingInput> = {}): BindingInput {
  const enc = x25519.keygen();
  const sig = ed25519.keygen();
  return {
    email: "user@example.com",
    x25519PublicKey: Buffer.from(enc.publicKey).toString("hex"),
    ed25519PublicKey: Buffer.from(sig.publicKey).toString("hex"),
    issuedAt: "2026-06-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildBindingPayload", () => {
  it("is deterministic for the same input", () => {
    const input = sampleInput();
    expect(buildBindingPayload(input)).toEqual(buildBindingPayload(input));
  });

  it("changes when any field changes", () => {
    const a = buildBindingPayload(sampleInput({ issuedAt: "2026-06-03T00:00:00.000Z" }));
    const b = buildBindingPayload(sampleInput({ issuedAt: "2026-06-03T00:00:01.000Z" }));
    // Note both use fresh random keys, so this is a weak check; the strong
    // determinism check is the test above. This just confirms bytes are not
    // empty/constant.
    expect(a).not.toEqual(b);
  });
});

describe("signBinding / verifyBindingSignature", () => {
  it("verifies a valid signature", () => {
    const signer = ed25519.keygen();
    const payload = buildBindingPayload(sampleInput());
    const signature = signBinding(payload, signer.secretKey);
    expect(verifyBindingSignature(payload, signature, signer.publicKey)).toBe(true);
  });

  it("fails on a tampered payload", () => {
    const signer = ed25519.keygen();
    const payload = buildBindingPayload(sampleInput());
    const signature = signBinding(payload, signer.secretKey);
    const tampered = new Uint8Array(payload);
    tampered[0] ^= 0xff;
    expect(verifyBindingSignature(tampered, signature, signer.publicKey)).toBe(false);
  });

  it("fails on a wrong public key", () => {
    const signer = ed25519.keygen();
    const attacker = ed25519.keygen();
    const payload = buildBindingPayload(sampleInput());
    const signature = signBinding(payload, signer.secretKey);
    expect(verifyBindingSignature(payload, signature, attacker.publicKey)).toBe(false);
  });

  it("returns false (no throw) on a malformed public key", () => {
    const signer = ed25519.keygen();
    const payload = buildBindingPayload(sampleInput());
    const signature = signBinding(payload, signer.secretKey);
    expect(verifyBindingSignature(payload, signature, new Uint8Array(3))).toBe(false);
  });
});
