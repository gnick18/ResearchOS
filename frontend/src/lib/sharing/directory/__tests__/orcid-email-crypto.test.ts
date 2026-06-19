// Tests for the ORCID email-capture server crypto (section 18.7).
//
// AES-256-GCM round-trip, ciphertext is not plaintext, a fresh IV per call, and
// tamper / wrong-key / malformed-blob all decrypt to null rather than leaking.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decryptOrcidEmail,
  encryptOrcidEmail,
} from "../orcid-email-crypto";

const KEY = "test-orcid-email-enc-key-at-least-16-chars-long";

describe("encryptOrcidEmail / decryptOrcidEmail", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.ORCID_EMAIL_ENC_KEY;
    process.env.ORCID_EMAIL_ENC_KEY = KEY;
  });

  afterEach(() => {
    process.env.ORCID_EMAIL_ENC_KEY = original;
  });

  it("round-trips an email back to the same plaintext", () => {
    const email = "alice@wisc.edu";
    const enc = encryptOrcidEmail(email);
    expect(decryptOrcidEmail(enc)).toBe(email);
  });

  it("does not store the plaintext email in the ciphertext", () => {
    const email = "alice@wisc.edu";
    const enc = encryptOrcidEmail(email);
    expect(enc).not.toContain("alice");
    expect(enc).not.toContain("wisc.edu");
    expect(enc).not.toContain(email);
  });

  it("uses a fresh IV so the same email encrypts to different ciphertexts", () => {
    const email = "bob@mit.edu";
    const a = encryptOrcidEmail(email);
    const b = encryptOrcidEmail(email);
    expect(a).not.toBe(b);
    // Both still decrypt to the same plaintext.
    expect(decryptOrcidEmail(a)).toBe(email);
    expect(decryptOrcidEmail(b)).toBe(email);
  });

  it("produces the versioned v1.<iv>.<tag>.<ct> serialized form", () => {
    const enc = encryptOrcidEmail("carol@example.org");
    const parts = enc.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    // iv is 12 bytes -> 24 hex chars, tag is 16 bytes -> 32 hex chars.
    expect(parts[1]).toMatch(/^[0-9a-f]{24}$/);
    expect(parts[2]).toMatch(/^[0-9a-f]{32}$/);
    expect(parts[3]).toMatch(/^[0-9a-f]+$/);
  });

  it("returns null when the ciphertext is tampered (auth tag fails)", () => {
    const enc = encryptOrcidEmail("dave@example.org");
    const parts = enc.split(".");
    // Flip the last hex nibble of the ciphertext body.
    const last = parts[3];
    const flipped =
      last.slice(0, -1) + (last.slice(-1) === "0" ? "1" : "0");
    const tampered = [parts[0], parts[1], parts[2], flipped].join(".");
    expect(decryptOrcidEmail(tampered)).toBeNull();
  });

  it("returns null when decrypting under a different key", () => {
    const enc = encryptOrcidEmail("erin@example.org");
    process.env.ORCID_EMAIL_ENC_KEY = "a-completely-different-key-16chars+";
    expect(decryptOrcidEmail(enc)).toBeNull();
  });

  it("returns null for a malformed or unversioned blob", () => {
    expect(decryptOrcidEmail("not-a-blob")).toBeNull();
    expect(decryptOrcidEmail("v2.aa.bb.cc")).toBeNull();
    expect(decryptOrcidEmail("")).toBeNull();
    expect(decryptOrcidEmail("v1.only.three")).toBeNull();
  });

  it("throws when the key env is missing or too short", () => {
    delete process.env.ORCID_EMAIL_ENC_KEY;
    expect(() => encryptOrcidEmail("x@y.z")).toThrow(/ORCID_EMAIL_ENC_KEY/);
    process.env.ORCID_EMAIL_ENC_KEY = "short";
    expect(() => encryptOrcidEmail("x@y.z")).toThrow(/ORCID_EMAIL_ENC_KEY/);
  });
});
