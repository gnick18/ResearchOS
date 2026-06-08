// Passkey PRF salt invariant.
//
// The WebAuthn L3 prf extension requires eval.first to be EXACTLY 32 bytes, and
// Chrome enforces this. A non-32-byte salt makes the PRF output absent from
// getClientExtensionResults(), so unlock silently falls back to the recovery
// code and an enrolled passkey can never unlock the identity. This guard makes
// that regression impossible.

import { describe, expect, it } from "vitest";

import { PRF_SALT } from "../webauthn";

describe("PRF_SALT", () => {
  it("is exactly 32 bytes (WebAuthn L3 prf eval.first requirement)", () => {
    expect(PRF_SALT).toBeInstanceOf(Uint8Array);
    expect(PRF_SALT.length).toBe(32);
  });
});
