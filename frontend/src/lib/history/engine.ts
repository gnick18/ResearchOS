// Version Control Phase 0: the headless delta-store engine.
//
// Authoritative design: docs/proposals/VERSION_CONTROL_R4_PREP.md (compaction
// algorithm, 2a-2i) + VERSION_CONTROL_PROPOSAL.md (3c history layout, 3j
// genesis, 3l revert). Read those before changing the row shape or the
// compaction window: the on-disk format is a persistent contract.
//
// Design choices worth knowing:
//   - The engine is built against the HistoryStorage interface (storage.ts).
//     Tests run against an in-memory store; production binds to fileService.
//   - id / ts generation is INJECTABLE (createEngine clock) so the test suite
//     is fully deterministic; production uses crypto.randomUUID + Date.now.
//   - Every public method that touches disk is async. The hash is computed via
//     async crypto.subtle (hash.ts), matching the rest of the codebase.
//
// Robustness contract (PROPOSAL.md 3j, R4-prep test 10): a history-write
// failure must NEVER throw into the user's save path. The engine itself does
// not swallow errors (tests want to see them), but the save-path wrapper in
// local-api.ts wraps every call in try/catch. Compaction is the one internal
// place that swallows: a corrupt delta aborts compaction cleanly and leaves
// the file untouched.

import { canonicalize } from "./canonicalize";
import { applyDelta, applyReverseDelta, computeDelta } from "./diff";
import { sha256Hex } from "./hash";
import {
  fileServiceHistoryStorage,
  historyFilePath,
  jsonlToRows,
  rowsToJsonl,
  type HistoryStorage,
} from "./storage";
import {
  isBoundarySnapshotRow,
  isGenesisRow,
  type BoundarySnapshotRow,
  type DeltaRow,
  type GenesisRow,
  type HistoryEditKind,
  type HistoryRow,
} from "./types";

// ── Tunables (R4-prep OQ3 / 2a-2b) ──────────────────────────────────────────

/** Compaction fires when the file exceeds this many rows (R4-prep 2a). */
export const COMPACTION_THRESHOLD = 500;

/** Rows kept verbatim at the tail, never folded (R4-prep 2b). */
export const RECENT_WINDOW = 100;

// ── Injectable clock / id source (deterministic tests) ──────────────────────

export interface EngineClock {
  /** Returns a fresh unique row id. */
  newId(): string;
  /** Returns an ISO 8601 timestamp for "now". */
  now(): string;
}

const defaultClock: EngineClock = {
  newId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  },
  now(): string {
    return new Date().toISOString();
  },
};

export interface EngineConfig {
  storage?: HistoryStorage;
  clock?: EngineClock;
}

export interface AppendEditArgs {
  /** The edit kind for the delta row. */
  type: HistoryEditKind;
  /** Entity-type folder name (e.g. "notes"). Used in the storage path. */
  entityType: string;
  /** Record id. */
  id: string | number;
  /** Record owner (= the folder this history file lives in). */
  owner: string;
  /** The user performing the edit. */
  actor: string;
  /** Tracked state BEFORE the edit. `null` for a brand-new record. */
  prevState: unknown;
  /** Tracked state AFTER the edit. */
  nextState: unknown;
  /**
   * VC Phase 2 (FLAG-4): for a "revert" / "undo-revert" edit, the version index
   * the edit reverted TO. Stamped onto the DeltaRow so the viewer can label it.
   * Omitted (and not written) for ordinary edits.
   */
  revertTargetVersion?: number;
}

// ── The engine ──────────────────────────────────────────────────────────────

export class HistoryEngine {
  private readonly storage: HistoryStorage;
  private readonly clock: EngineClock;

  constructor(config: EngineConfig = {}) {
    this.storage = config.storage ?? fileServiceHistoryStorage;
    this.clock = config.clock ?? defaultClock;
  }

  private path(entityType: string, owner: string, id: string | number): string {
    return historyFilePath(owner, entityType, id);
  }

  /** Read and parse the full history file. Empty array when missing. */
  async readHistory(
    entityType: string,
    owner: string,
    id: string | number,
  ): Promise<HistoryRow[]> {
    const raw = await this.storage.readRaw(this.path(entityType, owner, id));
    return jsonlToRows<HistoryRow>(raw);
  }

