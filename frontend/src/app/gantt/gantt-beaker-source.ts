// sequence editor master (Gantt source sub-bot). BeakerSearch step 3, the first
// per-page SOURCE, the Gantt page.
//
// This module is the PURE builder behind the Gantt's BeakerSearch registration.
// It takes a plain snapshot of the page state (tasks, projects, goals, filters,
// selection, the date window) plus a bag of handler callbacks, and returns one
// BeakerSearchSource (context card + commands + suggested ids + nav groups). It
// reads NO store, holds NO React, and calls NO Date.now(), so the context-card
// copy, the command ids / groups / enabled gating, the Suggested ordering, and
// the nav groups are all unit-tested without rendering. The thin
// useGanttBeakerSource hook (co-located) wires the live store slices + queries +
// handlers into this builder inside a useMemo.
//
// The spec is docs/proposals/beakersearch-gantt.md. Where that doc's sketch uses
// an older function-based source shape (context() / suggested() / entities()),
// this maps it onto the ACTUAL generic BeakerSearchSource contract, contextCard
// + commands (with stable ids + page-defined groups) + suggestedIds + navGroups.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import type { IconName } from "@/components/icons";
import type { BeakerSearchSource } from "@/components/beaker-search/types";
import type {
  EditorCommand,
  PaletteContextCard,
  PaletteNavGroup,
  PaletteNavItem,
} from "@/components/sequences/editor-commands";
import type { HighLevelGoal, Project, Task } from "@/lib/types";

// ── Page-defined command groups ────────────────────────────────────────────
// These print between the page's nav groups and the global "Go to" / "App"
// layer, in first-appearance order (see editor-commands commandGroupOrder).
export const GANTT_GROUP_SELECTED_TASK = "Selected task";
export const GANTT_GROUP_SELECTED_GOAL = "Selected goal";
export const GANTT_GROUP_CREATE = "Create";
export const GANTT_GROUP_FILTER = "Filter and scope";
export const GANTT_GROUP_TIMELINE = "Timeline view";

// ── Date-window shape (computed by the caller from ganttStartDate + viewMode) ─
export interface GanttWindow {
  /** Pre-formatted "Mon DD" label for the window start. */
  startLabel: string;
  /** Pre-formatted "Mon DD" label for the window end. */
  endLabel: string;
}

// ── The plain state snapshot the builder reads ─────────────────────────────
export interface GanttSourceData {
  /** Own + shared-with-me tasks (the page's allTasks). */
  allTasks: Task[];
  /** The on-screen-scoped tasks (filteredTasks), for the empty-query nav list. */
  filteredTasks: Task[];
  /** Non-archived projects (activeProjects). */
  activeProjects: Project[];
  /** All goals on the page. */
  goals: HighLevelGoal[];
  /** Every tag known to the page (allTags), for the per-tag filter commands. */
  allTags: string[];

  // Filters / scope (ON-SCREEN).
  projectFilterMode: "all" | "explicit";
  selectedProjectIds: string[];
  selectedTags: string[];
  showShared: boolean;
  ganttStartDate: string | null;
  window: GanttWindow;

  // Selection (SELECTED).
  editingTaskKey: string | null;
  editingGoal: HighLevelGoal | null;

  // Hover (HOVERED). The bar the cursor was over when the palette opened,
  // resolved by the hook from the data-beaker-target key (task or goal). SELECTED
  // always outranks this, so a real open entity wins over a stale hover. Null when
  // nothing tagged was under the pointer.
  hovered:
    | { kind: "task"; task: Task }
    | { kind: "goal"; goal: HighLevelGoal }
    | null;

  /** Session-local recently-opened task keys (newest first), for the
   *  "Recently opened" nav group. */
  recentTaskKeys: string[];

  // Pre-computed helpers the builder needs but must not derive itself (keeps
  // the builder pure and the keying identical to the page).
  /** taskKey(task) for a task, the composite "{ns}:{id}". */
  taskKeyOf: (task: Task) => string;
  /** encodeFilterKey(project), the composite filter key. */
  filterKeyOf: (project: Project) => string;
  /** The STANDALONE_FILTER_KEY sentinel. */
  standaloneFilterKey: string;
}

