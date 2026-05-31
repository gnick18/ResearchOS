import { describe, it, expect } from "vitest";
import {
  computeReorderSuggestions,
  dueReorderSuggestions,
  normalizeItemName,
  daysToWeeks,
  DUE_RATIO,
  MIN_ORDERS_FOR_CADENCE,
  type ReorderPurchaseInput,
} from "./reorder-cadence";

// A fixed evaluation instant so every "weeks ago" date is deterministic.
// 2026-06-01T00:00:00Z, chosen to match the project's working date.
const NOW_MS = Date.parse("2026-06-01T00:00:00Z");
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** ISO date string for `weeks` whole weeks before NOW. */
function weeksAgo(weeks: number): string {
  return new Date(NOW_MS - weeks * MS_PER_WEEK).toISOString().slice(0, 10);
}

/** Terse fixture builder. id auto-increments so "most recent" is stable. */
let nextId = 1;
function order(
  name: string,
  weeks: number,
  extra: Partial<ReorderPurchaseInput> = {},
): ReorderPurchaseInput {
  return {
    id: nextId++,
    item_name: name,
    cas: null,
    vendor: null,
    link: null,
    price_per_unit: 0,
    quantity: 1,
    order_date: weeksAgo(weeks),
    ...extra,
  };
}

describe("computeReorderSuggestions - brief fixtures", () => {
  it("orders at 0/6/12/18 weeks ago -> mean 6 weeks, last 0 weeks ago -> NOT due", () => {
    // Four orders spaced exactly 6 weeks apart, the newest placed today.
    // Intervals between the four dates are 6,6,6 weeks -> mean 6 weeks.
    // Time since last = 0 -> ratio 0 -> not due.
    const inputs = [
      order("Q5 Polymerase", 18),
      order("Q5 Polymerase", 12),
      order("Q5 Polymerase", 6),
      order("Q5 Polymerase", 0),
    ];
    const [s] = computeReorderSuggestions(inputs, NOW_MS);
    expect(s).toBeDefined();
    expect(s.orderCount).toBe(4);
    expect(s.meanIntervalDays).toBe(42); // 6 weeks
    expect(s.daysSinceLast).toBe(0);
    expect(s.due).toBe(false);
    expect(s.ratio).toBe(0);
  });

  it("mean 6 weeks, last order 7 weeks ago -> DUE", () => {
    // Three orders 6 weeks apart, but the newest is 7 weeks old:
    // dates at 19, 13, 7 weeks ago. Intervals 6,6 weeks -> mean 6 weeks.
    // Time since last = 7 weeks > 0.8*6 = 4.8 weeks -> due.
    const inputs = [
      order("Taq", 19),
      order("Taq", 13),
      order("Taq", 7),
    ];
    const [s] = computeReorderSuggestions(inputs, NOW_MS);
    expect(s).toBeDefined();
    expect(s.meanIntervalDays).toBe(42); // 6 weeks
    expect(s.daysSinceLast).toBe(7 * 7); // 49 days
    expect(s.due).toBe(true);
    // 49 / 42 = 1.1666...
    expect(s.ratio).toBeCloseTo(49 / 42, 6);
  });
});

describe("computeReorderSuggestions - due threshold edges", () => {
  it("exactly at 0.8 * mean is due (>= boundary)", () => {
    // mean interval 10 weeks (orders at 28, 18, 8 weeks ago -> intervals
    // 10,10). Last order 8 weeks ago is exactly 0.8 * 10 = 8 weeks -> due.
    const inputs = [
      order("Acetonitrile", 28),
      order("Acetonitrile", 18),
      order("Acetonitrile", 8),
    ];
    const [s] = computeReorderSuggestions(inputs, NOW_MS);
    expect(s.meanIntervalDays).toBe(70); // 10 weeks
    expect(s.daysSinceLast).toBe(56); // 8 weeks
    // 56 === 0.8 * 70 exactly -> due is inclusive.
    expect(s.daysSinceLast).toBe(DUE_RATIO * s.meanIntervalDays);
    expect(s.due).toBe(true);
  });

  it("just under 0.8 * mean is NOT due", () => {
    // mean interval 10 weeks; last order 5 weeks ago -> 5 < 8 -> not due.
    const inputs = [
      order("Methanol", 25),
      order("Methanol", 15),
      order("Methanol", 5),
    ];
    const [s] = computeReorderSuggestions(inputs, NOW_MS);
    expect(s.meanIntervalDays).toBe(70);
    expect(s.daysSinceLast).toBe(35); // 5 weeks
    expect(s.due).toBe(false);
  });
});

