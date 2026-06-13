// Unit tests for BeakerBot inventory coworker tools (BeakerAI lane, 2026-06-13).
//
// Test strategy:
//   - Fixture helpers build minimal InventoryItem / InventoryStock records.
//   - All tests stub the injectable deps (listItems, createItem, listStocksForItem,
//     createStock, updateStock, navigate) so no real folder or file system is touched.
//   - Pure-logic tests (resolveItemsByName, describeAction) run with no I/O.
//   - Wiring tests assert that each tool builds the right payload and passes it to
//     the correct dep method.
//   - Error paths: missing item name, ambiguous name, no stocks when consuming,
//     negative absoluteCount, bad args combination.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  addInventoryItemTool,
  adjustInventoryStockTool,
  resolveItemsByName,
  applyStockAdjustment,
  inventoryToolsDeps,
  type InventoryToolsDeps,
} from "./inventory-tools";

import type { InventoryItem, InventoryStock } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 1,
    name: "Q5 High-Fidelity DNA Polymerase",
    category: "enzyme",
    catalog_number: "M0491L",
    vendor: "NEB",
    cas: null,
    url: null,
    container_label: "vial",
    storage_class: null,
    hazard_note: null,
    sds_url: null,
    notes: null,
    low_at_count: 2,
    product_barcode: null,
    owner: "testuser",
    shared_with: [],
    created_by: "testuser",
    ...overrides,
  };
}

