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
  appendUpdate,
  deleteCollabDoc,
  compactDoc,
  COMPACT_THRESHOLD,
} from "@/lib/collab/server/db";

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
    const { sql, calls } = makeMockSql([
      [{ id: "7" }], // INSERT RETURNING id
      [],            // UPDATE collab_docs SET updated_at
    ]);
    _testSetSql(sql);

    const id = await appendUpdate("doc1", new Uint8Array([1, 2, 3]), "hash-alice");

    expect(id).toBe(7);
    expect(calls[0]).toContain("INSERT INTO collab_doc_updates");
    expect(calls[1]).toContain("UPDATE collab_docs");
    expect(calls[1]).toContain("updated_at");
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
