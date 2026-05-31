// Version Control Phase 0: core engine tests (genesis, reconstruct, revert
// reverse-walk). The 10-test compaction battery lives in compaction.test.ts.

import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonicalize";
import { applyDelta } from "./diff";
import {
  ENTITY,
  ID,
  OWNER,
  makeEngine,
  pathFor,
  readRows,
  seedHistory,
} from "./test-utils";
import { isDeltaRow, isGenesisRow } from "./types";

describe("HistoryEngine.appendEdit", () => {
  it("writes a genesis row then a delta on the first edit", async () => {
    const { engine, storage } = makeEngine();
    await engine.appendEdit({
      type: "create",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: null,
      nextState: { id: ID, title: "PCR run", n: 1 },
    });

    const rows = readRows(storage);
    expect(rows).toHaveLength(2);
    expect(isGenesisRow(rows[0])).toBe(true);
    expect(isDeltaRow(rows[1])).toBe(true);
    expect(rows[1].kind).toBe("create");
  });

  it("genesis-then-delta round-trips: reconstructState(1) == HEAD", async () => {
    const { engine } = makeEngine();
    const head = { id: ID, title: "PCR run", n: 1 };
    await engine.appendEdit({
      type: "create",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: null,
      nextState: head,
    });

    const reconstructed = await engine.reconstructState(ENTITY, OWNER, ID, 1);
    expect(reconstructed).toEqual(canonicalize(head));
  });

  it("does NOT write a second genesis on subsequent edits", async () => {
    const { engine, storage } = makeEngine();
    await engine.appendEdit({
      type: "create",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: null,
      nextState: { id: ID, n: 1 },
    });
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: { id: ID, n: 1 },
      nextState: { id: ID, n: 2 },
    });
    const rows = readRows(storage);
    expect(rows.filter(isGenesisRow)).toHaveLength(1);
    expect(rows).toHaveLength(3); // genesis + 2 deltas
  });

  it("stamps actor/owner on the row, not in the diff (volatile stamps excluded)", async () => {
    const { engine, storage } = makeEngine();
    // Two records that differ ONLY by a volatile stamp produce an EMPTY-content
    // diff: the canonical states are identical, so the delta has no +/- body.
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "alex",
      prevState: { id: ID, n: 1, updated_at: "t1", last_edited_by: "mira" },
      nextState: { id: ID, n: 1, updated_at: "t2", last_edited_by: "alex" },
    });
    const rows = readRows(storage);
    const delta = (rows[1] as { delta: string }).delta;
    // No content lines changed (only volatile stamps differed).
    const changedLines = delta
      .split("\n")
      .filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"));
    expect(changedLines).toHaveLength(0);
    // But the row records the actor from save context.
    expect(rows[1].actor).toBe("alex");
  });

  // vc-persona-fixes sub-bot of HR (2026-05-30): a SUBSEQUENT save whose tracked
  // (canonical) state did not move must NOT append a phantom delta row. This is
  // the root fix for the live-tested "one restore = TWO timeline rows" bug: a
  // restore wrote one real content row PLUS a content-less companion row that
  // rendered "No tracked content changed". An empty canonical delta now no-ops.
  it("does NOT append a row when the canonical state did not change", async () => {
    const { engine, storage } = makeEngine();
    // First real edit lays genesis + delta (2 rows).
    await engine.appendEdit({
      type: "create",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: null,
      nextState: { id: ID, n: 1 },
    });
    expect(readRows(storage)).toHaveLength(2);

    // A second save that changes ONLY a denylisted stamp (no tracked content
    // movement) appends NOTHING: prevCanonical === nextCanonical.
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "alex",
      prevState: { id: ID, n: 1, updated_at: "t1" },
      nextState: { id: ID, n: 1, updated_at: "t2" },
    });
    expect(readRows(storage)).toHaveLength(2); // unchanged: no phantom row.
  });

  it("one restore produces exactly ONE new row (content delta, no empty companion)", async () => {
    const { engine, storage } = makeEngine();
    // Build a small history: create -> update -> update (genesis + 3 deltas).
    await engine.appendEdit({
      type: "create",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: null,
      nextState: { id: ID, title: "v1" },
    });
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: { id: ID, title: "v1" },
      nextState: { id: ID, title: "v2" },
    });
    const beforeRestore = readRows(storage).length;

    // Restore writes the reverted content back as ONE "revert" delta. The
    // revert_undo_window rides along but is denylisted, so it produces no
    // content change of its own and must not mint a second row.
    await engine.appendEdit({
      type: "revert",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: { id: ID, title: "v2" },
      nextState: {
        id: ID,
        title: "v1",
        revert_undo_window: {
          from_version: 2,
          to_version: 1,
          reverted_at: "t",
          expires_at: "t2",
          reverted_by: "mira",
        },
      },
      revertTargetVersion: 1,
    });
    const after = readRows(storage);
    expect(after.length).toBe(beforeRestore + 1); // exactly ONE new row.
    expect(after[after.length - 1].kind).toBe("revert");
  });
});

