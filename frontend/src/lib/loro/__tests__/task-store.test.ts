// Tests for openTaskDoc + TaskDocHandle (experiment collab chunk 1).
// The sidecar store, collab adopt, and device peer are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";

const persistTaskDoc = vi.fn(async () => {});

vi.mock("../task-sidecar-store", () => ({
  loadOrRebuildTaskDoc: vi.fn(async () => {
    const d = new LoroDoc();
    d.getText("content").insert(0, "hello");
    d.commit();
    return d;
  }),
  persistTaskDoc: (...args: unknown[]) => persistTaskDoc(...args),
}));

// No collab doc id -> no adopt (keeps the open path simple + offline).
vi.mock("@/lib/collab/client/doc-id", () => ({ getCollabDocId: () => undefined }));
vi.mock("@/lib/collab/client/sync-hooks", () => ({ buildCollabBaseDoc: vi.fn() }));
vi.mock("../device-peer", () => ({ getDevicePeerId: () => BigInt(5) }));

import { openTaskDoc, _evictTaskDoc } from "../task-store";
import { getTaskContentText } from "../task-doc";

const TASK = { id: 3, owner: "manny" };

describe("task-store openTaskDoc + handle", () => {
  beforeEach(() => {
    persistTaskDoc.mockClear();
    _evictTaskDoc(TASK, "notes");
  });

  it("opens a handle with the loaded doc content", async () => {
    const h = await openTaskDoc(TASK, "notes");
    expect(getTaskContentText(h.doc)).toBe("hello");
  });

  it("reuses the cached handle for the same surface", async () => {
    const a = await openTaskDoc(TASK, "notes");
    const b = await openTaskDoc(TASK, "notes");
    expect(a).toBe(b);
  });

  it("debounced commit persists and toggles commitPending", async () => {
    const h = await openTaskDoc(TASK, "notes");
    const states: boolean[] = [];
    h.subscribeCommitPending((p) => states.push(p)); // fires once with false

    vi.useFakeTimers();
    void h.commit();
    expect(h.commitPending).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();

    expect(persistTaskDoc).toHaveBeenCalledTimes(1);
    expect(h.commitPending).toBe(false);
    // saw false (init) -> true (queued) -> false (settled)
    expect(states).toEqual([false, true, false]);
  });
});
