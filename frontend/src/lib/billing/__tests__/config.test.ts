// Metered-storage billing, pure config tests.

import { describe, expect, it } from "vitest";

import { BYTES_PER_BLOCK, GB_PER_BLOCK, paidStorageBytes } from "../config";

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
