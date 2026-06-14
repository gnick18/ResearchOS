import { describe, it, expect } from "vitest";
import {
  normalizeHandle,
  validateHandle,
  baseHandleFrom,
} from "@/lib/account/account-profile";

describe("account handle helpers", () => {
  it("normalizes case, trim, and a leading @", () => {
    expect(normalizeHandle("  @JaneDoe ")).toBe("janedoe");
  });

  it("accepts valid handles", () => {
    for (const h of ["jane", "jane-doe", "j_doe", "lab42", "a1b"]) {
      expect(validateHandle(h)).toBeNull();
    }
  });

  it("rejects too short, too long, bad chars, edge separators, reserved", () => {
    expect(validateHandle("ab")).not.toBeNull();
    expect(validateHandle("x".repeat(31))).not.toBeNull();
    expect(validateHandle("has space")).not.toBeNull();
    expect(validateHandle("-lead")).not.toBeNull();
    expect(validateHandle("trail_")).not.toBeNull();
    expect(validateHandle("admin")).not.toBeNull();
    expect(validateHandle("account")).not.toBeNull();
  });

  it("derives a sane base handle from an email", () => {
    expect(baseHandleFrom("Jane.Doe@wisc.edu")).toBe("jane-doe");
    expect(validateHandle(baseHandleFrom("Jane.Doe@wisc.edu"))).toBeNull();
  });

  it("pads a too-short base so it validates", () => {
    const h = baseHandleFrom("a@x.com");
    expect(h.length).toBeGreaterThanOrEqual(3);
    expect(validateHandle(h)).toBeNull();
  });
});
