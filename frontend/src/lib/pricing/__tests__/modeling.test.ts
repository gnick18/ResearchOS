import { describe, expect, it } from "vitest";

import {
  ACTIVITY_PER_M_WRITES,
} from "../assumptions";
import {
  BLENDED_PER_GB_MO,
  BUFFER,
  STRIPE_FIXED,
  STRIPE_PCT,
} from "../assumptions";
import {
  avgFreeUserCost,
  bareCost,
  netMargin,
  priceStorageOnly,
  priceWithActivity,
  subscriberMargin,
  sustainability,
  type FreeUsageMix,
  type PayingSide,
} from "../modeling";

// Reconstruct the storage-only recovery formula independently so the test does
// not just echo the implementation. raw -> +buffer -> +Stripe fixed -> gross up.
function expectedStorageOnly(capGB: number, freeGB: number): number {
  const billable = Math.max(0, capGB - freeGB);
  if (billable <= 0) return 0;
  const raw = billable * BLENDED_PER_GB_MO;
  const pre = raw + raw * BUFFER;
  return (pre + STRIPE_FIXED) / (1 - STRIPE_PCT);
}

describe("priceStorageOnly", () => {
  it("recovers buffer + Stripe over the free pool", () => {
    expect(priceStorageOnly(100, 1)).toBeCloseTo(expectedStorageOnly(100, 1), 6);
  });

  it("is zero when storage is within the free pool", () => {
    expect(priceStorageOnly(1, 1)).toBe(0);
    expect(priceStorageOnly(0.5, 1)).toBe(0);
  });

  it("rises with the cap", () => {
    expect(priceStorageOnly(250, 5)).toBeGreaterThan(priceStorageOnly(100, 5));
  });
});

describe("priceWithActivity", () => {
  it("is strictly higher than storage-only because it prices the allowance", () => {
    const so = priceStorageOnly(100, 1);
    const sa = priceWithActivity(100, 1, 10);
    expect(sa).toBeGreaterThan(so);
  });

  it("folds the throttle allowance activity into the recovered cost", () => {
    const billable = 100 - 1;
    const raw = billable * BLENDED_PER_GB_MO + 10 * ACTIVITY_PER_M_WRITES;
    const pre = raw + raw * BUFFER;
    const expected = (pre + STRIPE_FIXED) / (1 - STRIPE_PCT);
    expect(priceWithActivity(100, 1, 10)).toBeCloseTo(expected, 6);
  });

  it("is zero when there is no billable storage and no allowance", () => {
    expect(priceWithActivity(1, 1, 0)).toBe(0);
  });
});

describe("subscriberMargin / netMargin", () => {
  it("is profitable for a typical researcher on a real paid tier", () => {
    // A Pro-sized plan (250 GB cap over 1 GB free) used modestly: 8 GB stored,
    // 100k writes. The cap-based price comfortably clears the real usage cost.
    const price = priceStorageOnly(250, 1);
    const m = subscriberMargin(price, 8, 0.1);
    expect(m.net).toBeGreaterThan(0);
    expect(m.net).toBeCloseTo(netMargin(price, 8, 0.1), 10);
  });

  it("LOSES on the adversarial low-storage high-activity user (storage-only)", () => {
    // Power/automated: 4 GB stored but 8M writes, priced storage-only on a small
    // plan. Activity cost outruns the storage-based price -> negative net.
    const price = priceStorageOnly(4, 1);
    const m = subscriberMargin(price, 4, 8);
    expect(m.net).toBeLessThan(0);
    // The same user is fine once the price includes the activity allowance.
    const priceSA = priceWithActivity(4, 1, 8);
    expect(netMargin(priceSA, 4, 8)).toBeGreaterThanOrEqual(0);
  });

  it("bareCost is storage plus activity with no buffer or Stripe", () => {
    expect(bareCost(2, 1)).toBeCloseTo(
      2 * BLENDED_PER_GB_MO + 1 * ACTIVITY_PER_M_WRITES,
      10,
    );
  });
});

describe("avgFreeUserCost", () => {
  it("normalizes the mix and the heavy class tracks the free cap", () => {
    const lowCap: FreeUsageMix = { lightPct: 70, typicalPct: 25, heavyPct: 5, capM: 0.5 };
    const highCap: FreeUsageMix = { ...lowCap, capM: 2 };
    expect(avgFreeUserCost(highCap)).toBeGreaterThan(avgFreeUserCost(lowCap));
  });
});

describe("sustainability", () => {
  const paying: PayingSide = {
    paidIndividuals: 300,
    paidLabs: 100,
    departments: 30,
    labsPerDept: 10,
    institutions: 3,
    deptsPerInst: 6,
    sustainPerLab: 12,
  };
  const mix: FreeUsageMix = { lightPct: 70, typicalPct: 25, heavyPct: 5, capM: 1 };

  it("net = total in minus (free base cost + fixed base)", () => {
    const r = sustainability(10000, mix, paying);
    expect(r.net).toBeCloseTo(r.totalIn - (r.freeCost + r.fixed), 6);
  });

  it("a healthy paying side carries the free base (positive net, real break-even)", () => {
    const r = sustainability(10000, mix, paying);
    expect(r.net).toBeGreaterThan(0);
    expect(r.breakEvenFreeUsers).toBeGreaterThan(10000);
    expect(r.headroom).toBeGreaterThan(0);
  });

  it("goes underwater once the free base exceeds break-even", () => {
    const r = sustainability(10000, mix, paying);
    const over = sustainability(Math.ceil(r.breakEvenFreeUsers) + 5000, mix, paying);
    expect(over.net).toBeLessThan(0);
    expect(over.headroom).toBeLessThan(0);
  });

  it("break-even free users solves total in - fixed = freeUsers * avg cost", () => {
    const r = sustainability(10000, mix, paying);
    expect(r.breakEvenFreeUsers * r.avgFreeCost).toBeCloseTo(r.totalIn - r.fixed, 4);
  });
});
