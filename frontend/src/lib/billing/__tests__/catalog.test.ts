import { describe, expect, it } from "vitest";

import {
  usd,
  PLAN_PRICES,
  AI_PACK_DOLLARS,
  DEPT_PER_LAB_DISCOUNT_CENTS,
  DEPT_USAGE_DISCOUNT_PCT,
} from "../catalog";
import { MODEL_A_PLANS } from "../model-a/pricing";

describe("usd", () => {
  it("formats whole and fractional dollars", () => {
    expect(usd(300)).toBe("$3");
    expect(usd(2500)).toBe("$25");
    expect(usd(350)).toBe("$3.50");
    expect(usd(1299)).toBe("$12.99");
    expect(usd(0)).toBe("$0");
  });
});

describe("PLAN_PRICES", () => {
  it("derives the base figure from MODEL_A_PLANS (single source)", () => {
    expect(PLAN_PRICES.solo.baseCents).toBe(MODEL_A_PLANS.solo.baseFeeCents);
    expect(PLAN_PRICES.lab.baseCents).toBe(MODEL_A_PLANS.lab.baseFeeCents);
    expect(PLAN_PRICES.dept.baseCents).toBe(MODEL_A_PLANS.dept.baseFeeCents);
    expect(PLAN_PRICES.solo.base).toBe(usd(MODEL_A_PLANS.solo.baseFeeCents));
  });

  it("carries the usage markup and per-lab suffix", () => {
    expect(PLAN_PRICES.lab.usageMarkup).toBe(MODEL_A_PLANS.lab.usageMarkup);
    expect(PLAN_PRICES.lab.baseSuffix).toContain("per lab");
    expect(PLAN_PRICES.dept.baseSuffix).toContain("per lab");
    expect(PLAN_PRICES.solo.baseSuffix).toBe("/mo");
  });
});

describe("AI_PACK_DOLLARS", () => {
  it("is the three prepaid tiers", () => {
    expect(AI_PACK_DOLLARS).toEqual([10, 25, 50]);
  });
});

describe("department volume discount (derived, customer-facing)", () => {
  it("is the per-lab dollars off the lab base", () => {
    expect(DEPT_PER_LAB_DISCOUNT_CENTS).toBe(
      PLAN_PRICES.lab.baseCents - PLAN_PRICES.dept.baseCents,
    );
    expect(usd(DEPT_PER_LAB_DISCOUNT_CENTS)).toBe("$5");
  });

  it("is the percent off cloud usage from the lower multiplier (about 14%)", () => {
    expect(DEPT_USAGE_DISCOUNT_PCT).toBe(14);
  });
});