  /**
   * Append one edit. Writes a genesis row first if the file is empty, then the
   * delta row, then runs the on-write compaction check (R4-prep 2a): if the
   * file now exceeds COMPACTION_THRESHOLD rows, compaction runs synchronously
   * before returning.
   */
  async appendEdit(args: AppendEditArgs): Promise<void> {
    const {
      type,
      entityType,
      id,
      owner,
      actor,
      prevState,
      nextState,
      revertTargetVersion,
    } = args;
    const path = this.path(entityType, owner, id);

    const rows = await this.readHistory(entityType, owner, id);

    const prevCanonical = canonicalize(prevState ?? {});
    const nextCanonical = canonicalize(nextState);
    const postHash = await sha256Hex(nextCanonical);

    // Genesis: first edit of a record with no history file. Write a genesis
    // row anchored at the PRE-edit state, then the first delta on top. If the
    // record is brand-new (prevState null), the genesis anchors the empty
    // state {} so the first delta captures the full create.
    if (rows.length === 0) {
      const genesisHash = await sha256Hex(prevCanonical);
      const genesis: GenesisRow = {
        id: this.clock.newId(),
        ts: this.clock.now(),
        v: 1,
        actor,
        owner,
        kind: "genesis",
        post_hash: genesisHash,
      };
      await this.storage.appendLine(path, JSON.stringify(genesis));
    }

    const delta = computeDelta(prevCanonical, nextCanonical);
    const row: DeltaRow = {
      id: this.clock.newId(),
      ts: this.clock.now(),
      v: 1,
      actor,
      owner,
      kind: type,
      delta,
      post_hash: postHash,
      // VC Phase 2 (FLAG-4): only stamp the target version on revert rows; an
      // ordinary edit leaves the field absent so the row shape is unchanged.
      ...(revertTargetVersion !== undefined
        ? { revert_target_version: revertTargetVersion }
        : {}),
    };
    await this.storage.appendLine(path, JSON.stringify(row));

    // On-write compaction check (R4-prep 2a). Count rows AFTER the append.
    const after = await this.readHistory(entityType, owner, id);
    if (after.length > COMPACTION_THRESHOLD) {
      await this.compact(entityType, owner, id);
    }
  }

  /**
   * Resolve the ANCHOR canonical state of a history file: the state at row 0.
   *   - boundary_snapshot anchor: row.state, byte-for-byte (R4-prep 2b).
   *   - genesis with genesis_state backfilled: that value.
   *   - genesis without genesis_state: reconstructed by reverse-walking from
   *     HEAD (R4-prep 2c). HEAD canonical must be supplied by the caller.
   *
   * Returns null if the anchor cannot be resolved (e.g. genesis lacks
   * genesis_state AND no headCanonical was supplied, or a reverse-walk hit a
   * corrupt delta).
   */
  private async resolveAnchorState(
    rows: HistoryRow[],
    headCanonical?: string,
  ): Promise<string | null> {
    if (rows.length === 0) return null;
    const anchor = rows[0];
    if (isBoundarySnapshotRow(anchor)) {
      return anchor.state;
    }
    if (isGenesisRow(anchor)) {
      if (anchor.genesis_state !== undefined) {
        return anchor.genesis_state;
      }
      // Bare genesis without a backfilled genesis_state. appendEdit ALWAYS
      // anchors genesis at the pre-edit canonical, and a fresh record's
      // prevState is null -> canonicalize({}). The genesis row records the
      // hash of that pre-image as post_hash. So the empty-doc canonical IS the
      // anchor whenever its hash matches post_hash. This resolves the common
      // fresh-record case with no need for headCanonical.
      const emptyCanonical = canonicalize({});
      const emptyHash = await sha256Hex(emptyCanonical);
      if (emptyHash === anchor.post_hash) {
        return emptyCanonical;
      }
      // Otherwise the genesis anchored a pre-existing (migrated) record whose
      // first-observation state was non-empty. We cannot derive it from the
      // hash alone; reverse-walk from HEAD if the caller supplied it (the
      // lazy-backfill path, R4-prep 2c).
      if (headCanonical === undefined) return null;
      return this.reverseWalkRows(rows, 0, headCanonical);
    }
    // Row 0 is a bare delta row (no genesis). Unsupported by construction.
    return null;
  }

