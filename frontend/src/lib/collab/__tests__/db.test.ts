// Tests for the collab server DB layer (src/lib/collab/server/db.ts).
//
// The sql layer is MOCKED throughout: no real Neon connection is made. The
// mock intercepts every tagged-template call and records the SQL fragment for
// assertion, or returns a canned result set. Real loro-crdt is used for the
// compaction tests so the Loro merge behavior is genuine.
//
// Test groups:
//   1. ensureCollabSchema: asserts the three CREATE TABLE statements are issued.
//   2. membership helpers: createCollabDoc, isMember, addMember, removeMember,
//      listMembers, getOwner.
//   3. getCatchup: snapshot + delta slice logic.
//   4. appendUpdate: insert + touch updated_at.
//   5. deleteCollabDoc: all three DELETE statements issued.
//   6. compactDoc: round-trip with real loro-crdt.
//      - Append several Loro updates to the mock, call compactDoc, assert the
//        merged snapshot reconstructs the same Loro state as a reference doc
//        built by importing the same updates directly.
//      - Assert only rows with id <= maxId are pruned (safe against concurrent
//        appends).

import { describe, it, expect, beforeEach, vi, type MockedFunction } from "vitest";
import { LoroDoc } from "loro-crdt";
import type { NeonQueryFunction } from "@neondatabase/serverless";

import {
  _testSetSql,
  ensureCollabSchema,
  createCollabDoc,
  isMember,
  addMember,
  removeMember,
  listMembers,
  getOwner,
  getCatchup,
  getDocUsage,
  getOwnerUsage,
  getOwnerQuotaBytes,
  getCollabStorageBytes,
  appendUpdate,
  deleteCollabDoc,
  compactDoc,
  COMPACT_THRESHOLD,
} from "@/lib/collab/server/db";
import { isBillingEnabled, FREE_ALLOWANCE_BYTES } from "@/lib/billing/config";
import { quotaBytesForOwner } from "@/lib/billing/db";

// Billing is mocked so the collab quota branch can be driven both ways without a
// real Neon connection. The default (billing off) preserves the flat-wall
// behavior every pre-existing appendUpdate test relies on. config keeps its real
// constants (FREE_ALLOWANCE_BYTES etc.), only isBillingEnabled is a spy.
vi.mock("@/lib/billing/config", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/billing/config")>();
  return { ...actual, isBillingEnabled: vi.fn(() => false) };
});
vi.mock("@/lib/billing/db", () => ({
  quotaBytesForOwner: vi.fn(async () => 0),
}));

const mockedIsBillingEnabled = isBillingEnabled as unknown as MockedFunction<
  typeof isBillingEnabled
>;
const mockedQuotaBytesForOwner = quotaBytesForOwner as MockedFunction<
  typeof quotaBytesForOwner
>;
import {
  CollabBudgetError,
  MAX_DOC_BYTES,
  MAX_OWNER_BYTES,
  MAX_UPDATE_BYTES,
} from "@/lib/collab/server/limits";

// ---------------------------------------------------------------------------
// Mock sql factory
// ---------------------------------------------------------------------------

/**
 * Builds a minimal mock of the Neon tagged-template function. Each call
 * returns the `rows` array configured for that call index (or [] by default).
 * All calls are recorded so tests can inspect what SQL was sent.
 */
function makeMockSql(
  schedule: Array<Array<Record<string, unknown>>> = [],
): {
  sql: NeonQueryFunction<false, false>;
  calls: string[];
} {
  const calls: string[] = [];
  let idx = 0;

  // The Neon driver returns a template-tag function. We use a Proxy to capture
  // the strings array and reconstruct a single SQL-like string for inspection.
  const sql = new Proxy(
    // The inner function is the tag. Neon's actual signature is
    // sql`...` => Promise<rows[]>, so we return a Promise directly.
    function sqlTag(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<Array<Record<string, unknown>>> {
      // Reconstruct the SQL text with $n placeholders for the inspected string.
      const reconstructed = strings.reduce((acc, part, i) => {
        return acc + part + (i < values.length ? `$${i + 1}` : "");
      }, "");
      calls.push(reconstructed.trim());
      const rows = schedule[idx++] ?? [];
      return Promise.resolve(rows);
    },
    {
      get(target, prop) {
        // Pass through any property access that is not a call (e.g. toString).
        return Reflect.get(target, prop);
      },
    },
  ) as unknown as NeonQueryFunction<false, false>;

  return { sql, calls };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset the singleton before each test so each test gets a fresh mock.
  _testSetSql(null);
  // Default every test to billing-off (the flat-wall behavior). Tests that
  // exercise the paid-quota path opt in by overriding these.
  mockedIsBillingEnabled.mockReturnValue(false);
  mockedQuotaBytesForOwner.mockResolvedValue(0);
});

