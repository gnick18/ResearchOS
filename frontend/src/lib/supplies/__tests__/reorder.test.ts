// Supplies v2 chunk 4: reorder pure logic. Pins the gap-based quantity prefill
// (section 4.4, "reorder is informed by on-hand") and the identity prefill +
// inventory_item_id stamping of seedFromSupply (section 4.1, the redundancy
// killer).

import { describe, it, expect } from "vitest";
import { reorderQuantityFromGap, seedFromSupply } from "../reorder";
import type { Supply } from "../supply-model";
import type { InventoryItem } from "@/lib/types";

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

function supply(over: Partial<Supply> = {}): Supply {
  return {
    key: "vc:neb|m0273",
    identity: {
      name: "Taq polymerase",
      vendor: "NEB",
      catalogNumber: "M0273",
      cas: "9012-90-2",
      category: "enzyme",
    },
    onHand: {
      itemIds: [7],
      totalCount: 1,
      stockCount: 1,
      worstStatus: "low",
      soonestExpiry: null,
    },
    ordering: null,
    kind: "onHand",
    ...over,
  };
}

describe("reorderQuantityFromGap", () => {
  it("orders enough to clear the low threshold", () => {
    // low at 5, 1 on hand -> order 4.
    expect(reorderQuantityFromGap(5, 1)).toBe(4);
  });

  it("rounds a fractional gap up", () => {
    expect(reorderQuantityFromGap(5, 2.5)).toBe(3);
  });

  it("falls back to 1 when there is no threshold", () => {
    expect(reorderQuantityFromGap(null, 0)).toBe(1);
    expect(reorderQuantityFromGap(undefined, 10)).toBe(1);
  });

  it("falls back to 1 when on hand already meets or beats the threshold", () => {
    expect(reorderQuantityFromGap(3, 3)).toBe(1);
    expect(reorderQuantityFromGap(3, 9)).toBe(1);
  });

  it("never returns less than 1", () => {
    expect(reorderQuantityFromGap(0, 0)).toBe(1);
  });
});

describe("seedFromSupply", () => {
  it("copies identity, stamps inventory_item_id, prefills quantity from the gap", () => {
    const it = item({ id: 7, name: "Taq polymerase", low_at_count: 5, url: "https://neb.com/m0273" });
    const seed = seedFromSupply(supply(), it);
    expect(seed).toEqual({
      item_name: "Taq polymerase",
      vendor: "NEB",
      cas: "9012-90-2",
      link: "https://neb.com/m0273",
      catalog_number: "M0273",
      category: "enzyme",
      inventory_item_id: 7,
      quantity: 4, // low_at 5 - 1 on hand
    });
  });

  it("leaves inventory_item_id null and quantity 1 for an order-only supply", () => {
    const orderOnly = supply({
      key: "n:conference flight",
      identity: {
        name: "Conference flight",
        vendor: null,
        catalogNumber: null,
        cas: null,
        category: "Miscellaneous",
      },
      onHand: null,
      ordering: { openLines: [], needsOrderingCount: 1, orderedCount: 0 },
      kind: "order",
    });
    const seed = seedFromSupply(orderOnly, null);
    expect(seed.inventory_item_id).toBeNull();
    expect(seed.quantity).toBe(1);
    expect(seed.item_name).toBe("Conference flight");
    expect(seed.link).toBeNull();
  });

  it("uses the first item id when a supply spans multiple owners", () => {
    const it = item({ id: 11, name: "Taq polymerase", low_at_count: null });
    const seed = seedFromSupply(
      supply({ onHand: { itemIds: [11, 12], totalCount: 2, stockCount: 2, worstStatus: "in_stock", soonestExpiry: null } }),
      it,
    );
    expect(seed.inventory_item_id).toBe(11);
    expect(seed.quantity).toBe(1); // no threshold -> default 1
  });
});