describe("HistoryEngine.reconstructState", () => {
  it("reconstructState(N) == HEAD after N edits (genesis with backfill)", async () => {
    const { engine, storage } = makeEngine();
    const { canonicals } = await seedHistory(storage, 12, {
      withGenesisState: true,
    });
    const head = canonicals[canonicals.length - 1];
    const rows = readRows(storage);
    const reconstructed = await engine.reconstructState(
      ENTITY,
      OWNER,
      ID,
      rows.length - 1,
    );
    expect(reconstructed).toEqual(head);
  });

  it("reconstructState at an intermediate version matches the seeded state", async () => {
    const { engine, storage } = makeEngine();
    const { canonicals } = await seedHistory(storage, 10, {
      withGenesisState: true,
    });
    // canonicals[k] is the state AFTER delta k; rows[k] is delta k. So
    // reconstructState(k) should equal canonicals[k].
    const target = 4;
    const reconstructed = await engine.reconstructState(ENTITY, OWNER, ID, target);
    expect(reconstructed).toEqual(canonicals[target]);
  });

  it("reconstructState anchors a bare genesis via supplied HEAD canonical", async () => {
    const { engine, storage } = makeEngine();
    const { canonicals, headCanonical } = await seedHistory(storage, 8, {
      withGenesisState: false,
    });
    const rows = readRows(storage);
    const reconstructed = await engine.reconstructState(
      ENTITY,
      OWNER,
      ID,
      rows.length - 1,
      headCanonical,
    );
    expect(reconstructed).toEqual(canonicals[canonicals.length - 1]);
  });
});

describe("HistoryEngine.reverseWalkTo", () => {
  it("reverse-walks from HEAD to an intermediate target", async () => {
    const { storage, engine } = makeEngine();
    const { canonicals, headCanonical } = await seedHistory(storage, 10, {
      withGenesisState: true,
    });
    const rows = readRows(storage);
    const target = 6;
    const result = engine.reverseWalkTo(rows, target, headCanonical);
    expect(result).toEqual(canonicals[target]);
  });

  it("reverse-walk to genesis (index 0) yields the genesis anchor state", async () => {
    const { storage, engine } = makeEngine();
    const { canonicals, headCanonical } = await seedHistory(storage, 5, {
      withGenesisState: true,
    });
    const rows = readRows(storage);
    const result = engine.reverseWalkTo(rows, 0, headCanonical);
    // canonicals[0] is the genesis pre-image (empty doc).
    expect(result).toEqual(canonicals[0]);
  });

  it("reverse-walk result can be re-applied forward (delta is invertible)", async () => {
    const { storage } = makeEngine();
    const { rows, headCanonical } = await seedHistory(storage, 4, {
      withGenesisState: true,
    });
    // Reverse the last delta manually and re-apply it forward.
    const lastDelta = (rows[rows.length - 1] as { delta: string }).delta;
    const { applyReverseDelta } = await import("./diff");
    const prev = applyReverseDelta(headCanonical, lastDelta);
    expect(prev).not.toBeNull();
    const roundTrip = applyDelta(prev as string, lastDelta);
    expect(roundTrip).toEqual(headCanonical);
  });
});

describe("path resolution", () => {
  it("namespaces history under users/<owner>/_history/<type>/<id>.jsonl", () => {
    expect(pathFor("notes", "mira", 47)).toBe(
      "users/mira/_history/notes/47.jsonl",
    );
  });
});
