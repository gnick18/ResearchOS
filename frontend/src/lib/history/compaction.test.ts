// Version Control Phase 0: the 10-test compaction battery from
// docs/proposals/VERSION_CONTROL_R4_PREP.md section 2i. Tests 1/2/6 verify the
// single-boundary invariant (2f); 3-5 verify revert; 7-10 are the corner cases.

import { describe, expect, it } from "vitest";
import { applyDelta } from "./diff";
import {
  COMPACTION_THRESHOLD,
  HistoryCompactedTargetError,
  RECENT_WINDOW,
  HistoryEngine,
} from "./engine";
import {
  ENTITY,
  ID,
  OWNER,
  makeClock,
  makeEngine,
  pathFor,
  readRows,
  seedHistory,
  MemoryStorage,
} from "./test-utils";
import { rowsToJsonl } from "./storage";
import {
  isBoundarySnapshotRow,
  type BoundarySnapshotRow,
  type DeltaRow,
  type HistoryRow,
} from "./types";

/** Forward-walk a post-compaction file: anchor (boundary or genesis_state)
 *  then apply each subsequent delta. Returns the HEAD canonical. */
function walkForward(rows: HistoryRow[]): string {
  let state: string;
  const anchor = rows[0];
  if (isBoundarySnapshotRow(anchor)) {
    state = anchor.state;
  } else {
    throw new Error("walkForward expects a boundary-anchored file");
  }
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as DeltaRow;
    const next = applyDelta(state, row.delta);
    if (next === null) throw new Error(`corrupt delta at row ${i}`);
    state = next;
  }
  return state;
}

