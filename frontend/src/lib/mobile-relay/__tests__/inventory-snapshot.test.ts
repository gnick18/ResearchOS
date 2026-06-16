// Inventory snapshot builder tests (scan-manager web sub-bot, 2026-06-08).
//
// Covers:
//   buildInventorySnapshot — trackedStocks: a stock with product_barcode + units_per_scan
//     appears correctly; a stock missing either field is excluded.
//   buildInventorySnapshot — recentPurchases: items with order_status "ordered"
//     appear; "needs_ordering" / "received" items are excluded.
//   buildInventorySnapshot — barcodeIndex: items with product_barcode contribute;
//     purchase catalog_number contributes at lower priority (item wins on collision).
//   buildInventorySnapshot — legacy items (no scan fields) still appear in items[].

// ── Mocks (must precede the imports under test) ───────────────────────────────

const memFs = new Map<string, unknown>();
const listed = new Map<string, string[]>();

import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
      const dir = path.slice(0, path.lastIndexOf("/"));
      const name = path.slice(path.lastIndexOf("/") + 1);
      const existing = listed.get(dir) ?? [];
      if (!existing.includes(name)) listed.set(dir, [...existing, name]);
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async (path: string) => listed.get(path) ?? []),
    // discoverUsers() (used by the shared-inclusive storage-node read) walks the
    // users root; the snapshot test data all lives under the mocked current user.
    listDirectories: vi.fn(async (path: string) =>
      path === "users" ? ["alice"] : [],
    ),
    deleteFile: vi.fn(async () => false),
    readText: vi.fn(async () => null),
    writeText: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("@/lib/file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alice"),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { buildInventorySnapshot } from "../inventory-snapshot";
import {
  inventoryItemsApi,
  inventoryStocksApi,
  purchasesApi,
  tasksApi,
  storageNodesApi,
} from "@/lib/local-api";
import { clearCurrentUserCache } from "@/lib/storage/json-store";

beforeEach(() => {
  memFs.clear();
  listed.clear();
  clearCurrentUserCache();
});

// ── helpers ───────────────────────────────────────────────────────────────────

async function createPurchaseTask(name = "Order 1") {
  return tasksApi.create({
    name,
    start_date: "2026-06-01",
    duration_days: 1,
    task_type: "purchase",
  });
}

// ── trackedStocks ─────────────────────────────────────────────────────────────

describe("buildInventorySnapshot — trackedStocks", () => {
  it("includes a stock that has both product_barcode on the item and units_per_scan on the stock", async () => {
    const item = await inventoryItemsApi.create({
      name: "Tip Box 200uL",
      product_barcode: "012345678905",
      low_at_count: 10,
    });
    await inventoryStocksApi.create({
      item_id: item.id,
      units_per_scan: 1,
      units_remaining: 96,
      scan_unit_label: "tip",
      container_count: 1,
    });

    const snap = await buildInventorySnapshot();
    expect(snap.trackedStocks).toHaveLength(1);
    const ts = snap.trackedStocks[0];
    expect(ts.productBarcode).toBe("012345678905");
    expect(ts.itemName).toBe("Tip Box 200uL");
    expect(ts.unitsPerScan).toBe(1);
    expect(ts.unitsRemaining).toBe(96);
    expect(ts.unitLabel).toBe("tip");
    expect(ts.lowAtCount).toBe(10);
    expect(ts.totalUnits).toBe(96);
  });

  it("uses stock.unit as the unitLabel fallback when scan_unit_label is absent", async () => {
    const item = await inventoryItemsApi.create({
      name: "PCR Tubes",
      product_barcode: "999000111222",
    });
    await inventoryStocksApi.create({
      item_id: item.id,
      units_per_scan: 4,
      units_remaining: 200,
      unit: "rxn",
      container_count: 1,
    });

    const snap = await buildInventorySnapshot();
    expect(snap.trackedStocks).toHaveLength(1);
    expect(snap.trackedStocks[0].unitLabel).toBe("rxn");
  });

  it("carries the stock's location_text as `location` (spatial inventory Phase A)", async () => {
    const item = await inventoryItemsApi.create({
      name: "Q5 Polymerase",
      product_barcode: "555000111222",
    });
    await inventoryStocksApi.create({
      item_id: item.id,
      units_per_scan: 1,
      units_remaining: 25,
      location_text: "-20 freezer, door rack",
      container_count: 1,
    });

    const snap = await buildInventorySnapshot();
    expect(snap.trackedStocks).toHaveLength(1);
    expect(snap.trackedStocks[0].location).toBe("-20 freezer, door rack");
  });

  it("resolves locationPath from the StorageNode tree (Phase B bridge)", async () => {
    const freezer = await storageNodesApi.create({ name: "-80 #2", kind: "freezer" });
    const box = await storageNodesApi.create({
      name: "Box: Q5",
      kind: "box",
      parent_id: freezer.id,
      box_rows: 9,
      box_cols: 9,
    });
    const item = await inventoryItemsApi.create({
      name: "Q5 Polymerase",
      product_barcode: "555000999888",
    });
    await inventoryStocksApi.create({
      item_id: item.id,
      units_per_scan: 1,
      units_remaining: 25,
      location_node_id: box.id,
      position: "A1",
      container_count: 1,
    });

    const snap = await buildInventorySnapshot();
    expect(snap.trackedStocks).toHaveLength(1);
    expect(snap.trackedStocks[0].locationPath).toBe("-80 #2 > Box: Q5 - A1");
  });

  it("reports locationPath null when the stock is not placed in the tree", async () => {
    const item = await inventoryItemsApi.create({
      name: "Agarose",
      product_barcode: "555000777666",
    });
    await inventoryStocksApi.create({
      item_id: item.id,
      units_per_scan: 1,
      units_remaining: 5,
      container_count: 1,
    });

    const snap = await buildInventorySnapshot();
    expect(snap.trackedStocks).toHaveLength(1);
    expect(snap.trackedStocks[0].locationPath).toBeNull();
  });

  it("reports location null when location_text is absent or whitespace", async () => {
    const item = await inventoryItemsApi.create({
      name: "DMSO",
      product_barcode: "555000333444",
    });
    await inventoryStocksApi.create({
      item_id: item.id,
      units_per_scan: 1,
      units_remaining: 10,
      location_text: "   ",
      container_count: 1,
    });

    const snap = await buildInventorySnapshot();
    expect(snap.trackedStocks).toHaveLength(1);
    expect(snap.trackedStocks[0].location).toBeNull();
  });

  it("excludes a stock when the parent item has no product_barcode", async () => {
    const item = await inventoryItemsApi.create({ name: "Ethanol" });
    await inventoryStocksApi.create({
      item_id: item.id,
      units_per_scan: 1,
      units_remaining: 100,
      container_count: 1,
    });

    const snap = await buildInventorySnapshot();
    expect(snap.trackedStocks).toHaveLength(0);
  });

  it("excludes a stock when units_per_scan is not set (legacy stock)", async () => {
    const item = await inventoryItemsApi.create({
      name: "Old Reagent",
      product_barcode: "111222333444",
    });
    // No units_per_scan; this is a legacy count-only stock.
    await inventoryStocksApi.create({
      item_id: item.id,
      container_count: 3,
    });

    const snap = await buildInventorySnapshot();
    expect(snap.trackedStocks).toHaveLength(0);
  });
});

