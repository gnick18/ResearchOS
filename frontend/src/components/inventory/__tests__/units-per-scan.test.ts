// Units-per-scan inventory model tests (scan-manager sub-bot, 2026-06-08).
//
// Covers:
//   deductUnitsFromScan — basic math, units_per_scan > 1, clamp at 0,
//     multiplier param (default 1 preserves single-scan behavior)
//   deriveInventoryStatus — units path: empty at 0, low below threshold,
//     in_stock above threshold, manual tap honored, expiry still wins
//   deriveInventoryStatus — legacy path unaffected (no units_per_scan)

import { describe, expect, it } from "vitest";

import { deductUnitsFromScan } from "../barcode-consume";
import { deriveInventoryStatus } from "@/lib/local-api";

// ── deductUnitsFromScan ──────────────────────────────────────────────────────

describe("deductUnitsFromScan", () => {
  it("deducts units_per_scan=1 from a full box of 50", () => {
    expect(deductUnitsFromScan(50, 1)).toBe(49);
  });

  it("deducts units_per_scan=5 in one scan", () => {
    expect(deductUnitsFromScan(50, 5)).toBe(45);
  });

  it("reaches zero exactly at the last scan (units_per_scan=1, remaining=1)", () => {
    expect(deductUnitsFromScan(1, 1)).toBe(0);
  });

  it("clamps at 0 — never goes negative even if deduction exceeds remaining", () => {
    expect(deductUnitsFromScan(3, 5)).toBe(0);
    expect(deductUnitsFromScan(0, 1)).toBe(0);
  });

  it("full box of 50 with units_per_scan=1 empties in exactly 50 scans", () => {
    let remaining = 50;
    for (let i = 0; i < 50; i++) {
      remaining = deductUnitsFromScan(remaining, 1);
    }
    expect(remaining).toBe(0);
  });

  it("full box of 50 with units_per_scan=5 empties in exactly 10 scans", () => {
    let remaining = 50;
    for (let i = 0; i < 10; i++) {
      remaining = deductUnitsFromScan(remaining, 5);
    }
    expect(remaining).toBe(0);
  });

  // ── multiplier param ────────────────────────────────────────────────────────

  it("multiplier defaults to 1 — single-scan behavior unchanged", () => {
    expect(deductUnitsFromScan(50, 5)).toBe(45);
    // explicit 1 same as no arg
    expect(deductUnitsFromScan(50, 5, 1)).toBe(45);
  });

  it("multiplier=3 deducts 3 * units_per_scan in one call", () => {
    expect(deductUnitsFromScan(50, 5, 3)).toBe(35);   // 50 - 15 = 35
    expect(deductUnitsFromScan(50, 1, 3)).toBe(47);   // 50 - 3 = 47
  });

  it("multiplier clamps at 0 — never goes negative", () => {
    expect(deductUnitsFromScan(10, 5, 3)).toBe(0);    // 10 - 15 = -5, clamped
    expect(deductUnitsFromScan(0, 5, 10)).toBe(0);
  });

  it("multiplier=1 matches single-scan across a variety of units_per_scan values", () => {
    for (const ups of [1, 2, 5, 10]) {
      expect(deductUnitsFromScan(100, ups, 1)).toBe(deductUnitsFromScan(100, ups));
    }
  });
});

// ── deriveInventoryStatus with units_per_scan ────────────────────────────────
//
// Helpers mirror the shape expected by deriveInventoryStatus.

function makeUnitStock(
  units_remaining: number,
  units_per_scan: number,
  overrides: {
    container_count?: number;
    expiration_date?: string | null;
    status?: "in_stock" | "low" | "empty" | "expired";
  } = {},
) {
  return {
    container_count: overrides.container_count ?? 1,
    expiration_date: overrides.expiration_date ?? null,
    status: overrides.status,
    units_per_scan,
    units_remaining,
  };
}

describe("deriveInventoryStatus — units-per-scan path", () => {
  const item = { low_at_count: 10 }; // threshold = 10 units

  it("returns empty when units_remaining is 0", () => {
    expect(deriveInventoryStatus(makeUnitStock(0, 1), item)).toBe("empty");
  });

  it("returns empty when units_remaining is negative (should not happen but guard)", () => {
    // Clamp math in deductUnitsFromScan prevents this; deriveInventoryStatus
    // treats any value <= 0 as empty for safety.
    expect(deriveInventoryStatus(makeUnitStock(-1, 1), item)).toBe("empty");
  });

  it("returns low when units_remaining < low_at_count threshold", () => {
    expect(deriveInventoryStatus(makeUnitStock(9, 1), item)).toBe("low");
    expect(deriveInventoryStatus(makeUnitStock(1, 1), item)).toBe("low");
  });

  it("returns in_stock when units_remaining equals threshold (not below)", () => {
    // low is strictly less-than, so exactly at the threshold is still in_stock.
    expect(deriveInventoryStatus(makeUnitStock(10, 1), item)).toBe("in_stock");
  });

  it("returns in_stock when units_remaining is well above threshold", () => {
    expect(deriveInventoryStatus(makeUnitStock(50, 1), item)).toBe("in_stock");
    expect(deriveInventoryStatus(makeUnitStock(50, 5), item)).toBe("in_stock");
  });

  it("returns in_stock when no threshold is set and remaining > 0", () => {
    const noThreshold = { low_at_count: null };
    expect(deriveInventoryStatus(makeUnitStock(5, 1), noThreshold)).toBe("in_stock");
  });

  it("honors a manual 'low' tap even when remaining is above the threshold", () => {
    const s = makeUnitStock(50, 1, { status: "low" });
    expect(
      deriveInventoryStatus(s, item, { manualStatus: "low" }),
    ).toBe("low");
  });

  it("expiry still wins over units_remaining > 0", () => {
    const pastDate = "2020-01-01T00:00:00.000Z";
    const s = makeUnitStock(50, 1, { expiration_date: pastDate });
    expect(deriveInventoryStatus(s, item)).toBe("expired");
  });

  it("units path uses units_remaining for low, NOT container_count", () => {
    // container_count = 10, units_remaining = 5 (< threshold 10): low.
    const s = makeUnitStock(5, 1, { container_count: 10 });
    expect(deriveInventoryStatus(s, item)).toBe("low");
  });
});

// ── deriveInventoryStatus legacy path (no units_per_scan) ────────────────────

describe("deriveInventoryStatus — legacy container-count path (unaffected)", () => {
  it("returns empty when container_count is 0", () => {
    expect(
      deriveInventoryStatus(
        { container_count: 0, expiration_date: null },
        null,
      ),
    ).toBe("empty");
  });

  it("returns in_stock for a positive count with no threshold", () => {
    expect(
      deriveInventoryStatus(
        { container_count: 3, expiration_date: null },
        null,
      ),
    ).toBe("in_stock");
  });

  it("returns low when summed count < low_at_count", () => {
    expect(
      deriveInventoryStatus(
        { container_count: 1, expiration_date: null },
        { low_at_count: 2 },
        { summedCount: 1 },
      ),
    ).toBe("low");
  });

  it("a stock with undefined units_per_scan is treated as legacy (no units path)", () => {
    // units_per_scan absent means the container-count path runs normally.
    const s = { container_count: 5, expiration_date: null, units_per_scan: undefined };
    expect(deriveInventoryStatus(s, { low_at_count: null })).toBe("in_stock");
  });
});
