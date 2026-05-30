// Version Control Phase 1: read-only viewer data-prep for the Notes pilot.
//
// This module is the PURE, React-free backbone of the version-history viewer.
// It consumes what the Phase 0 engine produces:
//   - HistoryRow[] from historyEngine.readHistory("notes", owner, id)
//   - RECONSTRUCTED canonical states (strings) from
//     historyEngine.reconstructState(...). It NEVER parses unified-diff text.
//
// It turns those into the view models the sidebar renders:
//   - a newest-first list of version entries (one per delta/genesis row),
//   - day -> session grouping (Today / Yesterday / May 27, then contiguous
//     same-editor runs collapsed into one expandable group),
//   - a "earlier versions (summarized)" group for rows folded into a
//     boundary_snapshot (R4-prep 2d lossiness, surfaced honestly),
//   - a one-line change summary derived from each row,
//   - pagination (50 newest-first, "load older" appends the next 50).
//
// Keeping this logic out of the component makes the grouping + summary rules
// deterministic and unit-testable with injected ts/ids (no Date.now).

import {
  isBoundarySnapshotRow,
  isGenesisRow,
  type HistoryRow,
} from "./types";

/** Default page size for the version list (R4-prep / design 2e). */
export const VERSION_PAGE_SIZE = 50;

/**
 * A contiguous-same-editor run collapses into one group when the run holds
 * more than this many versions. A run of 1 renders as a plain row.
 */
export const SESSION_MIN_RUN = 2;

/**
 * One renderable version in the list. `versionIndex` is the row's index in the
 * full file as returned by readHistory (0 = anchor), so the component can call
 * reconstructState(entityType, owner, id, versionIndex) directly.
 */
export interface VersionEntry {
  /** Stable row id from the engine. */
  rowId: string;
  /** Index in the full history file (0 = anchor). */
  versionIndex: number;
  /** ISO 8601 timestamp the row was written. */
  ts: string;
  /** Username credited with the edit. */
  actor: string;
  /** Record owner at the time (for cross-owner resolution). */
  owner: string;
  /** True for the live HEAD row (the most recent version). */
  isHead: boolean;
  /** A one-line, human-readable summary of what this version did. */
  summary: string;
}

/** A contiguous run of same-editor versions within a single day. */
export interface SessionGroup {
  /** The editor of every version in this run. */
  actor: string;
  owner: string;
  /** Newest-first versions in the run. */
  versions: VersionEntry[];
  /** ISO ts of the earliest version in the run. */
  startTs: string;
  /** ISO ts of the latest version in the run. */
  endTs: string;
  /**
   * When true the run holds enough versions to render collapsed by default
   * ("Morgan, 9:01-9:40, 7 versions"). A single-version run is always shown
   * inline (collapsible === false).
   */
  collapsible: boolean;
}

/** All versions written on one calendar day, split into editor-run sessions. */
export interface DayGroup {
  /** YYYY-MM-DD key for the day (local time). */
  dayKey: string;
  /** Human label: "Today", "Yesterday", or "May 27". */
  label: string;
  /** Newest-first session runs within the day. */
  sessions: SessionGroup[];
}

/**
 * The folded-rows summary group. Present only when the file carries a
 * boundary_snapshot (compaction has run). Rendered as a single
 * "earlier versions (summarized)" entry so the user understands why
 * row-by-row history stops at the boundary (R4-prep 2d).
 */
export interface SummarizedGroup {
  /** Anchor (boundary) version index, always 0 when present. */
  versionIndex: number;
  rowId: string;
  /** ISO ts the boundary preserved (the last folded row's ts). */
  ts: string;
  /** Day label for the boundary ts. */
  dayLabel: string;
  /** How many intermediate saves were folded away. */
  compactedRowCount: number;
}

export interface VersionListModel {
  /** Newest-first day groups for the loaded page(s). */
  days: DayGroup[];
  /** The folded-rows summary, or null when nothing has been compacted. */
  summarized: SummarizedGroup | null;
  /** True when more rows exist beyond the current page (drives "Load older"). */
  hasMore: boolean;
  /** Total renderable (non-anchor) versions in the file. */
  totalVersions: number;
}

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
  // The diff body is the entry bodies joined. For a single-entry note this is
  // just that entry's markdown; for a running log it is all entries in order.
  const body = entries.map((e) => e.content).join("\n\n");
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
 *   - first version of a record -> "created note"
 *   - title changed             -> "changed title"
 *   - description changed       -> "changed description"
 *   - entry body changed        -> "edited <entry title>" / "edited notes"
 *   - entry added / removed     -> "added entry" / "removed entry"
 *   - nothing detectable        -> "edited note"
 */