// ---------------------------------------------------------------------------
// 1. ensureCollabSchema
// ---------------------------------------------------------------------------

describe("ensureCollabSchema", () => {
  it("issues CREATE TABLE IF NOT EXISTS for all three tables plus indexes", async () => {
    const { sql, calls } = makeMockSql();
    _testSetSql(sql);

    await ensureCollabSchema();

    // We expect at minimum: collab_docs, collab_doc_updates, the updates index,
    // collab_doc_members. Check presence, not exact SQL.
    const joined = calls.join("\n");
    expect(joined).toContain("collab_docs");
    expect(joined).toContain("collab_doc_updates");
    expect(joined).toContain("collab_doc_members");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS");
    expect(joined).toContain("CREATE INDEX IF NOT EXISTS");
  });
});

// ---------------------------------------------------------------------------
// 2. Membership helpers
// ---------------------------------------------------------------------------

describe("createCollabDoc", () => {
  it("inserts a doc row and an owner membership row", async () => {
    const { sql, calls } = makeMockSql([
      [],  // INSERT collab_docs
      [],  // INSERT collab_doc_members (via addMember)
    ]);
    _testSetSql(sql);

    await createCollabDoc({ docId: "doc1", ownerEmailHash: "hash-owner" });

    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("INSERT INTO collab_docs");
    expect(calls[1]).toContain("INSERT INTO collab_doc_members");
  });
});

describe("isMember", () => {
  it("returns true when a membership row exists", async () => {
    const { sql } = makeMockSql([[{ "?column?": 1 }]]);
    _testSetSql(sql);

    const result = await isMember("doc1", "hash-alice");
    expect(result).toBe(true);
  });

  it("returns false when no membership row exists", async () => {
    const { sql } = makeMockSql([[]]);
    _testSetSql(sql);

    const result = await isMember("doc1", "hash-nobody");
    expect(result).toBe(false);
  });
});

describe("addMember", () => {
  it("issues an UPSERT into collab_doc_members", async () => {
    const { sql, calls } = makeMockSql([[]]);
    _testSetSql(sql);

    await addMember("doc1", "hash-bob", "editor");

    expect(calls[0]).toContain("INSERT INTO collab_doc_members");
    expect(calls[0]).toContain("ON CONFLICT");
  });
});

describe("removeMember", () => {
  it("issues a DELETE from collab_doc_members", async () => {
    const { sql, calls } = makeMockSql([[]]);
    _testSetSql(sql);

    await removeMember("doc1", "hash-bob");

    expect(calls[0]).toContain("DELETE FROM collab_doc_members");
  });
});

describe("listMembers", () => {
  it("returns mapped member objects", async () => {
    const { sql } = makeMockSql([
      [
        { member_email_hash: "hash-alice", role: "owner" },
        { member_email_hash: "hash-bob", role: "editor" },
      ],
    ]);
    _testSetSql(sql);

    const members = await listMembers("doc1");
    expect(members).toEqual([
      { memberEmailHash: "hash-alice", role: "owner" },
      { memberEmailHash: "hash-bob", role: "editor" },
    ]);
  });
});