// ── The handler bag (closures over store actions + apis + refetch) ─────────
export interface GanttSourceHandlers {
  setEditingTaskKey: (key: string | null) => void;
  setEditingGoal: (goal: HighLevelGoal | null) => void;
  setProjectFilterMode: (mode: "all" | "explicit") => void;
  setSelectedProjects: (keys: string[]) => void;
  toggleTag: (tag: string) => void;
  setShowShared: (show: boolean) => void;
  setGanttStartDate: (date: string | null) => void;
  ganttNavigateWeeks: (weeks: number) => void;
  setViewMode: (value: string) => void;
  setNewTaskStartDate: (date: string | null) => void;
  /** The page's create-task flow (setIsCreatingTask(true)). */
  createTask: () => void;
  /** The page's create-goal flow (setIsCreatingGoal(true)). */
  createGoal: () => void;
  /** Toggle a task's is_complete via tasksApi.update + refetch. */
  markTaskComplete: (task: Task) => void | Promise<void>;
  /** confirm() then tasksApi.delete + refetch. */
  deleteTask: (task: Task) => void | Promise<void>;
  /** Toggle a goal's is_complete via goalsApi.update + refetch. */
  markGoalComplete: (goal: HighLevelGoal) => void | Promise<void>;
  /** The page's handleDeleteGoal (confirm + goalsApi.delete + refetch + clear). */
  deleteGoal: (goal: HighLevelGoal) => void | Promise<void>;
}

// ── The eight VIEW_MODES, mirrored from Toolbar so the builder can stay pure
// (no import of the React component). value matches the store's ViewMode union. ─
export const GANTT_VIEW_MODES: { label: string; value: string }[] = [
  { label: "1W", value: "1week" },
  { label: "2W", value: "2week" },
  { label: "3W", value: "3week" },
  { label: "1M", value: "1month" },
  { label: "3M", value: "3month" },
  { label: "6M", value: "6month" },
  { label: "1Y", value: "1year" },
  { label: "All", value: "all" },
];

/** A task is read-only when it is shared into me without edit rights. The exact
 *  predicate the page uses at the TaskDetailPopup callsite (spec 2.6). */
export function isGanttTaskReadOnly(task: Task): boolean {
  return task.is_shared_with_me === true && task.shared_permission !== "edit";
}

/** A goal is read-only for destructive actions when it is shared into me. The
 *  HighLevelGoal shape carries no is_shared_with_me / shared_permission flag the
 *  way Task does (only owner + shared_with), so v1 treats every goal on the page
 *  as owner-editable per spec 8.4 ("owner goals fully editable; refine when goal
 *  sharing UI settles"). The predicate stays here as the single seam to upgrade
 *  once goals expose a real shared flag. */
export function isGanttGoalReadOnly(_goal: HighLevelGoal): boolean {
  return false;
}

/** The project a task belongs to within the active set (composite owner:id), or
 *  null for standalone / cross-owner shared tasks. */
function projectOfTask(task: Task, projects: Project[]): Project | null {
  return (
    projects.find((p) => p.id === task.project_id && p.owner === task.owner) ??
    null
  );
}

/** The human label for a task's project in an echo line. */
function projectLabelForTask(task: Task, projects: Project[]): string {
  if (task.is_shared_with_me) return task.owner ? `shared by ${task.owner}` : "shared";
  const proj = projectOfTask(task, projects);
  return proj ? proj.name : "Standalone";
}

/** The scope summary line for the context card (spec 2.5). Reuses the exact
 *  projectFilterLabel logic from Toolbar (lines ~153-182) for the project part. */
