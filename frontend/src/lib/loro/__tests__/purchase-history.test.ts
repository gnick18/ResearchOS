/**
 * Tests for purchase-item version history (purchase-loro chunk 4).
 *
 * Covers:
 *   1. listPurchaseVersions on a seed-only doc returns the seed version with the
 *      "seed" username fallback for peer "0".
 *   2. A real multi-commit doc returns versions in lamport order with messages.
 *   3. reconstructPurchaseAt time-travels (old version = old fields, new = new).
 *   4. reconstructPurchaseCanonicalAt produces a string the purchase adapter
 *      parses without throwing.
 *   5. restorePurchaseVersion is a FORWARD commit (history grows, fields revert,
 *      the .json mirror is rewritten).
 *
 * fileService is mocked in-memory so the sidecar store + actors run in node.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";
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
    readJson: vi.fn(async (path: string) => (jsons.has(path) ? jsons.get(path) : null)),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      jsons.set(path, data);
    }),
  },
}));

// Offline: no collab doc id, so openPurchaseDoc just loads from the in-memory
// sidecar store. Stable device peer for deterministic restore attribution.
vi.mock("@/lib/collab/client/doc-id", () => ({ getCollabDocId: () => undefined }));
vi.mock("@/lib/collab/client/sync-hooks", () => ({ buildCollabBaseDoc: vi.fn() }));
vi.mock("../device-peer", () => ({ getDevicePeerId: () => BigInt(424242) }));

import { seedPurchaseDoc, getPurchaseFields, setPurchaseField } from "../purchase-doc";
import {
  listPurchaseVersions,
  reconstructPurchaseAt,
  reconstructPurchaseCanonicalAt,
} from "../purchase-history";
import { restorePurchaseVersion } from "../purchase-restore";
import { openPurchaseDoc, _evictPurchaseDoc } from "../purchase-store";
import { purchaseAdapter } from "@/lib/history/purchase-viewer";

const OWNER = "mira";
const ID = 77;

function fixtureItem(): PurchaseItem {
  return {
    id: ID,
    task_id: 5,
    item_name: "Tris buffer",
    quantity: 2,
    link: null,
    cas: "77-86-1",
    price_per_unit: 30,
    shipping_fees: 5,
    total_price: 65,
    notes: null,
    funding_string: "R01-GM-12345",
    vendor: "Sigma",
    category: "Reagent",
    assigned_to: null,
    order_status: undefined,
    approved: false,
    approved_by: null,
    approved_at: null,
    flagged: null,
    declined_at: null,
    declined_by: null,
  } as PurchaseItem;
}

function sidecarPath(owner: string, id: number): string {
  return `users/${owner}/purchase_items/${id}.loro`;
}
function jsonPath(owner: string, id: number): string {
  return `users/${owner}/purchase_items/${id}.json`;
}
function actorsPath(owner: string): string {
  return `users/${owner}/.researchos/actors.json`;
}

function setSidecar(owner: string, id: number, bytes: Uint8Array): void {
  blobs.set(sidecarPath(owner, id), new Uint8Array(bytes));
}

beforeEach(() => {
  blobs.clear();
  jsons.clear();
  _evictPurchaseDoc(OWNER, ID);
  vi.clearAllMocks();
});

describe("listPurchaseVersions: seed-only doc", () => {
  it("returns the seed version with the seed username fallback", async () => {
    // No sidecar: loadOrRebuild seeds deterministically from the .json mirror.
    jsons.set(jsonPath(OWNER, ID), fixtureItem());

    const versions = await listPurchaseVersions(OWNER, ID);
    expect(versions.length).toBeGreaterThanOrEqual(1);

    const seed = versions[0];
    expect(seed.index).toBe(0);
    expect(seed.peer).toBe("0");
    expect(seed.username).toBe("seed");
    expect(seed.frontiers).toHaveLength(1);
  });
});

describe("listPurchaseVersions: multi-commit doc", () => {
  it("returns versions in lamport order with the correct messages", async () => {
    const doc = new LoroDoc();
    doc.import(seedPurchaseDoc(fixtureItem()));

    const devicePeer = BigInt(98765);
    doc.setPeerId(devicePeer);

    setPurchaseField(doc, "vendor", "Fisher");
    doc.commit({ message: "edit-vendor", timestamp: 1747000000 });

    setPurchaseField(doc, "price_per_unit", 42);
    doc.commit({ message: "edit-price", timestamp: 1747000060 });

    setSidecar(OWNER, ID, doc.export({ mode: "snapshot" }));
    jsons.set(actorsPath(OWNER), { [devicePeer.toString()]: { username: "mira" } });

    const versions = await listPurchaseVersions(OWNER, ID);
    expect(versions.length).toBe(3);
    expect(versions[0].username).toBe("seed");
    expect(versions[1].message).toBe("edit-vendor");
    expect(versions[1].username).toBe("mira");
    expect(versions[2].message).toBe("edit-price");
  });
});

describe("reconstructPurchaseAt: time-travel", () => {
  it("older version has old fields, newer version has new fields", async () => {
    const doc = new LoroDoc();
    doc.import(seedPurchaseDoc(fixtureItem()));
    doc.setPeerId(BigInt(55555));

    setPurchaseField(doc, "vendor", "Fisher");
    doc.commit({ message: "edit-vendor", timestamp: 1747000100 });

    setSidecar(OWNER, ID, doc.export({ mode: "snapshot" }));

    const versions = await listPurchaseVersions(OWNER, ID);
    const oldItem = await reconstructPurchaseAt(OWNER, ID, 0);
    expect(oldItem.vendor).toBe("Sigma");

    const newItem = await reconstructPurchaseAt(OWNER, ID, versions.length - 1);
    expect(newItem.vendor).toBe("Fisher");

    // Identity is preserved through reconstruction.
    expect(oldItem.id).toBe(ID);
    expect(newItem.id).toBe(ID);
  });

  it("throws a clear error for an out-of-range version index", async () => {
    jsons.set(jsonPath(OWNER, ID), fixtureItem());
    await expect(reconstructPurchaseAt(OWNER, ID, 99)).rejects.toThrow(/out of range/);
  });
});

describe("reconstructPurchaseCanonicalAt: adapter parses the output", () => {
  it("returns a canonical string the purchase adapter projects without throwing", async () => {
    jsons.set(jsonPath(OWNER, ID), fixtureItem());

    const canonical = await reconstructPurchaseCanonicalAt(OWNER, ID, 0);
    expect(typeof canonical).toBe("string");
    expect(canonical.endsWith("\n")).toBe(true);

    let projection: ReturnType<typeof purchaseAdapter.projectBody>;
    expect(() => {
      projection = purchaseAdapter.projectBody(canonical);
    }).not.toThrow();

    expect(projection!.body).toContain("Tris buffer");
    expect(projection!.body).toContain("Sigma");
  });
});

describe("restorePurchaseVersion: forward commit", () => {
  it("grows history, reverts the fields, and rewrites the .json mirror", async () => {
    // Build a doc with seed (vendor Sigma) + one edit (vendor Fisher).
    const doc = new LoroDoc();
    doc.import(seedPurchaseDoc(fixtureItem()));
    doc.setPeerId(BigInt(33333));
    setPurchaseField(doc, "vendor", "Fisher");
    doc.commit({ message: "edit-vendor", timestamp: 1747000200 });
    setSidecar(OWNER, ID, doc.export({ mode: "snapshot" }));

    const before = await listPurchaseVersions(OWNER, ID);
    expect(before.length).toBe(2); // seed + edit
    expect(before[before.length - 1]).toBeDefined();

    // Restore version 0 (the seed, vendor Sigma).
    const handle = await openPurchaseDoc(OWNER, ID);
    const result = await restorePurchaseVersion(handle, OWNER, ID, 0);

    // Forward commit: history GREW (not rewound).
    const after = await listPurchaseVersions(OWNER, ID);
    expect(after.length).toBe(before.length + 1);

    // The new HEAD carries a restore message -> the adapter labels it a revert.
    const head = after[after.length - 1];
    expect(head.message).toMatch(/^restore-v0/);

    // Fields reverted to the seed (vendor Sigma).
    expect(result.vendor).toBe("Sigma");

    // The .json mirror was rewritten with the restored value.
    const mirror = jsons.get(jsonPath(OWNER, ID)) as PurchaseItem;
    expect(mirror.vendor).toBe("Sigma");

    await handle.close();
  });
});
