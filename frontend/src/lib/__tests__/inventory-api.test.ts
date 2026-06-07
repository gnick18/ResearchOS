// frontend/src/lib/__tests__/inventory-api.test.ts
//
// Inventory chunk 1 data layer (inventory-chunk1 sub-bot of HR, 2026-06-07).
// Pins the contract of `inventoryItemsApi` / `inventoryStocksApi` and the
// `deriveInventoryStatus` helper against an in-memory file-service mock
// (mirrors `projects-hosted-sidecar-skip.test.ts`).
//
// Covered: create + read of an item and a stock; cross-user routing
// (createForUser / getForUser / saveForUser); the whole-lab-edit sharing
// default on new records; the status-derivation transitions
// (in_stock / low / empty / expired) including that a manual low/empty is not
// clobbered; normalization of a legacy / partial record.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { InventoryItem, InventoryStock } from "../types";

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

// `fetchAll...IncludingShared` walks `discoverUsers()`. Mock it so the
// aggregate read path is exercised against a known lab roster.
vi.mock("../file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => ["alex", "mira"]),
}));

import {
  inventoryItemsApi,
  inventoryStocksApi,
  deriveInventoryStatus,
  normalizeInventoryItemRecord,
  normalizeInventoryStockRecord,
  fetchAllInventoryItemsIncludingShared,
  fetchAllInventoryStocksIncludingShared,
} from "../local-api";
import { clearCurrentUserCache } from "../storage/json-store";
import { WHOLE_LAB_SENTINEL } from "../sharing/unified";

beforeEach(() => {
  memFs.clear();
  listed.clear();
  clearCurrentUserCache();
});

describe("inventoryItemsApi — create + read", () => {
  it("creates an item under the current user and reads it back", async () => {
    const item = await inventoryItemsApi.create({
      name: "Q5 High-Fidelity DNA Polymerase",
      vendor: "NEB",
      catalog_number: "M0491",
    });
    expect(item.id).toBe(1);
    expect(item.name).toBe("Q5 High-Fidelity DNA Polymerase");
    expect(item.category).toBe("reagent"); // default
    expect(item.owner).toBe("alex");
    expect(memFs.has("users/alex/inventory_items/1.json")).toBe(true);

    const read = await inventoryItemsApi.get(1);
    expect(read?.name).toBe("Q5 High-Fidelity DNA Polymerase");
    expect(read?.vendor).toBe("NEB");
  });

  it("defaults new records to whole-lab EDIT sharing", async () => {
    const item = await inventoryItemsApi.create({ name: "Tris buffer" });
    expect(item.shared_with).toEqual([
      { username: WHOLE_LAB_SENTINEL, level: "edit" },
    ]);
  });

  it("honors an explicit private shared_with (solo inventory)", async () => {
    const item = await inventoryItemsApi.create({
      name: "Private reagent",
      shared_with: [],
    });
    expect(item.shared_with).toEqual([]);
  });

  it("carries the barcode + opt-in consumption fields", async () => {
    const item = await inventoryItemsApi.create({
      name: "Anti-beta-actin",
      category: "antibody",
      product_barcode: "0123456789012",
      track_consumption: true,
      low_at_count: 2,
    });
    expect(item.product_barcode).toBe("0123456789012");
    expect(item.track_consumption).toBe(true);
    expect(item.low_at_count).toBe(2);
  });
});

