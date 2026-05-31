// Version Control Phase 3 (VC-Phase3-Project sub-bot of HR, 2026-05-31): the
// read-only viewer adapter for the Project entity. The generic grouping +
// pagination backbone lives in entity-viewer.ts; this is ONLY the
// Project-specific adapter: it projects a reconstructed canonical Project state
// to a diffable body + summarizes a change into a one-line row label. Modeled on
// task-viewer.ts.
//
// It consumes what the engine produces: RECONSTRUCTED canonical states (strings)
// from historyEngine.reconstructState(...). It NEVER parses unified-diff text.
//
// What a Project's "tracked content" is (the body the document column diffs):
// the on-disk project record fields the user edits through projectsApi.update +
// the Edit-project modal: the NAME (the title line), TAGS, COLOR, the weekend /
// 7-day schedule flag, the archive state, and the linked FUNDING account. These
// are the fields a `projectsApi.update` patch carries; they each surface as a
// localized line in the projected body so a single-field edit renders a real
// diff. Structural scalars that the canonical also tracks (sort_order, owner,
// shared_with) are not user-authored prose, so they are not anchored in the body
// (they still ride the underlying canonical diff if they ever change).
//
// IMPORTANT SCOPE NOTE: the project OVERVIEW prose lives in a SEPARATE
// `users/<owner>/projects/<id>-overview.md` file written by projectsApi.setOverview
// (NOT projectsApi.update), so it has no history hook and is intentionally OUT OF
// SCOPE for this chip (the same separate-file body-write problem the design doc
// flags as FLAG-M for Method markdown). This adapter projects only the record
// fields that flow through projectsApi.update.

import type { EntityViewerAdapter } from "./entity-viewer";
import type { HistoryEditKind } from "./types";

/**
 * The slice of a Project we diff + summarize. The reconstructed canonical state
 * is a pretty-printed JSON string of the tracked project (canonicalize.ts); this
 * projects it to the fields the viewer cares about.
 */
export interface ProjectProjection {
  name: string;
  /** Tags in stored order (each a localized checklist-style line). */
  tags: string[];
  /** Hex color string, or "" when unset. */
  color: string;
  /** The 7-day / weekend-active schedule flag. */
  weekendActive: boolean;
  /** Whether the project is archived (drives the archive / unarchive summary). */
  isArchived: boolean;
  /** Linked funding account id, or null when unlinked. */
  fundingAccountId: number | null;
  /** Concatenated diffable body. */
  body: string;
}

interface RawProject {
  name?: unknown;
  tags?: unknown;
  color?: unknown;
  weekend_active?: unknown;
  is_archived?: unknown;
  funding_account_id?: unknown;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Parse a reconstructed canonical state string into a ProjectProjection.
 * Tolerant: a malformed / empty state projects to all-empty fields so the viewer
 * degrades to "no content" rather than throwing.
 */
export function projectProjectState(
  canonical: string | null | undefined,
): ProjectProjection {
  const empty: ProjectProjection = {
    name: "",
    tags: [],
    color: "",
    weekendActive: false,
    isArchived: false,
    fundingAccountId: null,
    body: "",
  };
  if (!canonical || canonical.trim().length === 0) return empty;
  let parsed: RawProject;
  try {
    parsed = JSON.parse(canonical) as RawProject;
  } catch {
    return empty;
  }
  const name = asString(parsed.name);
  const tags = Array.isArray(parsed.tags)
    ? (parsed.tags as unknown[]).map((t) => asString(t)).filter((t) => t.length > 0)
    : [];
  const color = asString(parsed.color);
  const weekendActive = parsed.weekend_active === true;
  const isArchived = parsed.is_archived === true;
  const fundingAccountId =
    typeof parsed.funding_account_id === "number"
      ? parsed.funding_account_id
      : null;

  // The NAME is the single "#" title line so a name-only edit renders a real
  // diff (the parity with the Task / Notes adapters), and a single "#" heading
  // cannot collide with a "##" metadata heading below.
  const parts: string[] = [];
  if (name.trim()) parts.push(`# ${name.trim()}`);

  // Each editable metadata field is anchored under its own heading so the
  // line-diff localizes a change to the field that actually moved (same
  // anchoring rationale as the Task adapter's per-surface headings).
  const metaLines: string[] = [];
  if (tags.length > 0) metaLines.push(`Tags: ${tags.join(", ")}`);
  if (color.trim()) metaLines.push(`Color: ${color.trim()}`);
  metaLines.push(`Schedule: ${weekendActive ? "7-day (weekends active)" : "weekdays only"}`);
  if (isArchived) metaLines.push("Status: archived");
  if (fundingAccountId !== null) metaLines.push(`Funding account: #${fundingAccountId}`);
  if (metaLines.length > 0) parts.push(`## Details\n${metaLines.join("\n")}`);

  const body = parts.join("\n\n");

  return {
    name,
    tags,
    color,
    weekendActive,
    isArchived,
    fundingAccountId,
    body,
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
 *   - first version of a record          -> "created project"
 *   - name changed                       -> "renamed project"
 *   - archive state toggled              -> "archived project" / "unarchived
 *                                           project"
 *   - tags changed                       -> "edited tags"
 *   - color changed                      -> "changed color"
 *   - schedule (weekend flag) changed    -> "changed schedule"
 *   - funding link changed               -> "linked funding" / "unlinked
 *                                           funding" / "changed funding"
 *   - nothing detectable                 -> "edited project"
 *
 * The restore / undo special-cases come FIRST (mirrors the Task adapter): a
 * restore + an undo both look like a plain content edit by diff alone, so
 * without the row kind they read identically and the timeline cannot tell a
 * restore from a real edit.
 */
export function summarizeProjectChange(
  before: ProjectProjection | null,
  after: ProjectProjection,
  kind?: HistoryEditKind,
): string {
  if (kind === "revert") return "Restored an earlier version";
  if (kind === "undo-revert") return "Undid a restore";

  if (before === null) return "created project";

  if (before.name !== after.name) return "renamed project";

  if (before.isArchived !== after.isArchived) {
    return after.isArchived ? "archived project" : "unarchived project";
  }

  if (before.tags.join(" ") !== after.tags.join(" ")) {
    return "edited tags";
  }

  if (before.color !== after.color) return "changed color";

  if (before.weekendActive !== after.weekendActive) return "changed schedule";

  if (before.fundingAccountId !== after.fundingAccountId) {
    if (before.fundingAccountId === null) return "linked funding";
    if (after.fundingAccountId === null) return "unlinked funding";
    return "changed funding";
  }

  return "edited project";
}

/**
 * VC Phase 3: the Project EntityViewerAdapter. The generic
 * EntityVersionHistorySidebar consumes this exactly as it consumes taskAdapter /
 * notesAdapter.
 */
export const projectAdapter: EntityViewerAdapter<ProjectProjection> = {
  projectBody: projectProjectState,
  summarize: summarizeProjectChange,
};
