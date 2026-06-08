// Chunk 3 signal-computation tests. Each pure function takes an explicit
// `now: Date` so the boundaries are deterministic (no Date.now() in tests).
// Covers: expiring boundary at 30 days + already-expired; stale boundary at 6
// months on received vs last_touched (most-recent touch wins); low summing
// across stocks + the manual low/empty union.

import { describe, expect, it } from "vitest";

import {
  computeExpiringSignals,
  computeStaleSignals,
  computeLowSignals,
  computeInventorySignals,
  formatDate,
  EXPIRING_SOON_DAYS,
} from "../inventory-ui";
import type { InventoryItem, InventoryStock } from "@/lib/types";

// A fixed reference clock for every test in this file.
const NOW = new Date("2026-06-07T12:00:00.000Z");

function isoDaysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function makeItem(over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 1,
    name: "Q5 Polymerase",
    category: "reagent",
    catalog_number: null,
    vendor: "NEB",
    cas: null,
    url: null,
    container_label: "vial",
    notes: null,
    low_at_count: null,
    track_consumption: false,
    product_barcode: null,
    registry: null,
    owner: "me",
    shared_with: [],
    created_by: "me",
    ...over,
  };
}

function makeStock(over: Partial<InventoryStock> = {}): InventoryStock {
  return {
    id: 1,
    item_id: 1,
    lot_number: null,
    container_count: 3,
    status: "in_stock",
    received_date: null,
    expiration_date: null,
    opened_date: null,
    last_touched_at: null,
    amount_per_container: null,
    unit: null,
    concentration: null,
    location_text: null,
    location_node_id: null,
    position: null,
    purchase_item_id: null,
    container_code: null,
    notes: null,
    owner: "me",
    shared_with: [],
    created_by: "me",
    ...over,
  };
}

describe("computeExpiringSignals", () => {
  const item = makeItem();

  it("fires at exactly the 30-day boundary (inclusive)", () => {
    const stock = makeStock({
      expiration_date: isoDaysFromNow(EXPIRING_SOON_DAYS),
    });
    const out = computeExpiringSignals([item], [stock], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].daysToExpiry).toBe(30);
    expect(out[0].expired).toBe(false);
    expect(out[0].annotation).toMatch(/^Expires in 30 days /);
  });

  it("does NOT fire one day past the 30-day boundary", () => {
    const stock = makeStock({
      expiration_date: isoDaysFromNow(EXPIRING_SOON_DAYS + 1),
    });
    expect(computeExpiringSignals([item], [stock], NOW)).toHaveLength(0);
  });

  it("flags an already-expired stock with an 'Expired N days ago' annotation", () => {
    const stock = makeStock({ expiration_date: isoDaysFromNow(-4) });
    const out = computeExpiringSignals([item], [stock], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].expired).toBe(true);
    expect(out[0].daysToExpiry).toBe(-4);
    expect(out[0].annotation).toMatch(/^Expired 4 days ago /);
  });

  it("ignores stocks with no expiration date", () => {
    const stock = makeStock({ expiration_date: null });
    expect(computeExpiringSignals([item], [stock], NOW)).toHaveLength(0);
  });

  it("sorts most-expired first", () => {
    const stocks = [
      makeStock({ id: 1, expiration_date: isoDaysFromNow(10) }),
      makeStock({ id: 2, expiration_date: isoDaysFromNow(-20) }),
      makeStock({ id: 3, expiration_date: isoDaysFromNow(5) }),
    ];
    const out = computeExpiringSignals([item], stocks, NOW);
    expect(out.map((s) => s.stock.id)).toEqual([2, 3, 1]);
  });
});

