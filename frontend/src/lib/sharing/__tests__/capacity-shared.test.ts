import { describe, expect, it } from "vitest";

import {
  capacityStatus,
  FREE_TIER,
  pctUsed,
} from "../capacity-shared";

describe("pctUsed", () => {
  it("computes a normal percentage", () => {
    expect(pctUsed(25, 100)).toBe(25);
    expect(pctUsed(1, 4)).toBe(25);
  });

  it("clamps to 100 when over the limit", () => {
    expect(pctUsed(150, 100)).toBe(100);
  });

  it("clamps to 0 for negative usage", () => {
    expect(pctUsed(-5, 100)).toBe(0);
  });

  it("returns 0 for a non-positive limit instead of dividing by zero", () => {
    expect(pctUsed(10, 0)).toBe(0);
    expect(pctUsed(10, -1)).toBe(0);
  });
});

describe("capacityStatus", () => {
  it("is ok below 70 percent", () => {
    expect(capacityStatus(0)).toBe("ok");
    expect(capacityStatus(69.9)).toBe("ok");
  });

  it("is watch from 70 up to 90 percent", () => {
    expect(capacityStatus(70)).toBe("watch");
    expect(capacityStatus(89.9)).toBe("watch");
  });

  it("is critical at 90 percent and above", () => {
    expect(capacityStatus(90)).toBe("critical");
    expect(capacityStatus(100)).toBe("critical");
  });
});

describe("FREE_TIER", () => {
  it("has positive ceilings for every tracked service", () => {
    expect(FREE_TIER.neonStorageBytes).toBeGreaterThan(0);
    expect(FREE_TIER.r2StorageBytes).toBeGreaterThan(0);
    expect(FREE_TIER.upstashStorageBytes).toBeGreaterThan(0);
    expect(FREE_TIER.upstashCommandsPerMonth).toBeGreaterThan(0);
    expect(FREE_TIER.resendPerDay).toBeGreaterThan(0);
    expect(FREE_TIER.resendPerMonth).toBeGreaterThan(0);
  });

  it("R2 ceiling is larger than the Neon ceiling (bundles are the heavy data)", () => {
    expect(FREE_TIER.r2StorageBytes).toBeGreaterThan(FREE_TIER.neonStorageBytes);
  });
});
