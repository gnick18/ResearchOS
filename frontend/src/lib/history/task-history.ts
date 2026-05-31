// Version Control Phase 3 (VC-Phase3-Task sub-bot of HR, 2026-05-31): the
// Task / Experiment save-path wiring for the delta-store engine. This is the
// per-entity twin of notes-history.ts: it records an append-only history row
// under users/<owner>/_history/task/<id>.jsonl on every tracked Task save.
//
// The design (VERSION_CONTROL_PHASE3_DESIGN.md, "Per-entity chip" step 2-3) is
// to MIRROR recordNoteHistory exactly, only swapping the entity-type token. The
// engine + on-disk row schema are entity-agnostic, so there is no per-entity
// schema risk: we deliberately REUSE the SHARED HISTORY_ENGINE_ENABLED /
// RESTORE_ENABLED flags from notes-history.ts (the design's "ONE global flag,
// not per-entity" posture) rather than introducing a parallel pair. Re-exported
// here so Task call sites can import flags + recorder from one module.
//
// Entity-type token: "task". Verified against the canonical token already used
// by the engine on the Task soft-delete path (local-api.ts softDeleteEntity
// passes entityType: "task"), so the history-file namespace matches every other
// Task-scoped engine call. Experiments ARE tasks (task_type === "experiment");
// they share this single "task" namespace, exactly as they share the tasks
// store + the _trash/tasks/ folder (proposal §3a, "experiments are tasks").

import { historyEngine } from "./engine";
import { HISTORY_ENGINE_ENABLED, RESTORE_ENABLED } from "./notes-history";
import type { HistoryEditKind } from "./types";

// Re-export the SHARED flags so Task call sites read them from one place. These
// are the SAME consts as the Notes pilot uses (single source of truth); the
// design's flag posture is one global pair, not per-entity.
export { HISTORY_ENGINE_ENABLED, RESTORE_ENABLED };

/**
 * The Task / Experiment history-file namespace. Matches the entityType the
 * engine already receives on the Task soft-delete path (softDeleteEntity in
 * local-api.ts), so reads + writes hit users/<owner>/_history/task/<id>.jsonl.
 */
const TASK_ENTITY_TYPE = "task";

/**
 * Best-effort: append a Task edit to the delta store. A history-write failure
 * must NEVER throw into the user's save path (PROPOSAL.md 3j), so this swallows
 * every error after logging. The live task has already been persisted by the
 * time this runs; history is a side-channel.
 *
 * No-op when the flag is off, so it is safe to call unconditionally from the
 * save path (the caller still guards on the flag to avoid the prevState read).
 *
 * Byte-for-byte the recordNoteHistory shape, only the entity-type token differs.
 */
export async function recordTaskHistory(args: {
  type: HistoryEditKind;
  id: string | number;
  owner: string;
  actor: string;
  prevState: unknown;
  nextState: unknown;
  /** VC Phase 2 (FLAG-4): target version for a "revert" / "undo-revert" row. */
  revertTargetVersion?: number;
}): Promise<void> {
  if (!HISTORY_ENGINE_ENABLED) return;
  try {
    await historyEngine.appendEdit({
      type: args.type,
      entityType: TASK_ENTITY_TYPE,
      id: args.id,
      owner: args.owner,
      actor: args.actor,
      prevState: args.prevState,
      nextState: args.nextState,
      revertTargetVersion: args.revertTargetVersion,
    });
  } catch (err) {
    // Swallow: the live record saved fine; history is best-effort.
    console.warn(
      `[history] recordTaskHistory failed for task/${args.id} (task saved, history skipped):`,
      err,
    );
  }
}
