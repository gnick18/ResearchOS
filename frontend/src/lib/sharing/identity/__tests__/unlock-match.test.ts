// D1 provider-unlock decision, the security-critical email-match gate.
//
// A provider sign-in may unlock ONLY the account whose claimed identity email
// matches the verified session email. These cases pin that rule, the part that
// keeps "any successful Google login" from unlocking the wrong account.

import { describe, expect, it } from "vitest";

import { evaluateUnlockMatch } from "../unlock-match";

describe("evaluateUnlockMatch", () => {
  it("unlocks when the verified email matches the claimed identity", () => {
    expect(
      evaluateUnlockMatch("ada@lab.edu", "ada@lab.edu"),
    ).toEqual({ ok: true });
  });

  it("matches across casing and surrounding whitespace", () => {
    expect(
      evaluateUnlockMatch("  Ada@Lab.EDU ", "ada@lab.edu"),
    ).toEqual({ ok: true });
  });

  it("does NOT unlock on a different verified email", () => {
    // The exact failure mode the gate exists to prevent: a real, successful
    // Google login by someone else must not open this account.
    expect(
      evaluateUnlockMatch("someone-else@lab.edu", "ada@lab.edu"),
    ).toEqual({ ok: false, reason: "email-mismatch" });
  });

  it("does NOT unlock when the session has no email", () => {
    expect(evaluateUnlockMatch(null, "ada@lab.edu")).toEqual({
      ok: false,
      reason: "no-session-email",
    });
    expect(evaluateUnlockMatch("", "ada@lab.edu")).toEqual({
      ok: false,
      reason: "no-session-email",
    });
    expect(evaluateUnlockMatch("   ", "ada@lab.edu")).toEqual({
      ok: false,
      reason: "no-session-email",
    });
  });

  it("does NOT unlock when the account has no claimed identity", () => {
    // A verified email with no sidecar to match against is a mismatch, never
    // a unlock. Empty/missing claimed email never opens the account.
    expect(evaluateUnlockMatch("ada@lab.edu", null)).toEqual({
      ok: false,
      reason: "email-mismatch",
    });
    expect(evaluateUnlockMatch("ada@lab.edu", "")).toEqual({
      ok: false,
      reason: "email-mismatch",
    });
  });

  it("does NOT unlock when both sides are missing", () => {
    // Empty session email is reported first (it is the earlier guard), so two
    // empties read as the no-session-email outcome. Either way, never ok.
    expect(evaluateUnlockMatch(null, null)).toEqual({
      ok: false,
      reason: "no-session-email",
    });
  });
});