export function summarizeChange(
  before: NoteProjection | null,
  after: NoteProjection,
): string {
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

// ── Day / session grouping ──────────────────────────────────────────────────

/** Local YYYY-MM-DD key for an ISO timestamp. */
export function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Human day label relative to `now`. "Today" / "Yesterday" / "May 27".
 * `now` is injected so tests are deterministic (no Date.now in assertions).
 */
export function dayLabelOf(iso: string, now: Date): string {
  const key = dayKeyOf(iso);
  const todayKey = dayKeyOf(now.toISOString());
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = dayKeyOf(yesterday.toISOString());
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return key;
  // Same year: "May 27". Different year: "May 27, 2025".
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** HH:MM local clock for a session-range label, e.g. "9:01". */
export function clockOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Build the full version-list view model from raw history rows + a paging
 * cursor. The component supplies the reconstructed projections separately
 * (for summaries); here we build structure + summaries from a summary map.
 *
 * @param rows         full file rows, oldest-first (as readHistory returns).
 * @param now          injected "now" for relative day labels.
 * @param summaries    rowId -> one-line summary (precomputed by the caller from
 *                     reconstructed states). Missing entries fall back to a
 *                     generic "edited note".
 * @param pageCount    how many pages have been loaded (1 = first 50 newest).
 */
export function buildVersionList(
  rows: HistoryRow[],
  now: Date,
  summaries: Record<string, string>,
  pageCount = 1,
): VersionListModel {
  // Separate the boundary snapshot (if any). It is the anchor at index 0.
  const boundary = rows.length > 0 && isBoundarySnapshotRow(rows[0]) ? rows[0] : null;

  // Renderable versions: every non-genesis, non-boundary row. Keep the file
  // index so the component can reconstruct each version directly.
  const entries: VersionEntry[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (isGenesisRow(row) || isBoundarySnapshotRow(row)) continue;
    entries.push({
      rowId: row.id,
      versionIndex: i,
      ts: row.ts,
      actor: row.actor,
      owner: row.owner,
      isHead: false,
      summary: summaries[row.id] ?? "edited note",
    });
  }

  // Newest-first. Mark the first (newest) as HEAD = the live "Current version".
  entries.reverse();
  if (entries.length > 0) entries[0].isHead = true;

  const totalVersions = entries.length;

  // Pagination: the newest `pageCount * PAGE_SIZE` entries.
  const limit = pageCount * VERSION_PAGE_SIZE;
  const visible = entries.slice(0, limit);
  const hasMore = entries.length > limit;

  // Group visible entries by day, then by contiguous same-editor run.
  const days: DayGroup[] = [];
  for (const entry of visible) {
    const dayKey = dayKeyOf(entry.ts);
    let day = days[days.length - 1];
    if (!day || day.dayKey !== dayKey) {
      day = { dayKey, label: dayLabelOf(entry.ts, now), sessions: [] };
      days.push(day);
    }
    const lastSession = day.sessions[day.sessions.length - 1];
    if (lastSession && lastSession.actor === entry.actor) {
      lastSession.versions.push(entry);
      // versions are newest-first, so the run's start is the LAST pushed.
      lastSession.startTs = entry.ts;
    } else {
      day.sessions.push({
        actor: entry.actor,
        owner: entry.owner,
        versions: [entry],
        startTs: entry.ts,
        endTs: entry.ts,
        collapsible: false,
      });
    }
  }
  // Mark runs that are long enough to collapse by default.
  for (const day of days) {
    for (const session of day.sessions) {
      session.collapsible = session.versions.length >= SESSION_MIN_RUN;
    }
  }

  const summarized: SummarizedGroup | null = boundary
    ? {
        versionIndex: 0,
        rowId: boundary.id,
        ts: boundary.ts,
        dayLabel: dayLabelOf(boundary.ts, now),
        compactedRowCount: boundary.compacted_row_count,
      }
    : null;

  return { days, summarized, hasMore, totalVersions };
}

/**
 * Build a "Morgan, 9:01-9:40, 7 versions" label for a collapsed session run.
 * Pure string assembly so the component stays declarative. `displayName` is the
 * resolved editor label (with the "(PI)" badge) the caller passes in.
 */
export function sessionRangeLabel(
  session: SessionGroup,
  displayName: string,
): string {
  const start = clockOf(session.startTs);
  const end = clockOf(session.endTs);
  const count = session.versions.length;
  const range = start === end ? start : `${start}-${end}`;
  return `${displayName}, ${range}, ${count} versions`;
}
