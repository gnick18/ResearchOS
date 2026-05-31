// Version Control Phase 3 (VC-Phase3-Task sub-bot of HR, 2026-05-31): the
// read-only viewer adapter for the Task pilot. The generic grouping +
// pagination backbone lives in entity-viewer.ts; this is ONLY the Task-specific
// adapter: it projects a reconstructed canonical Task state to a diffable body +
// summarizes a change into a one-line row label. Modeled on notes-viewer.ts.
//
// It consumes what the engine produces: RECONSTRUCTED canonical states (strings)
// from historyEngine.reconstructState(...). It NEVER parses unified-diff text.
//
// A Task is ONE record with three task_type variants (experiment / list /
// purchase, see types.ts). Version history is live for ALL three, so the
// projected body + the summary labels both branch on task_type so a list edit
// or a purchase edit diffs its own real content with its own vocabulary
// (task-viewer-polish sub-bot of HR, 2026-05-31: list / purchase tasks used to
// fall through the experiment-only projection, so a sub-task edit rendered an
// empty diff body and every change read "edited experiment").
//
// What a Task's "lab content" is (the body the document column diffs):
//   - COMMON (every variant): the task name (the title line) + the deviation_log
//     (the running notes field every task type carries).
//   - experiment: PLUS per-method body_override + variation_notes (the
//     documented per-method protocol deviations on each TaskMethodAttachment).
//   - list: PLUS the sub_tasks checklist (each sub-task's text + checked state).
//   - purchase: nothing extra lives ON the task record. The line items are
//     separate PurchaseItem entities (record_type "purchase_item"), not embedded
//     fields, so a purchase task projects name + deviation_log only.
// Structural scalar fields (start_date, duration_days, is_complete, tags, ...)
// still appear in the canonical and drive the summary labels, but the diffable
// body focuses on the prose the user actually writes.

import type { EntityViewerAdapter } from "./entity-viewer";
import type { HistoryEditKind } from "./types";

/** The three Task variants (see Task.task_type in types.ts). */
export type TaskType = "experiment" | "list" | "purchase";

/**
 * The slice of a Task we diff + summarize. The reconstructed canonical state is
 * a pretty-printed JSON string of the tracked task (canonicalize.ts); this
 * projects it to the fields the viewer cares about. Which content fields are
 * meaningful depends on `taskType`: experiments carry per-method prose, lists
 * carry sub_tasks, purchases carry only the common name + deviation log.
 */
