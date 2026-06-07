// Chunk 6 scan-resolver tests (design 15.2). The resolver is pure: it takes the
// scanned string + the loaded items + stocks and returns a discriminated kind.
// Covers: container_code wins over product_barcode; product-single vs
// product-multi; unknown; and trim / case tolerance.

import { describe, expect, it } from "vitest";

import { resolveBarcode } from "../barcode-resolve";
import type { InventoryItem, InventoryStock } from "@/lib/types";

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

describe("resolveBarcode", () => {
  it("matches a container_code and returns the container kind", () => {
    const item = makeItem();
    const stock = makeStock({ id: 5, container_code: "RX-0042" });
    const res = resolveBarcode("RX-0042", [item], [stock]);
    expect(res.kind).toBe("container");
    if (res.kind === "container") {
      expect(res.stock.id).toBe(5);
      expect(res.item.id).toBe(1);
    }
  });

  it("matches a container_code FIRST, even when a product_barcode also matches", () => {
    // The same string is both a stock's container_code AND an item's
    // product_barcode. container_code must win (design 15.2 resolution order).
    const collidingCode = "0123456789012";
    const item = makeItem({ id: 9, product_barcode: collidingCode });
    const stockA = makeStock({
      id: 11,
      item_id: 9,
      container_code: collidingCode,
    });
    const stockB = makeStock({ id: 12, item_id: 9 });
    const res = resolveBarcode(collidingCode, [item], [stockA, stockB]);
    expect(res.kind).toBe("container");
    if (res.kind === "container") {
      expect(res.stock.id).toBe(11);
    }
  });

  it("returns product-single when a product_barcode matches an item with one stock", () => {
    const item = makeItem({ id: 2, product_barcode: "5901234123457" });
    const stock = makeStock({ id: 21, item_id: 2 });
    const res = resolveBarcode("5901234123457", [item], [stock]);
    expect(res.kind).toBe("product-single");
    if (res.kind === "product-single") {
      expect(res.item.id).toBe(2);
      expect(res.stock.id).toBe(21);
    }
  });

  it("returns product-multi when a product_barcode matches an item with 2+ stocks", () => {
    const item = makeItem({ id: 3, product_barcode: "4006381333931" });
    const s1 = makeStock({ id: 31, item_id: 3, lot_number: "AB1207" });
    const s2 = makeStock({ id: 32, item_id: 3, lot_number: "AB0991" });
    const res = resolveBarcode("4006381333931", [item], [s1, s2]);
    expect(res.kind).toBe("product-multi");
    if (res.kind === "product-multi") {
      expect(res.stocks).toHaveLength(2);
      expect(res.item.id).toBe(3);
    }
  });

  it("returns unknown when nothing matches", () => {
    const item = makeItem({ product_barcode: "111" });
    const stock = makeStock({ container_code: "AAA" });
    const res = resolveBarcode("does-not-exist", [item], [stock]);
    expect(res.kind).toBe("unknown");
    if (res.kind === "unknown") {
      expect(res.code).toBe("does-not-exist");
    }
  });

  it("is tolerant of surrounding whitespace and case", () => {
    const item = makeItem();
    const stock = makeStock({ id: 7, container_code: "RX-0042" });
    const res = resolveBarcode("  rx-0042  ", [item], [stock]);
    expect(res.kind).toBe("container");
    if (res.kind === "container") {
      expect(res.stock.id).toBe(7);
    }
  });

  it("treats a blank scan as unknown without matching a null code field", () => {
    // A stock with container_code === null must NOT match an empty scan.
    const item = makeItem({ product_barcode: null });
    const stock = makeStock({ container_code: null });
    const res = resolveBarcode("   ", [item], [stock]);
    expect(res.kind).toBe("unknown");
  });

  it("does not match a product_barcode across owners", () => {
    // An item owned by someone else with a matching barcode but whose stocks
    // belong to a different item_id should still resolve to its own stocks.
    const mine = makeItem({ id: 4, owner: "me", product_barcode: "BC-1" });
    const myStock = makeStock({ id: 41, item_id: 4, owner: "me" });
    // A foreign stock with the same item_id but a different owner must NOT be
    // counted as one of `mine`'s stocks.
    const foreignStock = makeStock({ id: 99, item_id: 4, owner: "other" });
    const res = resolveBarcode("BC-1", [mine], [myStock, foreignStock]);
    expect(res.kind).toBe("product-single");
    if (res.kind === "product-single") {
      expect(res.stock.id).toBe(41);
    }
  });
});