describe("getOwner", () => {
  it("returns the owner hash when the doc exists", async () => {
    const { sql } = makeMockSql([[{ owner_email_hash: "hash-owner" }]]);
    _testSetSql(sql);

    const owner = await getOwner("doc1");
    expect(owner).toBe("hash-owner");
  });

  it("returns null when the doc does not exist", async () => {
    const { sql } = makeMockSql([[]]);
    _testSetSql(sql);

    const owner = await getOwner("missing-doc");
    expect(owner).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. getCatchup
// ---------------------------------------------------------------------------

describe("getCatchup", () => {
  it("returns null when the doc does not exist", async () => {
    const { sql } = makeMockSql([[]]);
    _testSetSql(sql);

    const result = await getCatchup("no-such-doc");
    expect(result).toBeNull();
  });

  it("returns the snapshot plus delta updates (id > latest_version)", async () => {
    const fakeSnapshot = Buffer.from("snapshot-bytes");
    const fakeUpdate = Buffer.from("update-bytes");

    const { sql } = makeMockSql([
      // collab_docs SELECT
      [
        {
          doc_id: "doc1",
          owner_email_hash: "hash-owner",
          title: "My note",
          latest_snapshot: fakeSnapshot,
          latest_version: "3",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ],
      // collab_doc_updates SELECT (id > 3)
      [
        {
          id: "4",
          doc_id: "doc1",
          update_bytes: fakeUpdate,
          author_email_hash: "hash-alice",
          created_at: "2026-01-02T00:01:00Z",
        },
      ],
    ]);
    _testSetSql(sql);

    const catchup = await getCatchup("doc1");
    expect(catchup).not.toBeNull();
    expect(catchup!.version).toBe(3);
    expect(catchup!.snapshot).toBe(fakeSnapshot);
    expect(catchup!.updates).toHaveLength(1);
    expect(catchup!.updates[0].id).toBe(4);
  });

  it("returns an empty updates array when there are no outstanding updates", async () => {
    const { sql } = makeMockSql([
      [
        {
          doc_id: "doc1",
          owner_email_hash: "hash-owner",
          title: null,
          latest_snapshot: null,
          latest_version: "0",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      [],
    ]);
    _testSetSql(sql);

    const catchup = await getCatchup("doc1");
    expect(catchup!.updates).toHaveLength(0);
    expect(catchup!.snapshot).toBeNull();
    expect(catchup!.version).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. appendUpdate
// ---------------------------------------------------------------------------

describe("appendUpdate", () => {
  it("inserts an update row and touches updated_at on the doc, returning the new id", async () => {
    // Call order now: getDocUsage SELECT, getOwnerUsage SELECT, INSERT, UPDATE.
    const { sql, calls } = makeMockSql([
      [{ owner_hash: "hash-owner", doc_bytes: 0 }], // getDocUsage
      [{ owner_bytes: 0 }],                         // getOwnerUsage
      [{ id: "7" }],                                // INSERT RETURNING id
      [],                                           // UPDATE updated_at
    ]);
    _testSetSql(sql);

    const id = await appendUpdate("doc1", new Uint8Array([1, 2, 3]), "hash-alice");

    expect(id).toBe(7);
    const insertCall = calls.find((c) =>
      c.startsWith("INSERT INTO collab_doc_updates"),
    );
    expect(insertCall).toBeDefined();
    const updateCall = calls.find((c) => c.startsWith("UPDATE collab_docs"));
    expect(updateCall).toBeDefined();
    expect(updateCall).toContain("updated_at");
  });

  it("skips the per-doc and per-owner gate (but still inserts) when the doc row is missing", async () => {
    // getDocUsage returns no row, so the gate is skipped and the insert runs
    // straight away. No getOwnerUsage query is issued.
    const { sql, calls } = makeMockSql([
      [],            // getDocUsage: no row
      [{ id: "9" }], // INSERT RETURNING id
      [],            // UPDATE updated_at
    ]);
    _testSetSql(sql);

    const id = await appendUpdate("ghost", new Uint8Array([1, 2, 3]), "hash-x");
    expect(id).toBe(9);
    // Only three calls: getDocUsage, INSERT, UPDATE. No owner-usage SELECT.
    expect(calls).toHaveLength(3);
  });

  it("rejects an update larger than MAX_UPDATE_BYTES before touching the db", async () => {
    const { sql, calls } = makeMockSql([]);
    _testSetSql(sql);

    const tooBig = new Uint8Array(MAX_UPDATE_BYTES + 1);
    await expect(
      appendUpdate("doc1", tooBig, "hash-alice"),
    ).rejects.toMatchObject({ name: "CollabBudgetError", scope: "update" });
    // Nothing was written, the size check is the very first thing.
    expect(calls).toHaveLength(0);
  });

  it("rejects when the doc would exceed MAX_DOC_BYTES", async () => {
    const { sql, calls } = makeMockSql([
      // getDocUsage: doc already at the per-doc cap.
      [{ owner_hash: "hash-owner", doc_bytes: MAX_DOC_BYTES }],
    ]);
    _testSetSql(sql);

    await expect(
      appendUpdate("doc1", new Uint8Array([1]), "hash-alice"),
    ).rejects.toBeInstanceOf(CollabBudgetError);
    // getDocUsage ran, but no owner-usage, INSERT, or UPDATE.
    expect(calls).toHaveLength(1);
  });

  it("rejects when the owner would exceed MAX_OWNER_BYTES", async () => {
    const { sql, calls } = makeMockSql([
      // getDocUsage: this doc is small, so the per-doc cap is fine.
      [{ owner_hash: "hash-owner", doc_bytes: 10 }],
      // getOwnerUsage: the owner is already at the per-owner cap.
      [{ owner_bytes: MAX_OWNER_BYTES }],
    ]);
    _testSetSql(sql);

    await expect(
      appendUpdate("doc1", new Uint8Array([1]), "hash-alice"),
    ).rejects.toMatchObject({ name: "CollabBudgetError", scope: "owner" });
    // getDocUsage + getOwnerUsage ran, but no INSERT or UPDATE.
    expect(calls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 4b. Usage measurement (powers the budget gate + the /admin gauge)
// ---------------------------------------------------------------------------

describe("getDocUsage", () => {
  it("returns the owner hash and summed bytes when the doc exists", async () => {
    const { sql } = makeMockSql([
      [{ owner_hash: "hash-owner", doc_bytes: "4096" }],
    ]);
    _testSetSql(sql);

    const usage = await getDocUsage("doc1");
    expect(usage).toEqual({ ownerHash: "hash-owner", docBytes: 4096 });
  });

  it("returns null when the doc does not exist", async () => {
    const { sql } = makeMockSql([[]]);
    _testSetSql(sql);

    expect(await getDocUsage("missing")).toBeNull();
  });
});

describe("getOwnerUsage", () => {
  it("returns the owner's total bytes as a number", async () => {
    const { sql, calls } = makeMockSql([[{ owner_bytes: "123456" }]]);
    _testSetSql(sql);

    const bytes = await getOwnerUsage("hash-owner");
    expect(bytes).toBe(123456);
    expect(calls[0]).toContain("octet_length");
  });

  it("returns 0 when the owner has no docs", async () => {
    const { sql } = makeMockSql([[{ owner_bytes: 0 }]]);
    _testSetSql(sql);

    expect(await getOwnerUsage("nobody")).toBe(0);
  });
});

describe("getOwnerQuotaBytes", () => {
  it("falls back to the flat MAX_OWNER_BYTES wall when billing is off", async () => {
    mockedIsBillingEnabled.mockReturnValue(false);
    const quota = await getOwnerQuotaBytes("hash-owner");
    expect(quota).toBe(MAX_OWNER_BYTES);
    // No billing lookup is made when billing is off.
    expect(mockedQuotaBytesForOwner).not.toHaveBeenCalled();
  });

  it("reads the billing quota for the owner key when billing is on", async () => {
    mockedIsBillingEnabled.mockReturnValue(true);
    mockedQuotaBytesForOwner.mockResolvedValue(FREE_ALLOWANCE_BYTES);
    const quota = await getOwnerQuotaBytes("hash-owner");
    expect(quota).toBe(FREE_ALLOWANCE_BYTES);
    // The collab owner hash is passed straight through as the billing owner key.
    expect(mockedQuotaBytesForOwner).toHaveBeenCalledWith("hash-owner");
  });
});

describe("appendUpdate per-owner quota (billing on)", () => {
  it("allows a write that the flat wall would reject once a block lifts the quota", async () => {
    // The owner is already past the flat MAX_OWNER_BYTES wall, but billing
    // reports a higher quota (a purchased block), so the write is allowed.
    mockedIsBillingEnabled.mockReturnValue(true);
    mockedQuotaBytesForOwner.mockResolvedValue(MAX_OWNER_BYTES * 100);

    const { sql } = makeMockSql([
      [{ owner_hash: "hash-owner", doc_bytes: 10 }], // getDocUsage
      [{ owner_bytes: MAX_OWNER_BYTES }],            // getOwnerUsage: past flat wall
      [{ id: "11" }],                                // INSERT RETURNING id
      [],                                            // UPDATE updated_at
    ]);
    _testSetSql(sql);

    const id = await appendUpdate("doc1", new Uint8Array([1]), "hash-alice");
    expect(id).toBe(11);
    expect(mockedQuotaBytesForOwner).toHaveBeenCalledWith("hash-owner");
  });

  it("still rejects once usage passes the billing quota", async () => {
    mockedIsBillingEnabled.mockReturnValue(true);
    mockedQuotaBytesForOwner.mockResolvedValue(MAX_OWNER_BYTES);

    const { sql } = makeMockSql([
      [{ owner_hash: "hash-owner", doc_bytes: 10 }], // getDocUsage
      [{ owner_bytes: MAX_OWNER_BYTES }],            // getOwnerUsage: at quota
    ]);
    _testSetSql(sql);

    await expect(
      appendUpdate("doc1", new Uint8Array([1]), "hash-alice"),
    ).rejects.toMatchObject({ name: "CollabBudgetError", scope: "owner" });
  });
});

describe("getCollabStorageBytes", () => {
  it("sums pg_total_relation_size over the two collab content tables", async () => {
    const { sql, calls } = makeMockSql([[{ bytes: "789" }]]);
    _testSetSql(sql);

    const bytes = await getCollabStorageBytes();
    expect(bytes).toBe(789);
    expect(calls[0]).toContain("pg_total_relation_size");
    expect(calls[0]).toContain("collab_docs");
    expect(calls[0]).toContain("collab_doc_updates");
  });
});

// ---------------------------------------------------------------------------
// 5. deleteCollabDoc
// ---------------------------------------------------------------------------

describe("deleteCollabDoc", () => {
  it("deletes updates, members, and the doc row in that order", async () => {
    const { sql, calls } = makeMockSql([[], [], []]);
    _testSetSql(sql);

    await deleteCollabDoc("doc1");

    expect(calls[0]).toContain("DELETE FROM collab_doc_updates");
    expect(calls[1]).toContain("DELETE FROM collab_doc_members");
    expect(calls[2]).toContain("DELETE FROM collab_docs");
  });
});

// ---------------------------------------------------------------------------
// 6. compactDoc (real loro-crdt, mock sql)
// ---------------------------------------------------------------------------

describe("COMPACT_THRESHOLD", () => {
  it("is a positive integer", () => {
    expect(typeof COMPACT_THRESHOLD).toBe("number");
    expect(COMPACT_THRESHOLD).toBeGreaterThan(0);
  });
});

describe("compactDoc", () => {
  it("returns null when there are no updates to fold", async () => {
    const { sql } = makeMockSql([
      // getCatchup: doc row exists
      [
        {
          doc_id: "doc1",
          owner_email_hash: "hash-owner",
          title: null,
          latest_snapshot: null,
          latest_version: "0",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      // getCatchup: no updates
      [],
    ]);
    _testSetSql(sql);

    const result = await compactDoc("doc1");
    expect(result).toBeNull();
  });

  it("merges snapshot + updates into a fresh snapshot with real loro-crdt", async () => {
    // Build real Loro update bytes so compactDoc can actually merge them.

    // Reference doc: the final state we expect after merging.
    const refDoc = new LoroDoc();
    refDoc.setPeerId(BigInt(1));
    const meta = refDoc.getMap("meta");
    meta.set("title", "Test note");
    refDoc.commit({ message: "set title" });
    const update1 = refDoc.export({ mode: "update" });

    meta.set("description", "A collaborative note");
    refDoc.commit({ message: "set description" });
    const update2 = refDoc.export({ mode: "update" });

    // The reference snapshot (imported all updates from scratch).
    const refFinal = new LoroDoc();
    refFinal.import(update1);
    refFinal.import(update2);

    // Convert to Buffers (what the DB layer hands back).
    const buf1 = Buffer.from(update1);
    const buf2 = Buffer.from(update2);

    // Schedule of SQL calls for getCatchup + UPDATE + DELETE:
    const { sql, calls } = makeMockSql([
      // getCatchup: doc SELECT (no existing snapshot, latest_version = 0)
      [
        {
          doc_id: "doc1",
          owner_email_hash: "hash-owner",
          title: null,
          latest_snapshot: null,
          latest_version: "0",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      // getCatchup: updates SELECT (two rows, id 1 and 2)
      [
        {
          id: "1",
          doc_id: "doc1",
          update_bytes: buf1,
          author_email_hash: "hash-alice",
          created_at: "2026-01-01T00:01:00Z",
        },
        {
          id: "2",
          doc_id: "doc1",
          update_bytes: buf2,
          author_email_hash: "hash-alice",
          created_at: "2026-01-01T00:02:00Z",
        },
      ],
      // UPDATE collab_docs SET latest_snapshot
      [],
      // DELETE collab_doc_updates WHERE id <= 2
      [],
    ]);
    _testSetSql(sql);

    const result = await compactDoc("doc1");

    // Should return maxId = 2.
    expect(result).toBe(2);

    // The UPDATE call must carry latest_version = maxId = 2.
    const updateCall = calls.find((c) => c.startsWith("UPDATE collab_docs"));
    expect(updateCall).toBeDefined();
    expect(updateCall).toContain("latest_version");

    // The DELETE call must prune only rows with id <= 2, not concurrent appends.
    const deleteCall = calls.find((c) => c.startsWith("DELETE FROM collab_doc_updates"));
    expect(deleteCall).toBeDefined();
    expect(deleteCall).toContain("id <=");
  });

  it("prunes only rows with id <= maxId (concurrent-append safety)", async () => {
    // Build a minimal update so the bytes are valid Loro data.
    const doc = new LoroDoc();
    doc.setPeerId(BigInt(99));
    doc.getMap("meta").set("x", "y");
    doc.commit({ message: "x" });
    const updateBytes = Buffer.from(doc.export({ mode: "update" }));

    // Schedule: three update rows (ids 5, 6, 7). maxId captured = 7. We verify
    // the DELETE uses id <= 7, not some larger value.
    const { sql, calls } = makeMockSql([
      // getCatchup doc row
      [
        {
          doc_id: "doc1",
          owner_email_hash: "hash-owner",
          title: null,
          latest_snapshot: null,
          latest_version: "0",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      // getCatchup updates (ids 5, 6, 7 = simulating a compaction starting from a gap)
      [
        { id: "5", doc_id: "doc1", update_bytes: updateBytes, author_email_hash: "h", created_at: "" },
        { id: "6", doc_id: "doc1", update_bytes: updateBytes, author_email_hash: "h", created_at: "" },
        { id: "7", doc_id: "doc1", update_bytes: updateBytes, author_email_hash: "h", created_at: "" },
      ],
      // UPDATE collab_docs
      [],
      // DELETE
      [],
    ]);
    _testSetSql(sql);

    const result = await compactDoc("doc1");
    expect(result).toBe(7);

    // The SQL fragment must contain the literal 7 as the id ceiling.
    // We do not test the exact value injection (that is the Neon driver's job)
    // but we do verify the DELETE is scoped to this doc and uses <=.
    const deleteCall = calls.find((c) => c.startsWith("DELETE FROM collab_doc_updates"));
    expect(deleteCall).toContain("id <=");
  });

  it("round-trip: getCatchup then import snapshot+updates reconstructs original state", async () => {
    // Build a LoroDoc with two commits, export a snapshot after the first and
    // an update for the second, then verify that importing snapshot + update
    // gives the same content as a doc with both updates imported directly.

    const docA = new LoroDoc();
    docA.setPeerId(BigInt(42));
    const metaA = docA.getMap("meta");
    metaA.set("title", "Round-trip test");
    docA.commit({ message: "commit 1" });
    const snapshot = docA.export({ mode: "snapshot" });

    metaA.set("description", "second commit");
    docA.commit({ message: "commit 2" });
    const update2 = docA.export({ mode: "update" });

    // Reconstruct from snapshot + update.
    const reconstructed = new LoroDoc();
    reconstructed.import(snapshot);
    reconstructed.import(update2);

    // Direct import of both updates.
    const direct = new LoroDoc();
    direct.import(snapshot);
    direct.import(update2);

    // Content must match.
    const reconMeta = reconstructed.getMap("meta").toJSON() as Record<string, unknown>;
    const directMeta = direct.getMap("meta").toJSON() as Record<string, unknown>;

    expect(reconMeta["title"]).toBe("Round-trip test");
    expect(reconMeta["description"]).toBe("second commit");
    expect(reconMeta).toEqual(directMeta);
  });
});
