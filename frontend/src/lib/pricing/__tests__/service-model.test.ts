import { describe, expect, it } from "vitest";

import { ACTIVITY_PER_M_WRITES, BLENDED_PER_GB_MO, BUFFER } from "../assumptions";
import { stripeMonthlyAmortized, FIXED_BASE_MONTHLY } from "../modeling";
import {
  STORAGE_MARKUP,
  storageRetailPerGB,
  relayCost,
  serviceMargin,
  avgFreeUserCostPathA,
  freeBaseAcquisitionOneTime,
  aiMarginPerUser,
  AI_INDIV_RETAIL_PER_M,
  AI_ORG_RETAIL_PER_M,
  AI_REAL_COST_PER_M,
  AI_SIGNUP_GRANT_USD,
  blendedSubNet,
  blendedGovPerPaid,
  blendedAiMargin,
  blendedPaidNet,
  projectAtScale,
  breakEvenConversion,
  freeUsersPerPayer,
  type ServiceTiers,
  type AdoptionMix,
} from "../service-model";

const TIERS: ServiceTiers = {
  solo: { id: "solo", name: "Solo", audience: "solo", price: 6, relayWritesM: 0.5, cadence: "annual" },
  lab: { id: "lab", name: "Lab", audience: "lab", price: 5, relayWritesM: 0.6, cadence: "annual" },
  dept: { id: "dept", name: "Dept", audience: "dept", price: 5, relayWritesM: 0.6, cadence: "annual", governanceFeePerLab: 16 },
};

const MIX: AdoptionMix = {
  conversion: 0.05,
  soloShare: 0.4,
  labShare: 0.4,
  deptShare: 0.2,
  membersPerLab: 6,
  freeRelayWritesM: 0, // Path A: free users do nothing that writes to us
  freeUserLifetimeMonths: 24,
  aiTokensPerPaidM: 1,
};

describe("storage is near-cost pass-through", () => {
  it("retail per GB is cost x buffer x markup", () => {
    expect(storageRetailPerGB()).toBeCloseTo(
      BLENDED_PER_GB_MO * (1 + BUFFER) * STORAGE_MARKUP,
      9,
    );
  });

  it("markup is a thin 1.1-1.2x band, never a profit center", () => {
    expect(STORAGE_MARKUP).toBeGreaterThanOrEqual(1.1);
    expect(STORAGE_MARKUP).toBeLessThanOrEqual(1.2);
  });
});

describe("relayCost", () => {
  it("is writes times the per-million activity cost", () => {
    expect(relayCost(0.5)).toBeCloseTo(0.5 * ACTIVITY_PER_M_WRITES, 9);
    expect(relayCost(0)).toBe(0);
  });
});

