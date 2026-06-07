// Activity throttle pure-decision tests (chunk C).

import { describe, expect, it } from "vitest";

import { THROTTLED_MIN_INTERVAL_MS, isOverAllowance } from "../throttle";

describe("isOverAllowance", () => {
  it("is over only at or past a positive allowance", () => {
    expect(isOverAllowance(0, 1_000_000)).toBe(false);
    expect(isOverAllowance(999_999, 1_000_000)).toBe(false);
    expect(isOverAllowance(1_000_000, 1_000_000)).toBe(true);
    expect(isOverAllowance(2_000_000, 1_000_000)).toBe(true);
  });

  it("treats a zero or negative allowance as unlimited (never throttle)", () => {
    expect(isOverAllowance(5_000_000, 0)).toBe(false);
    expect(isOverAllowance(5_000_000, -1)).toBe(false);
  });
});

describe("throttle interval", () => {
  it("spaces over-allowance pushes by a few seconds", () => {
    expect(THROTTLED_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(1000);
  });
});