describe("inventoryStocksApi — create + read + status", () => {
  it("creates a stock for an item and stamps received/last_touched", async () => {
    const item = await inventoryItemsApi.create({ name: "Q5" });
    const stock = await inventoryStocksApi.create({
      item_id: item.id,
      container_count: 3,
    });
    expect(stock.id).toBe(1);
    expect(stock.item_id).toBe(item.id);
    expect(stock.container_count).toBe(3);
    expect(stock.status).toBe("in_stock");
    expect(stock.last_touched_at).toBeTruthy();
    expect(stock.container_code).toBeNull();

    const read = await inventoryStocksApi.get(1);
    expect(read?.container_count).toBe(3);
  });

  it("inherits the parent item's sharing on a new stock", async () => {
    const item = await inventoryItemsApi.create({ name: "Q5" });
    const stock = await inventoryStocksApi.create({ item_id: item.id });
    expect(stock.shared_with).toEqual([
      { username: WHOLE_LAB_SENTINEL, level: "edit" },
    ]);
  });

  it("derives 'empty' at container_count 0", async () => {
    const item = await inventoryItemsApi.create({ name: "Q5" });
    const stock = await inventoryStocksApi.create({
      item_id: item.id,
      container_count: 0,
    });
    expect(stock.status).toBe("empty");
  });

  it("derives 'low' from the item low_at_count threshold", async () => {
    const item = await inventoryItemsApi.create({ name: "Q5", low_at_count: 3 });
    const stock = await inventoryStocksApi.create({
      item_id: item.id,
      container_count: 1, // summed 1 < threshold 3
    });
    expect(stock.status).toBe("low");
  });

  it("derives 'expired' from a past expiration_date (wins over count)", async () => {
    const item = await inventoryItemsApi.create({ name: "Q5", low_at_count: 3 });
    const stock = await inventoryStocksApi.create({
      item_id: item.id,
      container_count: 1,
      expiration_date: "2000-01-01T00:00:00.000Z",
    });
    expect(stock.status).toBe("expired");
  });

  it("recomputes status on update when the count drops to 0", async () => {
    const item = await inventoryItemsApi.create({ name: "Q5" });
    const stock = await inventoryStocksApi.create({
      item_id: item.id,
      container_count: 3,
    });
    expect(stock.status).toBe("in_stock");
    const updated = await inventoryStocksApi.update(stock.id, {
      container_count: 0,
    });
    expect(updated?.status).toBe("empty");
  });

  it("does NOT clobber a manual 'low' tap on a still-positive count", async () => {
    // No low_at_count threshold, count well above zero — only a human tap
    // would make it low. Recompute must preserve that tap.
    const item = await inventoryItemsApi.create({ name: "Q5" });
    const stock = await inventoryStocksApi.create({
      item_id: item.id,
      container_count: 5,
      status: "low", // manual tap at create
    });
    expect(stock.status).toBe("low");

    // An unrelated edit (e.g. a note change) must not flip it back to in_stock.
    const updated = await inventoryStocksApi.update(stock.id, {
      notes: "still running low, eyeballed it",
    });
    expect(updated?.status).toBe("low");
  });

  it("lets an explicit in_stock tap clear a prior manual low", async () => {
    const item = await inventoryItemsApi.create({ name: "Q5" });
    const stock = await inventoryStocksApi.create({
      item_id: item.id,
      container_count: 5,
      status: "low",
    });
    const updated = await inventoryStocksApi.update(stock.id, {
      status: "in_stock",
    });
    expect(updated?.status).toBe("in_stock");
  });
});

describe("deriveInventoryStatus — pure helper", () => {
  const NOW = new Date("2026-06-07T00:00:00.000Z");

  it("expired beats everything", () => {
    expect(
      deriveInventoryStatus(
        { container_count: 5, expiration_date: "2020-01-01" },
        { low_at_count: 10 },
        { now: NOW },
      ),
    ).toBe("expired");
  });

  it("empty at count 0 (not yet expired)", () => {
    expect(
      deriveInventoryStatus(
        { container_count: 0, expiration_date: null },
        { low_at_count: 2 },
        { now: NOW },
      ),
    ).toBe("empty");
  });

  it("manual low preserved over in_stock recompute", () => {
    expect(
      deriveInventoryStatus(
        { container_count: 5, expiration_date: null, status: "low" },
        { low_at_count: null },
        { now: NOW },
      ),
    ).toBe("low");
  });

  it("count-based low via summedCount", () => {
    expect(
      deriveInventoryStatus(
        { container_count: 1, expiration_date: null },
        { low_at_count: 4 },
        { now: NOW, summedCount: 2 },
      ),
    ).toBe("low");
  });

  it("in_stock default", () => {
    expect(
      deriveInventoryStatus(
        { container_count: 5, expiration_date: null },
        { low_at_count: 2 },
        { now: NOW, summedCount: 5 },
      ),
    ).toBe("in_stock");
  });
});

describe("cross-user routing", () => {
  it("createForUser bumps the target user's counter and lands in their dir", async () => {
    const item = await inventoryItemsApi.createForUser(
      { name: "Mira's reagent" },
      "mira",
    );
    expect(item.owner).toBe("mira");
    expect(memFs.has("users/mira/inventory_items/1.json")).toBe(true);
    // current user (alex) counter untouched
    expect(memFs.has("users/alex/inventory_items/1.json")).toBe(false);

    const read = await inventoryItemsApi.getForUser(item.id, "mira");
    expect(read?.name).toBe("Mira's reagent");
  });

  it("stock createForUser routes into the owner's dir with derived status", async () => {
    const item = await inventoryItemsApi.createForUser(
      { name: "Mira's reagent", low_at_count: 5 },
      "mira",
    );
    const stock = await inventoryStocksApi.create(
      { item_id: item.id, container_count: 2 },
      "mira",
    );
    expect(stock.owner).toBe("mira");
    expect(stock.status).toBe("low"); // 2 < 5
    expect(memFs.has("users/mira/inventory_stocks/1.json")).toBe(true);

    const read = await inventoryStocksApi.getForUser(stock.id, "mira");
    expect(read?.container_count).toBe(2);
  });

  it("saveForUser overwrites a record in the owner's dir", async () => {
    const item = await inventoryItemsApi.createForUser({ name: "X" }, "mira");
    const saved = await inventoryItemsApi.saveForUser(
      item.id,
      { ...item, name: "X renamed" },
      "mira",
    );
    expect(saved.name).toBe("X renamed");
    const read = await inventoryItemsApi.getForUser(item.id, "mira");
    expect(read?.name).toBe("X renamed");
  });
});

