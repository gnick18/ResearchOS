// Unit tests for the BeakerBot setup_inventory_item composite (BeakerAI lane, 2026-06-16).
//
// Strategy: stub the create deps, call execute() with representative args, and
// assert the composite created the item and created each stock ALREADY assigned to
// that new item (the item_id back-reference), with the right totals. Also assert
// the pure plan + the numbered describeAction preview. No real FSA.

import { describe, it, expect } from "vitest";
import {
  setupInventoryItemTool,
  computeInventorySetupPlan,
  overrideSetupInventoryItemDeps,
  type StockSpec,
} from "./setup-inventory-item";
import type { InventoryItem, InventoryItemCreate, InventoryStockCreate } from "@/lib/types";

function stock(partial: Partial<StockSpec> = {}): StockSpec {
  return {
    containerCount: 1,
    lotNumber: null,
    expirationDate: null,
    locationText: null,
    amountPerContainer: null,
    unit: null,
    ...partial,
  };
}

describe("computeInventorySetupPlan", () => {
  it("produces the item + stocks plan from args", () => {
    const plan = computeInventorySetupPlan(
      "Q5 Polymerase",
      "enzyme",
      "NEB",
      "M0491",
      2,
      ["pcr"],
      [stock({ containerCount: 3 })],
    );
    expect(plan.item).toEqual({
      name: "Q5 Polymerase",
      category: "enzyme",
      vendor: "NEB",
      catalogNumber: "M0491",
      lowAtCount: 2,
      tags: ["pcr"],
    });
    expect(plan.stocks).toHaveLength(1);
    expect(plan.stocks[0].containerCount).toBe(3);
  });
});

describe("setup_inventory_item execute", () => {
  it("creates the item, then each stock assigned to the new item id", async () => {
    const createdItems: InventoryItemCreate[] = [];
    const createdStocks: InventoryStockCreate[] = [];
    let navigatedTo = "";
    const restore = overrideSetupInventoryItemDeps({
      createItem: async (data) => {
        createdItems.push(data);
        return { id: 42, name: data.name } as InventoryItem;
      },
      createStock: async (data) => {
        createdStocks.push(data);
        return { id: 100 + createdStocks.length } as any;
      },
      navigate: (p) => {
        navigatedTo = p;
      },
    });

    try {
      const result = await setupInventoryItemTool.execute!({
        name: "Q5 Polymerase",
        category: "enzyme",
        vendor: "NEB",
        lowAtCount: 2,
        stocks: [
          { containerCount: 3, lotNumber: "L1", expirationDate: "2027-01-01" },
          { containerCount: 2, locationText: "-20C shelf 2" },
        ],
      });

      // The item was created once with the parsed fields.
      expect(createdItems).toHaveLength(1);
      expect(createdItems[0]).toMatchObject({
        name: "Q5 Polymerase",
        category: "enzyme",
        vendor: "NEB",
        low_at_count: 2,
      });

      // Every stock points at the NEW item id (42), the back-reference.
      expect(createdStocks).toHaveLength(2);
      expect(createdStocks.every((s) => s.item_id === 42)).toBe(true);
      expect(createdStocks[0]).toMatchObject({ container_count: 3, lot_number: "L1", expiration_date: "2027-01-01" });
      expect(createdStocks[1]).toMatchObject({ container_count: 2, location_text: "-20C shelf 2" });

      expect(result).toMatchObject({
        ok: true,
        itemId: 42,
        itemName: "Q5 Polymerase",
        stockIds: [101, 102],
        totalContainers: 5,
      });
      expect(navigatedTo).toBe("/inventory");
    } finally {
      restore();
    }
  });

  it("creates just the item when no stocks are given", async () => {
    let stockCalls = 0;
    const restore = overrideSetupInventoryItemDeps({
      createItem: async (data) => ({ id: 7, name: data.name } as InventoryItem),
      createStock: async () => {
        stockCalls += 1;
        return { id: 1 } as any;
      },
      navigate: () => {},
    });
    try {
      const result = await setupInventoryItemTool.execute!({ name: "Microscope" });
      expect(stockCalls).toBe(0);
      expect(result).toMatchObject({ ok: true, itemId: 7, stockIds: [], totalContainers: 0 });
    } finally {
      restore();
    }
  });

  it("rejects an empty name without writing", async () => {
    let itemCalls = 0;
    const restore = overrideSetupInventoryItemDeps({
      createItem: async (data) => {
        itemCalls += 1;
        return { id: 1, name: data.name } as InventoryItem;
      },
    });
    try {
      const result = await setupInventoryItemTool.execute!({ name: "  " });
      expect(result).toEqual({ ok: false, error: "Item name is required." });
      expect(itemCalls).toBe(0);
    } finally {
      restore();
    }
  });

  it("drops an invalid category rather than passing a bad value", async () => {
    let captured: InventoryItemCreate | null = null;
    const restore = overrideSetupInventoryItemDeps({
      createItem: async (data) => {
        captured = data;
        return { id: 9, name: data.name } as InventoryItem;
      },
      createStock: async () => ({ id: 1 } as any),
      navigate: () => {},
    });
    try {
      await setupInventoryItemTool.execute!({ name: "Thing", category: "not_a_category" });
      expect(captured!.category).toBeUndefined();
    } finally {
      restore();
    }
  });
});

describe("setup_inventory_item describeAction", () => {
  it("produces a numbered preview of the item + each stock", () => {
    const preview = setupInventoryItemTool.describeAction!({
      name: "Q5 Polymerase",
      category: "enzyme",
      vendor: "NEB",
      stocks: [{ containerCount: 3, lotNumber: "L1", expirationDate: "2027-01-01" }],
    });
    expect(preview.summary).toContain('1. Create inventory item "Q5 Polymerase"');
    expect(preview.summary).toContain("enzyme");
    expect(preview.summary).toContain("2. Add stock: 3 containers");
    expect(preview.summary).toContain("lot L1");
    expect(preview.summary).toContain("exp 2027-01-01");
  });
});
