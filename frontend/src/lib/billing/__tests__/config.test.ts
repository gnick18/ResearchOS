// Metered-storage billing, pure config tests.

import { describe, expect, it } from "vitest";

import {
  BYTES_PER_GB,
  FREE_ALLOWANCE_BYTES,
  MIN_MONTHLY_CHARGE_CENTS,
  billableBytes,
  gbToBytes,
  maxMonthlyCostCents,
  monthlyChargeCents,
  rawChargeCents,
  reportableGb,
} from "../config";

const GB = 1024 ** 3;

describe("billableBytes", () => {
  it("is zero within the free tier and the overage above it", () => {
    expect(FREE_ALLOWANCE_BYTES).toBe(1 * GB);
    expect(billableBytes(0.5 * GB)).toBe(0);
    expect(billableBytes(1 * GB)).toBe(0);
    expect(billableBytes(3 * GB)).toBe(2 * GB);
  });
});

describe("rawChargeCents", () => {
  it("charges $0.30 per GB-month above the free tier", () => {
    // 11 GB used = 10 GB billable * $0.30 = $3.00.
    expect(rawChargeCents(11 * GB)).toBe(300);
    expect(rawChargeCents(1 * GB)).toBe(0);
  });
});

describe("monthlyChargeCents", () => {
  it("waives any charge below the monthly minimum", () => {
    // 1.5 GB = 0.5 GB billable * $0.30 = 15 cents, under the $2 minimum -> waived.
    expect(rawChargeCents(1.5 * GB)).toBe(15);
    expect(monthlyChargeCents(1.5 * GB)).toBe(0);
  });

  it("charges in full once the minimum is met", () => {
    // 8 GB = 7 GB billable * $0.30 = $2.10, at or above the $2 minimum.
    const charge = monthlyChargeCents(8 * GB);
    expect(charge).toBe(210);
    expect(charge).toBeGreaterThanOrEqual(MIN_MONTHLY_CHARGE_CENTS);
  });
});

describe("maxMonthlyCostCents", () => {
  it("is the whole cap used above the free tier", () => {
    expect(maxMonthlyCostCents(5)).toBe(120); // 4 GB * $0.30 = $1.20
    expect(maxMonthlyCostCents(25)).toBe(720); // 24 GB * $0.30 = $7.20
    expect(maxMonthlyCostCents(100)).toBe(2970); // 99 GB * $0.30 = $29.70
  });
});

describe("gbToBytes", () => {
  it("converts GB to bytes", () => {
    expect(gbToBytes(5)).toBe(5 * BYTES_PER_GB);
  });
});

describe("reportableGb", () => {
  it("reports the billable GB once the minimum is met, else 0 (waived)", () => {
    expect(reportableGb(1.5 * GB)).toBe(0); // 15 cents, waived
    expect(reportableGb(0.5 * GB)).toBe(0); // within free tier
    expect(reportableGb(8 * GB)).toBe(7); // 7 GB billable, $2.10 charge
  });
});
