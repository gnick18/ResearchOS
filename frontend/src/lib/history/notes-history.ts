// Version Control Phase 0: Notes pilot wiring for the delta-store engine.
//
// This is the ONLY surface wired in Phase 0 (the Notes pilot, PROPOSAL.md
// Phase R4). It is gated behind a DEFAULT-OFF flag so cherry-picking Phase 0
// to main is INERT: no _history/ files are written into anyone's real data
// folder until Phase 1 explicitly enables the pilot.
//
// Why default-off (and why a single const, not a Settings toggle):
//   - Phase 0 ships the engine + tests so the on-disk row schema (a data-shape
//     contract) can be reviewed and frozen BEFORE any user data is written
//     against it. If the flag defaulted on, the first merge would start
//     writing v:1 rows everywhere, and a later schema correction would need a
//     migration. Default-off keeps the merge a no-op at runtime.
//   - To enable the Phase 1 Notes pilot, flip HISTORY_ENGINE_ENABLED to true
//     (or, when Phase 1 lands a Settings surface, replace this const with a
//     persisted per-user setting read here).

import { historyEngine } from "./engine";
import type { HistoryEditKind } from "./types";

/**
 * Master switch for the Phase 0 history engine on the Notes save path.
 *
 * Phase 1 (Notes version-history viewer pilot, 2026-05-29): FLIPPED TO TRUE.
 * Grant approved the pilot going live, so Note saves now write an append-only
 * history row under users/<owner>/_history/notes/<id>.jsonl. This never mutates
 * the live note: recordNoteHistory runs AFTER the live record is persisted and
 * swallows any failure (PROPOSAL.md 3j), so the save path is unaffected. The
 * read-only viewer (NoteVersionHistorySidebar) consumes these rows.
 *
 * Was DEFAULT false through Phase 0 so the on-disk v:1 row schema could be
 * frozen before any user data was written against it. The schema is now frozen.
 */
export const HISTORY_ENGINE_ENABLED = true;

const NOTES_ENTITY_TYPE = "notes";

/**
 * Best-effort: append a Notes edit to the delta store. A history-write failure
 * must NEVER throw into the user's save path (PROPOSAL.md 3j), so this swallows
 * every error after logging. The live note has already been persisted by the
 * time this runs; history is a side-channel.
 *
 * No-op when the flag is off, so it is safe to call unconditionally from the
 * save path (the caller still guards on the flag to avoid the prevState read).
 */
export async function recordNoteHistory(args: {
  type: HistoryEditKind;
  id: string | number;
  owner: string;
  actor: string;
  prevState: unknown;
  nextState: unknown;
}): Promise<void> {
  if (!HISTORY_ENGINE_ENABLED) return;
  try {
    await historyEngine.appendEdit({
      type: args.type,
      entityType: NOTES_ENTITY_TYPE,
      id: args.id,
      owner: args.owner,
      actor: args.actor,
      prevState: args.prevState,
      nextState: args.nextState,
    });
  } catch (err) {
    // Swallow: the live record saved fine; history is best-effort.
    console.warn(
      `[history] recordNoteHistory failed for notes/${args.id} (note saved, history skipped):`,
      err,
    );
  }
}
