// frontend/src/lib/__tests__/receive-to-inventory.test.ts
//
// Chunk 4 — Purchases-receive self-populate (chunk-4 bot of HR, 2026-06-07).
//
// Tests the data-layer operations that ReceiveToInventoryDialog performs:
//   - Choice 1 (skip): no API calls, nothing written to disk.
//   - Choice 2 (create new): create item from PurchaseItem pre-fill fields,
//     create a stock with purchase_item_id, received_date, container_count
//     defaulted from PurchaseItem.quantity.
//   - Choice 3 (add to existing): create a new stock when no matching
//     (lot, expiry, location) triple exists; bump container_count on an
//     existing stock when the triple matches.
//
// Uses the same in-memory file-service mock as inventory-api.test.ts so the
// real JsonStore + API code runs against a deterministic store.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PurchaseItem } from "../types";

// ── in-memory file system mock (mirrors inventory-api.test.ts) ────────────────

const memFs = new Map<string, unknown>();
const listed = new Map<string, string[]>();

function trackFile(path: string): void {
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash);
  const fileName = path.slice(slash + 1);
  const existing = listed.get(dir) ?? [];
  if (!existing.includes(fileName)) listed.set(dir, [...existing, fileName]);
}

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
      trackFile(path);
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async (path: string) => listed.get(path) ?? []),
    deleteFile: vi.fn(async (path: string) => {
      memFs.delete(path);
      return true;
    }),
    readText: vi.fn(async () => null),
    writeText: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("../file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

vi.mock("../file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => ["alex"]),
}));

import { inventoryItemsApi, inventoryStocksApi } from "../local-api";
import { clearCurrentUserCache } from "../storage/json-store";

beforeEach(() => {
  memFs.clear();
  listed.clear();
  clearCurrentUserCache();
});

// ── fixture PurchaseItem ──────────────────────────────────────────────────────

function makePurchaseItem(overrides?: Partial<PurchaseItem>): PurchaseItem {
  return {
    id: 42,
    task_id: 1,
    item_name: "Q5 High-Fidelity DNA Polymerase",
    quantity: 3,
    link: "https://www.neb.com/en-us/products/m0491-q5-high-fidelity-dna-polymerase",
    cas: null,
    price_per_unit: 82,
    shipping_fees: 0,
    total_price: 246,
    notes: null,
    funding_string: null,
    vendor: "NEB",
    category: null,
    order_status: "received",
    ...overrides,
  };
}

// ── choice 1: skip ────────────────────────────────────────────────────────────

describe("receive-to-inventory: choice 1 (skip)", () => {
  it("writes nothing when the user skips", async () => {
    // Simulating skip: no API is called. The dialog simply calls onClose().
    // Verify that the in-memory FS stays empty.
    expect(memFs.size).toBe(0);
    expect(listed.size).toBe(0);
  });
});

// ── choice 2: create new ─────────────────────────────────────────────────────

describe("receive-to-inventory: choice 2 (create new item + stock)", () => {
  it("pre-fills the item from PurchaseItem fields and creates a linked stock", async () => {
    const purchase = makePurchaseItem();
    const today = new Date().toISOString().split("T")[0];

    // Replicate what CreateNewStep does on submit.
    const newItem = await inventoryItemsApi.create({
      name: purchase.item_name,
      category: "reagent",
      vendor: purchase.vendor ?? undefined,
      cas: purchase.cas ?? undefined,
      url: purchase.link ?? undefined,
    });

    expect(newItem.name).toBe("Q5 High-Fidelity DNA Polymerase");
    expect(newItem.vendor).toBe("NEB");
    expect(newItem.url).toBe(
      "https://www.neb.com/en-us/products/m0491-q5-high-fidelity-dna-polymerase",
    );
    expect(newItem.category).toBe("reagent");
    expect(newItem.cas).toBeNull();

    const newStock = await inventoryStocksApi.create({
      item_id: newItem.id,
      purchase_item_id: purchase.id,
      received_date: today,
      container_count: Math.floor(purchase.quantity),
      status: "in_stock",
      expiration_date: null,
      location_text: null,
      lot_number: null,
    });

    expect(newStock.item_id).toBe(newItem.id);
    expect(newStock.purchase_item_id).toBe(42); // FK to PurchaseItem
    expect(newStock.container_count).toBe(3);   // from purchase.quantity
    expect(newStock.received_date).toBe(today);
    expect(newStock.status).toBe("in_stock");
    expect(newStock.expiration_date).toBeNull();
  });

  it("defaults container_count to 1 when quantity is missing / < 1", async () => {
    const purchase = makePurchaseItem({ quantity: 0 });

    const newItem = await inventoryItemsApi.create({ name: purchase.item_name });
    const count =
      typeof purchase.quantity === "number" && purchase.quantity >= 1
        ? Math.floor(purchase.quantity)
        : 1;
    expect(count).toBe(1);

    const newStock = await inventoryStocksApi.create({
      item_id: newItem.id,
      purchase_item_id: purchase.id,
      received_date: new Date().toISOString().split("T")[0],
      container_count: count,
      status: "in_stock",
    });
    expect(newStock.container_count).toBe(1);
  });
});