export function ganttScopeSummary(data: GanttSourceData): string {
  const parts: string[] = [];

  // Project part.
  if (data.projectFilterMode === "all") {
    parts.push("All projects");
  } else if (data.selectedProjectIds.length === 0) {
    parts.push("No projects");
  } else if (data.selectedProjectIds.length === 1) {
    const onlyKey = data.selectedProjectIds[0];
    if (onlyKey === data.standaloneFilterKey) {
      parts.push("Standalone");
    } else {
      const match = data.activeProjects.find((p) => data.filterKeyOf(p) === onlyKey);
      parts.push(match ? match.name : "1 project");
    }
  } else {
    parts.push(`${data.selectedProjectIds.length} projects`);
  }

  // Tag part.
  if (data.selectedTags.length === 1) {
    parts.push(`tag ${data.selectedTags[0]}`);
  } else if (data.selectedTags.length > 1) {
    parts.push(`tags ${data.selectedTags.map((t) => `#${t}`).join(" ")}`);
  }

  // Window part.
  parts.push(`${data.window.startLabel} to ${data.window.endLabel}`);

  // Shared part, only when on AND at least one shared task is in view (spec 2.5,
  // suppress the noise otherwise).
  if (data.showShared && data.filteredTasks.some((t) => t.is_shared_with_me)) {
    parts.push("incl. shared");
  }

  return parts.join(", ");
}

/** Resolve the current SELECTED entity (task beats goal). */
function resolveSelection(
  data: GanttSourceData,
): { kind: "task"; task: Task } | { kind: "goal"; goal: HighLevelGoal } | null {
  if (data.editingTaskKey) {
    const task = data.allTasks.find((t) => data.taskKeyOf(t) === data.editingTaskKey);
    if (task) return { kind: "task", task };
  }
  if (data.editingGoal) return { kind: "goal", goal: data.editingGoal };
  return null;
}

/** Resolve the active context entity by the SELECTED > HOVERED rule. When a real
 *  selection exists, hovered is ignored. When nothing is selected, the bar the
 *  cursor was pointing at drives the SAME context-card selection line and the
 *  SAME Suggested action set, only the framing ("pointing at" vs "selected")
 *  changes. `isHovered` lets the copy and the Suggested hint switch voice without
 *  duplicating the per-entity logic. */
function resolveContext(data: GanttSourceData):
  | { kind: "task"; task: Task; isHovered: boolean }
  | { kind: "goal"; goal: HighLevelGoal; isHovered: boolean }
  | null {
  const sel = resolveSelection(data);
  if (sel?.kind === "task") return { kind: "task", task: sel.task, isHovered: false };
  if (sel?.kind === "goal") return { kind: "goal", goal: sel.goal, isHovered: false };

  const hov = data.hovered;
  if (hov?.kind === "task") return { kind: "task", task: hov.task, isHovered: true };
  if (hov?.kind === "goal") return { kind: "goal", goal: hov.goal, isHovered: true };
  return null;
}

/** Build the context card (spec 2.5). Two stacked lines, the scope line as
 *  title + meta, the selection line under a hairline divider when SELECTED. */
function buildContextCard(data: GanttSourceData): PaletteContextCard {
  const ctx = resolveContext(data);
  let selection: PaletteContextCard["selection"];

  // The selection line frames a real selection as the open entity and a hover as
  // "the bar you were pointing at", so the user knows which one drives Suggested.
  if (ctx?.kind === "task") {
    const t = ctx.task;
    const bits = [`${t.start_date} to ${t.end_date}`];
    if (t.is_complete) bits.push("complete");
    if (isGanttTaskReadOnly(t)) bits.push("shared, view only");
    const lead = ctx.isHovered ? "Pointing at " : "";
    selection = { iconName: "list", text: `${lead}${t.name}, ${bits.join(", ")}` };
  } else if (ctx?.kind === "goal") {
    const g = ctx.goal;
    const done = g.smart_goals.filter((s) => s.is_complete).length;
    const total = g.smart_goals.length;
    const bits = ["milestone", `due ${g.end_date}`];
    if (total > 0) bits.push(`${done} of ${total} done`);
    const lead = ctx.isHovered ? "Pointing at " : "";
    selection = { iconName: "map", text: `${lead}${g.name}, ${bits.join(", ")}` };
  }

  return {
    iconName: "history",
    title: "Gantt",
    meta: ganttScopeSummary(data),
    selection,
  };
}

/** The single dominant project when the filter is scoped to exactly one real
 *  project (spec 3.3), else null. */
function dominantProject(data: GanttSourceData): Project | null {
  if (data.projectFilterMode !== "explicit") return null;
  if (data.selectedProjectIds.length !== 1) return null;
  const key = data.selectedProjectIds[0];
  if (key === data.standaloneFilterKey) return null;
  return data.activeProjects.find((p) => data.filterKeyOf(p) === key) ?? null;
}

/** Whether any filter is currently narrowing the view (spec 3.5). */
function anyFilterActive(data: GanttSourceData): boolean {
  return (
    data.projectFilterMode === "explicit" ||
    data.selectedTags.length > 0 ||
    !data.showShared
  );
}

/** Build the full command set with stable ids + page-defined groups (spec 3 +
 *  6). The selection-specific rows carry stable ids the Suggested rule names. */
function buildCommands(
  data: GanttSourceData,
  handlers: GanttSourceHandlers,
): EditorCommand[] {
  const out: EditorCommand[] = [];
  // SELECTED > HOVERED. A hovered bar drives the same action rows as a selection
  // (same ids, same enabled gating), so Suggested can reference them either way.
  const ctx = resolveContext(data);

  // ── Selected / hovered task actions (spec 3.1). v1 simplifications, Shift /
  // Add dep / Move all open the detail popup where those edits live. ─────────
  if (ctx?.kind === "task") {
    const t = ctx.task;
    const key = data.taskKeyOf(t);
    const ro = isGanttTaskReadOnly(t);
    out.push({
      id: "gantt-task-toggle-complete",
      label: `Mark "${t.name}" ${t.is_complete ? "incomplete" : "complete"}`,
      detail: t.is_complete ? "currently complete" : "currently in progress",
      group: GANTT_GROUP_SELECTED_TASK,
      iconName: "check",
      enabled: !ro,
      run: () => void handlers.markTaskComplete(t),
    });
    out.push({
      id: "gantt-task-shift-dates",
      label: `Shift "${t.name}" dates`,
      detail: `${t.start_date} to ${t.end_date}`,
      group: GANTT_GROUP_SELECTED_TASK,
      iconName: "history",
      enabled: !ro,
      run: () => handlers.setEditingTaskKey(key),
    });
    out.push({
      id: "gantt-task-add-dependency",
      label: `Add a dependency from "${t.name}"`,
      detail: "link to another experiment",
      group: GANTT_GROUP_SELECTED_TASK,
      iconName: "share",
      enabled: !ro && t.task_type === "experiment",
      run: () => handlers.setEditingTaskKey(key),
    });
    out.push({
      id: "gantt-task-open",
      label: `Open "${t.name}"`,
      detail: "view and edit details",
      group: GANTT_GROUP_SELECTED_TASK,
      iconName: "eye",
      run: () => handlers.setEditingTaskKey(key),
    });
    out.push({
      id: "gantt-task-move-project",
      label: `Move "${t.name}" to a project`,
      detail: `currently in ${projectLabelForTask(t, data.activeProjects)}`,
      group: GANTT_GROUP_SELECTED_TASK,
      iconName: "folder",
      enabled: !ro,
      run: () => handlers.setEditingTaskKey(key),
    });
    out.push({
      id: "gantt-task-delete",
      label: `Delete "${t.name}"`,
      detail: "moves to Trash",
      group: GANTT_GROUP_SELECTED_TASK,
      iconName: "trash",
      enabled: !ro,
      run: () => void handlers.deleteTask(t),
    });
  }

  // ── Selected / hovered goal actions (spec 3.2). ───────────────────────────
  if (ctx?.kind === "goal") {
    const g = ctx.goal;
    const ro = isGanttGoalReadOnly(g);
    out.push({
      id: "gantt-goal-edit",
      label: `Edit "${g.name}"`,
      detail: "milestone",
      group: GANTT_GROUP_SELECTED_GOAL,
      iconName: "pencil",
      run: () => handlers.setEditingGoal(g),
    });
    out.push({
      id: "gantt-goal-add-task",
      label: "Add a task under this goal",
      detail: "new experiment toward it",
      group: GANTT_GROUP_SELECTED_GOAL,
      iconName: "plus",
      run: () => {
        if (g.start_date) handlers.setNewTaskStartDate(g.start_date);
        handlers.createTask();
      },
    });
    out.push({
      id: "gantt-goal-toggle-complete",
      label: `Mark "${g.name}" ${g.is_complete ? "incomplete" : "complete"}`,
      detail: g.is_complete ? "currently complete" : "currently open",
      group: GANTT_GROUP_SELECTED_GOAL,
      iconName: "check",
      enabled: !ro,
      run: () => void handlers.markGoalComplete(g),
    });
    out.push({
      id: "gantt-goal-delete",
      label: `Delete "${g.name}"`,
      detail: "moves to Trash",
      group: GANTT_GROUP_SELECTED_GOAL,
      iconName: "trash",
      enabled: !ro,
      run: () => void handlers.deleteGoal(g),
    });
  }

  // ── Create (spec 6). ──────────────────────────────────────────────────────
  out.push({
    id: "gantt-new-task",
    label: "New task",
    group: GANTT_GROUP_CREATE,
    iconName: "plus",
    run: handlers.createTask,
  });
  out.push({
    id: "gantt-new-goal",
    label: "New high-level goal",
    group: GANTT_GROUP_CREATE,
    iconName: "map",
    run: handlers.createGoal,
  });

  // ── Filter and scope (spec 6). ────────────────────────────────────────────
  out.push({
    id: "gantt-show-all-projects",
    label: "Show all projects",
    group: GANTT_GROUP_FILTER,
    iconName: "folder",
    enabled: data.projectFilterMode !== "all",
    run: () => handlers.setProjectFilterMode("all"),
  });
  out.push({
    id: "gantt-show-standalone",
    label: "Show only standalone tasks",
    keywords: "no project orphan",
    group: GANTT_GROUP_FILTER,
    iconName: "list",
    run: () => {
      handlers.setProjectFilterMode("explicit");
      handlers.setSelectedProjects([data.standaloneFilterKey]);
    },
  });
  for (const tag of data.allTags) {
    const active = data.selectedTags.includes(tag);
    out.push({
      id: `gantt-tag-${tag}`,
      label: `${active ? "Remove" : "Filter by"} tag #${tag}`,
      keywords: tag,
      group: GANTT_GROUP_FILTER,
      iconName: "list",
      run: () => handlers.toggleTag(tag),
    });
  }
  out.push({
    id: "gantt-toggle-shared",
    label: "Toggle shared tasks",
    detail: data.showShared ? "currently shown" : "currently hidden",
    keywords: "shared visibility",
    group: GANTT_GROUP_FILTER,
    iconName: "users",
    run: () => handlers.setShowShared(!data.showShared),
  });
  out.push({
    id: "gantt-clear-filters",
    label: "Clear all filters",
    group: GANTT_GROUP_FILTER,
    iconName: "refresh",
    enabled: anyFilterActive(data),
    run: () => {
      handlers.setProjectFilterMode("all");
      for (const tag of data.selectedTags) handlers.toggleTag(tag);
      handlers.setShowShared(true);
    },
  });

  // ── Timeline view (spec 6). ───────────────────────────────────────────────
  for (const vm of GANTT_VIEW_MODES) {
    out.push({
      id: `gantt-view-${vm.value}`,
      label: `View ${vm.label}`,
      keywords: "timeline zoom range",
      group: GANTT_GROUP_TIMELINE,
      iconName: "history",
      run: () => handlers.setViewMode(vm.value),
    });
  }
  out.push({
    id: "gantt-week-forward",
    label: "Go forward one week",
    group: GANTT_GROUP_TIMELINE,
    iconName: "caret",
    run: () => handlers.ganttNavigateWeeks(1),
  });
  out.push({
    id: "gantt-week-back",
    label: "Go back one week",
    group: GANTT_GROUP_TIMELINE,
    iconName: "caret",
    run: () => handlers.ganttNavigateWeeks(-1),
  });
  out.push({
    id: "gantt-go-today",
    label: "Go to today",
    group: GANTT_GROUP_TIMELINE,
    iconName: "history",
    enabled: data.ganttStartDate !== null,
    run: () => handlers.setGanttStartDate(null),
  });

  return out;
}

/** The ordered ids of the contextually relevant commands for the current
 *  selection / filter context (spec 3, the Suggested rule). These ids must all
 *  exist in buildCommands; ids that are disabled / absent are silently skipped
 *  by the palette. */
function buildSuggestedIds(data: GanttSourceData): string[] {
  const ids: string[] = [];
  // SELECTED > HOVERED, both lead with the same per-entity action ids.
  const ctx = resolveContext(data);

  if (ctx?.kind === "task") {
    ids.push(
      "gantt-task-toggle-complete",
      "gantt-task-shift-dates",
      "gantt-task-add-dependency",
      "gantt-task-open",
      "gantt-task-move-project",
      "gantt-task-delete",
    );
  } else if (ctx?.kind === "goal") {
    ids.push(
      "gantt-goal-edit",
      "gantt-goal-add-task",
      "gantt-goal-toggle-complete",
      "gantt-goal-delete",
    );
  }

  // Filter-active suggestions (spec 3.3 / 3.4), ranked below a real selection.
  const proj = dominantProject(data);
  if (proj) ids.push("gantt-show-all-projects");
  if (data.selectedTags.length > 0) {
    for (const tag of data.selectedTags) ids.push(`gantt-tag-${tag}`);
  }

  // Always-on orientation defaults (spec 3.5), ranked last.
  ids.push("gantt-new-task", "gantt-new-goal");
  if (anyFilterActive(data)) ids.push("gantt-clear-filters");
  if (data.ganttStartDate !== null) ids.push("gantt-go-today");

  return ids;
}

/** The Suggested heading hint (spec 3). */
function buildSuggestedHint(data: GanttSourceData): string | undefined {
  const ctx = resolveContext(data);
  if (ctx?.kind === "task") {
    return ctx.isHovered ? "for the task you were pointing at" : "for the selected task";
  }
  if (ctx?.kind === "goal") {
    return ctx.isHovered
      ? "for the milestone you were pointing at"
      : "for the selected milestone";
  }
  return undefined;
}

/** A task nav item (spec 4 / 5). */
function taskNavItem(
  task: Task,
  data: GanttSourceData,
  handlers: GanttSourceHandlers,
  detailOverride?: string,
): PaletteNavItem {
  const key = data.taskKeyOf(task);
  const projectName = projectLabelForTask(task, data.activeProjects);
  const keywords = [
    ...(task.tags ?? []),
    projectName,
    task.is_shared_with_me ? task.owner : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    id: key,
    label: task.name,
    detail: detailOverride ?? `${projectName}, ${task.start_date} to ${task.end_date}`,
    keywords,
    iconName: "list",
    tone: "task",
    onRun: () => handlers.setEditingTaskKey(key),
  };
}

/** Build the nav groups (spec 4 + 5). Order, tasks, projects, goals, recents. */
function buildNavGroups(
  data: GanttSourceData,
  handlers: GanttSourceHandlers,
): PaletteNavGroup[] {
  const groups: PaletteNavGroup[] = [];

  // Jump to a task, scoped to filteredTasks (on-screen) in the resting view.
  const taskItems = data.filteredTasks.map((t) => taskNavItem(t, data, handlers));
  groups.push({
    title: "Jump to a task",
    hint: `in view (${taskItems.length})`,
    items: taskItems,
  });

  // Jump to a project (sets the explicit filter to that one project).
  const projectItems: PaletteNavItem[] = data.activeProjects.map((p) => {
    const fk = data.filterKeyOf(p);
    return {
      id: fk,
      label: p.name,
      detail: "scope the timeline to this project",
      keywords: [...(p.tags ?? []), p.owner].filter(Boolean).join(" "),
      iconName: "folder",
      tone: "project",
      onRun: () => {
        handlers.setProjectFilterMode("explicit");
        handlers.setSelectedProjects([fk]);
      },
    };
  });
  groups.push({ title: "Jump to a project", items: projectItems });

  // Jump to a goal (opens the goal modal).
  const goalItems: PaletteNavItem[] = data.goals.map((g) => ({
    id: String(g.id),
    label: g.name,
    detail: `milestone, due ${g.end_date}`,
    keywords: g.smart_goals.map((s) => s.text).join(" "),
    iconName: "map",
    tone: "goal",
    onRun: () => handlers.setEditingGoal(g),
  }));
  groups.push({ title: "Jump to a goal", items: goalItems });

  // Recently opened (session-local). Omit the whole group when empty (spec 5).
  const recentItems: PaletteNavItem[] = [];
  for (const key of data.recentTaskKeys) {
    const t = data.allTasks.find((x) => data.taskKeyOf(x) === key);
    if (t) recentItems.push(taskNavItem(t, data, handlers, "opened recently"));
  }
  if (recentItems.length > 0) {
    groups.push({ title: "Recently opened", items: recentItems });
  }

  return groups;
}

/** Build the whole Gantt BeakerSearch source from a pure state snapshot. */
export function buildGanttSource(
  data: GanttSourceData,
  handlers: GanttSourceHandlers,
): BeakerSearchSource {
  return {
    id: "gantt",
    contextCard: buildContextCard(data),
    commands: buildCommands(data, handlers),
    suggestedIds: buildSuggestedIds(data),
    suggestedHint: buildSuggestedHint(data),
    navGroups: buildNavGroups(data, handlers),
  };
}

// Re-export so the hook / tests can name the icon set without re-deriving it.
export type { IconName };