  /**
   * Reconstruct the canonical state AT a given version index by forward-walking
   * from the anchor. `versionIndex` is the row index in the CURRENT file
   * (0 = anchor). Applies deltas for rows (0, versionIndex] in order.
   *
   * For a genesis-anchored file whose genesis_state is not yet backfilled, the
   * caller must pass `headCanonical` so the anchor can be derived.
   */
  async reconstructState(
    entityType: string,
    owner: string,
    id: string | number,
    versionIndex: number,
    headCanonical?: string,
  ): Promise<string> {
    const rows = await this.readHistory(entityType, owner, id);
    if (rows.length === 0) {
      throw new Error(
        `[history] reconstructState: no history for ${entityType}/${id}`,
      );
    }
    if (versionIndex < 0 || versionIndex >= rows.length) {
      throw new Error(
        `[history] reconstructState: versionIndex ${versionIndex} out of range [0, ${rows.length - 1}]`,
      );
    }

    let state = await this.resolveAnchorState(rows, headCanonical);
    if (state === null) {
      throw new Error(
        `[history] reconstructState: cannot resolve anchor for ${entityType}/${id}`,
      );
    }

    // Forward-walk the deltas from row 1 up to and including versionIndex.
    for (let i = 1; i <= versionIndex; i++) {
      const row = rows[i];
      if (isBoundarySnapshotRow(row)) {
        // A boundary snapshot inside the walk (only at index 0 normally).
        state = row.state;
        continue;
      }
      if (isGenesisRow(row)) {
        // A genesis row mid-file is malformed; skip defensively.
        continue;
      }
      const next = applyDelta(state, row.delta);
      if (next === null) {
        throw new Error(
          `[history] reconstructState: corrupt delta at row ${i} for ${entityType}/${id}`,
        );
      }
      state = next;
    }
    return state;
  }

  /**
   * Reverse-walk primitive for revert (PROPOSAL.md 3l / R4-prep 2d). Given the
   * HEAD canonical state and a target version index, reverse-apply deltas from
   * HEAD back down to `targetVersion`, returning the canonical state AT
   * `targetVersion`.
   *
   * Cases (R4-prep 2d):
   *   - target inside the recent window: pure reverse-apply (Case A).
   *   - target IS the boundary snapshot row: reverse-apply down to row 1, then
   *     read boundary.state directly (Case B).
   *   - target BEFORE the boundary (folded away): NOT reachable. We throw a
   *     clearly-typed error so the UI can offer the Case-B fallback. The row no
   *     longer exists in the file, so any such request is stale (R4-prep 2d
   *     Case C).
   *
   * This is the synchronous primitive: it takes the already-read rows + HEAD
   * canonical so revert UX (Phase 2) can call it without re-reading.
   */
  reverseWalkTo(
    rows: HistoryRow[],
    targetVersion: number,
    headCanonicalState: string,
  ): string {
    if (rows.length === 0) {
      throw new Error("[history] reverseWalkTo: empty history");
    }
    if (targetVersion < 0 || targetVersion >= rows.length) {
      throw new Error(
        `[history] reverseWalkTo: targetVersion ${targetVersion} out of range [0, ${rows.length - 1}]`,
      );
    }

    const target = rows[targetVersion];

    // Case B: target is the boundary snapshot. Its `state` IS the answer; no
    // reverse-walk past it is possible (Case C is unreachable by construction
    // because folded rows are gone).
    if (isBoundarySnapshotRow(target)) {
      return target.state;
    }

    return this.reverseWalkRows(rows, targetVersion, headCanonicalState);
  }

