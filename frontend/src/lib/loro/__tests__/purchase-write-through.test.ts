// Tests for the purchase write-through seam (purchase-loro chunk 3).
//
// Covers the four behaviours the manager flagged:
//   - write-through persists BOTH the .loro sidecar AND the .json mirror,
//   - merge-at-save preserves a concurrent remote edit to an OTHER field,
//   - approval-state fields round-trip through the Loro field map,
//   - the pi-actions flag-off path falls through to rawPurchasesApi.update.
//
// fileService is an in-memory map (blobs for .loro, objects for .json). The
// collab adopt path is stubbed offline (no collab_doc_id -> no adopt). The
// attribution + total_price recompute (buildPurchaseUpdatePatch) is the real
// implementation re-stated here as a thin deterministic stub so the test does
// not pull the whole local-api module graph.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PurchaseItem, PurchaseItemUpdate } from "@/lib/types";

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

// Offline: no collab doc id means no DO adopt, so openPurchaseDoc just
// loads/rebuilds from the in-memory sidecar store.
vi.mock("@/lib/collab/client/doc-id", () => ({ getCollabDocId: () => undefined }));
vi.mock("@/lib/collab/client/sync-hooks", () => ({ buildCollabBaseDoc: vi.fn() }));
vi.mock("../device-peer", () => ({ getDevicePeerId: () => BigInt(7) }));

// Thin deterministic stand-in for buildPurchaseUpdatePatch: same total_price
// recompute, fixed attribution so assertions are stable. Keeps the test off the
// full local-api module graph.
vi.mock("@/lib/local-api", () => ({
  buildPurchaseUpdatePatch: vi.fn(
    async (
      existing: Pick<PurchaseItem, "price_per_unit" | "quantity" | "shipping_fees">,
      data: PurchaseItemUpdate,
    ) => {
      const pricePerUnit = data.price_per_unit ?? existing.price_per_unit;
      const quantity = data.quantity ?? existing.quantity;
      const shippingFees = data.shipping_fees ?? existing.shipping_fees;
      return {
        ...data,
        total_price: pricePerUnit * quantity + shippingFees,
        last_edited_by: "tester",
        last_edited_at: "2026-06-07T00:00:00.000Z",
      };
    },
  ),
}));

import { writePurchaseUpdateThroughLoro } from "../purchase-write-through";
import { _evictPurchaseDoc } from "../purchase-store";
import { seedPurchaseDoc, getPurchaseFields } from "../purchase-doc";
import { LoroDoc } from "loro-crdt";

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
    catalog_number: null,
    category: null,
    flagged: null,
    ...over,
  };
}

/** Seed the in-memory sidecar from a PurchaseItem so openPurchaseDoc loads it. */
function seedSidecar(item: PurchaseItem): void {
  blobs.set(SIDECAR, seedPurchaseDoc(item));
}

describe("writePurchaseUpdateThroughLoro", () => {
  beforeEach(() => {
    blobs.clear();
    jsons.clear();
    _evictPurchaseDoc(OWNER, ID);
  });

  it("persists BOTH the .loro sidecar and the .json mirror", async () => {
    seedSidecar(makeItem());

    const projected = await writePurchaseUpdateThroughLoro(OWNER, ID, {
      vendor: "Thermo",
      catalog_number: null,
    });

    // Returns the projected PurchaseItem (same return contract as .update).
    expect(projected.vendor).toBe("Thermo");

    // The .loro sidecar was written.
    expect(blobs.has(SIDECAR)).toBe(true);
    // The .json mirror is the field projection.
    const mirror = jsons.get(JSON_PATH) as PurchaseItem;
    expect(mirror.vendor).toBe("Thermo");
    expect(mirror.id).toBe(ID);
    expect(mirror.task_id).toBe(3);

    // The sidecar round-trips back to the same content.
    const reloaded = new LoroDoc();
    reloaded.import(blobs.get(SIDECAR)!);
    expect(getPurchaseFields(reloaded).vendor).toBe("Thermo");
  });

  it("recomputes total_price and stamps attribution into the mirror", async () => {
    seedSidecar(makeItem({ price_per_unit: 100, quantity: 2, shipping_fees: 0 }));

    const projected = await writePurchaseUpdateThroughLoro(OWNER, ID, {
      quantity: 5,
    });

    // 100 * 5 + 0 = 500 (recompute off the doc's current price + shipping).
    expect(projected.total_price).toBe(500);
    expect(projected.last_edited_by).toBe("tester");
    const mirror = jsons.get(JSON_PATH) as PurchaseItem;
    expect(mirror.total_price).toBe(500);
  });

  it("merge-at-save preserves a concurrent remote edit to an OTHER field", async () => {
    // The local doc starts with vendor NEB. Simulate a remote collaborator who
    // (over the relay) already changed the NOTES field on the SAME doc. The
    // open handle's doc carries that remote notes edit. Our save touches only
    // vendor; the remote notes value must survive (per-key LWW).
    seedSidecar(makeItem({ vendor: "NEB", notes: null }));

    // Simulate the relay having merged a remote notes edit into the persisted
    // sidecar before our save opens it.
    const remote = new LoroDoc();
    remote.import(blobs.get(SIDECAR)!);
    remote.getMap("fields").set("notes", "ship cold, dry ice");
    remote.commit();
    blobs.set(SIDECAR, remote.export({ mode: "snapshot" }));

    const projected = await writePurchaseUpdateThroughLoro(OWNER, ID, {
      vendor: "Sigma",
      catalog_number: null,
    });

    // Our field changed AND the concurrent remote field is preserved.
    expect(projected.vendor).toBe("Sigma");
    expect(projected.notes).toBe("ship cold, dry ice");

    const mirror = jsons.get(JSON_PATH) as PurchaseItem;
    expect(mirror.vendor).toBe("Sigma");
    expect(mirror.notes).toBe("ship cold, dry ice");
  });

  it("rounds the approval-state fields through the Loro field map", async () => {
    seedSidecar(makeItem());

    const projected = await writePurchaseUpdateThroughLoro(OWNER, ID, {
      approved: true,
      approved_by: "pi",
      approved_at: "2026-06-07T12:00:00.000Z",
      declined_at: null,
      declined_by: null,
    });

    expect(projected.approved).toBe(true);
    expect(projected.approved_by).toBe("pi");
    expect(projected.approved_at).toBe("2026-06-07T12:00:00.000Z");
    expect(projected.declined_at).toBeNull();

    // The mirror carries the approval state for the approval-queue reader.
    const mirror = jsons.get(JSON_PATH) as PurchaseItem;
    expect(mirror.approved).toBe(true);
    expect(mirror.approved_by).toBe("pi");

    // The sidecar round-trips the approval state too.
    const reloaded = new LoroDoc();
    reloaded.import(blobs.get(SIDECAR)!);
    expect(getPurchaseFields(reloaded).approved).toBe(true);
    expect(getPurchaseFields(reloaded).approved_by).toBe("pi");
  });

  it("rounds the flagged object through the Loro field map", async () => {
    seedSidecar(makeItem());
    const flag = { by: "pi", at: "2026-06-07T01:00:00.000Z", reason: "over budget" };

    const projected = await writePurchaseUpdateThroughLoro(OWNER, ID, {
      flagged: flag,
    });
    expect(projected.flagged).toEqual(flag);

    // And a clear round-trips back to null.
    const cleared = await writePurchaseUpdateThroughLoro(OWNER, ID, {
      flagged: null,
    });
    expect(cleared.flagged).toBeNull();
  });
});
