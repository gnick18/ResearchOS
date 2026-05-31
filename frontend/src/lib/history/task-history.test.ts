// VC Phase 3 (VC-Phase3-Task sub-bot of HR, 2026-05-31): engine-level history
// tests for the Task / Experiment pilot. The engine is entity-agnostic, so these
// drive it through the "task" entity-type namespace and pin the per-entity
// contract the Task chip adds:
//   - record + read round-trip (a tracked save produces a reconstructable row),
//   - reconstruct a BARE-GENESIS task (existed before its first tracked save),
//   - restore ("revert") + the 24h undo ("undo-revert") round-trip,
//   - the Case-C HistoryCompactedTargetError on a folded target,
//   - the DERIVED `end_date` field does NOT appear in any delta (FLAG-derived-
//     cache: it is on the canonicalize denylist, so a save that only recomputes
//     end_date must produce an empty-content delta).
//
// Deterministic: in-memory storage + a fixed-epoch clock (test-utils).

import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonicalize";
import { HistoryCompactedTargetError } from "./engine";
import {
  makeEngine,
  readRows,
  type MemoryStorage,
} from "./test-utils";
import { historyFilePath } from "./storage";
import { isDeltaRow, isGenesisRow } from "./types";
import type { BoundarySnapshotRow, DeltaRow, GenesisRow, HistoryRow } from "./types";

// Task-scoped fixture identity. The Task entity-type token is "task" (the same
// token the engine already receives on the Task soft-delete path).
const ENTITY = "task";
const OWNER = "mira";
const ID = 42;

function pathForTask(owner = OWNER, id: string | number = ID): string {
  return historyFilePath(owner, ENTITY, id);
}

function readTaskRows(storage: MemoryStorage): HistoryRow[] {
  return readRows(storage, pathForTask());
}

// A minimal Task-like record: the tracked fields the canonical captures. We pass
// these straight through engine.appendEdit (it canonicalizes internally).
function task(fields: {
  name?: string;
  start_date?: string;
  duration_days?: number;
  end_date?: string;
  deviation_log?: string | null;
  is_complete?: boolean;
}): Record<string, unknown> {
  return {
    id: ID,
    name: fields.name ?? "PCR run",
    start_date: fields.start_date ?? "2026-05-01",
    duration_days: fields.duration_days ?? 1,
    // The DERIVED cache. Provided so the record looks like a real on-disk task;
    // the denylist must strip it from every delta.
    end_date: fields.end_date ?? "2026-05-01",
    deviation_log: fields.deviation_log ?? null,
    is_complete: fields.is_complete ?? false,
    owner: OWNER,
  };
}

// ── record + read round-trip ─────────────────────────────────────────────────

describe("task history record + read round-trip", () => {
  it("a tracked save appends a reconstructable row under the 'task' namespace", async () => {
    const { storage, engine } = makeEngine();
    // First tracked save of a fresh task: prevState is the empty doc so genesis
    // anchors at the empty pre-image and reconstructState resolves WITHOUT a
    // headCanonical (the engine-with-clean-anchor path).
    const after = task({ deviation_log: "day 1: seeded cells" });

    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: {},
      nextState: after,
    });

    const rows = readTaskRows(storage);
    // Genesis + one delta. The file lives at the task-namespace path.
    expect(storage.files.has(pathForTask())).toBe(true);
    expect(rows.length).toBe(2);
    expect(isGenesisRow(rows[0])).toBe(true);
    expect(isDeltaRow(rows[1])).toBe(true);

    // HEAD reconstructs to the post-edit canonical.
    const head = await engine.reconstructState(ENTITY, OWNER, ID, rows.length - 1);
    expect(head).toEqual(canonicalize(after));
  });
});

// ── reconstruct a bare-genesis task ──────────────────────────────────────────