  /**
   * Internal: reverse-apply deltas from HEAD down to (but stopping AT) the row
   * at `targetIndex`. Returns the canonical state AT `targetIndex`'s timestamp
   * (i.e. AFTER target's own delta has been applied, the state target produced).
   *
   * Walks rows [HEAD .. targetIndex+1] reverse-applying each delta. The result
   * after reverse-applying row (targetIndex+1) is the post-state of row
   * targetIndex. If targetIndex is the genesis row (index 0), the result is the
   * genesis anchor state (the state BEFORE row 1's delta = genesis_state).
   */
  private reverseWalkRows(
    rows: HistoryRow[],
    targetIndex: number,
    headCanonicalState: string,
  ): string {
    let state = headCanonicalState;
    const lastIndex = rows.length - 1;
    // Reverse-apply from HEAD down to the row just above the target.
    for (let i = lastIndex; i > targetIndex; i--) {
      const row = rows[i];
      if (isBoundarySnapshotRow(row)) {
        // Reaching a boundary while walking back means the target was folded
        // away (Case C). Unreachable: surface a clear, typed error.
        throw new HistoryCompactedTargetError(i);
      }
      if (isGenesisRow(row)) {
        // Genesis has no delta; nothing to reverse. The pre-genesis state is
        // not represented by a delta, so stop here.
        continue;
      }
      const prev = applyReverseDelta(state, row.delta);
      if (prev === null) {
        throw new Error(
          `[history] reverseWalkTo: corrupt delta at row ${i}, cannot revert through this point`,
        );
      }
      state = prev;
    }
    return state;
  }

