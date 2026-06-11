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

// VC Phase 3 (Project, sequencing step 2): the Project recorder. Same shared
// flags re-exported from project-history.ts, single source of truth.
export { recordProjectHistory } from "./project-history";

// save-checkpoint bot (2026-06-02): the task Lab Notes / Results MARKDOWN
// document recorder + viewer adapter. Additive entity types ("task_notes" /
// "task_results") keyed by (owner, taskId); same shared flags re-exported.
export {
  recordTaskDocHistory,
  taskDocAdapter,
  taskDocEntityType,
  taskDocPayload,
  projectTaskDocState,
  summarizeTaskDocChange,
  TASK_NOTES_ENTITY_TYPE,
  TASK_RESULTS_ENTITY_TYPE,
  type TaskDocSurface,
  type TaskDocProjection,
} from "./task-doc-history";

// seq history bot (2026-06-03): the sequence editor recorder + viewer adapter.
// Additive entity type ("sequences") keyed by (owner, sequenceId); the same
// shared flags re-exported, single source of truth.
export {
  recordSequenceHistory,
  sequenceAdapter,
  sequencePayload,
  projectSequenceState,
  summarizeSequenceChange,
  sequenceDigest,
  formatBp,
  SEQUENCES_ENTITY_TYPE,
  type SequenceTrackedState,
  type SequenceTrackedFeature,
  type SequenceProjection,
  type SequenceDocLike,
} from "./sequences-history";

// chunk-5 bot (2026-06-07): inventory item + stock recorders and viewer
// adapters. Additive entity types ("inventory_items" / "inventory_stocks")
// keyed by (owner, id); same shared flags re-exported.
export {
  recordInventoryItemVersion,
  recordInventoryStockVersion,
  inventoryItemAdapter,
  inventoryStockAdapter,
  projectInventoryItemState,
  projectInventoryStockState,
  summarizeInventoryItemChange,
  summarizeInventoryStockChange,
  INVENTORY_ITEM_ENTITY_TYPE,
  INVENTORY_STOCK_ENTITY_TYPE,
  type InventoryItemTrackedState,
  type InventoryStockTrackedState,
  type InventoryItemProjection,
  type InventoryStockProjection,
} from "./inventory-history";

// chem-history bot (2026-06-11): molecule editor recorder + viewer adapter.
// Additive entity type ("molecules") keyed by (owner, moleculeId); same shared
// flags re-exported, single source of truth.
// NOTE: the recorder + adapter live in lib/chemistry/molecule-history.ts
// (co-located with the chemistry layer) to keep the import graph clean (the
// adapter imports MoleculeMeta from api.ts). Re-exported here so consumers can
// import from "@/lib/history" like other entity types.
export {
  recordMoleculeHistory,
  moleculeAdapter,
  moleculePayload,
  projectMoleculeState,
  summarizeMoleculeChange,
  moleculeDigest,
  MOLECULES_ENTITY_TYPE,
  type MoleculeTrackedState,
  type MoleculeProjection,
} from "../chemistry/molecule-history";