describe("computeReorderSuggestions - qualification gate", () => {
  it("fewer than 3 distinct order dates is NOT suggested", () => {
    const inputs = [order("Pipette tips", 8), order("Pipette tips", 2)];
    expect(computeReorderSuggestions(inputs, NOW_MS)).toEqual([]);
  });

  it("exactly 3 distinct order dates qualifies", () => {
    const inputs = [
      order("Eppendorf tubes", 12),
      order("Eppendorf tubes", 8),
      order("Eppendorf tubes", 4),
    ];
    expect(computeReorderSuggestions(inputs, NOW_MS)).toHaveLength(1);
  });

  it("MIN_ORDERS_FOR_CADENCE is 3 (contract)", () => {
    expect(MIN_ORDERS_FOR_CADENCE).toBe(3);
  });
});

describe("computeReorderSuggestions - same-day / duplicate collapsing", () => {
  it("same-day duplicate line items count as ONE ordering event", () => {
    // Five line items but only THREE distinct dates (two pairs are
    // same-day duplicates). Must still qualify (3 dates) and read mean
    // from the three dates, not five rows.
    const inputs = [
      order("DMSO", 12),
      order("DMSO", 12), // same day as above -> collapsed
      order("DMSO", 6),
      order("DMSO", 6), // same day -> collapsed
      order("DMSO", 0),
    ];
    const [s] = computeReorderSuggestions(inputs, NOW_MS);
    expect(s).toBeDefined();
    expect(s.orderCount).toBe(3); // not 5
    expect(s.meanIntervalDays).toBe(42); // intervals 6,6 weeks
  });

  it("two distinct line items on two days does NOT qualify (only 2 dates)", () => {
    const inputs = [
      order("Glycerol", 10),
      order("Glycerol", 10),
      order("Glycerol", 2),
      order("Glycerol", 2),
    ];
    expect(computeReorderSuggestions(inputs, NOW_MS)).toEqual([]);
  });
});

describe("computeReorderSuggestions - grouping", () => {
  it("groups case- and whitespace-insensitively by name", () => {
    const inputs = [
      order("Q5  Polymerase", 18),
      order("q5 polymerase", 12),
      order("Q5 POLYMERASE", 6),
    ];
    const out = computeReorderSuggestions(inputs, NOW_MS);
    expect(out).toHaveLength(1);
    expect(out[0].orderCount).toBe(3);
  });

  it("separates items that share a name but differ by CAS", () => {
    const inputs = [
      order("Buffer", 18, { cas: "111-11-1" }),
      order("Buffer", 12, { cas: "111-11-1" }),
      order("Buffer", 6, { cas: "111-11-1" }),
      order("Buffer", 16, { cas: "222-22-2" }),
      order("Buffer", 10, { cas: "222-22-2" }),
      order("Buffer", 4, { cas: "222-22-2" }),
    ];
    const out = computeReorderSuggestions(inputs, NOW_MS);
    expect(out).toHaveLength(2);
    for (const s of out) expect(s.orderCount).toBe(3);
  });

  it("carries vendor/link/price/quantity from the MOST RECENT order", () => {
    // Same CAS across all three so they group; the cadence representative
    // must be the newest (6-weeks-ago) row's vendor / price / link / qty.
    const inputs = [
      order("Agarose", 18, {
        vendor: "OldVendor",
        price_per_unit: 10,
        cas: "9012-36-6",
      }),
      order("Agarose", 12, {
        vendor: "MidVendor",
        price_per_unit: 11,
        cas: "9012-36-6",
      }),
      order("Agarose", 6, {
        vendor: "NewVendor",
        price_per_unit: 12.5,
        link: "https://example.com/agarose",
        quantity: 3,
        cas: "9012-36-6",
      }),
    ];
    const [s] = computeReorderSuggestions(inputs, NOW_MS);
    expect(s.vendor).toBe("NewVendor");
    expect(s.pricePerUnit).toBe(12.5);
    expect(s.link).toBe("https://example.com/agarose");
    expect(s.quantity).toBe(3);
    expect(s.cas).toBe("9012-36-6");
    // representative id is the newest row's id.
    expect(s.representativeId).toBe(inputs[2].id);
  });
});

