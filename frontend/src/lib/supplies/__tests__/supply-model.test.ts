// Supplies v2 chunk 1: the link-layer view-model. Pins identity keying, the
// purchase->supply resolver (FK precedence then identity), the on-hand
// aggregation, and the both / on-hand-only / order-only classification.

import { describe, it, expect } from "vitest";
import {
  buildSupplies,
  resolvePurchaseKey,
  supplyKeyFor,
} from "../supply-model";
import type { InventoryItem, InventoryStock, PurchaseItem } from "@/lib/types";

function item(over: Partial<InventoryItem> & { id: number; name: string }): InventoryItem {
  return {
    category: "reagent",
    catalog_number: null,
    vendor: null,
    cas: null,
    url: null,
    container_label: null,
    storage_class: null,
    hazard_note: null,
    sds_url: null,
    notes: null,
    low_at_count: null,
    product_barcode: null,
    owner: "alex",
    shared_with: [],
    created_by: "alex",
    ...over,
  } as InventoryItem;
}

function stock(
  over: Partial<InventoryStock> & { id: number; item_id: number; container_count: number },
): InventoryStock {
  return {
    lot_number: null,
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
    ...over,
  } as InventoryStock;
}

function purchase(
  over: Partial<PurchaseItem> & { id: number; item_name: string },
): PurchaseItem {
  return {
    task_id: 1,
    quantity: 1,
    link: null,
    cas: null,
    price_per_unit: 0,
    shipping_fees: 0,
    total_price: 0,
    notes: null,
    funding_string: null,
    vendor: null,
    catalog_number: null,
    category: null,
    order_status: "needs_ordering",
    ...over,
  } as PurchaseItem;
}

describe("supplyKeyFor", () => {
  it("keys on vendor+catalog when both present", () => {
    expect(supplyKeyFor({ name: "Taq", vendor: "NEB", catalogNumber: "M0273" })).toBe(
      "vc:neb|m0273",
    );
  });
  it("falls back to normalized name when catalog or vendor is missing", () => {
    expect(supplyKeyFor({ name: "Taq Polymerase", vendor: "NEB", catalogNumber: null })).toBe(
      "n:taq polymerase",
    );
    expect(supplyKeyFor({ name: " Taq ", vendor: null, catalogNumber: null })).toBe("n:taq");
  });
});

describe("resolvePurchaseKey", () => {
  const neb = item({ id: 10, name: "Taq", vendor: "NEB", catalog_number: "M0273" });
  const byId = new Map([[10, neb]]);

  it("prefers the stamped inventory_item_id FK", () => {
    // The line's own identity is different, but the FK wins.
    const p = purchase({
      id: 1,
      item_name: "different name",
      vendor: "OtherCo",
      catalog_number: "X1",
      inventory_item_id: 10,
    });
    expect(resolvePurchaseKey(p, byId)).toBe("vc:neb|m0273");
  });
  it("falls back to the line's own identity when no FK", () => {
    const p = purchase({ id: 2, item_name: "SYBR", vendor: "Thermo", catalog_number: "A25742" });
    expect(resolvePurchaseKey(p, byId)).toBe("vc:thermo|a25742");
  });
  it("ignores a dangling FK (item not in set) and uses identity", () => {
    const p = purchase({ id: 3, item_name: "Ghost", inventory_item_id: 999 });
    expect(resolvePurchaseKey(p, byId)).toBe("n:ghost");
  });
});

describe("buildSupplies", () => {
  it("classifies both / on-hand-only / order-only and aggregates on-hand", () => {
    const items = [
      item({ id: 10, name: "Taq", vendor: "NEB", catalog_number: "M0273" }), // both
      item({ id: 11, name: "Old buffer", vendor: "Sigma", catalog_number: "B1" }), // on-hand only
    ];
    const stocks = [
      stock({ id: 1, item_id: 10, container_count: 2, status: "in_stock", expiration_date: "2026-09-01" }),
      stock({ id: 2, item_id: 10, container_count: 1, status: "low", expiration_date: "2026-07-01" }),
      stock({ id: 3, item_id: 11, container_count: 4, status: "in_stock" }),
    ];
    const purchases = [
      // open line linked by FK to Taq -> "both"
      purchase({ id: 100, item_name: "Taq", inventory_item_id: 10, order_status: "ordered" }),
      // order-only line (no matching item): a flight
      purchase({ id: 101, item_name: "Conference flight", category: "Miscellaneous" }),
      // received line is ignored (it became stock)
      purchase({ id: 102, item_name: "Taq", inventory_item_id: 10, order_status: "received" }),
    ];

    const supplies = buildSupplies({ items, stocks, purchases });
    const byKey = new Map(supplies.map((s) => [s.key, s]));

    const taq = byKey.get("vc:neb|m0273")!;
    expect(taq.kind).toBe("both");
    expect(taq.onHand!.totalCount).toBe(3);
    expect(taq.onHand!.stockCount).toBe(2);
    expect(taq.onHand!.worstStatus).toBe("low"); // low beats in_stock
    expect(taq.onHand!.soonestExpiry).toBe("2026-07-01");
    expect(taq.ordering!.openLines).toHaveLength(1); // received excluded
    expect(taq.ordering!.orderedCount).toBe(1);

    const buffer = byKey.get("vc:sigma|b1")!;
    expect(buffer.kind).toBe("onHand");
    expect(buffer.ordering).toBeNull();
    expect(buffer.onHand!.totalCount).toBe(4);

    const flight = byKey.get("n:conference flight")!;
    expect(flight.kind).toBe("order");
    expect(flight.onHand).toBeNull();
    expect(flight.ordering!.needsOrderingCount).toBe(1);
  });

  it("collapses same-identity inventory items across owners into one supply", () => {
    // Two owners each have 'Taq NEB M0273' -> ONE supply, stocks aggregated.
    const items = [
      item({ id: 10, name: "Taq", vendor: "NEB", catalog_number: "M0273", owner: "alex" }),
      item({ id: 20, name: "Taq", vendor: "NEB", catalog_number: "M0273", owner: "mira" }),
    ];
    const stocks = [
      stock({ id: 1, item_id: 10, container_count: 2 }),
      stock({ id: 2, item_id: 20, container_count: 3 }),
    ];
    const supplies = buildSupplies({ items, stocks, purchases: [] });
    expect(supplies).toHaveLength(1);
    expect(supplies[0].onHand!.totalCount).toBe(5);
    expect(supplies[0].onHand!.itemIds.sort()).toEqual([10, 20]);
  });

  it("matches an ad-hoc purchase to an existing item by identity (no FK)", () => {
    const items = [item({ id: 10, name: "Taq", vendor: "NEB", catalog_number: "M0273" })];
    const purchases = [
      purchase({ id: 100, item_name: "Taq", vendor: "NEB", catalog_number: "M0273" }),
    ];
    const supplies = buildSupplies({ items, stocks: [], purchases });
    expect(supplies).toHaveLength(1);
    expect(supplies[0].kind).toBe("both");
  });
});
