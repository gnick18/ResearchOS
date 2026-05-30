// Version Control Phase 0: row schema for the git-inspired delta store.
//
// Authoritative design: docs/proposals/VERSION_CONTROL_R4_PREP.md (locks the
// jsdiff@9.0.0 delta-per-row + boundary_snapshot shape) and
// docs/proposals/VERSION_CONTROL_PROPOSAL.md sections 3c / 3f / 3j / 3l.
//
// NOTE on shape lineage: PROPOSAL.md 3c shows the ORIGINAL per-field-change
// row (a `fields[]` array of old/new pairs). R4-prep OQ10 SUPERSEDED that with
// a single jsdiff unified-diff string per row. We implement the R4-prep
// delta-row shape here, NOT the per-field shape.
//
// On-disk format: one JSON object per line (jsonl) under
// users/<owner>/_history/<type>/<id>.jsonl. Every row carries `v: 1` as the
// migration anchor (R4-prep FU4).

/** The set of edit kinds a delta row can record. */
export type HistoryEditKind =
  | "create"
  | "update"
  | "delete"
  | "restore"
  | "revert"
  | "rename";

/**
 * The genesis row. Row 0 of a fresh history file. Carries no delta and no
 * inline state at write time: it records only the post-edit hash of the
 * state at first observation (PROPOSAL.md 3j).
 *
 * `genesis_state` is a LAZY backfill field (R4-prep 2c): it is absent on
 * write and filled in on the first compaction by reverse-walking from HEAD
 * back to genesis. Presence of `genesis_state` means the backfill is done
 * (idempotent cache).
 */
export interface GenesisRow {
  /** Unique row id (UUID). Stable across reads. */
  id: string;
  /** ISO 8601 timestamp at write. */
  ts: string;
  /** Row-format schema version. Always 1 for Phase 0. */
  v: 1;
  /** The user who performed (or is credited with) the first observation. */
  actor: string;
  /** The record owner at the time. Redundant so rows copied out of context
   *  stay self-describing. */
  owner: string;
  kind: "genesis";
  /** sha256 of canonical(state) at first observation. */
  post_hash: string;
  /** Lazily backfilled on first compaction: the canonical state string at
   *  the genesis point. Absent until backfilled. */
  genesis_state?: string;
}

/**
 * A delta row. The bread-and-butter edit row. `delta` is a jsdiff unified
 * diff between the previous canonical state and the next canonical state
 * (createTwoFilesPatch(prevCanonical, nextCanonical)).
 */
export interface DeltaRow {
  id: string;
  ts: string;
  v: 1;
  actor: string;
  owner: string;
  kind: HistoryEditKind;
  /** jsdiff unified diff: createTwoFilesPatch(prevCanonical, nextCanonical). */
  delta: string;
  /** sha256 of canonical(nextState). Lets a reader verify the live record
   *  matches the latest row and lets revert detect interleaved edits. */
  post_hash: string;
}

/**
 * The boundary snapshot row. EXACTLY the interface in R4-prep section 2b.
 * Written by compaction; REPLACES the entire compaction window with a single
 * row. Invariant (R4-prep 2f): at most ONE boundary_snapshot row per file.
 */
export interface BoundarySnapshotRow {
  /** New UUID. */
  id: string;
  /** Preserved from the original row at index (N - RECENT_WINDOW). */
  ts: string;
  v: 1;
  /** Sentinel actor for compaction-authored rows. */
  actor: "compaction";
  /** Owner copied from the folded row. */
  owner: string;
  kind: "boundary_snapshot";
  /** Full canonical document state string at the boundary point. */
  state: string;
  /** sha256 of canonical(state), for round-trip verification. */
  state_hash: string;
  /** How many rows were folded into this snapshot. */
  compacted_row_count: number;
  /** The id/ts range that was folded away. */
  compacted_range: {
    from_id: string;
    to_id: string;
    from_ts: string;
    to_ts: string;
  };
}

/** Any row that can appear in a history file. */
export type HistoryRow = GenesisRow | DeltaRow | BoundarySnapshotRow;

/** Narrowing helpers. */
export function isGenesisRow(row: HistoryRow): row is GenesisRow {
  return row.kind === "genesis";
}

export function isBoundarySnapshotRow(
  row: HistoryRow,
): row is BoundarySnapshotRow {
  return row.kind === "boundary_snapshot";
}

export function isDeltaRow(row: HistoryRow): row is DeltaRow {
  return (
    row.kind === "create" ||
    row.kind === "update" ||
    row.kind === "delete" ||
    row.kind === "restore" ||
    row.kind === "revert" ||
    row.kind === "rename"
  );
}
