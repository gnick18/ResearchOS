import { describe, expect, it } from "vitest";

import { ACTIVITY_PER_M_WRITES, BLENDED_PER_GB_MO, BUFFER } from "../assumptions";
import { stripeMonthlyAmortized } from "../modeling";
import { FIXED_MONTHLY_BASE_CENTS, AMORTIZED_ANNUAL_CENTS } from "../../sharing/capacity-shared";
import {
  INFRA_FIXED_MONTHLY,
  DEFAULT_OPERATING_COSTS,
  monthlyOf,
  totalFixedMonthly,
  type FixedCostItem,
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
  breakEvenUsers,
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
  aiTokensPerPaidM: 1,
  aiAdoption: 0.3, // only ~20-40% of paid users buy AI
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

describe("fixed business costs", () => {
  it("infra floor is the sourced platform base + amortized annual fees", () => {
    expect(INFRA_FIXED_MONTHLY).toBeCloseTo(
      (FIXED_MONTHLY_BASE_CENTS + AMORTIZED_ANNUAL_CENTS) / 100,
      9,
    );
    // Workers $5 + Vercel $20 + ~$11 annual ~= $36/mo.
    expect(INFRA_FIXED_MONTHLY).toBeGreaterThan(30);
  });

  it("monthlyOf amortizes yearly items and sums monthly ones", () => {
    const items: FixedCostItem[] = [
      { label: "a", amount: 10, cadence: "monthly" },
      { label: "b", amount: 120, cadence: "yearly" },
    ];
    expect(monthlyOf(items)).toBeCloseTo(10 + 120 / 12, 9);
  });

  it("total fixed monthly is the floor plus operating overhead", () => {
    expect(totalFixedMonthly()).toBeCloseTo(
      INFRA_FIXED_MONTHLY + monthlyOf(DEFAULT_OPERATING_COSTS),
      9,
    );
    // The seeded total is real money, well above the old $28 placeholder.
    expect(totalFixedMonthly()).toBeGreaterThan(150);
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

describe("free users cost ~$0/mo recurring under Path A", () => {
  it("recurring monthly cost is just the relay footprint", () => {
    expect(avgFreeUserCostPathA(0.05)).toBeCloseTo(relayCost(0.05), 9);
  });

  it("is exactly zero at the default zero relay footprint", () => {
    expect(avgFreeUserCostPathA(0)).toBe(0);
  });

  it("the AI grant is a separate one-time 25 cents per account, not monthly", () => {
    expect(AI_SIGNUP_GRANT_USD).toBeCloseTo(0.25, 2);
    expect(freeBaseAcquisitionOneTime(10000)).toBeCloseTo(10000 * AI_SIGNUP_GRANT_USD, 6);
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

  it("AI margin blends org rate only for the dept share, scaled by adoption", () => {
    const expected =
      0.3 * (0.8 * aiMarginPerUser(1, false) + 0.2 * aiMarginPerUser(1, true));
    expect(blendedAiMargin(TIERS, MIX)).toBeCloseTo(expected, 9);
  });

  it("AI margin scales linearly with adoption (and is zero at 0%)", () => {
    expect(blendedAiMargin(TIERS, { ...MIX, aiAdoption: 0 })).toBe(0);
    const at30 = blendedAiMargin(TIERS, { ...MIX, aiAdoption: 0.3 });
    const at60 = blendedAiMargin(TIERS, { ...MIX, aiAdoption: 0.6 });
    expect(at60).toBeCloseTo(at30 * 2, 9);
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

  it("recurring expense is free relay plus the real fixed business cost", () => {
    const p = projectAtScale(10000, TIERS, MIX);
    const free = 10000 * (1 - MIX.conversion);
    expect(p.freeCost).toBeCloseTo(free * relayCost(MIX.freeRelayWritesM), 6);
    expect(p.expense).toBeCloseTo(p.freeCost + p.fixed, 9);
    // Default fixed is the sourced infra floor + seeded operating overhead, not
    // the old flat placeholder.
    expect(p.fixed).toBeCloseTo(totalFixedMonthly(), 9);
  });

  it("accepts a custom fixed monthly cost", () => {
    const p = projectAtScale(10000, TIERS, MIX, 500);
    expect(p.fixed).toBe(500);
    expect(p.expense).toBeCloseTo(p.freeCost + 500, 9);
  });

  it("reports the one-time acquisition cost separately, not in the monthly net", () => {
    const p = projectAtScale(10000, TIERS, MIX);
    const free = 10000 * (1 - MIX.conversion);
    expect(p.freeAcqOneTime).toBeCloseTo(free * AI_SIGNUP_GRANT_USD, 6);
    // net is revenue minus the recurring expense only; the one-time cost is excluded.
    expect(p.net).toBeCloseTo(p.revenue - p.expense, 9);
  });

  it("is net positive at scale for the seed tiers (Path A is sustainable)", () => {
    expect(projectAtScale(50000, TIERS, MIX).net).toBeGreaterThan(0);
  });
});

describe("breakEvenConversion", () => {
  it("is zero at the default zero relay (free users cost nothing recurring)", () => {
    expect(breakEvenConversion(TIERS, MIX)).toBe(0);
    expect(freeUsersPerPayer(TIERS, MIX)).toBe(Number.POSITIVE_INFINITY);
  });

  it("break-even users covers the fixed cost at the per-user contribution", () => {
    const fixed = 196;
    const be = breakEvenUsers(TIERS, MIX, fixed);
    // The projected net at exactly the break-even user count is ~0.
    expect(projectAtScale(be, TIERS, MIX, fixed).net).toBeCloseTo(0, 6);
    expect(be).toBeGreaterThan(0);
    expect(Number.isFinite(be)).toBe(true);
  });

  it("break-even users is Infinity when each user loses money", () => {
    // Zero conversion means no revenue, so no scale ever covers the fixed cost.
    expect(breakEvenUsers(TIERS, { ...MIX, conversion: 0 }, 196)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("becomes positive only under the stress-test relay dial", () => {
    const stressed = { ...MIX, freeRelayWritesM: 0.05 };
    const F = avgFreeUserCostPathA(0.05);
    const R = blendedPaidNet(TIERS, stressed);
    expect(breakEvenConversion(TIERS, stressed)).toBeCloseTo(F / (R + F), 9);
    expect(breakEvenConversion(TIERS, stressed)).toBeGreaterThan(0);
    expect(breakEvenConversion(TIERS, stressed)).toBeLessThan(0.03);
  });
});