describe("computeReorderSuggestions - irregular intervals", () => {
  it("computes a mean + CV for an erratic rhythm without crashing", () => {
    // Dates at 20, 18, 4 weeks ago -> intervals 2 weeks then 14 weeks.
    // mean = 8 weeks; intervals are very spread -> high CV.
    const inputs = [
      order("Random reagent", 20),
      order("Random reagent", 18),
      order("Random reagent", 4),
    ];
    const [s] = computeReorderSuggestions(inputs, NOW_MS);
    expect(s.meanIntervalDays).toBe(56); // 8 weeks
    // intervals (days): 14 and 98, mean 56, stddev 42 -> CV = 0.75.
    expect(s.intervalCv).toBeCloseTo(0.75, 6);
    // last order 4 weeks (28d) ago; 28 < 0.8*56=44.8 -> not due.
    expect(s.due).toBe(false);
  });
});

describe("computeReorderSuggestions - undated / future / blank", () => {
  it("drops undated purchases from the date series", () => {
    // Three dated orders qualify; one undated row is ignored.
    const inputs = [
      order("Ethanol", 18),
      order("Ethanol", 12),
      order("Ethanol", 6),
      order("Ethanol", 0, { order_date: null }),
    ];
    const [s] = computeReorderSuggestions(inputs, NOW_MS);
    expect(s.orderCount).toBe(3);
    // last DATED order was 6 weeks ago.
    expect(s.daysSinceLast).toBe(42);
  });

  it("skips a group with only undated rows", () => {
    const inputs = [
      order("Mystery", 0, { order_date: null }),
      order("Mystery", 0, { order_date: "" }),
      order("Mystery", 0, { order_date: "   " }),
    ];
    expect(computeReorderSuggestions(inputs, NOW_MS)).toEqual([]);
  });

  it("clamps a future-dated last order to daysSinceLast >= 0", () => {
    // Newest order dated in the FUTURE (start_date ahead of now). The
    // model still computes; time-since-last clamps to 0 (not due).
    const future = new Date(NOW_MS + 2 * MS_PER_WEEK).toISOString().slice(0, 10);
    const inputs = [
      order("Preorder", 12),
      order("Preorder", 6),
      { ...order("Preorder", 0), order_date: future },
    ];
    const [s] = computeReorderSuggestions(inputs, NOW_MS);
    expect(s.daysSinceLast).toBe(0);
    expect(s.due).toBe(false);
  });

  it("ignores rows with a blank item name", () => {
    const inputs = [
      order("", 18),
      order("   ", 12),
      order("Real", 18),
      order("Real", 12),
      order("Real", 6),
    ];
    const out = computeReorderSuggestions(inputs, NOW_MS);
    expect(out).toHaveLength(1);
    expect(out[0].itemName).toBe("Real");
  });
});

describe("computeReorderSuggestions - ordering of results", () => {
  it("sorts most-overdue (highest ratio) first", () => {
    const inputs = [
      // On-track item: mean 6w, last 0w ago -> ratio 0.
      order("OnTrack", 18),
      order("OnTrack", 12),
      order("OnTrack", 6),
      order("OnTrack", 0),
      // Overdue item: mean 6w, last 9w ago -> ratio 1.5.
      order("VeryOverdue", 21),
      order("VeryOverdue", 15),
      order("VeryOverdue", 9),
    ];
    const out = computeReorderSuggestions(inputs, NOW_MS);
    expect(out.map((s) => s.itemName)).toEqual(["VeryOverdue", "OnTrack"]);
  });
});

describe("dueReorderSuggestions", () => {
  it("returns only the due items", () => {
    const inputs = [
      // Not due (just ordered).
      order("Fresh", 18),
      order("Fresh", 12),
      order("Fresh", 6),
      order("Fresh", 0),
      // Due (overdue).
      order("Stale", 21),
      order("Stale", 15),
      order("Stale", 9),
    ];
    const due = dueReorderSuggestions(inputs, NOW_MS);
    expect(due.map((s) => s.itemName)).toEqual(["Stale"]);
  });
});

describe("helpers", () => {
  it("normalizeItemName collapses case + whitespace", () => {
    expect(normalizeItemName("  Q5   Polymerase ")).toBe("q5 polymerase");
  });

  it("daysToWeeks rounds to whole weeks", () => {
    expect(daysToWeeks(42)).toBe(6);
    expect(daysToWeeks(45)).toBe(6); // 6.43 -> 6
    expect(daysToWeeks(49)).toBe(7);
  });
});
