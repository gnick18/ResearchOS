// save-checkpoint bot (2026-06-02): version-control wiring for the task
// Lab Notes (notes.md) and Results (results.md) MARKDOWN documents.
//
// THE GAP this closes: the structured Task entity is already versioned
// (task-history.ts -> users/<owner>/_history/task/<id>.jsonl), but the two
// markdown surfaces inside the task popup (Lab Notes + Results) saved their raw
// notes.md / results.md straight through filesApi.writeFile, bypassing version
// control entirely. Those saves created zero checkpoints. This module adds the
// missing per-document history so each explicit "Save checkpoint" is a
// permanent, revertible version.
//
// Why a SEPARATE entity type (not the "task" namespace): the markdown docs are
// their own documents keyed by (owner, taskId). They are NOT fields of the
// structured Task record (the canonical Task state the task recorder diffs does
// not carry notes.md / results.md), so folding them into the "task" history file
// would conflate two unrelated edit streams. Two additive namespaces keep each
// document's timeline clean:
//   - users/<owner>/_history/task_notes/<taskId>.jsonl
//   - users/<owner>/_history/task_results/<taskId>.jsonl
//
// ENGINE MODEL FIT: the engine versions a CANONICAL STRING (canonicalize.ts
// accepts `unknown`; the row delta is a jsdiff of the canonical). It does not
// require a structured entity with immutable keys. A plain markdown document
// fits cleanly: we wrap it as a `{ content }` payload. The wrapper (vs a bare
// string) gives the canonical a stable shape, lets the denylist machinery run
// untouched, and matches how every other entity projects to a diffable `body`.
// No engine invariant is bent.
//
// ADDITIVE ONLY: this touches no existing Note / Task / Project versioning and
// migrates no existing files. A task whose notes.md predates this simply starts
// versioning from its next save (the genesis row anchors the pre-edit content).

import type { EntityViewerAdapter } from "./entity-viewer";
import { historyEngine } from "./engine";
import { HISTORY_ENGINE_ENABLED, RESTORE_ENABLED } from "./notes-history";
import type { HistoryEditKind } from "./types";

// Re-export the SHARED flags so task-doc call sites read them from one place.
// These are the SAME consts the Notes + Task pilots use (single source of
// truth); the flag posture is one global pair, not per-entity.
export { HISTORY_ENGINE_ENABLED, RESTORE_ENABLED };

/** History-file namespaces for the two task markdown documents. */
export const TASK_NOTES_ENTITY_TYPE = "task_notes";
export const TASK_RESULTS_ENTITY_TYPE = "task_results";

/** Which task markdown surface a recorder call targets. */
export type TaskDocSurface = "notes" | "results";

/**
 * Map a surface to its history-file namespace. Centralized so the recorder, the
 * sidebar mount, and the restore handler all agree on the path token.
 */
export function taskDocEntityType(surface: TaskDocSurface): string {
  return surface === "results"
    ? TASK_RESULTS_ENTITY_TYPE
    : TASK_NOTES_ENTITY_TYPE;
}

/**
 * Wrap a markdown document string as the tracked payload the engine versions.
 * The engine canonicalizes this; the `content` key gives the canonical a stable
 * shape so the denylist + diff machinery run exactly as for a structured entity.
 */
export function taskDocPayload(content: string): { content: string } {
  return { content };
}

/**
 * Best-effort: append a task-document edit (notes.md or results.md) to the
 * delta store. A history-write failure must NEVER throw into the user's save
 * path (PROPOSAL.md 3j), so this swallows every error after logging. The
 * markdown file has already been written to disk by the time this runs; history
 * is a side-channel.
 *
 * No-op when the flag is off. The caller still reads prevContent unconditionally
 * (it is the on-disk file the save is about to overwrite), so there is no
 * wasted read to guard.
 *
 * The engine's own empty-delta short-circuit drops a no-op save (prev === next)
 * for any document that already has history, so re-saving an unchanged document
 * never mints a phantom version. The caller ALSO skips the call when
 * prevContent === nextContent to avoid even the genesis-laying first write for a
 * truly empty no-op (see the save-path comment).
 */
export async function recordTaskDocHistory(args: {
  surface: TaskDocSurface;
  type: HistoryEditKind;
  /** Task id (the document key). */
  id: string | number;
  /** Owner folder the history file lives under. */
  owner: string;
  /** The user performing the edit. */
  actor: string;
  /** Markdown content BEFORE the save (the on-disk file). */
  prevContent: string;
  /** Markdown content AFTER the save (what was just written). */
  nextContent: string;
  /** VC Phase 2 (FLAG-4): target version for a "revert" / "undo-revert" row. */
  revertTargetVersion?: number;
}): Promise<void> {
  if (!HISTORY_ENGINE_ENABLED) return;
  try {
    await historyEngine.appendEdit({
      type: args.type,
      entityType: taskDocEntityType(args.surface),
      id: args.id,
      owner: args.owner,
      actor: args.actor,
      prevState: taskDocPayload(args.prevContent),
      nextState: taskDocPayload(args.nextContent),
      revertTargetVersion: args.revertTargetVersion,
    });
  } catch (err) {
    // Swallow: the markdown file saved fine; history is best-effort.
    console.warn(
      `[history] recordTaskDocHistory failed for ${taskDocEntityType(
        args.surface,
      )}/${args.id} (document saved, history skipped):`,
      err,
    );
  }
}

// ── Viewer adapter (consumes reconstructed canonical states) ────────────────

/** The projection the version viewer diffs + summarizes for a markdown doc. */
export interface TaskDocProjection {
  /** The raw markdown body, used directly as the in-place diff body. */
  body: string;
}

/**
 * Parse a reconstructed canonical state string (canonicalize of `{ content }`)
 * back into the raw markdown body. Tolerant: a malformed / empty canonical
 * projects to an empty body so the viewer degrades to "no content" rather than
 * throwing.
 */
export function projectTaskDocState(
  canonical: string | null | undefined,
): TaskDocProjection {
  if (!canonical || canonical.trim().length === 0) {
    return { body: "" };
  }
  try {
    const parsed = JSON.parse(canonical) as { content?: unknown };
    return { body: typeof parsed.content === "string" ? parsed.content : "" };
  } catch {
    return { body: "" };
  }
}

/**
 * One-line change summary for a markdown-doc version. The doc is a single
 * markdown blob (no sub-fields), so the summary is intentionally simple: it
 * special-cases restore / undo rows (which look like a plain edit by diff alone)
 * and otherwise reports created / edited / cleared. Pure (no Date.now).
 */
export function summarizeTaskDocChange(
  before: TaskDocProjection | null,
  after: TaskDocProjection,
  kind?: HistoryEditKind,
): string {
  if (kind === "revert") return "Restored an earlier version";
  if (kind === "undo-revert") return "Undid a restore";
  if (before === null) {
    return after.body.trim() ? "created document" : "created";
  }
  if (before.body === after.body) return "saved checkpoint";
  if (!after.body.trim()) return "cleared document";
  if (!before.body.trim()) return "added content";
  return "edited document";
}

/**
 * The task-document EntityViewerAdapter the generic EntityVersionHistorySidebar
 * consumes. Mirrors notesAdapter's shape (~the reference adapter) but for a
 * plain markdown body rather than a structured note.
 */
export const taskDocAdapter: EntityViewerAdapter<TaskDocProjection> = {
  projectBody: projectTaskDocState,
  summarize: summarizeTaskDocChange,
};
