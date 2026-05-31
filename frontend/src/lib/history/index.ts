// Version Control Phase 0: public surface of the headless delta-store engine.
//
// Phase 0 is the headless engine + Notes save-path wiring (behind a default-off
// flag) + tests. NO UI (the read-only viewer is Phase 1).
//
// See docs/proposals/VERSION_CONTROL_R4_PREP.md and VERSION_CONTROL_PROPOSAL.md.

export {
  HistoryEngine,
  HistoryCompactedTargetError,
  historyEngine,
  COMPACTION_THRESHOLD,
  RECENT_WINDOW,
  type EngineClock,
  type EngineConfig,
  type AppendEditArgs,
} from "./engine";

export { canonicalize } from "./canonicalize";
export { computeDelta, applyDelta, applyReverseDelta } from "./diff";
export { sha256Hex } from "./hash";
export {
  historyFilePath,
  rowsToJsonl,
  jsonlToRows,
  fileServiceHistoryStorage,
  type HistoryStorage,
} from "./storage";
export {
  isGenesisRow,
  isDeltaRow,
  isBoundarySnapshotRow,
  type HistoryRow,
  type GenesisRow,
  type DeltaRow,
  type BoundarySnapshotRow,
  type HistoryEditKind,
} from "./types";

export {
  HISTORY_ENGINE_ENABLED,
  RESTORE_ENABLED,
  recordNoteHistory,
} from "./notes-history";

// VC Phase 3 (Task pilot): the Task / Experiment recorder. The flags above are
// the SHARED pair task-history.ts re-exports, so they stay a single source of
// truth (no per-entity flag).
export { recordTaskHistory } from "./task-history";
