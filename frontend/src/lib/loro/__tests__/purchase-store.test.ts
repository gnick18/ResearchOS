// Tests for openPurchaseDoc + PurchaseDocHandle (purchase-loro chunk 1).
// The sidecar store, collab adopt, and device peer are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";

const persistPurchaseDoc = vi.fn(async (..._args: unknown[]) => {});

vi.mock("../purchase-sidecar-store", () => ({
  loadOrRebuildPurchaseDoc: vi.fn(async () => {
    const d = new LoroDoc();
    d.getMap("fields").set("vendor", "NEB");
    d.commit();
    return d;
  }),
  persistPurchaseDoc: (...args: unknown[]) => persistPurchaseDoc(...args),
}));

// No collab doc id -> no adopt (keeps the open path simple + offline).
vi.mock("@/lib/collab/client/doc-id", () => ({ getCollabDocId: () => undefined }));
vi.mock("@/lib/collab/client/sync-hooks", () => ({ buildCollabBaseDoc: vi.fn() }));
vi.mock("../device-peer", () => ({ getDevicePeerId: () => BigInt(5) }));

import { openPurchaseDoc, _evictPurchaseDoc } from "../purchase-store";

const OWNER = "manny";
const ID = 3;

describe("purchase-store openPurchaseDoc + handle", () => {
  beforeEach(() => {
    persistPurchaseDoc.mockClear();
    _evictPurchaseDoc(OWNER, ID);
  });

  it("opens a handle with the loaded doc", async () => {
    const h = await openPurchaseDoc(OWNER, ID);
    expect(h.doc.getMap("fields").get("vendor")).toBe("NEB");
  });

  it("reuses the cached handle for the same purchase item", async () => {
    const a = await openPurchaseDoc(OWNER, ID);
    const b = await openPurchaseDoc(OWNER, ID);
    expect(a).toBe(b);
  });

  it("debounced commit persists and toggles commitPending", async () => {
    const h = await openPurchaseDoc(OWNER, ID);
    const states: boolean[] = [];
    h.subscribeCommitPending((p) => states.push(p)); // fires once with false

    vi.useFakeTimers();
    void h.commit();
    expect(h.commitPending).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();

    expect(persistPurchaseDoc).toHaveBeenCalledTimes(1);
    expect(h.commitPending).toBe(false);
    // saw false (init) -> true (queued) -> false (settled)
    expect(states).toEqual([false, true, false]);
  });
});