describe("computeStaleSignals", () => {
  const item = makeItem();

  it("fires when received_date is older than 6 months and never touched", () => {
    // 8 months back (well past the 6-month cutoff). Midday UTC keeps the
    // rendered calendar date stable across the runner's timezone.
    const stock = makeStock({ received_date: "2025-10-01T12:00:00.000Z" });
    const out = computeStaleSignals([item], [stock], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].annotation).toMatch(/^Received Oct 1, 2025, not touched in/);
    expect(out[0].annotation).toMatch(/months$/);
  });

  it("does NOT fire when received just inside the 6-month window", () => {
    // 5 months back.
    const stock = makeStock({ received_date: "2026-01-07T12:00:00.000Z" });
    expect(computeStaleSignals([item], [stock], NOW)).toHaveLength(0);
  });

  it("a recent last_touched_at rescues an old received_date (most-recent wins)", () => {
    const stock = makeStock({
      received_date: "2025-01-01T00:00:00.000Z", // very old
      last_touched_at: isoDaysFromNow(-10), // touched 10 days ago
    });
    expect(computeStaleSignals([item], [stock], NOW)).toHaveLength(0);
  });

  it("fires off last_touched_at when both are old", () => {
    const stock = makeStock({
      received_date: "2025-01-01T12:00:00.000Z",
      last_touched_at: "2025-08-01T12:00:00.000Z", // ~10 months ago
    });
    const out = computeStaleSignals([item], [stock], NOW);
    expect(out).toHaveLength(1);
    // received_date present so the annotation leads with "Received".
    expect(out[0].annotation).toMatch(/^Received Jan 1, 2025, /);
  });

  it("never fires when neither date is present", () => {
    const stock = makeStock({ received_date: null, last_touched_at: null });
    expect(computeStaleSignals([item], [stock], NOW)).toHaveLength(0);
  });
});

describe("computeLowSignals", () => {
  it("sums container_count across stocks and fires below the threshold", () => {
    const item = makeItem({ id: 5, low_at_count: 2 });
    const stocks = [
      makeStock({ id: 1, item_id: 5, container_count: 1 }),
      makeStock({ id: 2, item_id: 5, container_count: 0 }),
    ];
    const out = computeLowSignals([item], stocks);
    expect(out).toHaveLength(1);
    expect(out[0].totalContainers).toBe(1);
    expect(out[0].empty).toBe(false);
    expect(out[0].chipStatus).toBe("low");
    expect(out[0].annotation).toBe("1 vial, below your threshold of 2");
  });

  it("does NOT fire when the summed total meets the threshold", () => {
    const item = makeItem({ id: 5, low_at_count: 2 });
    const stocks = [
      makeStock({ id: 1, item_id: 5, container_count: 1 }),
      makeStock({ id: 2, item_id: 5, container_count: 1 }),
    ];
    expect(computeLowSignals([item], stocks)).toHaveLength(0);
  });

  it("annotates a zero total as empty", () => {
    const item = makeItem({ id: 5, low_at_count: 2 });
    const stocks = [makeStock({ id: 1, item_id: 5, container_count: 0 })];
    const out = computeLowSignals([item], stocks);
    expect(out).toHaveLength(1);
    expect(out[0].empty).toBe(true);
    expect(out[0].chipStatus).toBe("empty");
    expect(out[0].annotation).toBe("0 vials, empty");
  });

  it("unions in a manual low/empty tap even when no numeric threshold is set", () => {
    const item = makeItem({ id: 5, low_at_count: null });
    const stocks = [
      makeStock({ id: 1, item_id: 5, container_count: 4, status: "low" }),
    ];
    const out = computeLowSignals([item], stocks);
    expect(out).toHaveLength(1);
    expect(out[0].chipStatus).toBe("low");
    expect(out[0].annotation).toBe("4 vials, flagged low");
  });

  it("does NOT fire for a healthy item with no threshold and no manual tap", () => {
    const item = makeItem({ id: 5, low_at_count: null });
    const stocks = [
      makeStock({ id: 1, item_id: 5, container_count: 4, status: "in_stock" }),
    ];
    expect(computeLowSignals([item], stocks)).toHaveLength(0);
  });

  it("sorts emptiest first", () => {
    const items = [
      makeItem({ id: 1, low_at_count: 3 }),
      makeItem({ id: 2, low_at_count: 3 }),
    ];
    const stocks = [
      makeStock({ id: 1, item_id: 1, container_count: 2 }),
      makeStock({ id: 2, item_id: 2, container_count: 0 }),
    ];
    const out = computeLowSignals(items, stocks);
    expect(out.map((s) => s.item.id)).toEqual([2, 1]);
  });
});

describe("computeInventorySignals", () => {
  it("reports allClear only when all three lists are empty", () => {
    const item = makeItem();
    const healthy = makeStock({ container_count: 5, status: "in_stock" });
    expect(computeInventorySignals([item], [healthy], NOW).allClear).toBe(true);

    const item2 = makeItem({ id: 2, low_at_count: 2 });
    const low = makeStock({ id: 9, item_id: 2, container_count: 1 });
    const bundle = computeInventorySignals(
      [item, item2],
      [healthy, low],
      NOW,
    );
    expect(bundle.allClear).toBe(false);
    expect(bundle.low).toHaveLength(1);
  });
});