describe("normalization of a legacy / partial record", () => {
  it("defaults a missing container_count to 1 and derives status", () => {
    const partial = {
      id: 7,
      item_id: 3,
      // container_count, status, and all optionals absent
    } as unknown as InventoryStock;
    const norm = normalizeInventoryStockRecord(partial, "alex");
    expect(norm.container_count).toBe(1);
    expect(norm.status).toBe("in_stock");
    expect(norm.lot_number).toBeNull();
    expect(norm.location_text).toBeNull();
    expect(norm.purchase_item_id).toBeNull();
    expect(norm.container_code).toBeNull();
    expect(norm.shared_with).toEqual([]); // missing array -> []
    expect(norm.owner).toBe("alex"); // back-filled from dir
  });

  it("derives empty for a legacy stock with explicit count 0 and no status", () => {
    const partial = {
      id: 8,
      item_id: 3,
      container_count: 0,
    } as unknown as InventoryStock;
    const norm = normalizeInventoryStockRecord(partial);
    expect(norm.status).toBe("empty");
  });

  it("back-fills item defaults (category, flags, arrays)", () => {
    const partial = {
      id: 2,
      name: "Legacy item",
    } as unknown as InventoryItem;
    const norm = normalizeInventoryItemRecord(partial, "alex");
    expect(norm.category).toBe("reagent");
    expect(norm.track_consumption).toBe(false);
    expect(norm.product_barcode).toBeNull();
    expect(norm.registry).toBeNull();
    expect(norm.low_at_count).toBeNull();
    expect(norm.shared_with).toEqual([]);
    expect(norm.owner).toBe("alex");
  });

  it("normalizes a legacy permission-shaped share entry to level", () => {
    const partial = {
      id: 3,
      name: "Shared legacy",
      shared_with: [{ username: "*", permission: "edit" }],
    } as unknown as InventoryItem;
    const norm = normalizeInventoryItemRecord(partial);
    expect(norm.shared_with).toEqual([{ username: "*", level: "edit" }]);
  });

  it("leaves a legacy item with no registry as null (v3 lazy default)", () => {
    const partial = {
      id: 9,
      name: "Old reagent",
    } as unknown as InventoryItem;
    const norm = normalizeInventoryItemRecord(partial, "alex");
    expect(norm.registry).toBeNull();
  });

  it("passes a plasmid registry through unchanged (round-trip)", () => {
    const registry = {
      backbone: "pUC19",
      insert: "GFP",
      resistance: "Ampicillin",
      size_bp: 2686,
    };
    const partial = {
      id: 10,
      name: "pUC19-GFP",
      category: "plasmid",
      registry,
    } as unknown as InventoryItem;
    const norm = normalizeInventoryItemRecord(partial, "alex");
    expect(norm.category).toBe("plasmid");
    expect(norm.registry).toEqual(registry);
  });
});

describe("whole-lab read aggregate", () => {
  it("unions every member's whole-lab-shared items the viewer can read", async () => {
    // alex creates one (whole-lab edit), mira creates one in her dir.
    await inventoryItemsApi.create({ name: "Alex item" });
    await inventoryItemsApi.createForUser({ name: "Mira item" }, "mira");

    const all = await fetchAllInventoryItemsIncludingShared();
    const names = all.map((i) => i.name).sort();
    expect(names).toEqual(["Alex item", "Mira item"]);

    const mine = all.find((i) => i.name === "Alex item");
    const theirs = all.find((i) => i.name === "Mira item");
    expect(mine?.is_shared_with_me).toBe(false);
    expect(theirs?.is_shared_with_me).toBe(true);
  });

  it("excludes a private item owned by another member", async () => {
    await inventoryItemsApi.create({ name: "Alex item" });
    // Mira's item is private (owner-only) — alex must NOT see it.
    await inventoryItemsApi.createForUser(
      { name: "Mira private", shared_with: [] },
      "mira",
    );

    const all = await fetchAllInventoryItemsIncludingShared();
    expect(all.map((i) => i.name)).toEqual(["Alex item"]);
  });

  it("unions stocks across members via the stock aggregate", async () => {
    const a = await inventoryItemsApi.create({ name: "Alex item" });
    await inventoryStocksApi.create({ item_id: a.id, container_count: 2 });
    const m = await inventoryItemsApi.createForUser({ name: "Mira item" }, "mira");
    await inventoryStocksApi.create({ item_id: m.id, container_count: 1 }, "mira");

    const all = await fetchAllInventoryStocksIncludingShared();
    expect(all.length).toBe(2);
    expect(all.some((s) => s.owner === "alex")).toBe(true);
    expect(all.some((s) => s.owner === "mira" && s.is_shared_with_me)).toBe(true);
  });
});
