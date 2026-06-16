import { describe, expect, it } from "vitest";

import { ACTIVITY_PER_M_WRITES, BLENDED_PER_GB_MO, BUFFER } from "../assumptions";
import { stripeMonthlyAmortized } from "../modeling";
import { FIXED_MONTHLY_BASE_CENTS, AMORTIZED_ANNUAL_CENTS } from "../../sharing/capacity-shared";
import {
  INFRA_FIXED_MONTHLY,
  DEFAULT_OPERATING_COSTS,
  DEFAULT_SCALING_SERVICES,
  scalingInfraCost,
  serviceMonthlyCost,
  serviceCrossUsers,
  monthlyOf,
  totalFixedMonthly,
  type FixedCostItem,
  STORAGE_MARKUP,
  storageRetailPerGB,
  hostedAssetMonthlyCost,
  relayCost,
  serviceMargin,
  avgFreeUserCostPathA,
  freeBaseAcquisitionOneTime,
  DEFAULT_FREE_GRANT_USAGE,
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
  taxOnProfit,
  DEFAULT_TAX_RATE,
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
  freeGrantUsage: 0.85, // conservative: most free accounts use the AI gift
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

  it("hosted companion-site assets bill at the same pass-through rate per GB", () => {
    // 1 GB (1e9 bytes) bills at exactly one storageRetailPerGB; it scales linearly.
    expect(hostedAssetMonthlyCost(1e9)).toBeCloseTo(storageRetailPerGB(), 9);
    expect(hostedAssetMonthlyCost(5e9)).toBeCloseTo(5 * storageRetailPerGB(), 9);
    expect(hostedAssetMonthlyCost(0)).toBe(0);
    expect(hostedAssetMonthlyCost(-100)).toBe(0); // never negative
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

describe("per-service step-ups", () => {
  it("each service crosses its free tier at a different user count", () => {
    const resend = DEFAULT_SCALING_SERVICES.find((s) => s.id === "resend")!;
    const upstash = DEFAULT_SCALING_SERVICES.find((s) => s.id === "upstash")!;
    const vercel = DEFAULT_SCALING_SERVICES.find((s) => s.id === "vercel")!;
    // Resend 3000/2 = 1500, Upstash 500k/40 = 12500, Vercel 10M/150 ~= 66667.
    expect(serviceCrossUsers(resend)).toBeCloseTo(1500, 0);
    expect(serviceCrossUsers(upstash)).toBeCloseTo(12500, 0);
    expect(serviceCrossUsers(vercel)).toBeCloseTo(10_000_000 / 150, 0);
    // All distinct moments, ascending.
    expect(serviceCrossUsers(resend)).toBeLessThan(serviceCrossUsers(upstash));
    expect(serviceCrossUsers(upstash)).toBeLessThan(serviceCrossUsers(vercel));
  });

  it("a service is free below its cross and costs its tier above", () => {
    const resend = DEFAULT_SCALING_SERVICES.find((s) => s.id === "resend")!;
    expect(serviceMonthlyCost(resend, 1000)).toBe(0); // 2000 emails < 3000 free
    expect(serviceMonthlyCost(resend, 5000)).toBe(20); // 10000 emails, $20 tier
    expect(serviceMonthlyCost(resend, 40000)).toBe(90); // 80000 emails, $90 tier
  });

  it("total scaling infra cost steps up as services cross, monotonic", () => {
    const at1k = scalingInfraCost(DEFAULT_SCALING_SERVICES, 1000);
    const at20k = scalingInfraCost(DEFAULT_SCALING_SERVICES, 20000);
    const at100k = scalingInfraCost(DEFAULT_SCALING_SERVICES, 100000);
    expect(at1k).toBe(0); // below every free tier
    expect(at20k).toBeGreaterThan(at1k);
    expect(at100k).toBeGreaterThanOrEqual(at20k);
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

  it("the grant cost scales by the free-grant usage rate (conservative ~0.85)", () => {
    expect(DEFAULT_FREE_GRANT_USAGE).toBeGreaterThanOrEqual(0.8);
    expect(DEFAULT_FREE_GRANT_USAGE).toBeLessThanOrEqual(0.9);
    expect(freeBaseAcquisitionOneTime(10000, 0.85)).toBeCloseTo(
      10000 * AI_SIGNUP_GRANT_USD * 0.85,
      6,
    );
    // Usage is independent of paid AI adoption (a free gift, not a paid pack).
    expect(freeBaseAcquisitionOneTime(10000, 0)).toBe(0);
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
    // 500 users is below every service free tier, so no step-ups yet.
    const p = projectAtScale(500, TIERS, MIX);
    const free = 500 * (1 - MIX.conversion);
    expect(p.freeCost).toBeCloseTo(free * relayCost(MIX.freeRelayWritesM), 6);
    expect(p.expense).toBeCloseTo(p.freeCost + p.fixed, 9);
    // Default fixed is the sourced infra floor + seeded operating overhead, not
    // the old flat placeholder.
    expect(p.fixed).toBeCloseTo(totalFixedMonthly(), 9);
  });

  it("accepts a custom fixed monthly cost", () => {
    const p = projectAtScale(10000, TIERS, MIX, 500, []); // no scaling services
    expect(p.fixed).toBe(500);
    expect(p.expense).toBeCloseTo(p.freeCost + 500, 9);
  });

  it("scales fixed costs up via per-service step-ups (not flat forever)", () => {
    const small = projectAtScale(500, TIERS, MIX, 200, []); // no scaling services
    const big = projectAtScale(50000, TIERS, MIX, 200); // default services
    expect(small.fixed).toBe(200); // below every free tier, no steps
    // At 50k the default services have stepped up, so fixed exceeds the base.
    expect(big.fixed).toBeGreaterThan(200);
    expect(big.fixed).toBeCloseTo(200 + scalingInfraCost(DEFAULT_SCALING_SERVICES, 50000), 9);
  });

  it("reports the one-time acquisition cost separately, not in the monthly net", () => {
    const p = projectAtScale(10000, TIERS, MIX);
    const free = 10000 * (1 - MIX.conversion);
    expect(p.freeAcqOneTime).toBeCloseTo(
      free * AI_SIGNUP_GRANT_USD * MIX.freeGrantUsage,
      6,
    );
    // net is revenue minus the recurring expense only; the one-time cost is excluded.
    expect(p.net).toBeCloseTo(p.revenue - p.expense, 9);
  });

  it("is net positive at scale for the seed tiers (Path A is sustainable)", () => {
    expect(projectAtScale(50000, TIERS, MIX).net).toBeGreaterThan(0);
  });
});

describe("owner taxes (single-member LLC pass-through)", () => {
  it("default rate is a plausible blended SE + federal + state estimate", () => {
    expect(DEFAULT_TAX_RATE).toBeGreaterThan(0.2);
    expect(DEFAULT_TAX_RATE).toBeLessThan(0.5);
  });

  it("taxOnProfit charges the rate on positive profit, nothing on a loss", () => {
    expect(taxOnProfit(1000, 0.35)).toBeCloseTo(350, 9);
    expect(taxOnProfit(0, 0.35)).toBe(0);
    expect(taxOnProfit(-500, 0.35)).toBe(0);
  });

  it("taxRate defaults to 0 so net == take-home (pre-tax model unchanged)", () => {
    const p = projectAtScale(50000, TIERS, MIX);
    expect(p.tax).toBe(0);
    expect(p.takeHome).toBeCloseTo(p.net, 9);
  });

  it("at scale (profit) tax is rate x net and take-home is the remainder", () => {
    const p = projectAtScale(50000, TIERS, MIX, 300, DEFAULT_SCALING_SERVICES, 0.35);
    expect(p.net).toBeGreaterThan(0);
    expect(p.tax).toBeCloseTo(p.net * 0.35, 6);
    expect(p.takeHome).toBeCloseTo(p.net * 0.65, 6);
  });

  it("at a loss there is no tax and take-home equals the (negative) net", () => {
    const p = projectAtScale(100, TIERS, MIX, 300, DEFAULT_SCALING_SERVICES, 0.35);
    expect(p.net).toBeLessThan(0);
    expect(p.tax).toBe(0);
    expect(p.takeHome).toBeCloseTo(p.net, 9);
  });

  it("taxes do not move break-even (profit is zero there, so tax is zero)", () => {
    const taxed = breakEvenUsers(TIERS, MIX, 196);
    // breakEvenUsers is pre-tax by construction; confirm net at that point is ~0
    // so applying any tax rate leaves it unchanged.
    const at = projectAtScale(taxed, TIERS, MIX, 196, DEFAULT_SCALING_SERVICES, 0.35);
    expect(at.tax).toBeLessThan(1); // negligible: profit is ~0 at break-even
  });
});

describe("breakEvenConversion", () => {
  it("is zero at the default zero relay (free users cost nothing recurring)", () => {
    expect(breakEvenConversion(TIERS, MIX)).toBe(0);
    expect(freeUsersPerPayer(TIERS, MIX)).toBe(Number.POSITIVE_INFINITY);
  });

  it("break-even users is the first count where net turns non-negative", () => {
    const fixed = 196;
    const be = breakEvenUsers(TIERS, MIX, fixed);
    expect(be).toBeGreaterThan(0);
    expect(Number.isFinite(be)).toBe(true);
    // Net is non-negative at break-even and was negative one step (100) before.
    expect(projectAtScale(be, TIERS, MIX, fixed).net).toBeGreaterThanOrEqual(0);
    expect(projectAtScale(be - 100, TIERS, MIX, fixed).net).toBeLessThan(0);
  });

  it("break-even users is Infinity when each user loses money", () => {
    // Zero conversion means no revenue, so no scale ever covers the fixed cost.
    expect(breakEvenUsers(TIERS, { ...MIX, conversion: 0 }, 196)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("service step-ups push break-even out vs no scaling", () => {
    const noScaling = breakEvenUsers(TIERS, MIX, 196, []);
    const withScaling = breakEvenUsers(TIERS, MIX, 196); // default services
    expect(withScaling).toBeGreaterThanOrEqual(noScaling);
    expect(Number.isFinite(withScaling)).toBe(true);
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