function makeStock(overrides: Partial<InventoryStock> = {}): InventoryStock {
  return {
    id: 10,
    item_id: 1,
    lot_number: null,
    container_count: 5,
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
    owner: "testuser",
    shared_with: [],
    created_by: "testuser",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stub deps factory
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<InventoryToolsDeps> = {}): InventoryToolsDeps {
  return {
    listItems: vi.fn().mockResolvedValue([makeItem()]),
    createItem: vi.fn().mockResolvedValue(makeItem()),
    listStocksForItem: vi.fn().mockResolvedValue([makeStock()]),
    createStock: vi.fn().mockResolvedValue(makeStock({ id: 20, container_count: 3 })),
    updateStock: vi.fn().mockResolvedValue(makeStock({ container_count: 3 })),
    navigate: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolveItemsByName
// ---------------------------------------------------------------------------

describe("resolveItemsByName", () => {
  const items: InventoryItem[] = [
    makeItem({ id: 1, name: "Q5 High-Fidelity DNA Polymerase" }),
    makeItem({ id: 2, name: "KAPA HiFi Polymerase" }),
    makeItem({ id: 3, name: "q5 high-fidelity dna polymerase" }),
  ];

  it("matches case-insensitively and returns all exact matches", () => {
    const result = resolveItemsByName(items, "Q5 High-Fidelity DNA Polymerase");
    expect(result.map((i) => i.id)).toEqual([1, 3]);
  });

  it("returns empty array when nothing matches", () => {
    const result = resolveItemsByName(items, "Taq polymerase");
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty query", () => {
    const result = resolveItemsByName(items, "   ");
    expect(result).toHaveLength(0);
  });

  it("trims surrounding whitespace from the query", () => {
    const result = resolveItemsByName(items, "  KAPA HiFi Polymerase  ");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// add_inventory_item: describeAction
// ---------------------------------------------------------------------------

describe("addInventoryItemTool.describeAction", () => {
  it("includes name and category in the summary", () => {
    const result = addInventoryItemTool.describeAction!({
      name: "Q5 High-Fidelity DNA Polymerase",
      category: "enzyme",
    });
    expect(result.summary).toContain("Q5 High-Fidelity DNA Polymerase");
    expect(result.summary).toContain("enzyme");
  });

  it("includes vendor when provided", () => {
    const result = addInventoryItemTool.describeAction!({
      name: "Q5 Polymerase",
      category: "enzyme",
      vendor: "NEB",
    });
    expect(result.summary).toContain("from NEB");
  });

  it("includes catalog number when provided", () => {
    const result = addInventoryItemTool.describeAction!({
      name: "Q5 Polymerase",
      catalogNumber: "M0491L",
    });
    expect(result.summary).toContain("M0491L");
  });

  it("includes low-at-count threshold when provided", () => {
    const result = addInventoryItemTool.describeAction!({
      name: "Q5 Polymerase",
      lowAtCount: 3,
    });
    expect(result.summary).toContain("3 containers");
  });

  it("defaults to reagent category when category is absent", () => {
    const result = addInventoryItemTool.describeAction!({ name: "Some Buffer" });
    expect(result.summary).toContain("reagent");
  });
});

// ---------------------------------------------------------------------------
// add_inventory_item: execute
// ---------------------------------------------------------------------------

describe("addInventoryItemTool.execute", () => {
  beforeEach(() => {
    vi.spyOn(inventoryToolsDeps, "createItem").mockResolvedValue(makeItem());
    vi.spyOn(inventoryToolsDeps, "navigate").mockImplementation(() => {});
  });

  it("returns an error when name is missing", async () => {
    const result = await addInventoryItemTool.execute({ name: "" }) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it("builds the right createItem payload for a minimal call", async () => {
    const createItem = vi.spyOn(inventoryToolsDeps, "createItem").mockResolvedValue(
      makeItem({ name: "Ethanol", category: "reagent" }),
    );
    const result = await addInventoryItemTool.execute({ name: "Ethanol" }) as { ok: true; name: string; category: string };
    expect(result.ok).toBe(true);
    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Ethanol", category: "reagent" }),
    );
  });

  it("passes vendor, catalog_number, and low_at_count through", async () => {
    const createItem = vi.spyOn(inventoryToolsDeps, "createItem").mockResolvedValue(
      makeItem({ name: "Q5", vendor: "NEB", catalog_number: "M0491L", low_at_count: 2 }),
    );
    await addInventoryItemTool.execute({
      name: "Q5",
      vendor: "NEB",
      catalogNumber: "M0491L",
      category: "enzyme",
      lowAtCount: 2,
    });
    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor: "NEB",
        catalog_number: "M0491L",
        low_at_count: 2,
        category: "enzyme",
      }),
    );
  });

  it("clamps an unknown category to reagent", async () => {
    const createItem = vi.spyOn(inventoryToolsDeps, "createItem").mockResolvedValue(makeItem());
    await addInventoryItemTool.execute({ name: "Mystery Stuff", category: "not_a_real_category" });
    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({ category: "reagent" }),
    );
  });

  it("navigates to /inventory after success", async () => {
    vi.spyOn(inventoryToolsDeps, "createItem").mockResolvedValue(makeItem());
    const navigate = vi.spyOn(inventoryToolsDeps, "navigate").mockImplementation(() => {});
    await addInventoryItemTool.execute({ name: "Some Buffer" });
    expect(navigate).toHaveBeenCalledWith("/inventory");
  });

  it("returns an error when createItem throws", async () => {
    vi.spyOn(inventoryToolsDeps, "createItem").mockRejectedValue(new Error("disk full"));
    const result = await addInventoryItemTool.execute({ name: "Some Buffer" }) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/disk full/);
  });
});

// ---------------------------------------------------------------------------
// adjust_inventory_stock: describeAction
// ---------------------------------------------------------------------------

describe("adjustInventoryStockTool.describeAction", () => {
  it("describes a restock with positive delta", () => {
    const result = adjustInventoryStockTool.describeAction!({
      itemName: "Q5 Polymerase",
      delta: 3,
    });
    expect(result.summary).toContain("Q5 Polymerase");
    expect(result.summary).toContain("restock +3");
  });

  it("describes a consume with negative delta", () => {
    const result = adjustInventoryStockTool.describeAction!({
      itemName: "Ethanol",
      delta: -2,
    });
    expect(result.summary).toContain("consume 2 containers");
  });

  it("describes an absolute count correction", () => {
    const result = adjustInventoryStockTool.describeAction!({
      itemName: "Tris buffer",
      absoluteCount: 4,
    });
    expect(result.summary).toContain("set container count to 4");
  });

  it("includes lot number in a restock description", () => {
    const result = adjustInventoryStockTool.describeAction!({
      itemName: "Q5",
      delta: 5,
      lotNumber: "LOT123",
    });
    expect(result.summary).toContain("LOT123");
  });
});

// ---------------------------------------------------------------------------
// applyStockAdjustment: positive delta (restock)
// ---------------------------------------------------------------------------

describe("applyStockAdjustment: positive delta", () => {
  it("creates a new stock record for the restocked lot", async () => {
    const deps = makeDeps({
      createStock: vi.fn().mockResolvedValue(makeStock({ id: 20, container_count: 4 })),
    });
    const item = makeItem();
    const result = await applyStockAdjustment(item, { delta: 4 }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("restocked");
      expect(result.newContainerCount).toBe(4);
      expect(result.stockId).toBe(20);
    }
    expect(deps.createStock).toHaveBeenCalledWith(
      expect.objectContaining({ item_id: item.id, container_count: 4 }),
    );
  });

  it("passes lot number and expiration date to createStock", async () => {
    const deps = makeDeps({
      createStock: vi.fn().mockResolvedValue(makeStock({ id: 21, container_count: 2 })),
    });
    await applyStockAdjustment(
      makeItem(),
      { delta: 2, lotNumber: "LOT-A", expirationDate: "2027-01-01" },
      deps,
    );
    expect(deps.createStock).toHaveBeenCalledWith(
      expect.objectContaining({ lot_number: "LOT-A", expiration_date: "2027-01-01" }),
    );
  });
});

// ---------------------------------------------------------------------------
// applyStockAdjustment: negative delta (consume)
// ---------------------------------------------------------------------------

describe("applyStockAdjustment: negative delta (consume)", () => {
  it("subtracts from the first non-empty stock", async () => {
    const existing = makeStock({ id: 10, container_count: 5 });
    const deps = makeDeps({
      listStocksForItem: vi.fn().mockResolvedValue([existing]),
      updateStock: vi.fn().mockResolvedValue(makeStock({ id: 10, container_count: 3 })),
    });
    const result = await applyStockAdjustment(makeItem(), { delta: -2 }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("consumed");
      expect(result.newContainerCount).toBe(3);
    }
    expect(deps.updateStock).toHaveBeenCalledWith(10, { container_count: 3 });
  });

  it("clamps the new count at 0 (never goes negative)", async () => {
    const existing = makeStock({ id: 10, container_count: 1 });
    const deps = makeDeps({
      listStocksForItem: vi.fn().mockResolvedValue([existing]),
      updateStock: vi.fn().mockResolvedValue(makeStock({ id: 10, container_count: 0 })),
    });
    await applyStockAdjustment(makeItem(), { delta: -10 }, deps);
    expect(deps.updateStock).toHaveBeenCalledWith(10, { container_count: 0 });
  });

  it("returns an error when no stocks exist to consume from", async () => {
    const deps = makeDeps({ listStocksForItem: vi.fn().mockResolvedValue([]) });
    const result = await applyStockAdjustment(makeItem(), { delta: -2 }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/no stock records/i);
    }
  });
});

// ---------------------------------------------------------------------------
// applyStockAdjustment: absoluteCount
// ---------------------------------------------------------------------------

describe("applyStockAdjustment: absoluteCount", () => {
  it("sets the existing stock to the exact count", async () => {
    const existing = makeStock({ id: 10, container_count: 5 });
    const deps = makeDeps({
      listStocksForItem: vi.fn().mockResolvedValue([existing]),
      updateStock: vi.fn().mockResolvedValue(makeStock({ id: 10, container_count: 7 })),
    });
    const result = await applyStockAdjustment(makeItem(), { absoluteCount: 7 }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("corrected");
      expect(result.newContainerCount).toBe(7);
    }
    expect(deps.updateStock).toHaveBeenCalledWith(10, { container_count: 7 });
  });

  it("creates a first stock when none exist", async () => {
    const deps = makeDeps({
      listStocksForItem: vi.fn().mockResolvedValue([]),
      createStock: vi.fn().mockResolvedValue(makeStock({ id: 30, container_count: 4 })),
    });
    const result = await applyStockAdjustment(makeItem(), { absoluteCount: 4 }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("corrected");
    }
    expect(deps.createStock).toHaveBeenCalledWith(
      expect.objectContaining({ container_count: 4 }),
    );
  });

  it("returns an error when absoluteCount is negative", async () => {
    const deps = makeDeps();
    const result = await applyStockAdjustment(makeItem(), { absoluteCount: -1 }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/negative/i);
    }
  });

  it("returns an error when neither delta nor absoluteCount is supplied", async () => {
    const deps = makeDeps();
    const result = await applyStockAdjustment(makeItem(), {}, deps);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// adjust_inventory_stock: execute (item resolution)
// ---------------------------------------------------------------------------

describe("adjustInventoryStockTool.execute: item resolution", () => {
  beforeEach(() => {
    vi.spyOn(inventoryToolsDeps, "navigate").mockImplementation(() => {});
  });

  it("returns an error when itemName is empty", async () => {
    const result = await adjustInventoryStockTool.execute({ itemName: "", delta: 1 }) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it("returns an error when no item matches the name", async () => {
    vi.spyOn(inventoryToolsDeps, "listItems").mockResolvedValue([makeItem({ name: "Ethanol" })]);
    const result = await adjustInventoryStockTool.execute({
      itemName: "Taq Polymerase",
      delta: -1,
    }) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no inventory item named/i);
  });

  it("returns an ambiguity error with candidates when multiple items match", async () => {
    vi.spyOn(inventoryToolsDeps, "listItems").mockResolvedValue([
      makeItem({ id: 1, name: "Q5 Polymerase" }),
      makeItem({ id: 2, name: "Q5 Polymerase", vendor: "BioLabs" }),
    ]);
    const result = await adjustInventoryStockTool.execute({
      itemName: "Q5 Polymerase",
      delta: -1,
    }) as { ok: false; error: string; candidates: unknown[] };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/multiple items match/i);
    expect(Array.isArray(result.candidates)).toBe(true);
    expect((result.candidates as unknown[]).length).toBe(2);
  });

  it("returns an error when both delta and absoluteCount are supplied", async () => {
    vi.spyOn(inventoryToolsDeps, "listItems").mockResolvedValue([makeItem()]);
    const result = await adjustInventoryStockTool.execute({
      itemName: "Q5 High-Fidelity DNA Polymerase",
      delta: 1,
      absoluteCount: 5,
    }) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not both/i);
  });

  it("returns an error when neither delta nor absoluteCount is supplied", async () => {
    vi.spyOn(inventoryToolsDeps, "listItems").mockResolvedValue([makeItem()]);
    const result = await adjustInventoryStockTool.execute({
      itemName: "Q5 High-Fidelity DNA Polymerase",
    }) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/supply either/i);
  });

  it("resolves the item by name and applies a positive delta (restock)", async () => {
    const item = makeItem({ id: 5, name: "Q5 High-Fidelity DNA Polymerase" });
    vi.spyOn(inventoryToolsDeps, "listItems").mockResolvedValue([item]);
    vi.spyOn(inventoryToolsDeps, "listStocksForItem").mockResolvedValue([]);
    const createStock = vi.spyOn(inventoryToolsDeps, "createStock").mockResolvedValue(
      makeStock({ id: 55, item_id: 5, container_count: 3 }),
    );
    const result = await adjustInventoryStockTool.execute({
      itemName: "Q5 High-Fidelity DNA Polymerase",
      delta: 3,
    }) as { ok: true; action: string; stockId: number; newContainerCount: number };
    expect(result.ok).toBe(true);
    expect(result.action).toBe("restocked");
    expect(result.newContainerCount).toBe(3);
    expect(createStock).toHaveBeenCalledWith(
      expect.objectContaining({ item_id: 5, container_count: 3 }),
    );
  });

  it("resolves the item by name and applies a negative delta (consume)", async () => {
    const item = makeItem({ id: 5, name: "Q5 High-Fidelity DNA Polymerase" });
    const existing = makeStock({ id: 10, item_id: 5, container_count: 5 });
    vi.spyOn(inventoryToolsDeps, "listItems").mockResolvedValue([item]);
    vi.spyOn(inventoryToolsDeps, "listStocksForItem").mockResolvedValue([existing]);
    const updateStock = vi.spyOn(inventoryToolsDeps, "updateStock").mockResolvedValue(
      makeStock({ id: 10, container_count: 4 }),
    );
    const result = await adjustInventoryStockTool.execute({
      itemName: "Q5 High-Fidelity DNA Polymerase",
      delta: -1,
    }) as { ok: true; action: string; newContainerCount: number };
    expect(result.ok).toBe(true);
    expect(result.action).toBe("consumed");
    expect(result.newContainerCount).toBe(4);
    expect(updateStock).toHaveBeenCalledWith(10, { container_count: 4 });
  });

  it("navigates to /inventory after a successful adjust", async () => {
    const item = makeItem({ id: 5, name: "Q5 High-Fidelity DNA Polymerase" });
    vi.spyOn(inventoryToolsDeps, "listItems").mockResolvedValue([item]);
    vi.spyOn(inventoryToolsDeps, "listStocksForItem").mockResolvedValue([makeStock()]);
    vi.spyOn(inventoryToolsDeps, "updateStock").mockResolvedValue(makeStock({ container_count: 2 }));
    const navigate = vi.spyOn(inventoryToolsDeps, "navigate").mockImplementation(() => {});
    await adjustInventoryStockTool.execute({
      itemName: "Q5 High-Fidelity DNA Polymerase",
      delta: -3,
    });
    expect(navigate).toHaveBeenCalledWith("/inventory");
  });
});
