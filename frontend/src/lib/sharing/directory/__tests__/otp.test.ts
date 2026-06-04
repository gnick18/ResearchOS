// Phase 1b-i, OTP generation, hashing, and constant-time verification.

import { describe, expect, it } from "vitest";
import { randomBytes } from "@noble/hashes/utils.js";

import { generateOtp, hashOtp, verifyOtp } from "../otp";

describe("generateOtp", () => {
  it("returns exactly 6 numeric digits", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it("preserves leading zeros (always length 6)", () => {
    for (let i = 0; i < 2000; i++) {
      expect(generateOtp()).toHaveLength(6);
    }
  });

  it("only ever emits digits 0-9 across many samples", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      for (const ch of generateOtp()) seen.add(ch);
    }
    expect([...seen].sort()).toEqual([
      "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    ]);
  });

  it("produces varied values (not a constant)", () => {
    const values = new Set<string>();
    for (let i = 0; i < 200; i++) values.add(generateOtp());
    // With a CSPRNG over a million-value space, 200 draws should be nearly all
    // distinct; require a generous lower bound to stay non-flaky.
    expect(values.size).toBeGreaterThan(150);
  });
});

describe("hashOtp / verifyOtp", () => {
  it("round-trips a correct code", () => {
    const salt = randomBytes(16);
    const otp = generateOtp();
    const hash = hashOtp(otp, salt);
    expect(verifyOtp(otp, salt, hash)).toBe(true);
  });

  it("rejects a wrong code", () => {
    const salt = randomBytes(16);
    const hash = hashOtp("123456", salt);
    expect(verifyOtp("654321", salt, hash)).toBe(false);
  });

  it("rejects a correct code under the wrong salt", () => {
    const otp = "000123";
    const hash = hashOtp(otp, randomBytes(16));
    expect(verifyOtp(otp, randomBytes(16), hash)).toBe(false);
  });

  it("produces lowercase hex of HMAC-SHA256 length (64 chars)", () => {
    expect(hashOtp("000000", randomBytes(16))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a malformed stored hash without throwing", () => {
    const salt = randomBytes(16);
    expect(verifyOtp("123456", salt, "deadbeef")).toBe(false);
  });
});