  /**
   * Compaction (R4-prep 2b). Fold rows [0, N - RECENT_WINDOW) into a single
   * boundary_snapshot row; keep the most-recent RECENT_WINDOW rows verbatim.
   *
   * Crash-safe: composes the new file in memory, then writes it via the atomic
   * tmp+move rewrite. A corrupt delta in the fold aborts cleanly and leaves the
   * file UNTOUCHED (R4-prep test 10). The boundary_snapshot invariant (one per
   * file, R4-prep 2f) is preserved: the new boundary replaces the old one.
   */
  async compact(
    entityType: string,
    owner: string,
    id: string | number,
  ): Promise<void> {
    const path = this.path(entityType, owner, id);
    const rows = await this.readHistory(entityType, owner, id);
    const n = rows.length;
    if (n <= COMPACTION_THRESHOLD) {
      // Nothing to do. (Also the safe no-op for an under-threshold call.)
      return;
    }

    // Invariant guard (R4-prep 2f): at most one boundary snapshot, and only at
    // row 0. If we ever see more, abort rather than corrupt the file.
    const boundaryCount = rows.filter(isBoundarySnapshotRow).length;
    if (boundaryCount > 1) {
      console.warn(
        `[history] compact aborted: ${boundaryCount} boundary snapshots in ${path} (expected <= 1)`,
      );
      return;
    }
    if (boundaryCount === 1 && !isBoundarySnapshotRow(rows[0])) {
      console.warn(
        `[history] compact aborted: boundary snapshot not at row 0 in ${path}`,
      );
      return;
    }

    const windowEnd = n - RECENT_WINDOW; // exclusive: rows [0, windowEnd) fold
    if (windowEnd <= 0) return; // not enough rows to fold (defensive)

    // ── Resolve the anchor state at row 0 ──────────────────────────────────
    // Three cases:
    //   - boundary anchor: state byte-for-byte (R4-prep 2f second compaction).
    //   - genesis with genesis_state: that value.
    //   - bare genesis (no genesis_state): the lazy backfill, R4-prep 2c.
    //
    // The bare-genesis backfill leans on a fact appendEdit guarantees: the
    // genesis row is anchored at the PRE-edit canonical, which for a fresh
    // record is canonicalize({}). So HEAD can be reconstructed by forward-
    // walking every delta from canonicalize({}), and genesis_state is then
    // recovered by reverse-walking that HEAD back to row 0. The recovered
    // anchor is folded straight into the new boundary, so we never need to
    // separately persist a backfilled genesis row.

    const anchorRow = rows[0];
    let anchorState: string;

    if (isBoundarySnapshotRow(anchorRow)) {
      anchorState = anchorRow.state;
    } else if (isGenesisRow(anchorRow) && anchorRow.genesis_state !== undefined) {
      anchorState = anchorRow.genesis_state;
    } else if (isGenesisRow(anchorRow)) {
      // Bare genesis: reconstruct HEAD by forward-walking from the empty-doc
      // pre-image (how appendEdit anchored it), then reverse-walk back to
      // genesis to recover the anchor state (R4-prep 2c). The recovered state
      // is folded into the new boundary below, so no separate backfilled
      // genesis row is persisted.
      const headCanonical = this.forwardWalkFromEmpty(rows);
      if (headCanonical === null) {
        console.warn(
          `[history] compact aborted: corrupt delta while reconstructing HEAD for ${path}`,
        );
        return;
      }
      anchorState = this.reverseWalkRows(rows, 0, headCanonical);
    } else {
      console.warn(
        `[history] compact aborted: row 0 is neither genesis nor boundary in ${path}`,
      );
      return;
    }

    // ── Forward walk the fold window: rows [1, windowEnd) ──────────────────
    let state = anchorState;
    for (let i = 1; i < windowEnd; i++) {
      const row = rows[i];
      if (isBoundarySnapshotRow(row) || isGenesisRow(row)) {
        // Should not happen mid-file; skip defensively.
        continue;
      }
      const next = applyDelta(state, row.delta);
      if (next === null) {
        // Corrupt delta: abort cleanly, file untouched (R4-prep test 10).
        console.warn(
          `[history] compaction failed at row ${i} (corrupt delta) for ${path}; file left untouched`,
        );
        return;
      }
      state = next;
    }

    // `state` is now the canonical state at row (windowEnd - 1)'s timestamp.
    // The boundary snapshot's ts is the FOLDED row at windowEnd's predecessor
    // per R4-prep 2b: "= original row (N - RECENT_WINDOW)'s ts, preserved".
    // windowEnd == N - RECENT_WINDOW, so the row whose ts we preserve is
    // rows[windowEnd] (the first SURVIVING row). We preserve the ts of the last
    // FOLDED row so the snapshot timestamps the boundary point.
    const lastFoldedRow = rows[windowEnd - 1];
    const firstFoldedRow = rows[0];
    const stateHash = await sha256Hex(state);

    const boundary: BoundarySnapshotRow = {
      id: this.clock.newId(),
      ts: lastFoldedRow.ts,
      v: 1,
      actor: "compaction",
      owner,
      kind: "boundary_snapshot",
      state,
      state_hash: stateHash,
      compacted_row_count: windowEnd, // rows [0, windowEnd) folded
      compacted_range: {
        from_id: firstFoldedRow.id,
        to_id: lastFoldedRow.id,
        from_ts: firstFoldedRow.ts,
        to_ts: lastFoldedRow.ts,
      },
    };

    // FU2 size budget (R4-prep): warn if a boundary state exceeds 1 MB.
    if (state.length > 1_000_000) {
      console.warn(
        `[history] boundary_snapshot.state for ${path} is ${state.length} bytes (> 1 MB); see R4-prep FU2`,
      );
    }

    // ── Compose + atomic rewrite ───────────────────────────────────────────
    // New file = [boundary, ...recent verbatim rows]. The recent window is
    // rows [windowEnd, N). The old boundary (if any) is DISCARDED here: its
    // state was already folded forward into the new boundary (R4-prep 2f).
    const recent = rows.slice(windowEnd);
    const newRows: HistoryRow[] = [boundary, ...recent];
    await this.storage.rewrite(path, rowsToJsonl(newRows));
  }

  /**
   * Reconstruct HEAD canonical by forward-walking every delta from the empty
   * pre-image (canonicalize({})). Valid ONLY for a bare-genesis file (the
   * pre-image appendEdit anchored). Returns null on a corrupt delta.
   */
  private forwardWalkFromEmpty(rows: HistoryRow[]): string | null {
    let state = canonicalize({});
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (isBoundarySnapshotRow(row)) {
        state = row.state;
        continue;
      }
      if (isGenesisRow(row)) continue;
      const next = applyDelta(state, row.delta);
      if (next === null) return null;
      state = next;
    }
    return state;
  }
}

/**
 * Thrown by reverseWalkTo when the target row was folded into a boundary
 * snapshot and is no longer reachable (R4-prep 2d Case C). The UI catches this
 * to offer the "closest reachable point is the boundary" fallback.
 */
export class HistoryCompactedTargetError extends Error {
  constructor(public readonly boundaryRowIndex: number) {
    super(
      `[history] revert target was folded into a boundary snapshot (row ${boundaryRowIndex}); reachable only at boundary granularity`,
    );
    this.name = "HistoryCompactedTargetError";
  }
}

/** A ready-to-use default engine bound to fileService + the wall clock. */
export const historyEngine = new HistoryEngine();
