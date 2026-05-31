// Version Control Phase 3 (shared-generalization): the entity-agnostic backbone
// of the version-history viewer. This is the PURE, React-free grouping +
// pagination logic that USED to live in notes-viewer.ts; it is identical, just
// lifted to a generic home so every shareable entity reuses it.
//
// What is generic (here) vs entity-specific (the adapter):
//   - GENERIC: day -> session grouping, "earlier versions (summarized)" folding,
//     newest-first ordering, HEAD marking, pagination. None of it reads a single
//     entity field; it operates on HistoryRow timestamps/actors/owners only.
//   - ENTITY-SPECIFIC (EntityViewerAdapter): how a reconstructed canonical
//     string projects to a diffable BODY, and how two projections summarize into
//     a one-line change label. Each entity ships a ~40-line adapter
//     (notes-viewer.ts is the reference / regression canary).
//
// The viewer NEVER parses unified-diff text. It consumes reconstructed canonical
// states (strings) from the engine and projects them through the adapter.

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

// ── The entity adapter (the only entity-specific surface) ────────────────────

/**
 * What the engine reconstructs to is a pretty-printed canonical JSON string of
 * the tracked record. The adapter knows how to project that string to the slice
 * the viewer diffs + summarizes. `P` is the entity's projection shape; it MUST
 * carry a `body` string (the in-place diff body the document column renders).
 *
 * Each shareable entity ships one adapter (notes, tasks, projects, ...). The
 * Notes adapter (`notesAdapter` in notes-viewer.ts) is the reference shape and
 * the regression canary for this generalization.
 */
export interface EntityProjection {
  /** The diffable body string the document column renders. */
  body: string;
}

export interface EntityViewerAdapter<P extends EntityProjection = EntityProjection> {
  /**
   * Project a reconstructed canonical string to the diffable projection.
   * Tolerant: a malformed / empty canonical projects to an all-empty shape so
   * the viewer degrades to "no content" rather than throwing.
   */
  projectBody(canonical: string | null | undefined): P;
  /**
   * Derive a one-line change summary by comparing a version's projection
   * against its predecessor's. `before === null` means the first version of the
   * record. Pure (no Date.now, no engine calls).
   */
  summarize(before: P | null, after: P): string;
}

// ── View models (entity-agnostic) ────────────────────────────────────────────

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

// ── Day / session grouping (entity-agnostic) ─────────────────────────────────

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
 *                     generic "edited" label.
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
      summary: summaries[row.id] ?? "edited",
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