// ── recentPurchases ───────────────────────────────────────────────────────────

describe("buildInventorySnapshot — recentPurchases", () => {
  it("includes purchase items with order_status ordered", async () => {
    const task = await createPurchaseTask("Q5 order");
    const p = await purchasesApi.create({
      task_id: task.id,
      item_name: "Q5 Polymerase",
      quantity: 2,
      vendor: "NEB",
      catalog_number: "M0491",
      order_status: "ordered",
    });

    const snap = await buildInventorySnapshot();
    expect(snap.recentPurchases).toHaveLength(1);
    const rp = snap.recentPurchases[0];
    expect(rp.purchaseItemId).toBe(p.id);
    expect(rp.name).toBe("Q5 Polymerase");
    expect(rp.vendor).toBe("NEB");
    expect(rp.catalog).toBe("M0491");
    // orderedDate comes from the parent task's start_date.
    expect(rp.orderedDate).toBe("2026-06-01");
  });

  it("excludes needs_ordering and received items", async () => {
    const task = await createPurchaseTask("Mixed");
    await purchasesApi.create({
      task_id: task.id,
      item_name: "Needs ordering",
      quantity: 1,
      order_status: "needs_ordering",
    });
    await purchasesApi.create({
      task_id: task.id,
      item_name: "Already received",
      quantity: 1,
      order_status: "received",
    });

    const snap = await buildInventorySnapshot();
    expect(snap.recentPurchases).toHaveLength(0);
  });
});

// ── barcodeIndex ──────────────────────────────────────────────────────────────

describe("buildInventorySnapshot — barcodeIndex", () => {
  it("populates an entry for each item with a product_barcode", async () => {
    await inventoryItemsApi.create({
      name: "Taq Polymerase",
      vendor: "NEB",
      catalog_number: "M0273",
      product_barcode: "666777888999",
    });

    const snap = await buildInventorySnapshot();
    expect(snap.barcodeIndex["666777888999"]).toMatchObject({
      name: "Taq Polymerase",
      vendor: "NEB",
      catalog: "M0273",
    });
  });

  it("item-level barcode wins over purchase catalog_number on a collision", async () => {
    // Setup: an item with a barcode that collides with a purchase's catalog_number.
    await inventoryItemsApi.create({
      name: "Lab item",
      vendor: "Sigma",
      product_barcode: "COLLIDECODE",
    });
    const task = await createPurchaseTask();
    await purchasesApi.create({
      task_id: task.id,
      item_name: "Purchase item",
      quantity: 1,
      vendor: "VWR",
      catalog_number: "COLLIDECODE",
    });

    const snap = await buildInventorySnapshot();
    // The item entry overwrites the purchase entry.
    expect(snap.barcodeIndex["COLLIDECODE"].name).toBe("Lab item");
    expect(snap.barcodeIndex["COLLIDECODE"].vendor).toBe("Sigma");
  });
});

// ── backward compat ───────────────────────────────────────────────────────────

describe("buildInventorySnapshot — backward compat", () => {
  it("legacy items (no scan fields) still appear in items[]", async () => {
    await inventoryItemsApi.create({ name: "DMSO", vendor: "Sigma" });

    const snap = await buildInventorySnapshot();
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0].name).toBe("DMSO");
    // These three new arrays are always present, even empty.
    expect(snap.trackedStocks).toEqual([]);
    expect(snap.recentPurchases).toEqual([]);
    expect(snap.barcodeIndex).toEqual({});
  });
});
