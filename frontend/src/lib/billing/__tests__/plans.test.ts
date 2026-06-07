// Billing plan catalog tests (flat bundle plans).

import { describe, expect, it } from "vitest";

import { BYTES_PER_GB } from "../config";
import {
  ALL_PLANS,
  INDIVIDUAL_PLANS,
  LAB_PLANS,
  freePlan,
  getPlan,
  isPaidPlan,
  planOrFree,
} from "../plans";

describe("plan catalog", () => {
  it("has unique ids across individual and lab plans", () => {
    const ids = ALL_PLANS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the free plans are the 1 GB default for each audience", () => {
    expect(freePlan("individual").storageBytes).toBe(1 * BYTES_PER_GB);
    expect(freePlan("individual").priceCents).toBe(0);
    expect(freePlan("lab").priceCents).toBe(0);
  });

  it("paid plans carry a price and a Stripe price env", () => {
    for (const p of ALL_PLANS) {
      if (p.priceCents > 0) {
        expect(isPaidPlan(p)).toBe(true);
        expect(p.stripePriceEnv).toBeTruthy();
      } else {
        expect(isPaidPlan(p)).toBe(false);
      }
    }
  });

  it("storage cap and activity allowance rise together across tiers", () => {
    const tiers = INDIVIDUAL_PLANS;
    for (let i = 1; i < tiers.length; i += 1) {
      expect(tiers[i].storageBytes).toBeGreaterThan(tiers[i - 1].storageBytes);
      expect(tiers[i].activityWritesPerMonth).toBeGreaterThan(
        tiers[i - 1].activityWritesPerMonth,
      );
    }
  });

  it("lab plans are pooled (audience lab)", () => {
    for (const p of LAB_PLANS) expect(p.audience).toBe("lab");
  });
});

describe("plan lookup", () => {
  it("getPlan finds by id and returns null for unknown", () => {
    expect(getPlan("plus")?.name).toBe("Plus");
    expect(getPlan("nope")).toBeNull();
    expect(getPlan(null)).toBeNull();
  });

  it("planOrFree falls back to the audience free plan for bad ids", () => {
    expect(planOrFree("garbage", "individual").id).toBe("free");
    expect(planOrFree(null, "lab").id).toBe("lab_free");
    expect(planOrFree("pro", "individual").id).toBe("pro");
  });
});