describe("Compaction battery (R4-prep 2i)", () => {
  // Test 1: 501-row file triggers compaction.
  it("1. crossing the threshold compacts to 1 boundary + RECENT_WINDOW rows", async () => {
    const { engine, storage } = makeEngine();
    // Seed exactly COMPACTION_THRESHOLD rows (genesis + threshold-1 deltas).
    // The genesis counts as a row, so seed THRESHOLD total rows then trigger
    // one more save via appendEdit to cross to THRESHOLD+1.
    await seedHistory(storage, COMPACTION_THRESHOLD - 1, {
      withGenesisState: true,
    });
    const before = readRows(storage);
    expect(before).toHaveLength(COMPACTION_THRESHOLD);

    // One more real edit pushes the file to THRESHOLD+1, tripping compaction.
    const headBefore = walkAnyAnchor(before);
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: JSON.parse(stripTrailingNewlineToObject(headBefore)),
      nextState: { id: ID, n: COMPACTION_THRESHOLD, marker: "head" },
    });

    const after = readRows(storage);
    expect(after).toHaveLength(RECENT_WINDOW + 1);
    expect(isBoundarySnapshotRow(after[0])).toBe(true);
    const boundary = after[0] as BoundarySnapshotRow;
    expect(boundary.state.length).toBeGreaterThan(0);
    expect(boundary.actor).toBe("compaction");
    // The last RECENT_WINDOW rows are the most-recent deltas verbatim.
    const tail = after.slice(1);
    expect(tail).toHaveLength(RECENT_WINDOW);
    expect(tail.every((r) => r.kind === "update")).toBe(true);
  });

  // Test 2: round-trip forward-walk from boundary matches pre-compaction HEAD.
  it("2. forward-walk from the boundary reproduces HEAD", async () => {
    const { engine, storage } = makeEngine();
    await seedHistory(storage, COMPACTION_THRESHOLD - 1, {
      withGenesisState: true,
    });
    const before = readRows(storage);
    const headBefore = walkAnyAnchor(before);

    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: JSON.parse(stripTrailingNewlineToObject(headBefore)),
      nextState: { id: ID, n: 999, marker: "final" },
    });

    const after = readRows(storage);
    const reconstructedHead = walkForward(after);
    // Engine reconstructState at the last row must equal the forward walk.
    const viaEngine = await engine.reconstructState(
      ENTITY,
      OWNER,
      ID,
      after.length - 1,
    );
    expect(reconstructedHead).toEqual(viaEngine);
    // And the boundary's stored state_hash must verify.
    const boundary = after[0] as BoundarySnapshotRow;
    const { sha256Hex } = await import("./hash");
    expect(await sha256Hex(boundary.state)).toEqual(boundary.state_hash);
  });

  // Test 3: reverse-walk for revert, target inside the recent window.
  it("3. reverse-walk to a target inside the recent window (no boundary touch)", async () => {
    const { engine, storage } = makeEngine();
    const seeded = await seedHistory(storage, COMPACTION_THRESHOLD - 1, {
      withGenesisState: true,
    });
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: JSON.parse(
        stripTrailingNewlineToObject(seeded.headCanonical),
      ),
      nextState: { id: ID, n: 1000 },
    });
    const after = readRows(storage);
    const head = walkForward(after);
    // Target a row well inside the verbatim tail (not the boundary at 0).
    const target = after.length - 10;
    const result = engine.reverseWalkTo(after, target, head);
    // Forward-walk to the same target via reconstructState must agree.
    const viaForward = await engine.reconstructState(ENTITY, OWNER, ID, target);
    expect(result).toEqual(viaForward);
  });

  // Test 4: reverse-walk for revert, target = the boundary row.
  it("4. reverse-walk to the boundary returns boundary.state directly", async () => {
    const { engine, storage } = makeEngine();
    const seeded = await seedHistory(storage, COMPACTION_THRESHOLD - 1, {
      withGenesisState: true,
    });
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: JSON.parse(
        stripTrailingNewlineToObject(seeded.headCanonical),
      ),
      nextState: { id: ID, n: 2000 },
    });
    const after = readRows(storage);
    const head = walkForward(after);
    const boundary = after[0] as BoundarySnapshotRow;
    const result = engine.reverseWalkTo(after, 0, head);
    expect(result).toEqual(boundary.state);
  });

  // Test 5: reverse-walk for revert, target BEFORE the boundary (folded away).
  it("5. reverting to a folded row raises HistoryCompactedTargetError", async () => {
    // Build a file whose row 0 is a boundary and whose tail has deltas. Then
    // ask the walker to reverse past the boundary: impossible. We simulate the
    // stale request by handing the walker a synthetic targetVersion that points
    // INTO the tail but with a boundary sitting ABOVE it in the walk. Concretely
    // R4-prep Case C: the row no longer exists, so any targetVersion <
    // boundary-index is the boundary itself (index 0). To exercise the throw we
    // craft a file with a boundary at a NON-zero index (a malformed/stale shape)
    // so the reverse-walk encounters it mid-walk.
    const { engine } = makeEngine();
    const boundary: BoundarySnapshotRow = {
      id: "b0",
      ts: "2026-01-01T00:00:00.000Z",
      v: 1,
      actor: "compaction",
      owner: OWNER,
      kind: "boundary_snapshot",
      state: '{"id":47,"n":1}\n',
      state_hash: "deadbeef",
      compacted_row_count: 401,
      compacted_range: {
        from_id: "g0",
        to_id: "r400",
        from_ts: "2026-01-01T00:00:00.000Z",
        to_ts: "2026-01-01T00:06:40.000Z",
      },
    };
    // A delta row AFTER the boundary, then a HEAD. Target index 0 would be the
    // boundary (Case B). To hit Case C we target index -? not allowed. Instead
    // place a delta at index 1 and a boundary at index 1 is impossible; the
    // throw fires when the walk going from HEAD downward CROSSES a boundary that
    // sits ABOVE the target. Construct: [delta, boundary, delta] and target 0.
    const d0: DeltaRow = {
      id: "d0",
      ts: "2026-01-01T00:00:01.000Z",
      v: 1,
      actor: "mira",
      owner: OWNER,
      kind: "update",
      delta: "",
      post_hash: "x",
    };
    const d2: DeltaRow = {
      id: "d2",
      ts: "2026-01-01T00:00:03.000Z",
      v: 1,
      actor: "mira",
      owner: OWNER,
      kind: "update",
      delta: "",
      post_hash: "x",
    };
    const rows: HistoryRow[] = [d0, boundary, d2];
    // Target index 0 (d0), HEAD = some canonical. The walk from index 2 down to
    // index 1 hits the boundary at index 1 and must throw Case C.
    expect(() => engine.reverseWalkTo(rows, 0, '{"id":47}\n')).toThrow(
      HistoryCompactedTargetError,
    );
  });

  // Test 6: 1001-row file triggers a SECOND compaction; still one boundary.
  it("6. a second compaction keeps exactly one boundary and folds the old one", async () => {
    const { engine, storage } = makeEngine();
    // First compaction.
    const seeded = await seedHistory(storage, COMPACTION_THRESHOLD - 1, {
      withGenesisState: true,
    });
    let head: Record<string, unknown> = JSON.parse(
      stripTrailingNewlineToObject(seeded.headCanonical),
    );
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: head,
      nextState: { ...head, n: 600 },
    });
    head = { ...head, n: 600 };
    let rows = readRows(storage);
    expect(rows.filter(isBoundarySnapshotRow)).toHaveLength(1);
    const firstBoundary = rows.find(isBoundarySnapshotRow) as BoundarySnapshotRow;

    // Append enough edits to cross the threshold again. After the first
    // compaction the file has RECENT_WINDOW+1 rows; we need to add until it
    // exceeds COMPACTION_THRESHOLD again.
    const need = COMPACTION_THRESHOLD - rows.length + 1;
    for (let i = 0; i < need; i++) {
      const next = { ...head, n: 1000 + i };
      await engine.appendEdit({
        type: "update",
        entityType: ENTITY,
        id: ID,
        owner: OWNER,
        actor: "mira",
        prevState: head,
        nextState: next,
      });
      head = next;
    }

    rows = readRows(storage);
    // Still exactly one boundary, file back down to RECENT_WINDOW+1.
    expect(rows.filter(isBoundarySnapshotRow)).toHaveLength(1);
    expect(rows).toHaveLength(RECENT_WINDOW + 1);
    const secondBoundary = rows.find(isBoundarySnapshotRow) as BoundarySnapshotRow;
    // The old boundary's exact id is gone (folded forward into the new one).
    expect(secondBoundary.id).not.toEqual(firstBoundary.id);
    // Round-trip still holds: forward-walk reproduces HEAD.
    const reconstructed = walkForward(rows);
    const viaEngine = await engine.reconstructState(
      ENTITY,
      OWNER,
      ID,
      rows.length - 1,
    );
    expect(reconstructed).toEqual(viaEngine);
  });

  // Test 7: genesis-anchored compaction backfill (bare genesis, no state).
  it("7. compaction backfills the genesis anchor by reverse-walk", async () => {
    const { engine, storage } = makeEngine();
    // Bare genesis (no genesis_state) so compaction must reconstruct the anchor.
    const seeded = await seedHistory(storage, COMPACTION_THRESHOLD - 1, {
      withGenesisState: false,
    });
    const head = JSON.parse(stripTrailingNewlineToObject(seeded.headCanonical));
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: head,
      nextState: { ...head, n: 777 },
    });
    const after = readRows(storage);
    expect(after).toHaveLength(RECENT_WINDOW + 1);
    expect(isBoundarySnapshotRow(after[0])).toBe(true);
    // The boundary must round-trip to HEAD even though genesis had no state.
    const reconstructed = walkForward(after);
    const viaEngine = await engine.reconstructState(
      ENTITY,
      OWNER,
      ID,
      after.length - 1,
    );
    expect(reconstructed).toEqual(viaEngine);
  });

  // Test 8: atomic write under simulated crash. Original file stays intact.
  it("8. a crash between tmp-write and rename leaves the original file intact", async () => {
    const clock = makeClock();
    // A storage double whose rewrite() throws (simulating a crash mid-rename).
    const storage = new MemoryStorage();
    await seedHistory(storage, COMPACTION_THRESHOLD - 1, {
      withGenesisState: true,
    });
    const seeded = readRows(storage);
    const headCanonical = walkAnyAnchor(seeded);
    const originalRaw = storage.files.get(pathFor())!;

    const crashingStorage: typeof storage = Object.assign(
      Object.create(Object.getPrototypeOf(storage)),
      storage,
    );
    crashingStorage.files = storage.files;
    let rewriteCalls = 0;
    crashingStorage.rewrite = async () => {
      rewriteCalls++;
      throw new Error("simulated crash before rename");
    };

    const engine = new HistoryEngine({ storage: crashingStorage, clock });
    const head = JSON.parse(stripTrailingNewlineToObject(headCanonical));
    // appendEdit appends (succeeds), then compaction's rewrite throws. The
    // append itself is durable; the compaction rewrite never lands. We assert
    // the file still parses and the compaction did not partially apply.
    await expect(
      engine.appendEdit({
        type: "update",
        entityType: ENTITY,
        id: ID,
        owner: OWNER,
        actor: "mira",
        prevState: head,
        nextState: { ...head, n: 888 },
      }),
    ).rejects.toThrow("simulated crash");
    expect(rewriteCalls).toBe(1);

    // The file is the original 500 rows + the one appended delta (501), NOT a
    // half-written compaction. Re-running compaction on a non-crashing engine
    // succeeds and lands the boundary.
    const afterCrash = readRows(crashingStorage);
    expect(afterCrash.length).toBe(COMPACTION_THRESHOLD + 1);
    expect(afterCrash.filter(isBoundarySnapshotRow)).toHaveLength(0);
    // Sanity: the original prefix is still present byte-for-byte.
    expect(storage.files.get(pathFor())!.startsWith(originalRaw.trimEnd())).toBe(
      true,
    );

    // Recovery: a healthy engine re-runs compaction and succeeds.
    const healthy = new HistoryEngine({ storage, clock: makeClock() });
    await healthy.compact(ENTITY, OWNER, ID);
    const recovered = readRows(storage);
    expect(recovered).toHaveLength(RECENT_WINDOW + 1);
    expect(isBoundarySnapshotRow(recovered[0])).toBe(true);
  });

  // Test 9: concurrent appends across compaction stay consistent.
  it("9. an append landing right after compaction yields a consistent file", async () => {
    const { engine, storage } = makeEngine();
    const seeded = await seedHistory(storage, COMPACTION_THRESHOLD - 1, {
      withGenesisState: true,
    });
    let head: Record<string, unknown> = JSON.parse(
      stripTrailingNewlineToObject(seeded.headCanonical),
    );
    // Tab A's save triggers compaction.
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: head,
      nextState: { ...head, n: 600 },
    });
    head = { ...head, n: 600 };
    const afterCompact = readRows(storage);
    expect(afterCompact).toHaveLength(RECENT_WINDOW + 1);

    // Tab B's save lands on the freshly compacted file: a plain append (no new
    // compaction since we are well under the threshold). File grows by one.
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "alex",
      prevState: head,
      nextState: { ...head, n: 601 },
    });
    const afterB = readRows(storage);
    expect(afterB).toHaveLength(RECENT_WINDOW + 2);
    expect(afterB.filter(isBoundarySnapshotRow)).toHaveLength(1);
    // The file still reconstructs to the latest HEAD.
    const reconstructed = walkForward(afterB);
    const viaEngine = await engine.reconstructState(
      ENTITY,
      OWNER,
      ID,
      afterB.length - 1,
    );
    expect(reconstructed).toEqual(viaEngine);
  });

  // Test 10: corrupt delta aborts compaction cleanly, file untouched.
  it("10. a corrupt delta aborts compaction and leaves the file untouched", async () => {
    const { engine, storage } = makeEngine();
    await seedHistory(storage, COMPACTION_THRESHOLD, { withGenesisState: true });
    // Corrupt one delta INSIDE the fold window (not in the recent tail). Row 5
    // is comfortably inside [0, N - RECENT_WINDOW).
    const rows = readRows(storage);
    (rows[5] as DeltaRow).delta = "@@ this is not a valid unified diff @@";
    storage.files.set(pathFor(), rowsToJsonl(rows));
    const before = storage.files.get(pathFor());
    expect(rows.length).toBeGreaterThan(COMPACTION_THRESHOLD);

    await engine.compact(ENTITY, OWNER, ID);

    // File untouched: same bytes, no boundary written.
    const after = storage.files.get(pathFor());
    expect(after).toEqual(before);
    expect(readRows(storage).filter(isBoundarySnapshotRow)).toHaveLength(0);
  });
});

// ── Local helpers ───────────────────────────────────────────────────────────

/** Forward-walk a file whose anchor is either a backfilled genesis or a
 *  boundary (used to derive HEAD before triggering a real edit). */
function walkAnyAnchor(rows: HistoryRow[]): string {
  let state: string;
  const anchor = rows[0];
  if (isBoundarySnapshotRow(anchor)) {
    state = anchor.state;
  } else if (anchor.kind === "genesis") {
    // seedHistory with withGenesisState anchors at the empty doc.
    state = (anchor as { genesis_state?: string }).genesis_state ?? '{}\n';
  } else {
    throw new Error("unexpected anchor");
  }
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind === "genesis" || isBoundarySnapshotRow(row)) continue;
    const next = applyDelta(state, (row as DeltaRow).delta);
    if (next === null) throw new Error(`corrupt delta at row ${i}`);
    state = next;
  }
  return state;
}

/** Canonical strings carry a trailing newline; strip it to JSON.parse. */
function stripTrailingNewlineToObject(canonical: string): string {
  return canonical.trimEnd();
}
