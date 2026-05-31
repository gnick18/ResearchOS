// Version Control Phase 3 (VC-Phase3-Project sub-bot of HR, 2026-05-31): the
// Project save-path wiring for the delta-store engine. This is the per-entity
// twin of task-history.ts / notes-history.ts: it records an append-only history
// row under users/<owner>/_history/project/<id>.jsonl on every tracked Project
// save.
//
// The design (VERSION_CONTROL_PHASE3_DESIGN.md, "Per-entity chip" step 2-3,
// sequencing step 2 = Project) is to MIRROR recordTaskHistory exactly, only
// swapping the entity-type token. The engine + on-disk row schema are
// entity-agnostic, so there is no per-entity schema risk: we deliberately REUSE
// the SHARED HISTORY_ENGINE_ENABLED / RESTORE_ENABLED flags from notes-history.ts
// (the design's "ONE global flag, not per-entity" posture) rather than
// introducing a parallel pair. Re-exported here so Project call sites can import
// flags + recorder from one module.
//
// Entity-type token: "project". Verified against the canonical token already
// used by the engine on the Project soft-delete path (local-api.ts
// projectsApi.delete -> softDeleteEntity passes entityType: "project", and
// "project" is a member of TrashEntityType in lib/trash/trash-types.ts), so the
// history-file namespace matches every other Project-scoped engine call. NOT
// invented.

import { historyEngine } from "./engine";
import { HISTORY_ENGINE_ENABLED, RESTORE_ENABLED } from "./notes-history";
import type { HistoryEditKind } from "./types";

// Re-export the SHARED flags so Project call sites read them from one place.
// These are the SAME consts as the Notes pilot uses (single source of truth);
// the design's flag posture is one global pair, not per-entity.
export { HISTORY_ENGINE_ENABLED, RESTORE_ENABLED };

/**
 * The Project history-file namespace. Matches the entityType the engine already
 * receives on the Project soft-delete path (softDeleteEntity in local-api.ts,
 * entityType: "project"; "project" is also a TrashEntityType member), so reads +
 * writes hit users/<owner>/_history/project/<id>.jsonl.
 */
const PROJECT_ENTITY_TYPE = "project";

/**
 * Best-effort: append a Project edit to the delta store. A history-write failure
 * must NEVER throw into the user's save path (PROPOSAL.md 3j), so this swallows
 * every error after logging. The live project has already been persisted by the
 * time this runs; history is a side-channel.
 *
 * No-op when the flag is off, so it is safe to call unconditionally from the
 * save path (the caller still guards on the flag to avoid the prevState read).
 *
 * Byte-for-byte the recordTaskHistory shape, only the entity-type token differs.
 */
export async function recordProjectHistory(args: {
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
      entityType: PROJECT_ENTITY_TYPE,
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
      `[history] recordProjectHistory failed for project/${args.id} (project saved, history skipped):`,
      err,
    );
  }
}