describe("serviceMargin", () => {
  it("net is price minus relay minus amortized Stripe, storage excluded", () => {
    const m = serviceMargin(6, 0.5, "annual");
    const expected = 6 - relayCost(0.5) - stripeMonthlyAmortized(6, "annual");
    expect(m.net).toBeCloseTo(expected, 9);
  });

  it("a profitable service tier keeps most of its price", () => {
    expect(serviceMargin(6, 0.5, "annual").net).toBeGreaterThan(4.5);
  });

  it("marginX is Infinity for a relay-free (governance/presence) line", () => {
    expect(serviceMargin(16, 0, "annual").marginX).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("AI billing (locked rates)", () => {
  it("individual retail is ~$0.28/1M, org ~$0.40/1M, real cost ~$0.153/1M", () => {
    expect(AI_INDIV_RETAIL_PER_M).toBeCloseTo(0.28, 6);
    expect(AI_ORG_RETAIL_PER_M).toBeCloseTo(0.4, 6);
    expect(AI_REAL_COST_PER_M).toBeCloseTo(0.153, 6);
  });

  it("org AI margin exceeds individual at the same usage (2x vs 1.4x)", () => {
    expect(aiMarginPerUser(5, true)).toBeGreaterThan(aiMarginPerUser(5, false));
  });

  it("margin is retail minus real cost minus pack Stripe", () => {
    const m = aiMarginPerUser(10, false);
    const rev = 10 * AI_INDIV_RETAIL_PER_M;
    const expected = rev - 10 * AI_REAL_COST_PER_M - rev * 0.029;
    expect(m).toBeCloseTo(expected, 9);
  });

  it("zero usage yields zero AI margin", () => {
    expect(aiMarginPerUser(0, false)).toBe(0);
  });
});

describe("free users are near-free under Path A", () => {
  it("relay-only cost when no lifetime is given (stress-test path)", () => {
    expect(avgFreeUserCostPathA(0.05)).toBeCloseTo(relayCost(0.05), 9);
  });

  it("with zero relay, the only cost is the amortized AI sign-up grant", () => {
    expect(avgFreeUserCostPathA(0, 24)).toBeCloseTo(AI_SIGNUP_GRANT_USD / 24, 9);
  });

  it("the grant is about 25 cents one-time per account", () => {
    expect(AI_SIGNUP_GRANT_USD).toBeCloseTo(0.25, 2);
    expect(freeBaseAcquisitionOneTime(10000)).toBeCloseTo(10000 * AI_SIGNUP_GRANT_USD, 6);
  });

  it("a free user costs pennies a month versus dollars of paid net", () => {
    const free = avgFreeUserCostPathA(MIX.freeRelayWritesM, MIX.freeUserLifetimeMonths);
    expect(free).toBeLessThan(0.02);
    expect(blendedPaidNet(TIERS, MIX)).toBeGreaterThan(free * 100);
  });
});

describe("blended paid net decomposes into sub + AI + governance", () => {
  it("blendedPaidNet equals its three components", () => {
    expect(blendedPaidNet(TIERS, MIX)).toBeCloseTo(
      blendedSubNet(TIERS, MIX) +
        blendedAiMargin(TIERS, MIX) +
        blendedGovPerPaid(TIERS, MIX),
      9,
    );
  });

  it("governance is the dept share times the per-member fee", () => {
    expect(blendedGovPerPaid(TIERS, MIX)).toBeCloseTo(0.2 * (16 / 6), 9);
  });

  it("AI margin blends org rate only for the dept share", () => {
    const expected =
      0.8 * aiMarginPerUser(1, false) + 0.2 * aiMarginPerUser(1, true);
    expect(blendedAiMargin(TIERS, MIX)).toBeCloseTo(expected, 9);
  });

  it("normalizes shares that do not sum to one", () => {
    const a = blendedPaidNet(TIERS, { ...MIX, soloShare: 1, labShare: 1, deptShare: 1 });
    const b = blendedPaidNet(TIERS, { ...MIX, soloShare: 2, labShare: 2, deptShare: 2 });
    expect(a).toBeCloseTo(b, 9);
  });
});

describe("projectAtScale", () => {
  it("revenue is the sum of sub, AI, and governance contributions", () => {
    const p = projectAtScale(10000, TIERS, MIX);
    expect(p.revenue).toBeCloseTo(p.sub + p.ai + p.gov, 9);
    expect(p.revenue).toBeCloseTo(10000 * 0.05 * blendedPaidNet(TIERS, MIX), 6);
  });

  it("expense splits into free relay, amortized AI grant, and the fixed floor", () => {
    const p = projectAtScale(10000, TIERS, MIX);
    const free = 10000 * (1 - MIX.conversion);
    expect(p.freeRelayCost).toBeCloseTo(free * relayCost(MIX.freeRelayWritesM), 6);
    expect(p.freeAcqCost).toBeCloseTo(
      free * (AI_SIGNUP_GRANT_USD / MIX.freeUserLifetimeMonths),
      6,
    );
    expect(p.freeCost).toBeCloseTo(p.freeRelayCost + p.freeAcqCost, 9);
    expect(p.expense).toBeCloseTo(p.freeCost + p.fixed, 9);
    expect(p.fixed).toBe(FIXED_BASE_MONTHLY);
  });

  it("is net positive at scale for the seed tiers (Path A is sustainable)", () => {
    expect(projectAtScale(50000, TIERS, MIX).net).toBeGreaterThan(0);
  });
});

describe("breakEvenConversion", () => {
  it("is freeCost / (paidNet + freeCost)", () => {
    const F = avgFreeUserCostPathA(MIX.freeRelayWritesM, MIX.freeUserLifetimeMonths);
    const R = blendedPaidNet(TIERS, MIX);
    expect(breakEvenConversion(TIERS, MIX)).toBeCloseTo(F / (R + F), 9);
  });

  it("is well under 1% because free users are near-free", () => {
    expect(breakEvenConversion(TIERS, MIX)).toBeLessThan(0.01);
  });

  it("freeUsersPerPayer is the inverse intuition", () => {
    const be = breakEvenConversion(TIERS, MIX);
    expect(freeUsersPerPayer(TIERS, MIX)).toBeCloseTo((1 - be) / be, 6);
  });
});
