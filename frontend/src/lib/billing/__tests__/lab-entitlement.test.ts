import { describe, expect, it } from "vitest";

import { isActiveLabPlan, type SubscriptionRecord } from "../db";
import { LAB_PLANS, INDIVIDUAL_PLANS } from "../plans";

// Pure core behind the cross-lane publish gate isLabPublishEntitled (the async
// wrapper just fetches the subscription and applies this). Lab-domains / social
// lane checks the gate before allowing a lab to publish a vanity-domain site.

const paidLab = LAB_PLANS.find((p) => p.priceCents > 0)!;
const freeLab = LAB_PLANS.find((p) => p.priceCents === 0)!;
const paidIndividual = INDIVIDUAL_PLANS.find((p) => p.priceCents > 0)!;

function sub(over: Partial<SubscriptionRecord>): SubscriptionRecord {
  return {
    ownerKey: "owner",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeItemId: null,
    capBytes: 0,
    status: "active",
    labBilling: false,
    planId: freeLab.id,
    ...over,
  };
}

describe("isActiveLabPlan (lab publish entitlement core)", () => {
  it("is true only for an active, paid LAB-audience plan", () => {
    expect(isActiveLabPlan(sub({ status: "active", planId: paidLab.id }))).toBe(true);
  });

  it("is false when the subscription is not active", () => {
    expect(isActiveLabPlan(sub({ status: "past_due", planId: paidLab.id }))).toBe(false);
    expect(isActiveLabPlan(sub({ status: "inactive", planId: paidLab.id }))).toBe(false);
  });

  it("is false on a free lab plan (no paid tier)", () => {
    expect(isActiveLabPlan(sub({ status: "active", planId: freeLab.id }))).toBe(false);
  });

  it("is false on an active paid INDIVIDUAL plan (wrong audience)", () => {
    expect(isActiveLabPlan(sub({ status: "active", planId: paidIndividual.id }))).toBe(false);
  });

  it("is false for no subscription", () => {
    expect(isActiveLabPlan(null)).toBe(false);
  });
});
