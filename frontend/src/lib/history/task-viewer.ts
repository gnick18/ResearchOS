// Version Control Phase 3 (VC-Phase3-Task sub-bot of HR, 2026-05-31): the
// read-only viewer adapter for the Task / Experiment pilot. The generic
// grouping + pagination backbone lives in entity-viewer.ts; this is ONLY the
// Task-specific adapter: it projects a reconstructed canonical Task state to a
// diffable body + summarizes a change into a one-line row label. Modeled on
// notes-viewer.ts.
//
// It consumes what the engine produces: RECONSTRUCTED canonical states (strings)
// from historyEngine.reconstructState(...). It NEVER parses unified-diff text.
//
// What a Task's "lab content" is (the body the document column diffs):
//   - the experiment's name (the title line),
//   - the deviation_log (the experiment's running lab-note field), and
//   - per-method body_override + variation_notes (the documented per-method
//     protocol deviations that live on each TaskMethodAttachment).
// Structural scalar fields (start_date, duration_days, is_complete, tags, ...)
// still appear in the canonical and drive the summary labels, but the diffable
// body focuses on the prose the user actually writes.

import type { EntityViewerAdapter } from "./entity-viewer";
import type { HistoryEditKind } from "./types";

/**
 * The slice of a Task we diff + summarize. The reconstructed canonical state is
 * a pretty-printed JSON string of the tracked task (canonicalize.ts); this
 * projects it to the fields the viewer cares about.
 */
export interface TaskProjection {
  name: string;
  /** The experiment's running lab-note field (markdown). */
  deviationLog: string;
  /** Per-method documented deviations, in method order, for finer summaries. */
  methods: { methodId: number; bodyOverride: string; variationNotes: string }[];
  /** Concatenated diffable body: name + deviation log + per-method prose. */
  body: string;
  /** Whether the task is marked complete (for the complete/incomplete summary). */
  isComplete: boolean;
  /** Start date + duration drive the "rescheduled" summary. */
  startDate: string;
  durationDays: number | null;
}

interface RawMethodAttachment {
  method_id?: unknown;
  body_override?: unknown;
  variation_notes?: unknown;
}

interface RawTask {
  name?: unknown;
  deviation_log?: unknown;
  method_attachments?: unknown;
  is_complete?: unknown;
  start_date?: unknown;
  duration_days?: unknown;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Parse a reconstructed canonical state string into a TaskProjection. Tolerant:
 * a malformed / empty state projects to all-empty fields so the viewer degrades
 * to "no content" rather than throwing.
 */
export function projectTaskState(canonical: string | null | undefined): TaskProjection {
  const empty: TaskProjection = {
    name: "",
    deviationLog: "",
    methods: [],
    body: "",
    isComplete: false,
    startDate: "",
    durationDays: null,
  };
  if (!canonical || canonical.trim().length === 0) return empty;
  let parsed: RawTask;
  try {
    parsed = JSON.parse(canonical) as RawTask;
  } catch {
    return empty;
  }
  const rawMethods = Array.isArray(parsed.method_attachments)
    ? (parsed.method_attachments as RawMethodAttachment[])
    : [];
  const methods = rawMethods.map((m) => ({
    methodId: typeof m?.method_id === "number" ? m.method_id : -1,
    bodyOverride: asString(m?.body_override),
    variationNotes: asString(m?.variation_notes),
  }));
  const name = asString(parsed.name);
  const deviationLog = asString(parsed.deviation_log);

  // The diff body is the task NAME + the deviation LOG + each method's
  // body-override + variation-notes prose, each anchored by a heading so the
  // line-diff localizes a change to the field/method that actually moved (same
  // anchoring rationale as the Notes adapter's per-entry headings). A single
  // "#" name heading cannot collide with a "##" per-method heading.
  const methodsBlock = methods
    .map((m) => {
      const parts: string[] = [`## Method ${m.methodId}`];
      if (m.bodyOverride.trim()) parts.push(m.bodyOverride);
      if (m.variationNotes.trim()) parts.push(`Variation notes:\n${m.variationNotes}`);
      return parts.join("\n");
    })
    .filter((block) => block.includes("\n")) // drop heading-only (empty) methods
    .join("\n\n");
  const parts: string[] = [];
  if (name.trim()) parts.push(`# ${name.trim()}`);
  if (deviationLog.trim()) parts.push(deviationLog);
  if (methodsBlock) parts.push(methodsBlock);
  const body = parts.join("\n\n");

  return {
    name,
    deviationLog,
    methods,
    body,
    isComplete: parsed.is_complete === true,
    startDate: asString(parsed.start_date),
    durationDays:
      typeof parsed.duration_days === "number" ? parsed.duration_days : null,
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
 *   - first version of a record          -> "created experiment"
 *   - name changed                       -> "renamed experiment"
 *   - completion toggled                 -> "marked complete" / "reopened"
 *   - schedule changed                   -> "rescheduled"
 *   - deviation log changed              -> "edited lab notes"
 *   - a method's prose changed           -> "edited method N notes"
 *   - method added / removed             -> "added method" / "removed method"
 *   - nothing detectable                 -> "edited experiment"
 *
 * The restore / undo special-cases come FIRST (mirrors the Notes adapter): a
 * restore + an undo both look like a plain content edit by diff alone, so
 * without the row kind they read identically and the timeline cannot tell a
 * restore from a real edit.
 */
export function summarizeTaskChange(
  before: TaskProjection | null,
  after: TaskProjection,
  kind?: HistoryEditKind,
): string {
  if (kind === "revert") return "Restored an earlier version";
  if (kind === "undo-revert") return "Undid a restore";

  if (before === null) return "created experiment";

  if (before.name !== after.name) return "renamed experiment";

  if (before.isComplete !== after.isComplete) {
    return after.isComplete ? "marked complete" : "reopened";
  }

  if (
    before.startDate !== after.startDate ||
    before.durationDays !== after.durationDays
  ) {
    return "rescheduled";
  }

  if (before.deviationLog !== after.deviationLog) return "edited lab notes";

  if (after.methods.length > before.methods.length) return "added method";
  if (after.methods.length < before.methods.length) return "removed method";

  // Same method count: find which method's prose changed.
  for (let i = 0; i < after.methods.length; i++) {
    const a = after.methods[i];
    const b = before.methods[i];
    if (
      !b ||
      a.bodyOverride !== b.bodyOverride ||
      a.variationNotes !== b.variationNotes
    ) {
      return `edited method ${a.methodId} notes`;
    }
  }

  return "edited experiment";
}

/**
 * VC Phase 3: the Task EntityViewerAdapter. The generic
 * EntityVersionHistorySidebar consumes this exactly as it consumes notesAdapter.
 */
export const taskAdapter: EntityViewerAdapter<TaskProjection> = {
  projectBody: projectTaskState,
  summarize: summarizeTaskChange,
};
