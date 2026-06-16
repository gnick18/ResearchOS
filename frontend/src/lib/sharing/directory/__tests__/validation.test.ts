// Phase 1b-ii, directory request-body validation and response shaping.

import { describe, expect, it } from "vitest";

import {
  parseEmailBody,
  parseInstitutionSlug,
  parseRotateBody,
  parseVerifyBody,
  shapeLookupResult,
} from "../validation";

const HEX64 = "a".repeat(64);
const SIG = "b".repeat(128);
const ISSUED_AT = "2026-06-03T12:00:00.000Z";

function validVerifyBody(overrides: Record<string, unknown> = {}) {
  return {
    email: "alice@example.com",
    otp: "123456",
    x25519PublicKey: HEX64,
    ed25519PublicKey: HEX64,
    keyBackupBlob: "opaque-blob",
    signature: SIG,
    issuedAt: ISSUED_AT,
    ...overrides,
  };
}

describe("parseEmailBody", () => {
  it("accepts a plausible email and trims it", () => {
    expect(parseEmailBody({ email: "  alice@example.com " })).toEqual({
      email: "alice@example.com",
    });
  });

  it("rejects a non-object body", () => {
    expect(parseEmailBody(null)).toBeNull();
    expect(parseEmailBody("alice@example.com")).toBeNull();
    expect(parseEmailBody(42)).toBeNull();
  });

  it("rejects a missing or empty email", () => {
    expect(parseEmailBody({})).toBeNull();
    expect(parseEmailBody({ email: "" })).toBeNull();
    expect(parseEmailBody({ email: "   " })).toBeNull();
  });

  it("rejects an obviously malformed email", () => {
    expect(parseEmailBody({ email: "not-an-email" })).toBeNull();
    expect(parseEmailBody({ email: "a@b" })).toBeNull();
    expect(parseEmailBody({ email: "a@@b.com" })).toBeNull();
  });

  it("rejects a non-string email", () => {
    expect(parseEmailBody({ email: 123 })).toBeNull();
  });
});

describe("parseVerifyBody", () => {
  it("accepts a fully valid body", () => {
    const parsed = parseVerifyBody(validVerifyBody());
    expect(parsed).not.toBeNull();
    expect(parsed?.email).toBe("alice@example.com");
    expect(parsed?.otp).toBe("123456");
    expect(parsed?.keyBackupBlob).toBe("opaque-blob");
    expect(parsed?.issuedAt).toBe(ISSUED_AT);
  });

  it("coerces an absent backup blob to null", () => {
    const parsed = parseVerifyBody(validVerifyBody({ keyBackupBlob: undefined }));
    expect(parsed?.keyBackupBlob).toBeNull();
  });

  it("coerces an explicit null backup blob to null", () => {
    const parsed = parseVerifyBody(validVerifyBody({ keyBackupBlob: null }));
    expect(parsed?.keyBackupBlob).toBeNull();
  });

  it("rejects an OTP that is not exactly 6 digits", () => {
    expect(parseVerifyBody(validVerifyBody({ otp: "12345" }))).toBeNull();
    expect(parseVerifyBody(validVerifyBody({ otp: "1234567" }))).toBeNull();
    expect(parseVerifyBody(validVerifyBody({ otp: "12a456" }))).toBeNull();
  });

  it("rejects a non-hex public key", () => {
    expect(
      parseVerifyBody(validVerifyBody({ x25519PublicKey: "ZZZ" })),
    ).toBeNull();
    expect(
      parseVerifyBody(validVerifyBody({ ed25519PublicKey: "0xABCD" })),
    ).toBeNull();
  });

  it("rejects an uppercase-hex public key (wire encoding is lowercase)", () => {
    expect(
      parseVerifyBody(validVerifyBody({ x25519PublicKey: "ABCD" })),
    ).toBeNull();
  });

  it("rejects a non-hex signature", () => {
    expect(parseVerifyBody(validVerifyBody({ signature: "xyz" }))).toBeNull();
  });

  it("rejects a missing or malformed issuedAt", () => {
    expect(parseVerifyBody(validVerifyBody({ issuedAt: undefined }))).toBeNull();
    expect(parseVerifyBody(validVerifyBody({ issuedAt: "not-a-date" }))).toBeNull();
    // A loose form Date would coerce but that does not round-trip is rejected.
    expect(
      parseVerifyBody(validVerifyBody({ issuedAt: "2026-06-03" })),
    ).toBeNull();
  });

  it("rejects an empty-string backup blob (must be null or non-empty)", () => {
    expect(parseVerifyBody(validVerifyBody({ keyBackupBlob: "" }))).toBeNull();
  });

  it("rejects a non-object body", () => {
    expect(parseVerifyBody(null)).toBeNull();
    expect(parseVerifyBody("nope")).toBeNull();
  });

  it("defaults the optional displayName to null when absent or blank", () => {
    expect(parseVerifyBody(validVerifyBody())?.displayName).toBeNull();
    expect(
      parseVerifyBody(validVerifyBody({ displayName: "   " }))?.displayName,
    ).toBeNull();
    expect(
      parseVerifyBody(validVerifyBody({ displayName: 42 }))?.displayName,
    ).toBeNull();
  });

  it("trims and length-caps a present displayName without rejecting the body", () => {
    expect(
      parseVerifyBody(validVerifyBody({ displayName: "  Grant Nickles  " }))
        ?.displayName,
    ).toBe("Grant Nickles");
    const long = "x".repeat(250);
    expect(
      parseVerifyBody(validVerifyBody({ displayName: long }))?.displayName
        ?.length,
    ).toBe(100);
  });
});

