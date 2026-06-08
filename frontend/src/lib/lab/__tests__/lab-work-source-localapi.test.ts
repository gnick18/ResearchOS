// Lab-tier Phase 3 chunk 2b-bind: local-api LabWorkSource adapter tests.
//
// Covers:
//   - Unit: createLocalApiLabWorkSource() routes each method to the correct
//     JsonStore collection (tasks/notes/methods/purchase_items) and forwards
//     listAllForUser(owner) results through unchanged.
//   - Integration: the source fed into the REAL enumerateLabWork() produces
//     LabWorkRecord[] with correct recordType and recordId values.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLocalApiLabWorkSource } from "../lab-work-source-localapi";
import { enumerateLabWork } from "../lab-work-enumerate";

// ---------------------------------------------------------------------------
// Mock JsonStore
// ---------------------------------------------------------------------------

// Fixture data keyed by collection name.
const FIXTURES: Record<string, Array<{ id: number; [k: string]: unknown }>> = {
  tasks: [
    { id: 1, title: "Run gel", task_type: "task" },
    { id: 2, title: "CRISPR experiment", task_type: "experiment" },
  ],
  notes: [{ id: 10, body: "Observe colonies" }],
  methods: [{ id: 20, name: "PCR protocol" }],
  purchase_items: [{ id: 30, item: "Taq polymerase" }],
};

// Track which collection each JsonStore instance was created for, and capture
// listAllForUser calls so we can assert the right owner was used.
const mockListAllForUser = vi.fn((owner: string) => {
  // Returned below via instance-level closure.
  void owner;
  return Promise.resolve([]);
});

vi.mock("@/lib/storage/json-store", () => {
  // Each JsonStore instance receives the collection name in its constructor.
  // We use that to look up the correct fixture array.
  // Must be a regular function (not an arrow) so `new MockJsonStore(...)` works.
  function MockJsonStore(this: { listAllForUser: ReturnType<typeof vi.fn> }, collectionName: string) {
    this.listAllForUser = vi.fn((owner: string) => {
      void owner;
      return Promise.resolve(FIXTURES[collectionName] ?? []);
    });
  }
  const SpyableJsonStore = vi.fn(MockJsonStore as unknown as new (collectionName: string) => { listAllForUser: ReturnType<typeof vi.fn> });
  return { JsonStore: SpyableJsonStore };
});

// ---------------------------------------------------------------------------
// Import the mock AFTER setting it up so we can inspect constructor calls.
// ---------------------------------------------------------------------------
import { JsonStore } from "@/lib/storage/json-store";

// ---------------------------------------------------------------------------
// Unit tests: routing + per-collection delegation
// ---------------------------------------------------------------------------

describe("createLocalApiLabWorkSource — unit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constructs four JsonStore instances with the correct collection names", () => {
    createLocalApiLabWorkSource();
    const ctorCalls = (JsonStore as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(ctorCalls).toContain("tasks");
    expect(ctorCalls).toContain("notes");
    expect(ctorCalls).toContain("methods");
    expect(ctorCalls).toContain("purchase_items");
  });

  it("listTasks delegates to the tasks store with the supplied owner", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listTasks("alex");
    expect(result).toEqual(FIXTURES.tasks);
  });

  it("listNotes delegates to the notes store with the supplied owner", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listNotes("alex");
    expect(result).toEqual(FIXTURES.notes);
  });

  it("listMethods delegates to the methods store with the supplied owner", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listMethods("alex");
    expect(result).toEqual(FIXTURES.methods);
  });

  it("listPurchases delegates to the purchase_items store with the supplied owner", async () => {
    const source = createLocalApiLabWorkSource();
    const result = await source.listPurchases("alex");
    expect(result).toEqual(FIXTURES.purchase_items);
  });

  it("each store's listAllForUser is called with the correct owner string", async () => {
    const source = createLocalApiLabWorkSource();
    await source.listTasks("morgan");
    await source.listNotes("morgan");
    await source.listMethods("morgan");
    await source.listPurchases("morgan");

    // JsonStore was called 4 times (one per collection); each instance's
    // listAllForUser should have been called with "morgan".
    const instances = (JsonStore as unknown as ReturnType<typeof vi.fn>).mock.results.map(
      (r: { value: unknown }) => r.value as { listAllForUser: ReturnType<typeof vi.fn> },
    );
    for (const inst of instances) {
      expect(inst.listAllForUser).toHaveBeenCalledWith("morgan");
    }
  });
});

// ---------------------------------------------------------------------------
// Integration test: feed source into the REAL enumerateLabWork
// ---------------------------------------------------------------------------

describe("createLocalApiLabWorkSource + enumerateLabWork — integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("produces LabWorkRecord[] with correct recordTypes and recordIds", async () => {
    // The mock JsonStore already returns FIXTURES per collection; the source
    // wraps those stores. enumerateLabWork is the REAL function (not mocked).
    const source = createLocalApiLabWorkSource();

    const records = await enumerateLabWork({ owner: "alex", source });

    // Collect the actual (recordType, recordId) pairs for easy assertion.
    const pairs = records.map((r) => ({ type: r.recordType, id: r.recordId }));

    // task: id 1 (task_type "task")
    expect(pairs).toContainEqual({ type: "task", id: "1" });

    // experiment: id 2 (task_type "experiment")
    expect(pairs).toContainEqual({ type: "experiment", id: "2" });

    // note: id 10
    expect(pairs).toContainEqual({ type: "note", id: "10" });

    // method: id 20
    expect(pairs).toContainEqual({ type: "method", id: "20" });

    // purchase: id 30
    expect(pairs).toContainEqual({ type: "purchase", id: "30" });

    // Total count: 1 task + 1 experiment + 1 note + 1 method + 1 purchase = 5.
    expect(records).toHaveLength(5);
  });

  it("records have a non-empty plaintext Uint8Array (canonical bytes)", async () => {
    const source = createLocalApiLabWorkSource();
    const records = await enumerateLabWork({ owner: "alex", source });
    for (const r of records) {
      expect(r.plaintext).toBeInstanceOf(Uint8Array);
      expect(r.plaintext.length).toBeGreaterThan(0);
    }
  });

  it("output is grouped by type in LAB_WORK_TYPES order (task then experiment then note then method then purchase)", async () => {
    const source = createLocalApiLabWorkSource();
    const records = await enumerateLabWork({ owner: "alex", source });
    const types = records.map((r) => r.recordType);
    expect(types).toEqual(["task", "experiment", "note", "method", "purchase"]);
  });
});
