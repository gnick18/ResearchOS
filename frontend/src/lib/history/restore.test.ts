// VC Phase 2 (restore-a-version sub-bot of HR, 2026-05-30): engine-level
// round-trip tests for restore ("revert") + undo-restore ("undo-revert"), the
// canonicalize denylist for the undo-window sidecar (FLAG-2), and the Case-C
// folded-target throw. These are the data-mutating verification backbone.

import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonicalize";
import { HistoryCompactedTargetError } from "./engine";
import {
  ENTITY,
  ID,
  OWNER,
  makeEngine,
  readRows,
  seedHistory,
} from "./test-utils";
import { isDeltaRow } from "./types";
import type { BoundarySnapshotRow, DeltaRow, HistoryRow } from "./types";

// ── Restore round-trip ──────────────────────────────────────────────────────

describe("restore round-trip (kind 'revert')", () => {
  it("reverse-walks to a target then appends a 'revert' HEAD row carrying revert_target_version, and HEAD now reflects the target", async () => {
    const { storage, engine } = makeEngine();
    // Seed 8 edits (each sets n = 1..8). canonicals[k] is the state after delta k.
    const { canonicals, headCanonical } = await seedHistory(storage, 8, {
      withGenesisState: true,
    });
    const rows = readRows(storage);
    const target = 3; // restore back to the state where n === 3

    // Restore flow step 1-2: reverse-walk HEAD down to the target state.
    const targetCanonical = engine.reverseWalkTo(rows, target, headCanonical);
    expect(targetCanonical).toEqual(canonicals[target]);

    // Restore flow step 3-5: write the target state back as a NEW HEAD row,
    // stamped kind "revert" + the target version. prevState = current HEAD.
    await engine.appendEdit({
      type: "revert",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "alex",
      prevState: JSON.parse(headCanonical),
      nextState: JSON.parse(targetCanonical),
      revertTargetVersion: target,
    });

    const after = readRows(storage);
    const newHead = after[after.length - 1] as DeltaRow;
    expect(isDeltaRow(newHead)).toBe(true);
    expect(newHead.kind).toBe("revert");
    expect(newHead.revert_target_version).toBe(target);

    // The note now reflects the target state: reconstructing the new HEAD equals
    // the target canonical.
    const reconstructedHead = await engine.reconstructState(
      ENTITY,
      OWNER,
      ID,
      after.length - 1,
    );
    expect(reconstructedHead).toEqual(canonicals[target]);
  });
});

// ── Undo round-trip ─────────────────────────────────────────────────────────

describe("undo-restore round-trip (kind 'undo-revert')", () => {
  it("after a restore, undoing appends an 'undo-revert' row and HEAD returns to the pre-restore state", async () => {
    const { storage, engine } = makeEngine();
    const { canonicals, headCanonical } = await seedHistory(storage, 6, {
      withGenesisState: true,
    });
    const preRestoreVersion = readRows(storage).length - 1; // the live HEAD
    const preRestoreCanonical = headCanonical;
    const target = 2;

    // Restore to version 2.
    const rows1 = readRows(storage);
    const targetCanonical = engine.reverseWalkTo(rows1, target, headCanonical);
    await engine.appendEdit({
      type: "revert",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "alex",
      prevState: JSON.parse(headCanonical),
      nextState: JSON.parse(targetCanonical),
      revertTargetVersion: target,
    });

    // Undo: reverse-walk to from_version (the pre-restore HEAD) + write it back.
    const rows2 = readRows(storage);
    const newHeadCanonical = await engine.reconstructState(
      ENTITY,
      OWNER,
      ID,
      rows2.length - 1,
    );
    const undoTargetCanonical = engine.reverseWalkTo(
      rows2,
      preRestoreVersion,
      newHeadCanonical,
    );
    expect(undoTargetCanonical).toEqual(preRestoreCanonical);

    await engine.appendEdit({
      type: "undo-revert",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "alex",
      prevState: JSON.parse(targetCanonical),
      nextState: JSON.parse(undoTargetCanonical),
      revertTargetVersion: preRestoreVersion,
    });

    const after = readRows(storage);
    const undoRow = after[after.length - 1] as DeltaRow;
    expect(undoRow.kind).toBe("undo-revert");
    expect(undoRow.revert_target_version).toBe(preRestoreVersion);

    // HEAD is back to the pre-restore state (= the original n=6 head).
    const reconstructed = await engine.reconstructState(
      ENTITY,
      OWNER,
      ID,
      after.length - 1,
    );
    expect(reconstructed).toEqual(canonicals[canonicals.length - 1]);
    expect(reconstructed).toEqual(preRestoreCanonical);
  });
});

// ── FLAG-2: canonicalize ignores the undo-window sidecar ─────────────────────

describe("FLAG-2: canonicalize ignores revert_undo_window", () => {
  it("a record with revert_undo_window canonicalizes IDENTICALLY to one without it", () => {
    const base = { id: 47, title: "PCR run", n: 3 };
    const withWindow = {
      ...base,
      revert_undo_window: {
        from_version: 9,
        to_version: 3,
        reverted_at: "2026-05-30T12:00:00.000Z",
        expires_at: "2026-05-31T12:00:00.000Z",
        reverted_by: "alex",
      },
    };
    // The denylisted field must NOT appear in the canonical string at all.
    const canonicalWith = canonicalize(withWindow);
    const canonicalWithout = canonicalize(base);
    expect(canonicalWith).toEqual(canonicalWithout);
    expect(canonicalWith).not.toContain("revert_undo_window");
    expect(canonicalWith).not.toContain("expires_at");
  });

  it("setting the window produces an EMPTY-content delta (proves it never pollutes a row)", async () => {
    const { storage, engine } = makeEngine();
    // Two records differ ONLY by the undo-window sidecar.
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "alex",
      prevState: { id: ID, n: 1 },
      nextState: {
        id: ID,
        n: 1,
        revert_undo_window: {
          from_version: 5,
          to_version: 2,
          reverted_at: "2026-05-30T12:00:00.000Z",
          expires_at: "2026-05-31T12:00:00.000Z",
          reverted_by: "alex",
        },
      },
    });
    const rows = readRows(storage);
    const delta = (rows[1] as DeltaRow).delta;
    const changedLines = delta
      .split("\n")
      .filter(
        (l) =>
          (l.startsWith("+") || l.startsWith("-")) &&
          !l.startsWith("+++") &&
          !l.startsWith("---"),
      );
    expect(changedLines).toHaveLength(0);
  });
});

// ── Case C: reverse-walk onto a folded target throws (catchable) ─────────────

describe("Case C: reverseWalkTo a folded target", () => {
  it("throws HistoryCompactedTargetError when the walk crosses a boundary above the target", () => {
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
    // Target index 0 (d0); walking from HEAD (index 2) down hits the boundary at
    // index 1 -> Case C. The restore handler catches this exact error.
    let caught: unknown = null;
    try {
      engine.reverseWalkTo(rows, 0, '{"id":47}\n');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HistoryCompactedTargetError);
  });
});