describe("cross-owner item-id collision (composite owner:id key)", () => {
  // Every user's id counter starts at 1, so in a two-user lab alex and mira can
  // each own an item with id 1. fetchAllInventoryItemsIncludingShared merges
  // both, so a bare-integer key would let one owner's stocks resolve to the
  // other owner's item. These lock the composite `${owner}:${item_id}` keying.

  it("computeLowSignals does NOT merge two owners' stocks under the same id", () => {
    const alexItem = makeItem({
      id: 1,
      owner: "alex",
      name: "Alex Q5",
      low_at_count: 2,
    });
    const miraItem = makeItem({
      id: 1,
      owner: "mira",
      name: "Mira Q5",
      low_at_count: 2,
    });
    const stocks = [
      // alex is genuinely low: 1 container, threshold 2.
      makeStock({ id: 1, item_id: 1, owner: "alex", container_count: 1 }),
      // mira is healthy: 5 containers. A bare-id sum (1 + 5 = 6) would mask
      // alex's low signal entirely.
      makeStock({ id: 2, item_id: 1, owner: "mira", container_count: 5 }),
    ];
    const out = computeLowSignals([alexItem, miraItem], stocks);
    expect(out).toHaveLength(1);
    expect(out[0].item.owner).toBe("alex");
    expect(out[0].totalContainers).toBe(1);
  });

  it("computeExpiringSignals resolves a stock to its OWN owner's item", () => {
    const alexItem = makeItem({ id: 1, owner: "alex", name: "Alex reagent" });
    // mira's item is pushed last, so a bare-id Map would overwrite key `1` with
    // it and mislabel alex's expiring stock as "Mira reagent".
    const miraItem = makeItem({ id: 1, owner: "mira", name: "Mira reagent" });
    const stock = makeStock({
      id: 9,
      item_id: 1,
      owner: "alex",
      expiration_date: isoDaysFromNow(5),
    });
    const out = computeExpiringSignals([alexItem, miraItem], [stock], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].item.owner).toBe("alex");
    expect(out[0].item.name).toBe("Alex reagent");
  });

  it("computeStaleSignals resolves a stock to its OWN owner's item", () => {
    const alexItem = makeItem({ id: 1, owner: "alex", name: "Alex reagent" });
    const miraItem = makeItem({ id: 1, owner: "mira", name: "Mira reagent" });
    const stock = makeStock({
      id: 9,
      item_id: 1,
      owner: "alex",
      received_date: "2025-10-01T12:00:00.000Z",
    });
    const out = computeStaleSignals([alexItem, miraItem], [stock], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].item.owner).toBe("alex");
    expect(out[0].item.name).toBe("Alex reagent");
  });
});

describe("computeStaleSignals annotation wording", () => {
  const item = makeItem();

  it("cites the last-touch date when that is the reference, not just receipt", () => {
    // received Jan 2025, last touched Aug 2025; both past the 6-month cutoff.
    // The "N months" gap is from the LAST TOUCH (Aug), so the annotation must
    // name the touch rather than implying the gap is measured from receipt.
    const stock = makeStock({
      received_date: "2025-01-01T12:00:00.000Z",
      last_touched_at: "2025-08-01T12:00:00.000Z",
    });
    const out = computeStaleSignals([item], [stock], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].annotation).toBe(
      "Received Jan 1, 2025, last touched Aug 1, 2025 (10 months ago)",
    );
  });

  it("uses the received_date phrasing when there is no last touch", () => {
    const stock = makeStock({ received_date: "2025-10-01T12:00:00.000Z" });
    const out = computeStaleSignals([item], [stock], NOW);
    expect(out[0].annotation).toBe("Received Oct 1, 2025, not touched in 8 months");
  });
});

describe("formatDate renders the stored UTC-midnight day", () => {
  // Dates are stored at UTC midnight. formatDate must render in UTC so a US
  // (UTC-negative) machine does not show the previous calendar day.
  it("keeps a UTC-midnight ISO on its stored day", () => {
    expect(formatDate("2026-06-07T00:00:00.000Z")).toBe("Jun 7, 2026");
  });

  it("returns empty string for null / unparseable input", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("not-a-date")).toBe("");
  });
});
