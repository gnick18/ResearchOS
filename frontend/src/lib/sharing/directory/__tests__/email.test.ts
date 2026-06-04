// Phase 1b-i, directory email canonicalization and peppered hashing.

import { describe, expect, it } from "vitest";

import { canonicalizeEmail, hashEmail } from "../email";

const PEPPER = "server-pepper-one";
const OTHER_PEPPER = "server-pepper-two";

describe("canonicalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(canonicalizeEmail("  Alice@Example.COM  ")).toBe("alice@example.com");
  });

  it("is idempotent", () => {
    const once = canonicalizeEmail("  Bob@Lab.Org ");
    expect(canonicalizeEmail(once)).toBe(once);
  });

  it("is case and whitespace insensitive", () => {
    expect(canonicalizeEmail("USER@X.com")).toBe(canonicalizeEmail("  user@x.COM "));
  });

  it("does NOT apply provider-specific normalization (gmail dots preserved)", () => {
    // Stripping dots would break lookups, so a.b and ab must stay distinct.
    expect(canonicalizeEmail("a.b@gmail.com")).not.toBe(
      canonicalizeEmail("ab@gmail.com"),
    );
  });
});

describe("hashEmail", () => {
  it("is deterministic for a given pepper", () => {
    const e = canonicalizeEmail("alice@example.com");
    expect(hashEmail(e, PEPPER)).toBe(hashEmail(e, PEPPER));
  });

  it("returns lowercase hex of HMAC-SHA256 length (64 chars)", () => {
    const h = hashEmail(canonicalizeEmail("alice@example.com"), PEPPER);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the pepper changes", () => {
    const e = canonicalizeEmail("alice@example.com");
    expect(hashEmail(e, PEPPER)).not.toBe(hashEmail(e, OTHER_PEPPER));
  });

  it("produces different hashes for different emails under the same pepper", () => {
    expect(hashEmail(canonicalizeEmail("alice@example.com"), PEPPER)).not.toBe(
      hashEmail(canonicalizeEmail("bob@example.com"), PEPPER),
    );
  });

  it("yields the same hash regardless of input case/whitespace once canonicalized", () => {
    const a = hashEmail(canonicalizeEmail("  Alice@Example.com "), PEPPER);
    const b = hashEmail(canonicalizeEmail("alice@example.com"), PEPPER);
    expect(a).toBe(b);
  });
});