function validRotateBody(overrides: Record<string, unknown> = {}) {
  return {
    email: "alice@example.com",
    newX25519PublicKey: HEX64,
    newEd25519PublicKey: HEX64,
    signature: SIG,
    issuedAt: ISSUED_AT,
    keyBackupBlob: "opaque-blob",
    ...overrides,
  };
}

describe("parseRotateBody", () => {
  it("accepts a fully valid body", () => {
    const parsed = parseRotateBody(validRotateBody());
    expect(parsed).not.toBeNull();
    expect(parsed?.email).toBe("alice@example.com");
    expect(parsed?.newX25519PublicKey).toBe(HEX64);
    expect(parsed?.newEd25519PublicKey).toBe(HEX64);
    expect(parsed?.signature).toBe(SIG);
    expect(parsed?.issuedAt).toBe(ISSUED_AT);
    expect(parsed?.keyBackupBlob).toBe("opaque-blob");
  });

  it("trims the email", () => {
    const parsed = parseRotateBody(validRotateBody({ email: " alice@example.com " }));
    expect(parsed?.email).toBe("alice@example.com");
  });

  it("coerces an absent backup blob to null", () => {
    const parsed = parseRotateBody(validRotateBody({ keyBackupBlob: undefined }));
    expect(parsed?.keyBackupBlob).toBeNull();
  });

  it("coerces an explicit null backup blob to null", () => {
    const parsed = parseRotateBody(validRotateBody({ keyBackupBlob: null }));
    expect(parsed?.keyBackupBlob).toBeNull();
  });

  it("rejects an empty-string backup blob (must be null or non-empty)", () => {
    expect(parseRotateBody(validRotateBody({ keyBackupBlob: "" }))).toBeNull();
  });

  it("rejects a missing or malformed email", () => {
    expect(parseRotateBody(validRotateBody({ email: undefined }))).toBeNull();
    expect(parseRotateBody(validRotateBody({ email: "not-an-email" }))).toBeNull();
    expect(parseRotateBody(validRotateBody({ email: 123 }))).toBeNull();
  });

  it("rejects a non-hex new public key", () => {
    expect(
      parseRotateBody(validRotateBody({ newX25519PublicKey: "ZZZ" })),
    ).toBeNull();
    expect(
      parseRotateBody(validRotateBody({ newEd25519PublicKey: "0xABCD" })),
    ).toBeNull();
  });

  it("rejects an uppercase-hex new public key (wire encoding is lowercase)", () => {
    expect(
      parseRotateBody(validRotateBody({ newEd25519PublicKey: "ABCD" })),
    ).toBeNull();
  });

  it("rejects a missing new public key", () => {
    expect(
      parseRotateBody(validRotateBody({ newX25519PublicKey: undefined })),
    ).toBeNull();
    expect(
      parseRotateBody(validRotateBody({ newEd25519PublicKey: "" })),
    ).toBeNull();
  });

  it("rejects a non-hex or missing signature", () => {
    expect(parseRotateBody(validRotateBody({ signature: "xyz" }))).toBeNull();
    expect(parseRotateBody(validRotateBody({ signature: undefined }))).toBeNull();
  });

  it("rejects a missing or malformed issuedAt", () => {
    expect(parseRotateBody(validRotateBody({ issuedAt: undefined }))).toBeNull();
    expect(parseRotateBody(validRotateBody({ issuedAt: "not-a-date" }))).toBeNull();
    // A loose form Date would coerce but that does not round-trip is rejected.
    expect(parseRotateBody(validRotateBody({ issuedAt: "2026-06-03" }))).toBeNull();
  });

  it("rejects a non-object body", () => {
    expect(parseRotateBody(null)).toBeNull();
    expect(parseRotateBody("nope")).toBeNull();
    expect(parseRotateBody(42)).toBeNull();
  });
});

describe("shapeLookupResult", () => {
  it("returns only the public keys and fingerprint, never the backup blob", () => {
    const shaped = shapeLookupResult({
      x25519PublicKey: "x",
      ed25519PublicKey: "e",
      fingerprint: "1a2b 3c4d 5e6f 7a8b",
    });
    expect(shaped).toEqual({
      x25519PublicKey: "x",
      ed25519PublicKey: "e",
      fingerprint: "1a2b 3c4d 5e6f 7a8b",
    });
    expect(Object.keys(shaped)).not.toContain("keyBackupBlob");
    expect(Object.keys(shaped)).not.toContain("emailHash");
  });
});

describe("parseInstitutionSlug", () => {
  it("accepts a domain-shaped slug and lowercases it", () => {
    expect(parseInstitutionSlug("wisc.edu")).toBe("wisc.edu");
    expect(parseInstitutionSlug("  Wisc.EDU ")).toBe("wisc.edu");
    expect(parseInstitutionSlug("med.uni-bonn.de")).toBe("med.uni-bonn.de");
  });

  it("rejects non-strings, empty, too short, or too long", () => {
    expect(parseInstitutionSlug(undefined)).toBeNull();
    expect(parseInstitutionSlug(123)).toBeNull();
    expect(parseInstitutionSlug("")).toBeNull();
    expect(parseInstitutionSlug("ab")).toBeNull(); // no dot + too short
    expect(parseInstitutionSlug("a." + "x".repeat(100))).toBeNull();
  });

  it("requires a dot and rejects non-domain / traversal characters", () => {
    expect(parseInstitutionSlug("nodot")).toBeNull();
    expect(parseInstitutionSlug("a/b.edu")).toBeNull();
    expect(parseInstitutionSlug("../etc.passwd")).toBeNull();
    expect(parseInstitutionSlug("a..b.edu")).toBeNull();
    expect(parseInstitutionSlug(".edu")).toBeNull();
    expect(parseInstitutionSlug("wisc.edu.")).toBeNull();
    expect(parseInstitutionSlug("a b.edu")).toBeNull();
  });
});
