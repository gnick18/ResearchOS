import { describe, expect, it } from "vitest";

import { ACTIVITY_PER_M_WRITES, BLENDED_PER_GB_MO, BUFFER } from "../assumptions";
import { stripeMonthlyAmortized, FIXED_BASE_MONTHLY } from "../modeling";
import {
  STORAGE_MARKUP,
  storageRetailPerGB,
  relayCost,
  serviceMargin,
  avgFreeUserCostPathA,
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
  freeRelayWritesM: 0.05,
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
    // Relay cost is tiny relative to a service price, so net should be high.
    expect(serviceMargin(6, 0.5, "annual").net).toBeGreaterThan(4.5);
  });

  it("marginX is Infinity for a relay-free (governance/presence) line", () => {
    expect(serviceMargin(16, 0, "annual").marginX).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("free users are cheap under Path A", () => {
  it("free cost is only the thin relay footprint", () => {
    expect(avgFreeUserCostPathA(0.05)).toBeCloseTo(relayCost(0.05), 9);
  });

  it("a free user costs far less than a paying user nets", () => {
    const free = avgFreeUserCostPathA(MIX.freeRelayWritesM);
    const paid = blendedPaidNet(TIERS, MIX);
    expect(paid).toBeGreaterThan(free * 20);
  });
});

describe("blendedPaidNet", () => {
  it("amortizes the dept governance fee across lab members", () => {
    // Pure-dept mix should beat pure-lab by exactly govFee / membersPerLab.
    const deptOnly = blendedPaidNet(TIERS, { ...MIX, soloShare: 0, labShare: 0, deptShare: 1 });
    const labOnly = blendedPaidNet(TIERS, { ...MIX, soloShare: 0, labShare: 1, deptShare: 0 });
    expect(deptOnly - labOnly).toBeCloseTo(16 / 6, 9);
  });

  it("normalizes shares that do not sum to one", () => {
    const a = blendedPaidNet(TIERS, { ...MIX, soloShare: 1, labShare: 1, deptShare: 1 });
    const b = blendedPaidNet(TIERS, { ...MIX, soloShare: 2, labShare: 2, deptShare: 2 });
    expect(a).toBeCloseTo(b, 9);
  });
});

describe("projectAtScale", () => {
  it("revenue is paid users times blended net", () => {
    const p = projectAtScale(10000, TIERS, MIX);
    expect(p.revenue).toBeCloseTo(10000 * 0.05 * blendedPaidNet(TIERS, MIX), 6);
  });

  it("expense is the free base relay cost plus the fixed floor", () => {
    const p = projectAtScale(10000, TIERS, MIX);
    const free = 10000 * 0.95;
    expect(p.expense).toBeCloseTo(
      free * avgFreeUserCostPathA(MIX.freeRelayWritesM) + FIXED_BASE_MONTHLY,
      6,
    );
  });

  it("is net positive at scale for the seed tiers (Path A is sustainable)", () => {
    expect(projectAtScale(50000, TIERS, MIX).net).toBeGreaterThan(0);
  });
});

describe("breakEvenConversion", () => {
  it("is freeCost / (paidNet + freeCost)", () => {
    const F = avgFreeUserCostPathA(MIX.freeRelayWritesM);
    const R = blendedPaidNet(TIERS, MIX);
    expect(breakEvenConversion(TIERS, MIX)).toBeCloseTo(F / (R + F), 9);
  });

  it("lands at a realistic low conversion because the free base is cheap", () => {
    expect(breakEvenConversion(TIERS, MIX)).toBeLessThan(0.03);
  });

  it("freeUsersPerPayer is the inverse intuition", () => {
    const be = breakEvenConversion(TIERS, MIX);
    // free per payer ~= (1 - be) / be
    expect(freeUsersPerPayer(TIERS, MIX)).toBeCloseTo((1 - be) / be, 6);
  });
});