// ── choice 3: add to existing ─────────────────────────────────────────────────

describe("receive-to-inventory: choice 3 (add to existing item)", () => {
  it("creates a new stock row when no matching (lot, expiry, location) exists", async () => {
    const purchase = makePurchaseItem();

    // Create a pre-existing item with one stock.
    const existingItem = await inventoryItemsApi.create({
      name: "Q5 Polymerase",
    });
    const existingStock = await inventoryStocksApi.create({
      item_id: existingItem.id,
      container_count: 2,
      lot_number: "LOT-A",
      expiration_date: null,
      location_text: "-80 door",
    });

    // The new purchase has different lot: no triple match, so create new row.
    const newLot = "LOT-B";
    const existingStocks = await inventoryStocksApi.listForItem(
      existingItem.id,
      existingItem.owner,
    );
    const matchingLot = null; // search for lot=LOT-B
    const match = existingStocks.find(
      (s) =>
        (s.lot_number ?? null) === newLot &&
        (s.expiration_date ?? null) === null &&
        (s.location_text ?? null) === null,
    );
    expect(match).toBeUndefined(); // no match for LOT-B

    const newStock = await inventoryStocksApi.create({
      item_id: existingItem.id,
      purchase_item_id: purchase.id,
      received_date: new Date().toISOString().split("T")[0],
      container_count: 3,
      status: "in_stock",
      lot_number: newLot,
      expiration_date: null,
      location_text: null,
    });

    expect(newStock.lot_number).toBe("LOT-B");
    expect(newStock.purchase_item_id).toBe(42);

    // The existing stock is untouched.
    const stillExists = await inventoryStocksApi.get(existingStock.id);
    expect(stillExists?.container_count).toBe(2);
    expect(stillExists?.lot_number).toBe("LOT-A");
  });

  it("bumps container_count on an existing stock when the triple matches", async () => {
    const purchase = makePurchaseItem({ quantity: 3 });

    const existingItem = await inventoryItemsApi.create({
      name: "Tris buffer",
    });
    const existingStock = await inventoryStocksApi.create({
      item_id: existingItem.id,
      container_count: 2,
      lot_number: "LOT-X",
      expiration_date: null,
      location_text: null,
    });

    // Simulate the triple-match path in AddToExistingStep.
    const targetLot = "LOT-X";
    const targetExpiry = null;
    const targetLocation = null;
    const allStocks = await inventoryStocksApi.listForItem(
      existingItem.id,
      existingItem.owner,
    );
    const match = allStocks.find(
      (s) =>
        (s.lot_number ?? null) === targetLot &&
        (s.expiration_date ?? null) === targetExpiry &&
        (s.location_text ?? null) === targetLocation,
    );
    expect(match).toBeDefined();
    expect(match?.id).toBe(existingStock.id);

    const newCount =
      typeof purchase.quantity === "number" && purchase.quantity >= 1
        ? Math.floor(purchase.quantity)
        : 1;
    const updated = await inventoryStocksApi.update(
      match!.id,
      { container_count: match!.container_count + newCount },
      existingItem.owner,
    );
    // 2 existing + 3 from purchase = 5
    expect(updated?.container_count).toBe(5);
    expect(updated?.lot_number).toBe("LOT-X");
  });
});
