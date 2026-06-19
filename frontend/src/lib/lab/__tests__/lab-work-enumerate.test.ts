// Lab-tier Phase 3 chunk 2b-enumerate: enumerator unit tests.
//
// Covers:
//   - canonicalRecordBytes: identical bytes regardless of key insertion order,
//     nested objects and arrays handled, output decodes to valid sorted-key JSON.
//   - enumerateLabWork: tasks split into "task" vs "experiment" by task_type;
//     notes/methods/purchases map to their types; records with empty/null/undefined
//     ids are skipped; output order is stable (type-grouped then recordId ascending);
//     recordId is the stringified id.
//   - 2a round-trip: enumerated LabWorkRecord[] fed into the real syncLabWorkToMirror
//     with a putImpl mock; each record produces exactly one push, and the object key
//     matches labDataObjectKey(labId, owner, recordType, recordId).
//
// LAB_TIER_ENABLED gate: the round-trip test imports syncLabWorkToMirror and
// labDataObjectKey (the real functions) but supplies a putImpl mock so no real
// putLabRecord call is made. The mock bypasses assertEnabled() entirely, so no
// vi.mock of config is needed for these tests.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import {
  canonicalRecordBytes,
  enumerateLabWork,
  LAB_WORK_TYPES,
  type LabWorkSource,
  type OwnedRecord,
} from "../lab-work-enumerate";
import { syncLabWorkToMirror } from "../lab-sync";
import { labDataObjectKey } from "../lab-data-protocol";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

const dec = new TextDecoder();

function fakeSource(overrides: Partial<LabWorkSource> = {}): LabWorkSource {
  return {
    listTasks: overrides.listTasks ?? (async () => []),
    listNotes: overrides.listNotes ?? (async () => []),
    listMethods: overrides.listMethods ?? (async () => []),
    listPurchases: overrides.listPurchases ?? (async () => []),
    listInventory: overrides.listInventory ?? (async () => []),
    listInventoryStock: overrides.listInventoryStock ?? (async () => []),
    listSequences: overrides.listSequences ?? (async () => []),
    listPhylo: overrides.listPhylo ?? (async () => []),
    listMolecules: overrides.listMolecules ?? (async () => []),
    listDatahub: overrides.listDatahub ?? (async () => []),
    listResultSheets: overrides.listResultSheets ?? (async () => []),
    listNotesSheets: overrides.listNotesSheets ?? (async () => []),
    listDeposits: overrides.listDeposits ?? (async () => []),
  };
}

// A minimal fake key pair (not for real crypto; just to satisfy syncLabWorkToMirror
// types). The putImpl mock is called before any real crypto, so these never reach
// the actual signing code.
const FAKE_LAB_KEY = new Uint8Array(32).fill(1);
const FAKE_PRIV = new Uint8Array(32).fill(2);
const FAKE_PUB = new Uint8Array(32).fill(3);

// ---------------------------------------------------------------------------
// canonicalRecordBytes tests.
// ---------------------------------------------------------------------------

