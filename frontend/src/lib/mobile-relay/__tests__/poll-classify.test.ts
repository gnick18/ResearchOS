// Mobile capture poller tests.
//
// Two layers:
//   1. classifyCapture — the pure content-type router (no mocking needed).
//   2. runCaptureInboxPoll — the ingestion behavior that the persona audit
//      changed: a reorder must land as a real PURCHASE line item (not a Note),
//      and the same captureId processed twice (ack-failure replay) must create
//      exactly ONE record.
//
// The persistence layer is mocked the same in-memory way as
// purchases/misc-project.test.ts so the real local-api (tasks / projects /
// purchases) runs against a fake folder. The relay client + query client are
// mocked so no network / React Query is touched.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock surface (must precede the imports under test) ───────────────────────

const memFs = new Map<string, unknown>();
const listed = new Map<string, string[]>();

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
    deleteFile: vi.fn(async (path: string) => {
      const existed = memFs.has(path);
      memFs.delete(path);
      const dir = path.slice(0, path.lastIndexOf("/"));
      const name = path.slice(path.lastIndexOf("/") + 1);
      const existing = listed.get(dir) ?? [];
      listed.set(dir, existing.filter((n) => n !== name));
      return existed;
    }),
    readText: vi.fn(async () => null),
    writeText: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
    // Needed by the PURCHASE_LORO_ENABLED / LORO_PILOT_ENABLED write-through path
    // (loro sidecar-store uses writeFileFromBlob to persist .loro binary files).
    // In tests we accept the sidecar write silently; the in-memory JSON store is
    // what the tests assert against.
    writeFileFromBlob: vi.fn(async () => {}),
    readFileAsBytes: vi.fn(async () => null),
  },
}));