export interface TaskProjection {
  /**
   * The task variant. Drives both the content the body projects and the
   * vocabulary the summary uses. Defaults to "experiment" when the canonical
   * predates the field (the pilot shipped on experiments first).
   */
  taskType: TaskType;
  name: string;
  /** The task's running notes field (markdown). Present on every variant. */
  deviationLog: string;
  /**
   * Per-method documented deviations, in method order, for finer summaries.
   * Only meaningful for experiment tasks; empty for list / purchase.
   */
  methods: { methodId: number; bodyOverride: string; variationNotes: string }[];
  /**
   * The list checklist, in order, for finer summaries. Only meaningful for list
   * tasks; empty for experiment / purchase.
   */
  subTasks: { id: string; text: string; isComplete: boolean }[];
  /** Concatenated diffable body, projected per task_type. */
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

interface RawSubTask {
  id?: unknown;
  text?: unknown;
  is_complete?: unknown;
}

interface RawTask {
  task_type?: unknown;
  name?: unknown;
  deviation_log?: unknown;
  method_attachments?: unknown;
  sub_tasks?: unknown;
  is_complete?: unknown;
  start_date?: unknown;
  duration_days?: unknown;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asTaskType(v: unknown): TaskType {
  return v === "list" || v === "purchase" ? v : "experiment";
}

/**
 * Parse a reconstructed canonical state string into a TaskProjection. Tolerant:
 * a malformed / empty state projects to all-empty fields so the viewer degrades
 * to "no content" rather than throwing.
 */
export function projectTaskState(canonical: string | null | undefined): TaskProjection {
  const empty: TaskProjection = {
    taskType: "experiment",
    name: "",
    deviationLog: "",
    methods: [],
    subTasks: [],
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
  const taskType = asTaskType(parsed.task_type);
  const rawMethods = Array.isArray(parsed.method_attachments)
    ? (parsed.method_attachments as RawMethodAttachment[])
    : [];
  const methods = rawMethods.map((m) => ({
    methodId: typeof m?.method_id === "number" ? m.method_id : -1,
    bodyOverride: asString(m?.body_override),
    variationNotes: asString(m?.variation_notes),
  }));
  const rawSubTasks = Array.isArray(parsed.sub_tasks)
    ? (parsed.sub_tasks as RawSubTask[])
    : [];
  const subTasks = rawSubTasks.map((s) => ({
    id: asString(s?.id),
    text: asString(s?.text),
    isComplete: s?.is_complete === true,
  }));
  const name = asString(parsed.name);
  const deviationLog = asString(parsed.deviation_log);

  // COMMON to every variant: the task NAME (a single "#" title line) + the
  // deviation LOG. The leading "# <name>" line lets a name-only edit render a
  // real diff (the FIX-B parity with the Notes adapter), and a single "#"
  // heading cannot collide with a "##" per-method / per-sub-task heading.
  const parts: string[] = [];
  if (name.trim()) parts.push(`# ${name.trim()}`);
  if (deviationLog.trim()) parts.push(deviationLog);

  // VARIANT-SPECIFIC content, each anchored by a heading so the line-diff
  // localizes a change to the field that actually moved (same anchoring
  // rationale as the Notes adapter's per-entry headings).
  if (taskType === "experiment") {
    const methodsBlock = methods
      .map((m) => {
        const block: string[] = [`## Method ${m.methodId}`];
        if (m.bodyOverride.trim()) block.push(m.bodyOverride);
        if (m.variationNotes.trim())
          block.push(`Variation notes:\n${m.variationNotes}`);
        return block.join("\n");
      })
      .filter((block) => block.includes("\n")) // drop heading-only (empty) methods
      .join("\n\n");
    if (methodsBlock) parts.push(methodsBlock);
  } else if (taskType === "list") {
    // Each sub-task is one checklist line carrying its text + checked state, so
    // a toggle, a rename, or an add/remove all surface as a localized line diff.
    const subTasksBlock = subTasks
      .map((s) => `- [${s.isComplete ? "x" : " "}] ${s.text}`)
      .join("\n");
    if (subTasksBlock.trim()) parts.push(`## Sub-tasks\n${subTasksBlock}`);
  }
  // purchase: nothing extra on the task record (the line items are separate
  // PurchaseItem entities). The common name + deviation log already projected.

  const body = parts.join("\n\n");

  return {
    taskType,
    name,
    deviationLog,
    methods,
    subTasks,
    body,
    isComplete: parsed.is_complete === true,
    startDate: asString(parsed.start_date),
    durationDays:
      typeof parsed.duration_days === "number" ? parsed.duration_days : null,
  };
}

/**
 * The noun a summary uses for this task variant. Experiments read "experiment",
 * lists read "list", purchases read "purchase"; this keeps the "created ...",
 * "renamed ...", and fallback "edited ..." labels honest per task_type rather
 * than always saying "experiment".
 */
function taskNoun(taskType: TaskType): string {
  return taskType;
}

/**
 * Derive a one-line change summary by comparing a version's projected state
 * against its predecessor's. Pure: both projections are caller-supplied
 * reconstructed states (no Date.now, no engine calls). The vocabulary is
 * task_type-aware: the noun follows the variant (experiment / list / purchase)
 * and the content branches diff the field that variant actually carries.
 *
 * Summary precedence (most specific first):
 *   - restore row (kind "revert")        -> "Restored an earlier version"
 *   - undo row (kind "undo-revert")      -> "Undid a restore"
 *   - first version of a record          -> "created <noun>"
 *   - name changed                       -> "renamed <noun>"
 *   - completion toggled                 -> "marked complete" / "reopened"
 *   - schedule changed                   -> "rescheduled"
 *   - deviation log changed              -> "edited lab notes" (experiment) /
 *                                           "edited notes" (list / purchase)
 *   - (experiment) a method's prose      -> "edited method N notes"
 *   - (experiment) method added/removed  -> "added method" / "removed method"
 *   - (list) a sub-task changed          -> "edited a sub-task" / "checked off
 *                                           a sub-task" / "reopened a sub-task"
 *   - (list) sub-task added / removed    -> "added a sub-task" / "removed a
 *                                           sub-task"
 *   - nothing detectable                 -> "edited <noun>"
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

  const noun = taskNoun(after.taskType);

  if (before === null) return `created ${noun}`;

  if (before.name !== after.name) return `renamed ${noun}`;

  if (before.isComplete !== after.isComplete) {
    return after.isComplete ? "marked complete" : "reopened";
  }

  if (
    before.startDate !== after.startDate ||
    before.durationDays !== after.durationDays
  ) {
    return "rescheduled";
  }

  if (before.deviationLog !== after.deviationLog) {
    // The deviation_log is the "lab notes" field on an experiment, but on a
    // list / purchase it is just a generic notes field, so the label drops the
    // "lab" qualifier outside the experiment variant.
    return after.taskType === "experiment" ? "edited lab notes" : "edited notes";
  }

  if (after.taskType === "list") {
    if (after.subTasks.length > before.subTasks.length) return "added a sub-task";
    if (after.subTasks.length < before.subTasks.length)
      return "removed a sub-task";

    // Same sub-task count: find which one changed (a toggle reads as a check /
    // reopen, a text edit reads as an edit).
    for (let i = 0; i < after.subTasks.length; i++) {
      const a = after.subTasks[i];
      const b = before.subTasks[i];
      if (!b) return "edited a sub-task";
      if (a.isComplete !== b.isComplete) {
        return a.isComplete ? "checked off a sub-task" : "reopened a sub-task";
      }
      if (a.text !== b.text) return "edited a sub-task";
    }

    return `edited ${noun}`;
  }

  // Experiment-only method diffing. Purchase tasks carry no per-method or
  // sub-task content, so they fall straight through to the fallback below.
  if (after.taskType === "experiment") {
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
  }

  return `edited ${noun}`;
}

/**
 * VC Phase 3: the Task EntityViewerAdapter, covering all three task_type
 * variants (experiment / list / purchase). The generic
 * EntityVersionHistorySidebar consumes this exactly as it consumes notesAdapter.
 */
export const taskAdapter: EntityViewerAdapter<TaskProjection> = {
  projectBody: projectTaskState,
  summarize: summarizeTaskChange,
};
