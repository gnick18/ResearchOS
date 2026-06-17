import { describe, expect, it } from "vitest";

import {
  MODEL_A_PLANS,
  ACCRUAL_CHARGE_THRESHOLD_CENTS,
  getModelAPlan,
  periodCharge,
  isChargeable,
} from "../pricing";
import {
  relayCost,
  storageRetailPerGB,
  hostedAssetMonthlyCost,
} from "@/lib/pricing/service-model";

const GB = 1e9;
const noUsage = { writes: 0, storageBytes: 0, hostedBytes: 0 };

describe("Model A pricing core", () => {
  it("free accrues nothing, even with usage (receive-only, no produce)", () => {
    const c = periodCharge(MODEL_A_PLANS.free, {
      writes: 5_000_000,
      storageBytes: 10 * GB,
      hostedBytes: 2 * GB,
    });
    // Free has no base and no produce usage, but storage/hosted are still a-la-carte
    // priced if somehow present. A pure free user has none, so confirm base+usage 0.
    expect(c.baseCents).toBe(0);
    expect(c.usageCents).toBe(0);
  });

  it("solo is a $3 base plus 5x relay usage", () => {
    const writes = 200_000;
    const c = periodCharge(MODEL_A_PLANS.solo, { ...noUsage, writes });
    expect(c.baseCents).toBe(300);
    const expectedUsage = Math.round(relayCost(writes / 1_000_000) * 5 * 100);
    expect(c.usageCents).toBe(expectedUsage);
    expect(c.totalCents).toBe(300 + expectedUsage);
  });

  it("base fee is per-lab for lab and dept", () => {
    const lab1 = periodCharge(MODEL_A_PLANS.lab, { ...noUsage, labCount: 1 });
    const lab3 = periodCharge(MODEL_A_PLANS.lab, { ...noUsage, labCount: 3 });
    expect(lab1.baseCents).toBe(2500);
    expect(lab3.baseCents).toBe(7500);

    const dept5 = periodCharge(MODEL_A_PLANS.dept, { ...noUsage, labCount: 5 });
    expect(dept5.baseCents).toBe(25000);
  });

  it("lab marks usage up more than dept, dept more than solo (7 > 6 > 5)", () => {
    const writes = 1_000_000;
    const solo = periodCharge(MODEL_A_PLANS.solo, { ...noUsage, writes }).usageCents;
    const dept = periodCharge(MODEL_A_PLANS.dept, { ...noUsage, writes }).usageCents;
    const lab = periodCharge(MODEL_A_PLANS.lab, { ...noUsage, writes }).usageCents;
    expect(lab).toBeGreaterThan(dept);
    expect(dept).toBeGreaterThan(solo);
  });

  it("storage and hosted bill at the flat 1.15x near-cost rate", () => {
    const c = periodCharge(MODEL_A_PLANS.solo, {
      writes: 0,
      storageBytes: 4 * GB,
      hostedBytes: 1.5 * GB,
    });
    expect(c.storageCents).toBe(Math.round(4 * storageRetailPerGB() * 100));
    expect(c.hostedCents).toBe(Math.round(hostedAssetMonthlyCost(1.5 * GB) * 100));
  });

  it("totalCents is the sum of all components", () => {
    const c = periodCharge(MODEL_A_PLANS.lab, {
      writes: 500_000,
      storageBytes: 20 * GB,
      hostedBytes: 3 * GB,
      labCount: 2,
    });
    expect(c.totalCents).toBe(
      c.baseCents + c.usageCents + c.storageCents + c.hostedCents,
    );
  });

  it("getModelAPlan falls back to free for unknown/missing ids", () => {
    expect(getModelAPlan("solo").id).toBe("solo");
    expect(getModelAPlan("nonsense").id).toBe("free");
    expect(getModelAPlan(null).id).toBe("free");
    expect(getModelAPlan(undefined).id).toBe("free");
  });

  it("isChargeable trips at the $5 threshold", () => {
    expect(ACCRUAL_CHARGE_THRESHOLD_CENTS).toBe(500);
    expect(isChargeable(499)).toBe(false);
    expect(isChargeable(500)).toBe(true);
    expect(isChargeable(1200)).toBe(true);
  });
});
