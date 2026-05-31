// VC Phase 3 (VC-Phase3-Project sub-bot of HR, 2026-05-31): engine-level history
// tests for the Project entity (sequencing step 2). The engine is entity-agnostic,
// so these drive it through the "project" entity-type namespace and pin the
// per-entity contract the Project chip adds:
//   - record + read round-trip (a tracked save produces a reconstructable row),
//   - reconstruct a BARE-GENESIS project (existed before its first tracked save),
//   - restore ("revert") + the 24h undo ("undo-revert") round-trip,
//   - the Case-C HistoryCompactedTargetError on a folded target,
//   - the revert_undo_window stamp is denylisted (never in a delta),
//   - the global write-stamps (last_edited_at / last_edited_by) never appear in a
//     Project diff. Project carries NO derived/recomputed field (no end_date
//     analog), so there is no per-entity denylist entry to assert; this last case
//     is the equivalent "noise never pollutes the diff" guard for Project.
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

// Project-scoped fixture identity. The Project entity-type token is "project"
// (the same token the engine already receives on the Project soft-delete path,
// and a member of TrashEntityType).
const ENTITY = "project";
const OWNER = "mira";
const ID = 7;

function pathForProject(owner = OWNER, id: string | number = ID): string {
  return historyFilePath(owner, ENTITY, id);
}

function readProjectRows(storage: MemoryStorage): HistoryRow[] {
  return readRows(storage, pathForProject());
}

// A minimal Project-like record: the tracked fields the canonical captures. We
// pass these straight through engine.appendEdit (it canonicalizes internally).
function project(fields: {
  name?: string;
  tags?: string[] | null;
  color?: string | null;
  weekend_active?: boolean;
  is_archived?: boolean;
  funding_account_id?: number | null;
  last_edited_at?: string;
  last_edited_by?: string;
}): Record<string, unknown> {
  return {
    id: ID,
    name: fields.name ?? "Aptamer screen",
    tags: fields.tags ?? null,
    color: fields.color ?? "#3b82f6",
    weekend_active: fields.weekend_active ?? false,
    is_archived: fields.is_archived ?? false,
    archived_at: null,
    sort_order: 0,
    funding_account_id: fields.funding_account_id ?? null,
    owner: OWNER,
    shared_with: [],
    // Write-time stamps the global denylist must strip from every delta.
    last_edited_at: fields.last_edited_at ?? "2026-05-01T00:00:00.000Z",
    last_edited_by: fields.last_edited_by ?? OWNER,
  };
}

// ── record + read round-trip ─────────────────────────────────────────────────

describe("project history record + read round-trip", () => {
  it("a tracked save appends a reconstructable row under the 'project' namespace", async () => {
    const { storage, engine } = makeEngine();
    // First tracked save of a fresh project: prevState is the empty doc so
    // genesis anchors at the empty pre-image and reconstructState resolves
    // WITHOUT a headCanonical (the engine-with-clean-anchor path).
    const after = project({ name: "Aptamer screen", tags: ["rna"] });

    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "mira",
      prevState: {},
      nextState: after,
    });

    const rows = readProjectRows(storage);
    // Genesis + one delta. The file lives at the project-namespace path.
    expect(storage.files.has(pathForProject())).toBe(true);
    expect(rows.length).toBe(2);
    expect(isGenesisRow(rows[0])).toBe(true);
    expect(isDeltaRow(rows[1])).toBe(true);

    // HEAD reconstructs to the post-edit canonical.
    const head = await engine.reconstructState(ENTITY, OWNER, ID, rows.length - 1);
    expect(head).toEqual(canonicalize(after));
  });
});

// ── reconstruct a bare-genesis project ───────────────────────────────────────