describe("canonicalRecordBytes", () => {
  it("produces identical bytes for the same object with keys in different insertion order", () => {
    const a: OwnedRecord = { id: "r1", z: 99, a: "hello", m: true };
    const b: OwnedRecord = { m: true, id: "r1", a: "hello", z: 99 };

    const bytesA = canonicalRecordBytes(a);
    const bytesB = canonicalRecordBytes(b);

    expect(bytesA).toEqual(bytesB);
  });

  it("handles nested objects with shuffled key order", () => {
    const a: OwnedRecord = {
      id: "r2",
      meta: { y: 2, x: 1 },
      data: { beta: "b", alpha: "a" },
    };
    const b: OwnedRecord = {
      data: { alpha: "a", beta: "b" },
      id: "r2",
      meta: { x: 1, y: 2 },
    };

    const bytesA = canonicalRecordBytes(a);
    const bytesB = canonicalRecordBytes(b);

    expect(bytesA).toEqual(bytesB);
  });

  it("preserves array order (arrays are NOT sorted)", () => {
    const a: OwnedRecord = { id: "r3", tags: ["b", "a", "c"] };
    const b: OwnedRecord = { id: "r3", tags: ["a", "b", "c"] };

    const bytesA = canonicalRecordBytes(a);
    const bytesB = canonicalRecordBytes(b);

    // Different array order produces different bytes.
    expect(bytesA).not.toEqual(bytesB);
  });

  it("decodes to valid JSON with recursively sorted keys", () => {
    const record: OwnedRecord = {
      id: "r4",
      z_field: "last",
      a_field: "first",
      nested: { z: 99, a: 0 },
    };

    const bytes = canonicalRecordBytes(record);
    const json = dec.decode(bytes);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    // Top-level keys are sorted.
    expect(Object.keys(parsed)).toEqual(
      [...Object.keys(parsed)].slice().sort(),
    );

    // Nested keys are sorted.
    const nested = parsed.nested as Record<string, unknown>;
    expect(Object.keys(nested)).toEqual(["a", "z"]);

    // Values are intact.
    expect(parsed.a_field).toBe("first");
    expect(parsed.z_field).toBe("last");
    expect(nested.a).toBe(0);
    expect(nested.z).toBe(99);
  });

  it("handles arrays of objects recursively", () => {
    const a: OwnedRecord = {
      id: "r5",
      items: [{ z: 1, a: 2 }, { y: 3, b: 4 }],
    };
    const b: OwnedRecord = {
      id: "r5",
      items: [{ a: 2, z: 1 }, { b: 4, y: 3 }],
    };

    expect(canonicalRecordBytes(a)).toEqual(canonicalRecordBytes(b));
  });

  it("handles primitive values (string, number, boolean, null) in nested positions", () => {
    const record: OwnedRecord = {
      id: "r6",
      str: "hello",
      num: 42,
      bool: false,
      nil: null,
    };

    const bytes = canonicalRecordBytes(record);
    const json = dec.decode(bytes);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed.str).toBe("hello");
    expect(parsed.num).toBe(42);
    expect(parsed.bool).toBe(false);
    expect(parsed.nil).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// enumerateLabWork tests.
// ---------------------------------------------------------------------------

describe("enumerateLabWork", () => {
  it("splits tasks with task_type=experiment into 'experiment' recordType", async () => {
    const source = fakeSource({
      listTasks: async () => [
        { id: "t1", title: "Task one", task_type: "task" },
        { id: "e1", title: "Exp one", task_type: "experiment" },
        { id: "e2", title: "Exp two", task_type: "experiment" },
      ],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    const tasks = records.filter((r) => r.recordType === "task");
    const experiments = records.filter((r) => r.recordType === "experiment");

    expect(tasks).toHaveLength(1);
    expect(tasks[0].recordId).toBe("t1");

    expect(experiments).toHaveLength(2);
    const expIds = experiments.map((r) => r.recordId).sort();
    expect(expIds).toEqual(["e1", "e2"]);
  });

  it("treats tasks with no task_type as plain tasks (not experiments)", async () => {
    const source = fakeSource({
      listTasks: async () => [
        { id: "t2", title: "Untitled task" },
      ],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    expect(records).toHaveLength(1);
    expect(records[0].recordType).toBe("task");
    expect(records[0].recordId).toBe("t2");
  });

  it("maps notes to recordType 'note'", async () => {
    const source = fakeSource({
      listNotes: async () => [
        { id: "n1", content: "First note" },
        { id: "n2", content: "Second note" },
      ],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    expect(records).toHaveLength(2);
    for (const r of records) {
      expect(r.recordType).toBe("note");
    }
    const ids = records.map((r) => r.recordId);
    expect(ids).toContain("n1");
    expect(ids).toContain("n2");
  });

  it("maps methods to recordType 'method'", async () => {
    const source = fakeSource({
      listMethods: async () => [{ id: "m1", name: "Western blot" }],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    expect(records).toHaveLength(1);
    expect(records[0].recordType).toBe("method");
    expect(records[0].recordId).toBe("m1");
  });

  it("maps purchases to recordType 'purchase'", async () => {
    const source = fakeSource({
      listPurchases: async () => [
        { id: 10, vendor: "Sigma", amount: 99.5 },
      ],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    expect(records).toHaveLength(1);
    expect(records[0].recordType).toBe("purchase");
    // Numeric id is stringified.
    expect(records[0].recordId).toBe("10");
  });

  it("silently skips records with null id", async () => {
    const source = fakeSource({
      listNotes: async () => [
        { id: null as unknown as string, content: "bad" },
        { id: "n3", content: "good" },
      ],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    expect(records).toHaveLength(1);
    expect(records[0].recordId).toBe("n3");
  });

  it("silently skips records with undefined id", async () => {
    const source = fakeSource({
      listMethods: async () => [
        { id: undefined as unknown as string, name: "bad method" },
        { id: "m2", name: "good method" },
      ],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    expect(records).toHaveLength(1);
    expect(records[0].recordId).toBe("m2");
  });

  it("silently skips records with empty-string id", async () => {
    const source = fakeSource({
      listPurchases: async () => [
        { id: "", vendor: "bad" },
        { id: "p1", vendor: "good" },
      ],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    expect(records).toHaveLength(1);
    expect(records[0].recordId).toBe("p1");
  });

  it("stringifies numeric ids", async () => {
    const source = fakeSource({
      listTasks: async () => [
        { id: 42, title: "Numeric-id task", task_type: "task" },
      ],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    expect(records[0].recordId).toBe("42");
  });

  it("output order is stable: grouped by LAB_WORK_TYPES order, then recordId ascending", async () => {
    const source = fakeSource({
      listTasks: async () => [
        { id: "t10", task_type: "task" },
        { id: "e5", task_type: "experiment" },
        { id: "t2", task_type: "task" },
        { id: "e1", task_type: "experiment" },
      ],
      listNotes: async () => [
        { id: "n3" },
        { id: "n1" },
      ],
      listMethods: async () => [{ id: "m1" }],
      listPurchases: async () => [{ id: "p2" }, { id: "p1" }],
    });

    const recordsA = await enumerateLabWork({ owner: "alice", source });
    const recordsB = await enumerateLabWork({ owner: "alice", source });

    // Two runs produce the same sequence.
    expect(recordsA.map((r) => `${r.recordType}/${r.recordId}`)).toEqual(
      recordsB.map((r) => `${r.recordType}/${r.recordId}`),
    );

    // Types appear in LAB_WORK_TYPES order: task, experiment, note, method, purchase.
    const types = recordsA.map((r) => r.recordType);
    const taskIdx = types.indexOf("task");
    const expIdx = types.indexOf("experiment");
    const noteIdx = types.indexOf("note");
    const methodIdx = types.indexOf("method");
    const purchaseIdx = types.indexOf("purchase");

    expect(taskIdx).toBeLessThan(expIdx);
    expect(expIdx).toBeLessThan(noteIdx);
    expect(noteIdx).toBeLessThan(methodIdx);
    expect(methodIdx).toBeLessThan(purchaseIdx);

    // Within each type, recordIds are sorted ascending.
    const taskIds = recordsA
      .filter((r) => r.recordType === "task")
      .map((r) => r.recordId);
    expect(taskIds).toEqual([...taskIds].sort());

    const noteIds = recordsA
      .filter((r) => r.recordType === "note")
      .map((r) => r.recordId);
    expect(noteIds).toEqual([...noteIds].sort());
  });

  it("returns empty array when source returns no records", async () => {
    const records = await enumerateLabWork({
      owner: "alice",
      source: fakeSource(),
    });
    expect(records).toEqual([]);
  });

  it("LAB_WORK_TYPES array contains all fourteen expected types in order", () => {
    expect(LAB_WORK_TYPES).toEqual([
      "task",
      "experiment",
      "note",
      "method",
      "purchase",
      "inventory",
      "inventory_stock",
      "sequence",
      "phylo",
      "molecule",
      "datahub",
      "result_sheet",
      "notes_sheet",
      "deposit",
    ]);
  });

  it("maps deposits to recordType 'deposit'", async () => {
    const source = fakeSource({
      listDeposits: async () => [
        { id: 1, task_id: 42, repository: "zenodo", doi: null },
      ],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    expect(records).toHaveLength(1);
    expect(records[0].recordType).toBe("deposit");
    expect(records[0].recordId).toBe("1");
  });

  it("'deposit' appears after 'notes_sheet' in output order (appended last)", async () => {
    const source = fakeSource({
      listNotesSheets: async () => [{ id: "ns1", sheet: "notes", markdown: "" }],
      listDeposits: async () => [{ id: 1, repository: "zenodo" }],
    });

    const records = await enumerateLabWork({ owner: "alice", source });
    const types = records.map((r) => r.recordType);

    const nsIdx = types.indexOf("notes_sheet");
    const depIdx = types.indexOf("deposit");

    expect(nsIdx).toBeLessThan(depIdx);
  });

  it("maps inventory items to recordType 'inventory'", async () => {
    const source = fakeSource({
      listInventory: async () => [{ id: 1, name: "Taq polymerase" }],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    expect(records).toHaveLength(1);
    expect(records[0].recordType).toBe("inventory");
    expect(records[0].recordId).toBe("1");
  });

  it("maps inventory stocks to recordType 'inventory_stock'", async () => {
    const source = fakeSource({
      listInventoryStock: async () => [{ id: 2, item_id: 1, quantity: 5 }],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    expect(records).toHaveLength(1);
    expect(records[0].recordType).toBe("inventory_stock");
    expect(records[0].recordId).toBe("2");
  });

  it("maps sequences to recordType 'sequence'", async () => {
    const source = fakeSource({
      listSequences: async () => [{ id: 10, display_name: "pUC19" }],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    expect(records).toHaveLength(1);
    expect(records[0].recordType).toBe("sequence");
    expect(records[0].recordId).toBe("10");
  });

  it("maps phylo trees to recordType 'phylo'", async () => {
    const source = fakeSource({
      listPhylo: async () => [{ id: "phylo-abc", name: "My tree" }],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    expect(records).toHaveLength(1);
    expect(records[0].recordType).toBe("phylo");
    expect(records[0].recordId).toBe("phylo-abc");
  });

  it("maps molecules to recordType 'molecule'", async () => {
    const source = fakeSource({
      listMolecules: async () => [{ id: "mol-xyz", name: "Caffeine" }],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    expect(records).toHaveLength(1);
    expect(records[0].recordType).toBe("molecule");
    expect(records[0].recordId).toBe("mol-xyz");
  });

  it("maps datahub documents to recordType 'datahub'", async () => {
    const source = fakeSource({
      listDatahub: async () => [
        { id: "dh-001", meta: { id: "dh-001", name: "Results" }, columns: [], rows: [] },
      ],
    });

    const records = await enumerateLabWork({ owner: "alice", source });

    expect(records).toHaveLength(1);
    expect(records[0].recordType).toBe("datahub");
    expect(records[0].recordId).toBe("dh-001");
  });

  it("new types appear after original five in output order", async () => {
    const source = fakeSource({
      listTasks: async () => [{ id: "t1", task_type: "task" }],
      listInventory: async () => [{ id: 1, name: "item" }],
      listSequences: async () => [{ id: 9, display_name: "seq" }],
      listDatahub: async () => [{ id: "dh-1", meta: { id: "dh-1" } }],
    });

    const records = await enumerateLabWork({ owner: "alice", source });
    const types = records.map((r) => r.recordType);

    const taskIdx = types.indexOf("task");
    const invIdx = types.indexOf("inventory");
    const seqIdx = types.indexOf("sequence");
    const dhIdx = types.indexOf("datahub");

    expect(taskIdx).toBeLessThan(invIdx);
    expect(invIdx).toBeLessThan(seqIdx);
    expect(seqIdx).toBeLessThan(dhIdx);
  });
});

// ---------------------------------------------------------------------------
// 2a round-trip test: enumerateLabWork -> syncLabWorkToMirror.
//
// Uses the REAL syncLabWorkToMirror and REAL labDataObjectKey. A putImpl mock
// replaces the network call so no flag or relay is needed.
// ---------------------------------------------------------------------------

describe("2a round-trip (enumerateLabWork -> syncLabWorkToMirror)", () => {
  it("each enumerated record produces one push with the correct labDataObjectKey", async () => {
    const LAB_ID = "lab-test-42";
    const OWNER = "bob";

    const source = fakeSource({
      listTasks: async () => [
        { id: "t1", title: "Task one", task_type: "task" },
        { id: "e1", title: "Exp one", task_type: "experiment" },
      ],
      listNotes: async () => [{ id: "n1", content: "Note one" }],
      listMethods: async () => [{ id: "m1", name: "PCR" }],
      listPurchases: async () => [{ id: "p1", vendor: "Sigma" }],
    });

    // Enumerate first.
    const labWorkRecords = await enumerateLabWork({ owner: OWNER, source });

    // Five records: 1 task + 1 experiment + 1 note + 1 method + 1 purchase.
    expect(labWorkRecords).toHaveLength(5);

    // Collect put calls via mock.
    const putCalls: Array<{
      labId: string;
      owner: string;
      recordType: string;
      recordId: string;
    }> = [];

    const putImpl = vi.fn(
      async (args: {
        labId: string;
        owner: string;
        recordType: string;
        recordId: string;
        plaintext: Uint8Array;
        labKey: Uint8Array;
        signerEd25519Priv: Uint8Array;
        signerEd25519Pub: Uint8Array;
        fetchImpl?: typeof fetch;
      }) => {
        putCalls.push({
          labId: args.labId,
          owner: args.owner,
          recordType: args.recordType,
          recordId: args.recordId,
        });
      },
    );

    // Feed enumerated records into the real syncLabWorkToMirror.
    const result = await syncLabWorkToMirror({
      labId: LAB_ID,
      owner: OWNER,
      records: labWorkRecords,
      labKey: FAKE_LAB_KEY,
      signerEd25519Priv: FAKE_PRIV,
      signerEd25519Pub: FAKE_PUB,
      manifest: {},
      putImpl,
    });

    // Every record should have been pushed (manifest was empty).
    expect(result.pushed).toHaveLength(5);
    expect(result.skipped).toHaveLength(0);

    // putImpl called once per record.
    expect(putImpl).toHaveBeenCalledTimes(5);

    // Each pushed object key matches labDataObjectKey(labId, owner, recordType, recordId).
    for (const call of putCalls) {
      const expectedKey = labDataObjectKey(
        call.labId,
        call.owner,
        call.recordType,
        call.recordId,
      );
      expect(result.pushed).toContain(expectedKey);
    }

    // Verify the specific keys for each record type.
    expect(result.pushed).toContain(
      labDataObjectKey(LAB_ID, OWNER, "task", "t1"),
    );
    expect(result.pushed).toContain(
      labDataObjectKey(LAB_ID, OWNER, "experiment", "e1"),
    );
    expect(result.pushed).toContain(
      labDataObjectKey(LAB_ID, OWNER, "note", "n1"),
    );
    expect(result.pushed).toContain(
      labDataObjectKey(LAB_ID, OWNER, "method", "m1"),
    );
    expect(result.pushed).toContain(
      labDataObjectKey(LAB_ID, OWNER, "purchase", "p1"),
    );
  });

  it("second sync run with unchanged records skips all (deduplication via canonicalRecordBytes)", async () => {
    const LAB_ID = "lab-dedup-99";
    const OWNER = "carol";

    const source = fakeSource({
      listNotes: async () => [
        { id: "n1", content: "Stable note", z: 1, a: "alpha" },
      ],
    });

    const labWorkRecords = await enumerateLabWork({ owner: OWNER, source });

    const putImpl = vi.fn(async () => {});

    // First sync: pushes 1 record.
    const result1 = await syncLabWorkToMirror({
      labId: LAB_ID,
      owner: OWNER,
      records: labWorkRecords,
      labKey: FAKE_LAB_KEY,
      signerEd25519Priv: FAKE_PRIV,
      signerEd25519Pub: FAKE_PUB,
      manifest: {},
      putImpl,
    });

    expect(result1.pushed).toHaveLength(1);

    // Re-enumerate (same source, same data, same bytes due to canonicalRecordBytes).
    const labWorkRecords2 = await enumerateLabWork({ owner: OWNER, source });

    // Second sync: supplies the manifest from first run.
    const result2 = await syncLabWorkToMirror({
      labId: LAB_ID,
      owner: OWNER,
      records: labWorkRecords2,
      labKey: FAKE_LAB_KEY,
      signerEd25519Priv: FAKE_PRIV,
      signerEd25519Pub: FAKE_PUB,
      manifest: result1.manifest,
      putImpl,
    });

    // Nothing pushed on the second run; all skipped.
    expect(result2.pushed).toHaveLength(0);
    expect(result2.skipped).toHaveLength(1);
  });
});