describe("task bare-genesis reconstruction", () => {
  it("reconstructs every version when genesis anchors at a NON-empty pre-image (existing task, first tracked save)", async () => {
    const { storage, engine } = makeEngine();
    // The task as it existed on disk BEFORE the first tracked save (non-empty).
    const created = task({ name: "Western blot", deviation_log: null });
    const editedOnce = task({
      name: "Western blot",
      deviation_log: "Transfer at 100V for 1h",
    });
    const editedTwice = task({
      name: "Western blot (overnight)",
      deviation_log: "Transfer at 100V for 1h",
    });

    // First tracked save: prevState is the already-created non-empty record, so
    // genesis is anchored at a non-empty pre-image (bare genesis, no
    // genesis_state backfilled).
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: OWNER,
      prevState: created,
      nextState: editedOnce,
    });
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: OWNER,
      prevState: editedOnce,
      nextState: editedTwice,
    });

    const rows = readTaskRows(storage);
    // Genesis carries no backfilled state (the bare-genesis case).
    const genesis = rows[0] as GenesisRow;
    expect(isGenesisRow(genesis)).toBe(true);
    expect(genesis.genesis_state).toBeUndefined();

    // The viewer reconstructs from HEAD (canonicalize of the live record). HEAD
    // is editedTwice; reconstructing the first delta (version index 1) must
    // resolve the non-empty anchor and yield editedOnce, not "".
    const headCanonical = canonicalize(editedTwice);
    const v1 = engine.reverseWalkTo(rows, 1, headCanonical);
    expect(v1).toEqual(canonicalize(editedOnce));
    expect(v1).not.toBe("");
  });
});

// ── restore + 24h undo round-trip ────────────────────────────────────────────

describe("task restore + undo round-trip", () => {
  it("restores to a target ('revert'), then undoes ('undo-revert') back to the pre-restore HEAD", async () => {
    const { storage, engine } = makeEngine();
    // Build a small history: name v1 -> v2 -> v3.
    // First save from the EMPTY doc so genesis anchors at the empty pre-image
    // (reconstructState resolves without a headCanonical). Version indices then
    // are: 0 = genesis (empty), 1 = states[0] (v1), 2 = states[1], 3 = states[2].
    const states = [
      task({ name: "v1" }),
      task({ name: "v2" }),
      task({ name: "v3" }),
    ];
    let prev: Record<string, unknown> = {};
    for (let i = 0; i < states.length; i++) {
      await engine.appendEdit({
        type: "update",
        entityType: ENTITY,
        id: ID,
        owner: OWNER,
        actor: "mira",
        prevState: prev,
        nextState: states[i],
      });
      prev = states[i];
    }

    const rowsBefore = readTaskRows(storage);
    const preRestoreVersion = rowsBefore.length - 1; // live HEAD (= states[2])
    const headCanonical = canonicalize(states[states.length - 1]);
    const target = 1; // version index 1 = states[0] (v1)

    // Restore: reverse-walk to the target + append a "revert" HEAD row.
    const targetCanonical = engine.reverseWalkTo(rowsBefore, target, headCanonical);
    expect(targetCanonical).toEqual(canonicalize(states[0]));
    await engine.appendEdit({
      type: "revert",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: states[states.length - 1],
      nextState: JSON.parse(targetCanonical),
      revertTargetVersion: target,
    });

    const afterRestore = readTaskRows(storage);
    const revertRow = afterRestore[afterRestore.length - 1] as DeltaRow;
    expect(revertRow.kind).toBe("revert");
    expect(revertRow.revert_target_version).toBe(target);
    const restoredHead = await engine.reconstructState(
      ENTITY,
      OWNER,
      ID,
      afterRestore.length - 1,
    );
    expect(restoredHead).toEqual(canonicalize(states[0]));

    // Undo: reverse-walk back to the pre-restore version + append "undo-revert".
    const newHeadCanonical = restoredHead;
    const undoTargetCanonical = engine.reverseWalkTo(
      afterRestore,
      preRestoreVersion,
      newHeadCanonical,
    );
    expect(undoTargetCanonical).toEqual(headCanonical);
    await engine.appendEdit({
      type: "undo-revert",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: JSON.parse(targetCanonical),
      nextState: JSON.parse(undoTargetCanonical),
      revertTargetVersion: preRestoreVersion,
    });

    const afterUndo = readTaskRows(storage);
    const undoRow = afterUndo[afterUndo.length - 1] as DeltaRow;
    expect(undoRow.kind).toBe("undo-revert");
    const finalHead = await engine.reconstructState(
      ENTITY,
      OWNER,
      ID,
      afterUndo.length - 1,
    );
    expect(finalHead).toEqual(headCanonical);
  });

  it("stamps a 24h revert_undo_window on the restored record without polluting the delta (denylisted)", async () => {
    // The window is the FLAG-revert_undo_window sidecar: globally denylisted in
    // canonicalize, so a restored record carrying it canonicalizes identically
    // to one without it (no spurious delta line).
    const restored = task({ name: "v1" });
    const reverted_at = "2026-05-31T12:00:00.000Z";
    const expires_at = new Date(
      Date.parse(reverted_at) + 24 * 60 * 60 * 1000,
    ).toISOString();
    const withWindow = {
      ...restored,
      revert_undo_window: {
        from_version: 3,
        to_version: 1,
        reverted_at,
        expires_at,
        reverted_by: "mira",
      },
    };
    expect(canonicalize(withWindow)).toEqual(canonicalize(restored));
    expect(canonicalize(withWindow)).not.toContain("revert_undo_window");
    // The 24h window is exactly reverted_at + 24h (the popup stamps this).
    expect(Date.parse(expires_at) - Date.parse(reverted_at)).toBe(
      24 * 60 * 60 * 1000,
    );
  });
});

