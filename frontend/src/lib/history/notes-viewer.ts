// Version Control Phase 1: read-only viewer data-prep for the Notes pilot.
//
// VC Phase 3 (shared-generalization): the PURE, entity-agnostic grouping +
// pagination backbone moved to entity-viewer.ts. This module is now ONLY the
// Notes-specific adapter: it projects a reconstructed canonical Note state to a
// diffable body + summarizes a change. It re-exports the generic grouping
// helpers / view-model types so existing Notes call sites + tests (the
// regression canary) keep their import path (`./notes-viewer`) byte-for-byte.
//
// It consumes what the Phase 0 engine produces:
//   - HistoryRow[] from historyEngine.readHistory("notes", owner, id)
//   - RECONSTRUCTED canonical states (strings) from
//     historyEngine.reconstructState(...). It NEVER parses unified-diff text.
//
// Keeping this projection out of the component makes the summary rules
// deterministic and unit-testable with injected ts/ids (no Date.now).

import type { EntityViewerAdapter } from "./entity-viewer";
import type { HistoryEditKind } from "./types";

// Re-export the generic backbone so existing imports from "./notes-viewer"
// (incl. notes-viewer.test.ts, the canary) keep resolving unchanged.
export {
  VERSION_PAGE_SIZE,
  SESSION_MIN_RUN,
  buildVersionList,
  sessionRangeLabel,
  dayKeyOf,
  dayLabelOf,
  clockOf,
  type VersionEntry,
  type SessionGroup,
  type DayGroup,
  type SummarizedGroup,
  type VersionListModel,
} from "./entity-viewer";

// ── Note field projection (consumes reconstructed canonical state) ──────────

/**
 * The slice of a Note we diff + summarize. The reconstructed canonical state is
 * a pretty-printed JSON string of the tracked note (canonicalize.ts); this
 * projects it to the fields the viewer cares about. The viewer never touches
 * unified-diff text: it diffs these reconstructed values.
 */
export interface NoteProjection {
  title: string;
  description: string;
  /** Concatenated entry bodies (markdown), joined for the in-place diff. */
  body: string;
  /** Per-entry bodies keyed by entry title, for finer summaries. */
  entries: { title: string; content: string }[];
}

interface RawNoteEntry {
  title?: unknown;
  content?: unknown;
}

interface RawNote {
  title?: unknown;
  description?: unknown;
  entries?: unknown;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Parse a reconstructed canonical state string into a NoteProjection.
 * Tolerant: a malformed / empty state projects to all-empty fields so the
 * viewer degrades to "no content" rather than throwing.
 */
export function projectNoteState(canonical: string | null | undefined): NoteProjection {
  if (!canonical || canonical.trim().length === 0) {
    return { title: "", description: "", body: "", entries: [] };
  }
  let parsed: RawNote;
  try {
    parsed = JSON.parse(canonical) as RawNote;
  } catch {
    return { title: "", description: "", body: "", entries: [] };
  }
  const rawEntries = Array.isArray(parsed.entries)
    ? (parsed.entries as RawNoteEntry[])
    : [];
  const entries = rawEntries.map((e) => ({
    title: asString(e?.title),
    content: asString(e?.content),
  }));
  // The diff body is the entry HEADINGS + bodies joined. A heading line per
  // entry anchors each entry in the line-diff so a running-log edit (the user
  // edits ONE dated entry among several) renders as a localized change rather
  // than a whole-body churn, and a heading-only edit still surfaces a diff
  // (vc-persona-fixes sub-bot of HR, 2026-05-30: running-log entry edits were
  // rendering "No tracked content changed" because the projected body dropped
  // the entry headings, so the LCS could not anchor the changed entry). The
  // heading line is prefixed so it cannot be confused with body content.
  const body = entries
    .map((e) => {
      const heading = e.title.trim();
      return heading ? `## ${heading}\n${e.content}` : e.content;
    })
    .join("\n\n");
  return {
    title: asString(parsed.title),
    description: asString(parsed.description),
    body,
    entries,
  };
}

/**
 * Derive a one-line change summary by comparing a version's projected state
 * against its predecessor's. Pure: both projections are caller-supplied
 * reconstructed states (no Date.now, no engine calls).
 *
 * Summary precedence (most specific first):
 *   - restore row (kind "revert")        -> "Restored an earlier version"
 *   - undo row (kind "undo-revert")      -> "Undid a restore"
 *   - first version of a record          -> "created note"
 *   - title changed                      -> "changed title"
 *   - description changed                -> "changed description"
 *   - entry body changed                 -> "edited <entry title>" / "edited notes"
 *   - entry added / removed              -> "added entry" / "removed entry"
 *   - nothing detectable                 -> "edited note"
 *
 * The restore / undo special-cases come FIRST (vc-persona-fixes sub-bot of HR,
 * 2026-05-30): a restore + an undo both look like a plain content edit by diff
 * alone, so without the row kind they read identically ("edited note") and the
 * timeline cannot tell a restore from a real edit. The kind makes the action
 * legible. Restores still happen even on the very first comparison, so the kind
 * check precedes the `before === null` create branch.
 */
export function summarizeChange(
  before: NoteProjection | null,
  after: NoteProjection,
  kind?: HistoryEditKind,
): string {
  if (kind === "revert") return "Restored an earlier version";
  if (kind === "undo-revert") return "Undid a restore";

  if (before === null) return "created note";

  if (before.title !== after.title) return "changed title";
  if (before.description !== after.description) return "changed description";

  if (after.entries.length > before.entries.length) return "added entry";
  if (after.entries.length < before.entries.length) return "removed entry";

  // Same entry count: find which entry body changed.
  for (let i = 0; i < after.entries.length; i++) {
    const a = after.entries[i];
    const b = before.entries[i];
    if (!b || a.content !== b.content) {
      const name = a.title?.trim();
      return name ? `edited ${name}` : "edited notes";
    }
    if (a.title !== b.title) return "renamed entry";
  }

  return "edited note";
}

/**
 * VC Phase 3: the Notes EntityViewerAdapter. This is the reference adapter the
 * generic EntityVersionHistorySidebar consumes; per-entity chips ship a sibling
 * (~40 lines) with the same shape. `projectBody` + `summarize` simply wrap the
 * Notes projection above, so Notes behavior is byte-for-byte unchanged.
 */
export const notesAdapter: EntityViewerAdapter<NoteProjection> = {
  projectBody: projectNoteState,
  summarize: summarizeChange,
};
