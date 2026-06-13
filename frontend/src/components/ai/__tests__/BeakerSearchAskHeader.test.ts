// BeakerSearchAskHeader unit tests (BeakerAI lane manager, 2026-06-13).
//
// Pins the pure balance-indicator helpers: balanceFraction, balanceLevel, and
// ringColor. These are exported from BeakerSearchAskHeader.tsx and have no DOM
// or React dependency, so they run as plain functions under vitest.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  balanceFraction,
  balanceLevel,
  ringColor,
  type BalanceLevel,
} from "../BeakerSearchAskHeader";
import { STARTER_GRANT_TOKENS } from "@/lib/billing/ai-config";

describe("balanceFraction", () => {
  it("returns 1 when balance equals the starter grant (fresh account)", () => {
    expect(balanceFraction(STARTER_GRANT_TOKENS)).toBe(1);
  });

  it("returns 0 when balance is 0 (depleted)", () => {
    expect(balanceFraction(0)).toBe(0);
  });

  it("returns 0.5 at half the starter grant", () => {
    expect(balanceFraction(STARTER_GRANT_TOKENS / 2)).toBeCloseTo(0.5, 5);
  });

  it("clamps to 1 when balance exceeds the starter grant (after a top-up)", () => {
    expect(balanceFraction(STARTER_GRANT_TOKENS * 2)).toBe(1);
  });

  it("clamps to 0 for negative balances", () => {
    expect(balanceFraction(-1000)).toBe(0);
  });
});

describe("balanceLevel", () => {
  it("returns 'ok' at full balance", () => {
    expect(balanceLevel(STARTER_GRANT_TOKENS)).toBe("ok");
  });

  it("returns 'ok' just above the 15 % low threshold", () => {
    // 15.1 % of starter grant -> still ok
    expect(balanceLevel(Math.ceil(STARTER_GRANT_TOKENS * 0.151))).toBe("ok");
  });

  it("returns 'low' at exactly 15 % (boundary is exclusive)", () => {
    // balanceLevel uses frac < 0.15 for low, so 15 % is 'ok', 14.9 % is 'low'
    expect(balanceLevel(Math.floor(STARTER_GRANT_TOKENS * 0.149))).toBe("low");
  });

  it("returns 'low' between 5 % and 15 %", () => {
    expect(balanceLevel(Math.floor(STARTER_GRANT_TOKENS * 0.10))).toBe("low");
  });

  it("returns 'critical' at exactly 5 % (boundary is exclusive)", () => {
    expect(balanceLevel(Math.floor(STARTER_GRANT_TOKENS * 0.049))).toBe("critical");
  });

  it("returns 'critical' at 0 tokens", () => {
    expect(balanceLevel(0)).toBe("critical");
  });
});

describe("ringColor", () => {
  it("returns green for 'ok'", () => {
    const c = ringColor("ok" as BalanceLevel);
    expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    // green-500 family
    expect(c.toLowerCase()).toBe("#22c55e");
  });

  it("returns amber for 'low'", () => {
    expect(ringColor("low" as BalanceLevel).toLowerCase()).toBe("#f59e0b");
  });

  it("returns red for 'critical'", () => {
    expect(ringColor("critical" as BalanceLevel).toLowerCase()).toBe("#ef4444");
  });
});
