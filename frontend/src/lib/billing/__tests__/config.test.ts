// Metered-storage billing, pure config tests.

import { describe, expect, it } from "vitest";

import {
  BYTES_PER_BLOCK,
  GB_PER_BLOCK,
  PRICE_WIGGLE_CENTS,
  STRIPE_FEE_FLAT_CENTS,
  STRIPE_FEE_PCT,
  NEON_STORAGE_USD_PER_GB_MONTH,
  paidStorageBytes,
  recommendedBlockPriceCents,
} from "../config";

describe("paidStorageBytes", () => {
  const GB = 1024 ** 3;

  it("grants GB_PER_BLOCK per active block", () => {
    expect(BYTES_PER_BLOCK).toBe(GB_PER_BLOCK * GB);
    expect(paidStorageBytes(1)).toBe(BYTES_PER_BLOCK);
    expect(paidStorageBytes(3)).toBe(3 * BYTES_PER_BLOCK);
  });

  it("is zero for non-positive, NaN, or fractional-floored input", () => {
    expect(paidStorageBytes(0)).toBe(0);
    expect(paidStorageBytes(-2)).toBe(0);
    expect(paidStorageBytes(Number.NaN)).toBe(0);
    expect(paidStorageBytes(2.9)).toBe(2 * BYTES_PER_BLOCK);
  });
});

describe("recommendedBlockPriceCents", () => {
  it("prices a 10 GB block at data + Stripe fee + $1 (tax added separately)", () => {
    // 10 GB * $0.35 = $3.50 data; + $1 = $4.50 net target; grossed for the fee.
    expect(recommendedBlockPriceCents(10)).toBe(495); // $4.95
  });

  it("still nets at least the data cost plus the $1 buffer after the Stripe fee", () => {
    for (const gb of [5, 10, 20, 50]) {
      const price = recommendedBlockPriceCents(gb);
      const fee = Math.round(STRIPE_FEE_PCT * price + STRIPE_FEE_FLAT_CENTS);
      const net = price - fee;
      const dataCost = Math.round(gb * NEON_STORAGE_USD_PER_GB_MONTH * 100);
      expect(net).toBeGreaterThanOrEqual(dataCost + PRICE_WIGGLE_CENTS);
    }
  });
});