// ── Case C: reverse-walk onto a folded target throws ─────────────────────────

describe("task Case-C HistoryCompactedTargetError", () => {
  it("throws when the restore walk crosses a boundary above the target", () => {
    const { engine } = makeEngine();
    const boundary: BoundarySnapshotRow = {
      id: "b0",
      ts: "2026-01-01T00:00:00.000Z",
      v: 1,
      actor: "compaction",
      owner: OWNER,
      kind: "boundary_snapshot",
      state: '{"id":42,"name":"v1"}\n',
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
    let caught: unknown = null;
    try {
      engine.reverseWalkTo(rows, 0, '{"id":42}\n');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HistoryCompactedTargetError);
  });
});

// ── FLAG-derived-cache: end_date never appears in a delta ────────────────────

describe("task derived end_date is denylisted (never in a diff)", () => {
  it("a save that ONLY recomputes end_date produces an EMPTY-content delta", async () => {
    const { storage, engine } = makeEngine();
    // Two records identical except end_date (the derived cache). tasksApi.update
    // recomputes end_date on every save, so without the denylist this would diff
    // a meaningless line on every edit.
    const before = task({ start_date: "2026-05-01", duration_days: 1, end_date: "2026-05-01" });
    const after = task({ start_date: "2026-05-01", duration_days: 1, end_date: "2026-05-02" });

    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: before,
      nextState: after,
    });

    const rows = readTaskRows(storage);
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

  it("end_date does not appear in the canonical at all", () => {
    const canonical = canonicalize(task({ end_date: "2026-12-31" }));
    expect(canonical).not.toContain("end_date");
    expect(canonical).not.toContain("2026-12-31");
    // A REAL field (start_date) is still tracked.
    expect(canonical).toContain("start_date");
  });

  it("changing a REAL scheduling input (start_date) DOES diff, while its derived end_date does not", async () => {
    const { storage, engine } = makeEngine();
    const before = task({ start_date: "2026-05-01", end_date: "2026-05-01" });
    // Real reschedule: start_date moves (and the derived end_date moves with it).
    const after = task({ start_date: "2026-06-01", end_date: "2026-06-01" });
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: before,
      nextState: after,
    });
    const delta = (readTaskRows(storage)[1] as DeltaRow).delta;
    expect(delta).toContain("2026-06-01"); // start_date change is tracked
    expect(delta).toContain("start_date");
    // end_date is denylisted: even though it ALSO changed, it is not in the diff.
    expect(delta).not.toContain("end_date");
  });
});