vi.mock("@/lib/file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

vi.mock("@/lib/query-client", () => ({
  appQueryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("@/lib/mobile-relay/client", () => ({
  fetchInbox: vi.fn(),
  fetchObject: vi.fn(),
  ackCaptures: vi.fn(async () => {}),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────
import { classifyCapture, runCaptureInboxPoll } from "@/lib/mobile-relay/poll";
import {
  ackCaptures,
  fetchInbox,
  fetchObject,
  type PendingCapture,
  type UserCaptureKeys,
} from "@/lib/mobile-relay/client";
import { purchasesApi, inventoryItemsApi, inventoryStocksApi, tasksApi } from "@/lib/local-api";
import { MISC_CATEGORY_LABEL } from "@/lib/purchases/misc-project";
import { clearCurrentUserCache } from "@/lib/storage/json-store";

const REORDER_CT = "application/x-researchos-reorder";
const MARK_ARRIVED_CT = "application/x-researchos-mark-arrived";
const REGISTER_TRACKER_CT = "application/x-researchos-register-tracker";
const DEDUCT_CT = "application/x-researchos-deduct";
const KEYS = {} as UserCaptureKeys;

/** A pending reorder capture with the given id. */
function reorderCapture(captureId: string): PendingCapture {
  return {
    captureId,
    caption: null,
    createdAt: "2026-06-08T12:00:00.000Z",
    contentType: REORDER_CT,
  };
}

function reorderBlob(payload: Record<string, unknown>) {
  return {
    blob: new Blob([JSON.stringify(payload)], { type: REORDER_CT }),
  };
}

beforeEach(() => {
  memFs.clear();
  listed.clear();
  clearCurrentUserCache();
  vi.mocked(fetchInbox).mockReset();
  vi.mocked(fetchObject).mockReset();
  vi.mocked(ackCaptures).mockReset();
  vi.mocked(ackCaptures).mockResolvedValue(undefined as never);
});

describe("classifyCapture", () => {
  it("routes image content types to the image branch", () => {
    expect(classifyCapture("image/png")).toBe("image");
    expect(classifyCapture("image/jpeg")).toBe("image");
    expect(classifyCapture("IMAGE/HEIC")).toBe("image");
  });

  it("routes text content types to the text branch", () => {
    expect(classifyCapture("text/markdown")).toBe("text");
    expect(classifyCapture("text/plain")).toBe("text");
    expect(classifyCapture("text/markdown; charset=utf-8")).toBe("text");
    expect(classifyCapture("TEXT/PLAIN")).toBe("text");
  });

  it("routes the reorder content type to the reorder branch", () => {
    expect(classifyCapture("application/x-researchos-reorder")).toBe("reorder");
    expect(classifyCapture("APPLICATION/X-RESEARCHOS-REORDER")).toBe("reorder");
    expect(classifyCapture("application/x-researchos-reorder; charset=utf-8")).toBe(
      "reorder",
    );
  });

  it("routes everything else to other (skipped, never acked)", () => {
    expect(classifyCapture("application/pdf")).toBe("other");
    expect(classifyCapture("application/octet-stream")).toBe("other");
    expect(classifyCapture("")).toBe("other");
    expect(classifyCapture(null)).toBe("other");
    expect(classifyCapture(undefined)).toBe("other");
  });

  // W3 action content types (scan-manager web sub-bot, 2026-06-08).
  it("routes mark-arrived content type", () => {
    expect(classifyCapture("application/x-researchos-mark-arrived")).toBe("mark-arrived");
    expect(classifyCapture("APPLICATION/X-RESEARCHOS-MARK-ARRIVED")).toBe("mark-arrived");
  });

  it("routes register-tracker content type", () => {
    expect(classifyCapture("application/x-researchos-register-tracker")).toBe("register-tracker");
    expect(classifyCapture("APPLICATION/X-RESEARCHOS-REGISTER-TRACKER")).toBe("register-tracker");
  });

  it("routes deduct content type", () => {
    expect(classifyCapture("application/x-researchos-deduct")).toBe("deduct");
    expect(classifyCapture("APPLICATION/X-RESEARCHOS-DEDUCT")).toBe("deduct");
  });

  it("does not confuse similar x-researchos prefixes with each other", () => {
    // reorder must NOT be classified as mark-arrived even though it shares a prefix
    expect(classifyCapture("application/x-researchos-reorder")).toBe("reorder");
    expect(classifyCapture("application/x-researchos-mark-arrived")).toBe("mark-arrived");
    expect(classifyCapture("application/x-researchos-register-tracker")).toBe("register-tracker");
    expect(classifyCapture("application/x-researchos-deduct")).toBe("deduct");
  });
});

describe("runCaptureInboxPoll reorder routing", () => {
  it("lands a reorder as a needs_ordering purchase item (not a note)", async () => {
    vi.mocked(fetchInbox).mockResolvedValue([reorderCapture("cap-1")]);
    vi.mocked(fetchObject).mockResolvedValue(
      reorderBlob({
        name: "Taq polymerase",
        vendor: "NEB",
        catalog_number: "M0273",
        product_barcode: "012345678905",
      }) as never,
    );

    const result = await runCaptureInboxPoll(KEYS, "alex");
    expect(result.pulled).toBe(1);
    expect(result.errors).toBe(0);

    const items = await purchasesApi.listAll();
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.item_name).toBe("Taq polymerase");
    expect(item.vendor).toBe("NEB");
    expect(item.order_status).toBe("needs_ordering");
    expect(item.category).toBe(MISC_CATEGORY_LABEL);
    // Catalog number lands in its dedicated column; the barcode rides in notes.
    expect(item.catalog_number).toBe("M0273");
    expect(item.notes).toContain("012345678905");

    // The capture was acked once it landed.
    expect(vi.mocked(ackCaptures)).toHaveBeenCalledWith(KEYS, ["cap-1"]);
  });

  it("falls back to a sensible item name when the payload is partial", async () => {
    vi.mocked(fetchInbox).mockResolvedValue([reorderCapture("cap-bare")]);
    vi.mocked(fetchObject).mockResolvedValue(
      reorderBlob({ product_barcode: "999" }) as never,
    );

    await runCaptureInboxPoll(KEYS, "alex");
    const items = await purchasesApi.listAll();
    expect(items).toHaveLength(1);
    // reorderLabel falls back to the barcode when no name / catalog given.
    expect(items[0].item_name).toBe("999");
  });
});

describe("runCaptureInboxPoll dedup guard", () => {
  it("processing the same captureId twice creates exactly one purchase", async () => {
    // Two polls return the SAME capture, simulating an ack that failed (or was
    // never observed) so the relay handed the capture back.
    vi.mocked(fetchInbox)
      .mockResolvedValueOnce([reorderCapture("dup-1")])
      .mockResolvedValueOnce([reorderCapture("dup-1")]);
    vi.mocked(fetchObject).mockResolvedValue(
      reorderBlob({ name: "Ethanol", vendor: "Sigma" }) as never,
    );

    const first = await runCaptureInboxPoll(KEYS, "alex");
    const second = await runCaptureInboxPoll(KEYS, "alex");

    expect(first.pulled).toBe(1);
    // Second poll skips the write (dedup), so nothing is "pulled" again.
    expect(second.pulled).toBe(0);

    const items = await purchasesApi.listAll();
    expect(items).toHaveLength(1);

    // The replayed capture is still re-acked to clear it off the relay.
    expect(vi.mocked(ackCaptures)).toHaveBeenCalledWith(KEYS, ["dup-1"]);
    expect(vi.mocked(ackCaptures).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("ledgers the captureId before acking so an ack failure cannot duplicate", async () => {
    // First poll lands the write but the ack throws, leaving the capture on the
    // relay. The ledger was written BEFORE the ack, so the retry must not
    // re-create the purchase.
    vi.mocked(fetchInbox)
      .mockResolvedValueOnce([reorderCapture("flaky-1")])
      .mockResolvedValueOnce([reorderCapture("flaky-1")]);
    vi.mocked(fetchObject).mockResolvedValue(
      reorderBlob({ name: "Agarose" }) as never,
    );
    // Ack fails on the first landing, succeeds on the dedup re-ack.
    vi.mocked(ackCaptures)
      .mockRejectedValueOnce(new Error("relay unreachable"))
      .mockResolvedValue(undefined as never);

    const first = await runCaptureInboxPoll(KEYS, "alex");
    // The write succeeded but the ack threw, so the item was counted as an error.
    expect(first.errors).toBe(1);

    const second = await runCaptureInboxPoll(KEYS, "alex");
    expect(second.pulled).toBe(0);

    const items = await purchasesApi.listAll();
    expect(items).toHaveLength(1);
  });
});

// ── W3 action handler routing ─────────────────────────────────────────────────
// (scan-manager web sub-bot, 2026-06-08)
//
// Each test verifies that when a capture with a given contentType lands in the
// poll, the correct real-data write executes and the capture is acked.

function actionCapture(contentType: string, captureId: string): PendingCapture {
  return {
    captureId,
    caption: null,
    createdAt: "2026-06-08T12:00:00.000Z",
    contentType,
  };
}

function actionBlob(contentType: string, payload: Record<string, unknown>) {
  return {
    blob: new Blob([JSON.stringify(payload)], { type: contentType }),
  };
}

describe("runCaptureInboxPoll W3 mark-arrived", () => {
  it("marks a purchase as received and creates a linked stock + item", async () => {
    // Set up a purchase task + item in "ordered" status.
    const task = await tasksApi.create({
      name: "Order",
      start_date: "2026-06-01",
      duration_days: 1,
      task_type: "purchase",
    });
    const purchase = await purchasesApi.create({
      task_id: task.id,
      item_name: "Q5 Polymerase",
      quantity: 2,
      vendor: "NEB",
      order_status: "ordered",
    });

    vi.mocked(fetchInbox).mockResolvedValue([actionCapture(MARK_ARRIVED_CT, "arr-1")]);
    vi.mocked(fetchObject).mockResolvedValue(
      actionBlob(MARK_ARRIVED_CT, { purchaseItemId: purchase.id }) as never,
    );

    const result = await runCaptureInboxPoll(KEYS, "alex");
    expect(result.pulled).toBe(1);
    expect(result.errors).toBe(0);

    // The purchase should now be "received".
    const updated = (await purchasesApi.listAll()).find((p) => p.id === purchase.id);
    expect(updated?.order_status).toBe("received");

    // An InventoryItem + stock should have been created.
    const items = await inventoryItemsApi.list();
    expect(items.length).toBeGreaterThanOrEqual(1);
    const createdItem = items.find((i) => i.name === "Q5 Polymerase");
    expect(createdItem).toBeDefined();

    const stocks = await inventoryStocksApi.list();
    const linkedStock = stocks.find((s) => s.purchase_item_id === purchase.id);
    expect(linkedStock).toBeDefined();

    expect(vi.mocked(ackCaptures)).toHaveBeenCalledWith(KEYS, ["arr-1"]);
  });

  it("skips gracefully when purchaseItemId is missing", async () => {
    vi.mocked(fetchInbox).mockResolvedValue([actionCapture(MARK_ARRIVED_CT, "arr-bad")]);
    vi.mocked(fetchObject).mockResolvedValue(
      actionBlob(MARK_ARRIVED_CT, {}) as never,
    );

    const result = await runCaptureInboxPoll(KEYS, "alex");
    // The capture is still pulled (handler logged + returned, did not throw).
    expect(result.pulled).toBe(1);
    expect(result.errors).toBe(0);
  });
});

describe("runCaptureInboxPoll W3 register-tracker", () => {
  it("registers a stock for tracked scanning", async () => {
    const item = await inventoryItemsApi.create({ name: "Tip Box" });
    const stock = await inventoryStocksApi.create({
      item_id: item.id,
      container_count: 1,
    });

    vi.mocked(fetchInbox).mockResolvedValue([actionCapture(REGISTER_TRACKER_CT, "reg-1")]);
    vi.mocked(fetchObject).mockResolvedValue(
      actionBlob(REGISTER_TRACKER_CT, {
        stockId: stock.id,
        productBarcode: "BARCODE123",
        unitsPerScan: 1,
        totalUnits: 96,
        unitLabel: "tip",
      }) as never,
    );

    const result = await runCaptureInboxPoll(KEYS, "alex");
    expect(result.pulled).toBe(1);
    expect(result.errors).toBe(0);

    // Stock should now have units_per_scan + units_remaining.
    const updated = await inventoryStocksApi.get(stock.id);
    expect(updated?.units_per_scan).toBe(1);
    expect(updated?.units_remaining).toBe(96);
    expect(updated?.scan_unit_label).toBe("tip");

    // Item should have the product_barcode set.
    const updatedItem = await inventoryItemsApi.get(item.id);
    expect(updatedItem?.product_barcode).toBe("BARCODE123");

    expect(vi.mocked(ackCaptures)).toHaveBeenCalledWith(KEYS, ["reg-1"]);
  });

  it("skips gracefully when required fields are missing", async () => {
    vi.mocked(fetchInbox).mockResolvedValue([actionCapture(REGISTER_TRACKER_CT, "reg-bad")]);
    vi.mocked(fetchObject).mockResolvedValue(
      actionBlob(REGISTER_TRACKER_CT, { stockId: 99999 }) as never, // no barcode/units
    );

    const result = await runCaptureInboxPoll(KEYS, "alex");
    expect(result.pulled).toBe(1);
    expect(result.errors).toBe(0);
  });
});

describe("runCaptureInboxPoll W3 deduct", () => {
  it("deducts amount * units_per_scan from a tracked stock by stockId", async () => {
    const item = await inventoryItemsApi.create({ name: "Taq Box", product_barcode: "DEDBARCODE" });
    const stock = await inventoryStocksApi.create({
      item_id: item.id,
      units_per_scan: 5,
      units_remaining: 50,
      container_count: 1,
    });

    vi.mocked(fetchInbox).mockResolvedValue([actionCapture(DEDUCT_CT, "ded-1")]);
    vi.mocked(fetchObject).mockResolvedValue(
      actionBlob(DEDUCT_CT, { stockId: stock.id, amount: 3 }) as never,
    );

    const result = await runCaptureInboxPoll(KEYS, "alex");
    expect(result.pulled).toBe(1);
    expect(result.errors).toBe(0);

    // 50 - (5 * 3) = 35
    const updated = await inventoryStocksApi.get(stock.id);
    expect(updated?.units_remaining).toBe(35);

    expect(vi.mocked(ackCaptures)).toHaveBeenCalledWith(KEYS, ["ded-1"]);
  });

  it("resolves a stock by productBarcode when stockId is not given", async () => {
    const item = await inventoryItemsApi.create({
      name: "PCR Kit",
      product_barcode: "BARCODEONLY",
    });
    await inventoryStocksApi.create({
      item_id: item.id,
      units_per_scan: 1,
      units_remaining: 20,
      container_count: 1,
    });

    vi.mocked(fetchInbox).mockResolvedValue([actionCapture(DEDUCT_CT, "ded-2")]);
    vi.mocked(fetchObject).mockResolvedValue(
      actionBlob(DEDUCT_CT, { productBarcode: "BARCODEONLY", amount: 2 }) as never,
    );

    await runCaptureInboxPoll(KEYS, "alex");

    const updatedItem = await inventoryItemsApi.get(item.id);
    const stocks = await inventoryStocksApi.list();
    const updatedStock = stocks.find((s) => s.item_id === updatedItem!.id);
    // 20 - (1 * 2) = 18
    expect(updatedStock?.units_remaining).toBe(18);
  });

  it("skips gracefully when amount is missing", async () => {
    vi.mocked(fetchInbox).mockResolvedValue([actionCapture(DEDUCT_CT, "ded-bad")]);
    vi.mocked(fetchObject).mockResolvedValue(
      actionBlob(DEDUCT_CT, { stockId: 1 }) as never,
    );

    const result = await runCaptureInboxPoll(KEYS, "alex");
    expect(result.pulled).toBe(1);
    expect(result.errors).toBe(0);
  });
});
