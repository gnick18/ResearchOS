// OAuth key-bind request-body validation. The bind email comes from the Auth.js
// session, so this body carries no email and no otp, only the keys, signature,
// and issuedAt.

import { describe, expect, it } from "vitest";

import { parseOAuthBindBody } from "../validation";

const HEX64 = "a".repeat(64);
const SIG = "b".repeat(128);
const ISSUED_AT = "2026-06-03T12:00:00.000Z";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    x25519PublicKey: HEX64,
    ed25519PublicKey: HEX64,
    keyBackupBlob: "opaque-blob",
    signature: SIG,
    issuedAt: ISSUED_AT,
    ...overrides,
  };
}

describe("parseOAuthBindBody", () => {
  it("accepts a fully valid body", () => {
    const parsed = parseOAuthBindBody(validBody());
    expect(parsed).not.toBeNull();
    expect(parsed?.x25519PublicKey).toBe(HEX64);
    expect(parsed?.ed25519PublicKey).toBe(HEX64);
    expect(parsed?.signature).toBe(SIG);
    expect(parsed?.keyBackupBlob).toBe("opaque-blob");
    expect(parsed?.issuedAt).toBe(ISSUED_AT);
  });

  it("never reads an email or otp from the body", () => {
    // Even if a caller sends email/otp, they are ignored and not surfaced.
    const parsed = parseOAuthBindBody(
      validBody({ email: "attacker@example.com", otp: "123456" }),
    );
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed ?? {})).not.toContain("email");
    expect(Object.keys(parsed ?? {})).not.toContain("otp");
  });

  it("coerces an absent backup blob to null", () => {
    const parsed = parseOAuthBindBody(validBody({ keyBackupBlob: undefined }));
    expect(parsed?.keyBackupBlob).toBeNull();
  });

  it("coerces an explicit null backup blob to null", () => {
    const parsed = parseOAuthBindBody(validBody({ keyBackupBlob: null }));
    expect(parsed?.keyBackupBlob).toBeNull();
  });

  it("rejects an empty-string backup blob (must be null or non-empty)", () => {
    expect(parseOAuthBindBody(validBody({ keyBackupBlob: "" }))).toBeNull();
  });

  it("rejects a non-hex public key", () => {
    expect(
      parseOAuthBindBody(validBody({ x25519PublicKey: "ZZZ" })),
    ).toBeNull();
    expect(
      parseOAuthBindBody(validBody({ ed25519PublicKey: "0xABCD" })),
    ).toBeNull();
  });

  it("rejects an uppercase-hex public key (wire encoding is lowercase)", () => {
    expect(
      parseOAuthBindBody(validBody({ x25519PublicKey: "ABCD" })),
    ).toBeNull();
  });

  it("rejects a missing public key", () => {
    expect(
      parseOAuthBindBody(validBody({ x25519PublicKey: undefined })),
    ).toBeNull();
    expect(
      parseOAuthBindBody(validBody({ ed25519PublicKey: undefined })),
    ).toBeNull();
  });

  it("rejects a non-hex or missing signature", () => {
    expect(parseOAuthBindBody(validBody({ signature: "xyz" }))).toBeNull();
    expect(parseOAuthBindBody(validBody({ signature: undefined }))).toBeNull();
  });

  it("rejects a missing or malformed issuedAt", () => {
    expect(parseOAuthBindBody(validBody({ issuedAt: undefined }))).toBeNull();
    expect(parseOAuthBindBody(validBody({ issuedAt: "not-a-date" }))).toBeNull();
    // A loose form Date would coerce but that does not round-trip is rejected.
    expect(parseOAuthBindBody(validBody({ issuedAt: "2026-06-03" }))).toBeNull();
  });

  it("rejects a non-object body", () => {
    expect(parseOAuthBindBody(null)).toBeNull();
    expect(parseOAuthBindBody("nope")).toBeNull();
    expect(parseOAuthBindBody(42)).toBeNull();
  });
});