describe("project bare-genesis reconstruction", () => {
  it("reconstructs every version when genesis anchors at a NON-empty pre-image (existing project, first tracked save)", async () => {
    const { storage, engine } = makeEngine();
    // The project as it existed on disk BEFORE the first tracked save (non-empty).
    const created = project({ name: "Western blot", tags: null });
    const editedOnce = project({ name: "Western blot", tags: ["protein"] });
    const editedTwice = project({
      name: "Western blot (overnight)",
      tags: ["protein"],
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

    const rows = readProjectRows(storage);
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

describe("project restore + undo round-trip", () => {
  it("restores to a target ('revert'), then undoes ('undo-revert') back to the pre-restore HEAD", async () => {
    const { storage, engine } = makeEngine();
    // Build a small history: name v1 -> v2 -> v3.
    // First save from the EMPTY doc so genesis anchors at the empty pre-image
    // (reconstructState resolves without a headCanonical). Version indices then
    // are: 0 = genesis (empty), 1 = states[0] (v1), 2 = states[1], 3 = states[2].
    const states = [
      project({ name: "v1" }),
      project({ name: "v2" }),
      project({ name: "v3" }),
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

    const rowsBefore = readProjectRows(storage);
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

    const afterRestore = readProjectRows(storage);
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

    const afterUndo = readProjectRows(storage);
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
    const restored = project({ name: "v1" });
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
    // The 24h window is exactly reverted_at + 24h (the route stamps this).
    expect(Date.parse(expires_at) - Date.parse(reverted_at)).toBe(
      24 * 60 * 60 * 1000,
    );
  });
});

// ── Case C: reverse-walk onto a folded target throws ─────────────────────────

describe("project Case-C HistoryCompactedTargetError", () => {
  it("throws when the restore walk crosses a boundary above the target", () => {
    const { engine } = makeEngine();
    const boundary: BoundarySnapshotRow = {
      id: "b0",
      ts: "2026-01-01T00:00:00.000Z",
      v: 1,
      actor: "compaction",
      owner: OWNER,
      kind: "boundary_snapshot",
      state: '{"id":7,"name":"v1"}\n',
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
      engine.reverseWalkTo(rows, 0, '{"id":7}\n');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HistoryCompactedTargetError);
  });
});

// ── write-stamp noise never pollutes the diff (Project has NO derived field) ──

describe("project write-stamps are denylisted (never in a diff)", () => {
  it("a save that ONLY moves last_edited_at / last_edited_by produces an EMPTY-content delta", async () => {
    const { storage, engine } = makeEngine();
    // Two records identical except the per-save attribution stamps. Every
    // projectsApi.update rewrites these, so without the global denylist every
    // project save would diff a meaningless attribution line.
    const before = project({
      name: "Aptamer screen",
      last_edited_at: "2026-05-01T00:00:00.000Z",
      last_edited_by: "mira",
    });
    const after = project({
      name: "Aptamer screen",
      last_edited_at: "2026-05-02T00:00:00.000Z",
      last_edited_by: "alex",
    });

    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "alex",
      prevState: before,
      nextState: after,
    });

    const rows = readProjectRows(storage);
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

  it("the write-stamps do not appear in the canonical at all, but real fields do", () => {
    const canonical = canonicalize(
      project({ name: "Aptamer screen", last_edited_by: "alex" }),
    );
    expect(canonical).not.toContain("last_edited_at");
    expect(canonical).not.toContain("last_edited_by");
    // Real, user-authored fields ARE tracked.
    expect(canonical).toContain("name");
    expect(canonical).toContain("Aptamer screen");
  });

  it("changing a REAL field (name) DOES diff while the attribution stamps do not", async () => {
    const { storage, engine } = makeEngine();
    const before = project({ name: "Aptamer screen", last_edited_by: "mira" });
    // Real rename (and the attribution stamp moves with it, as every save does).
    const after = project({ name: "Aptamer screen v2", last_edited_by: "alex" });
    await engine.appendEdit({
      type: "update",
      entityType: ENTITY,
      id: ID,
      owner: OWNER,
      actor: "alex",
      prevState: before,
      nextState: after,
    });
    const delta = (readProjectRows(storage)[1] as DeltaRow).delta;
    expect(delta).toContain("Aptamer screen v2"); // name change is tracked
    expect(delta).toContain("name");
    // The attribution stamps are denylisted: even though they ALSO changed, they
    // are not in the diff.
    expect(delta).not.toContain("last_edited_by");
    expect(delta).not.toContain("alex");
  });
});
