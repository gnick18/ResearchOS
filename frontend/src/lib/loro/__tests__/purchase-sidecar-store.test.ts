// Tests for the purchase-item sidecar store (purchase-loro chunk 1).
// fileService is mocked with an in-memory file map (blobs for .loro, objects
// for .json).

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PurchaseItem } from "@/lib/types";

const blobs = new Map<string, Uint8Array>();
const jsons = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    ensureDir: vi.fn(async () => null),
    readFileAsBlob: vi.fn(async (path: string) => {
      const v = blobs.get(path);
      if (v === undefined) return null;
      return new Blob([v.buffer as ArrayBuffer]);
    }),
    writeFileFromBlob: vi.fn(async (path: string, blob: Blob) => {
      blobs.set(path, new Uint8Array(await blob.arrayBuffer()));
    }),
    readJson: vi.fn(async (path: string) => {
      return jsons.has(path) ? jsons.get(path) : null;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      jsons.set(path, data);
    }),
  },
}));

import { LoroDoc } from "loro-crdt";
import {
  seedPurchaseDoc,
  getPurchaseFields,
  setPurchaseField,
} from "../purchase-doc";
import {
  loadOrRebuildPurchaseDoc,
  persistPurchaseDoc,
} from "../purchase-sidecar-store";

const OWNER = "manny";
const ID = 7;
const SIDECAR = `users/${OWNER}/purchase_items/${ID}.loro`;
const JSON_PATH = `users/${OWNER}/purchase_items/${ID}.json`;

function makeItem(over: Partial<PurchaseItem> = {}): PurchaseItem {
  return {
    id: ID,
    task_id: 3,
    item_name: "Taq polymerase",
    quantity: 2,
    link: null,
    cas: null,
    price_per_unit: 100,
    shipping_fees: 0,
    total_price: 200,
    notes: null,
    funding_string: null,
    vendor: "NEB",
    category: null,
    flagged: null,
    ...over,
  };
}

describe("purchase-sidecar-store", () => {
  beforeEach(() => {
    blobs.clear();
    jsons.clear();
  });

  it("rebuilds from the .json mirror when no sidecar exists", async () => {
    jsons.set(JSON_PATH, makeItem({ vendor: "Sigma" }));
    const doc = await loadOrRebuildPurchaseDoc(OWNER, ID);
    expect(getPurchaseFields(doc).vendor).toBe("Sigma");
    expect(getPurchaseFields(doc).id).toBe(ID);
  });

  it("seeds an empty record when neither sidecar nor mirror exists", async () => {
    const doc = await loadOrRebuildPurchaseDoc(OWNER, ID);
    const projected = getPurchaseFields(doc);
    expect(projected.id).toBe(ID);
    expect(projected.item_name).toBe("");
  });

  it("persists BOTH the .loro sidecar and the .json mirror", async () => {
    const doc = new LoroDoc();
    doc.import(seedPurchaseDoc(makeItem()));
    setPurchaseField(doc, "vendor", "Thermo");
    doc.commit();

    await persistPurchaseDoc(OWNER, ID, doc);

    // The .loro sidecar exists.
    expect(blobs.has(SIDECAR)).toBe(true);
    // The .json mirror is the field projection (plain PurchaseItem object).
    const mirror = jsons.get(JSON_PATH) as PurchaseItem;
    expect(mirror.vendor).toBe("Thermo");
    expect(mirror.id).toBe(ID);
    expect(mirror.task_id).toBe(3);

    // The sidecar round-trips back to the same content.
    const reloaded = await loadOrRebuildPurchaseDoc(OWNER, ID);
    expect(getPurchaseFields(reloaded).vendor).toBe("Thermo");
  });

  it("prefers the sidecar over the mirror when both exist", async () => {
    const doc = new LoroDoc();
    doc.import(seedPurchaseDoc(makeItem({ vendor: "from sidecar" })));
    doc.commit();
    await persistPurchaseDoc(OWNER, ID, doc);
    // Tamper the mirror so we can tell which source loadOrRebuild used.
    jsons.set(JSON_PATH, makeItem({ vendor: "STALE MIRROR" }));
    const reloaded = await loadOrRebuildPurchaseDoc(OWNER, ID);
    expect(getPurchaseFields(reloaded).vendor).toBe("from sidecar");
  });
});
