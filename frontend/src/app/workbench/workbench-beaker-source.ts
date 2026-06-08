// sequence editor master (Workbench source sub-bot). BeakerSearch step 3, the
// third per-page SOURCE, the Workbench page (the hub).
//
// This module is the PURE builder behind the Workbench's BeakerSearch
// registration. It takes a plain snapshot of the page state (the active tab,
// the project filter, every domain's entity list, the focused selection, the
// recently-opened MRU) plus a bag of handler callbacks, and returns one
// BeakerSearchSource (context card + commands + suggested ids + nav groups). It
// reads NO store, holds NO React, and calls NO Date.now(), so the context-card
// copy, the command ids / groups / enabled gating, the Suggested ordering, the
// nav groups (incl. the cross-tab jumps + the tab switches), and the MRU
// resolution are all unit-tested without rendering. The thin
// useWorkbenchBeakerSource hook (co-located) wires the live store slices +
// queries + handlers into this builder inside a useMemo.
//
// Workbench is the most navigation-heavy page (five tabs over four data
// domains), so the headline is NAVIGATE. The jumps reach across tabs (a result
// on the Notes tab is reachable while you stand on the Experiments tab) via a
// lifted "open intent" the hook closes over (the requestOpen handler), modeled
// on the Notes tab's initialNotebookId deep-link-on-mount seam.
//
// The spec is docs/proposals/beakersearch-workbench.md and the approved visual
// target is docs/mockups/beakersearch-workbench-palette.html. This maps the
// spec's older function-based sketch (context() / suggested() / entities() /
// results()) onto the ACTUAL generic BeakerSearchSource contract, contextCard +
// commands (with stable ids + page-defined groups) + suggestedIds + navGroups.
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
  PaletteSubflow,
  PaletteTone,
} from "@/components/sequences/editor-commands";
import type { Note, Notebook, OneOnOne, Project, Task } from "@/lib/types";

// ── The five tabs (mirrors the page's local TabType) ───────────────────────
export type WorkbenchTab =
  | "projects"
  | "experiments"
  | "notes"
  | "lists"
  | "oneonone";

// ── Page-defined command groups ────────────────────────────────────────────
// These print between the page's nav groups and the global "Go to" / "App"
// layer, in first-appearance order (see editor-commands commandGroupOrder).
export const WORKBENCH_GROUP_SELECTED = "Selected";
export const WORKBENCH_GROUP_CREATE = "Create";
export const WORKBENCH_GROUP_TABS = "Switch tab";
export const WORKBENCH_GROUP_FILTER = "Filter";
export const WORKBENCH_GROUP_NOTEBOOKS = "Open a notebook";

// ── Registered icon names per entity family ────────────────────────────────
// The registry has no "flask" / "calendar" glyph (icon-guard blocks new inline
// svg), so each family maps to the nearest registered <Icon>. Experiments use
// "vial" (the bench tube), lists "list", projects "folder", notes "file",
// notebooks "book", 1:1s "users".
const ICON_EXPERIMENT: IconName = "vial";
const ICON_LIST: IconName = "list";
const ICON_PROJECT: IconName = "folder";
const ICON_NOTE: IconName = "file";
const ICON_NOTEBOOK: IconName = "book";
const ICON_ONEONONE: IconName = "users";

// ── The recently-opened MRU entity reference (spec 5) ──────────────────────
// A lightweight {kind, key} reference, persisted by the hook to per-user
// localStorage, re-resolved against the LIVE entity lists every render so the
// row label stays fresh and a deleted / unshared entity silently drops out.
export type WorkbenchEntityKind =
  | "experiment"
  | "list"
  | "note"
  | "notebook"
  | "oneonone"
  | "project";

export interface WorkbenchRecentRef {
  kind: WorkbenchEntityKind;
  /** The composite key, taskKey for experiments/lists, note-<owner>:<id> for
   *  notes, notebook-<id>, oneonone-<id>, <owner>:<id> for projects. The cross-
   *  tab seam also carries transient "__create__" / "__all__" / "__unfiled__"
   *  sentinels a panel acts on then discards (never a real selection). */
  key: string;
}

/** The lifted cross-tab open intent a panel reads on mount (spec 4.2). A panel
 *  gets the pending ref for its tab plus a callback to clear it once consumed,
 *  mirroring NotesPanel's initialNotebookId deep-link-on-mount precedent. */
export type WorkbenchInitialOpen = WorkbenchRecentRef | null;

// ── The plain state snapshot the builder reads ─────────────────────────────
export interface WorkbenchSourceData {
  // OPEN / FOCUSED + ON SCREEN.
  /** The active tab, the page's local activeTab. */
  activeTab: WorkbenchTab;
  /** The role-relative 1:1 tab label (oneOnOneTabLabel), e.g. "Mentoring". */
  oneOnOneTabLabel: string;
  /** Whether the 1:1 tab is shown (the page's showOneOnOneTab gate). Hides the
   *  1:1 tab jump + 1:1 entities + the New 1:1 command when false. */
  showOneOnOneTab: boolean;
  /** Whether the viewer is a lab head (gates New 1:1 + Delete 1:1). */
  isLabHead: boolean;
  /** The signed-in username, for the role-relative 1:1 display name. */
  currentUser: string;

  // The project filter (ON SCREEN). Composite "{owner}:{id}" keys, never bare.
  projectFilterMode: "all" | "explicit";
  selectedProjectIds: string[];

  // The five entity families (own + shared-into-me where relevant).
  projects: Project[];
  experiments: Task[];
  lists: Task[];
  notes: Note[];
  notebooks: Notebook[];
  oneOnOnes: OneOnOne[];

  /** The on-screen-scoped entities for the active tab + filter (spec 3.2), the
   *  empty-query "in view" lead. The page computes these with the SAME predicate
   *  the panel renders, so the resting jump list agrees with the pixels. The
   *  full lists above are still passed so a typed query widens to all tabs (the
   *  palette fuzzy-matches every nav item). */
  onScreenExperiments: Task[];
  onScreenLists: Task[];
  onScreenNotes: Note[];

  // SELECTED (the focused card / row / open popup, spec 3.3). At most one.
  selectedExperiment: Task | null;
  selectedList: Task | null;
  selectedNote: Note | null;
  selectedOneOnOne: OneOnOne | null;

  // HOVERED (the card / row the cursor was over when the palette opened,
  // resolved by the hook from the data-beaker-target key). SELECTED always
  // outranks this, so a real open entity wins over a stale hover. When nothing
  // is selected, the hovered entity drives the SAME context-card selection line
  // and the SAME per-entity Suggested set, only the framing ("Pointing at" vs
  // "selected") changes. Null when nothing tagged was under the pointer. The 1:1
  // tab has no hoverable card today, so it is not a hovered kind.
  hovered:
    | { kind: "experiment"; task: Task }
    | { kind: "list"; task: Task }
    | { kind: "note"; note: Note }
    | { kind: "project"; project: Project }
    | null;

  /** The recently-opened MRU refs (newest first), for the "Recently opened"
   *  cross-tab nav group (spec 5). */
  recent: WorkbenchRecentRef[];

  // Pre-computed helpers the builder needs but must not derive itself (keeps
  // the builder pure and the keying identical to the page / panels).
  /** taskKey(task), the composite owner-namespaced key. */
  taskKeyOf: (task: Task) => string;
  /** encodeFilterKey(project) / projectKey, the composite "{owner}:{id}". */
  projectKeyOf: (project: Project) => string;
  /** The STANDALONE_FILTER_KEY sentinel, for the Standalone filter command. */
  standaloneFilterKey: string;
  /** The human title for a notebook (its title, or the "<other member>" fall
   *  back the rail uses), pre-resolved so the builder stays string-only. */
  notebookTitleOf: (nb: Notebook) => string;
  /** The display name + sub for a project row, e.g. "8 experiments, 62%
   *  complete" or "shared from morgan". Pre-built so the builder never counts. */
  projectDetailOf: (project: Project) => string;
  /** The display name (the other person) for a 1:1, e.g. "1:1 with Morgan",
   *  role-relative via oneOnOneLabel. */
  oneOnOneNameOf: (oo: OneOnOne) => string;
  /** A short section + freshness echo for an experiment, e.g. "Running, day 2
   *  of 5". The page resolves the panel's assignSection so the echo matches. */
  experimentDetailOf: (task: Task) => string;
  /** A short bucket + date echo for a list task, e.g. "Overdue 3d". */
  listDetailOf: (task: Task) => string;
  /** A short echo for a note, e.g. "in Lab meeting, updated 2h ago". */
  noteDetailOf: (note: Note) => string;
  /** Whether the viewer can move / delete a note (owned, or shared at edit).
   *  Resolved by the hook against the live currentUser + shared_with levels,
   *  since Note carries no per-recipient permission field. */
  noteEditableOf: (note: Note) => boolean;
  /** The project name a task belongs to (own) or "shared from <owner>", for the
   *  create-experiment "in <project>" detail + the experiment row keywords. */
  projectLabelForTask: (task: Task) => string;
}

// ── The handler bag (closures over the page's real setters + apis) ─────────
export interface WorkbenchSourceHandlers {
  /** Switch the active tab in-page (setActiveTab). */
  setActiveTab: (tab: WorkbenchTab) => void;
  /** The lifted cross-tab open intent (spec 4.2). Sets pendingOpen on the page
   *  AND switches the tab, so the target panel opens the entity on mount. The
   *  hook closes over the page's pendingOpen setter + setActiveTab. */
  requestOpen: (ref: WorkbenchRecentRef) => void;
  /** Push a just-opened entity onto the MRU (spec 5). Called by every jump. */
  recordRecent: (ref: WorkbenchRecentRef) => void;

  // Project jump is a real route push (not a tab), so it has its own handler.
  openProject: (project: Project) => void;

  // Create (spec 6.1). Each routes through the panel's real flow.
  createProject: () => void;
  createExperiment: () => void;
  createListTask: () => void;
  createNote: () => void;
  createRunningLog: () => void;
  createOneOnOne: () => void;

  // Filter (spec 6.3). Reuse the store actions the pills drive.
  toggleProjectFilter: (filterKey: string) => void;
  toggleStandaloneFilter: () => void;
  clearProjectFilter: () => void;

  // Open a notebook (spec 6.4). In-page selection on the Notes tab, lifted via
  // requestOpen so it works cross-tab; the all/unfiled rail selections are
  // notes-tab-local intents the hook handles.
  selectAllNotes: () => void;
  selectUnfiledNotes: () => void;

  // Per-entity row actions (spec 6.5), bound to the SELECTED entity.
  openTaskComments: (task: Task) => void;
  toggleListComplete: (task: Task) => void;
  expandListInline: (task: Task) => void;
  openNoteComments: (note: Note) => void;
  /** BeakerSearch v2 (sub-flow framework, chunk 2). The REAL note-move write, the
   *  owner-aware notebooksApi.moveNoteToNotebook the Notes panel uses, targeting
   *  the chosen notebook (null => Unfiled / no notebook), then refetch. */
  moveNoteToNotebook: (note: Note, notebookId: string | null) => void | Promise<void>;
  deleteNote: (note: Note) => void;
  setOneOnOneArea: (area: "goals" | "meetings" | "notes" | "agenda") => void;
  deleteOneOnOne: (oo: OneOnOne) => void;
}

/** A list task is read-only for the complete toggle when shared into me without
 *  edit rights (the canToggle predicate the Lists panel uses). */
export function canToggleListComplete(task: Task): boolean {
  return !task.is_shared_with_me || task.shared_permission === "edit";
}

/** Resolve the single SELECTED entity (the strongest focus). Experiment beats
 *  list beats note beats 1:1, matching the per-tab single-popup model. */
function resolveSelection(data: WorkbenchSourceData):
  | { kind: "experiment"; task: Task }
  | { kind: "list"; task: Task }
  | { kind: "note"; note: Note }
  | { kind: "oneonone"; oo: OneOnOne }
  | null {
  if (data.selectedExperiment) {
    return { kind: "experiment", task: data.selectedExperiment };
  }
  if (data.selectedList) return { kind: "list", task: data.selectedList };
  if (data.selectedNote) return { kind: "note", note: data.selectedNote };
  if (data.selectedOneOnOne) {
    return { kind: "oneonone", oo: data.selectedOneOnOne };
  }
  return null;
}

/** The resolved active-context entity by the SELECTED > HOVERED rule. When a real
 *  selection exists, hovered is ignored. When nothing is selected, the card the
 *  cursor was pointing at drives the SAME context-card selection line and the
 *  SAME per-entity Suggested set, only the framing changes. `isHovered` lets the
 *  copy switch voice without duplicating the per-entity logic. A hovered 1:1 is
 *  not modeled (the 1:1 tab has no tagged card), so the oneonone kind only ever
 *  arrives via a real selection. */
type WorkbenchContext =
  | { kind: "experiment"; task: Task; isHovered: boolean }
  | { kind: "list"; task: Task; isHovered: boolean }
  | { kind: "note"; note: Note; isHovered: boolean }
  | { kind: "oneonone"; oo: OneOnOne; isHovered: boolean }
  | { kind: "project"; project: Project; isHovered: boolean }
  | null;

function resolveContext(data: WorkbenchSourceData): WorkbenchContext {
  const sel = resolveSelection(data);
  if (sel?.kind === "experiment") {
    return { kind: "experiment", task: sel.task, isHovered: false };
  }
  if (sel?.kind === "list") return { kind: "list", task: sel.task, isHovered: false };
  if (sel?.kind === "note") return { kind: "note", note: sel.note, isHovered: false };
  if (sel?.kind === "oneonone") {
    return { kind: "oneonone", oo: sel.oo, isHovered: false };
  }

  const hov = data.hovered;
  if (hov?.kind === "experiment") {
    return { kind: "experiment", task: hov.task, isHovered: true };
  }
  if (hov?.kind === "list") return { kind: "list", task: hov.task, isHovered: true };
  if (hov?.kind === "note") return { kind: "note", note: hov.note, isHovered: true };
  if (hov?.kind === "project") {
    return { kind: "project", project: hov.project, isHovered: true };
  }
  return null;
}

/** The plain tab noun for the context-card headline (spec 3.5). The 1:1 tab uses
 *  the role-relative label. */
function tabNoun(data: WorkbenchSourceData): string {
  switch (data.activeTab) {
    case "projects":
      return "Projects";
    case "experiments":
      return "Experiments";
    case "notes":
      return "Notes";
    case "lists":
      return "Lists";
    case "oneonone":
      return data.oneOnOneTabLabel;
  }
}

/** The lone real (non-standalone) project key when exactly one project pill is
 *  active (spec 3.3, the "filtered to <project>" + create-in echo), else null. */
function singleProjectFilter(data: WorkbenchSourceData): Project | null {
  if (data.projectFilterMode !== "explicit") return null;
  if (data.selectedProjectIds.length !== 1) return null;
  const key = data.selectedProjectIds[0];
  if (key === data.standaloneFilterKey) return null;
  return data.projects.find((p) => data.projectKeyOf(p) === key) ?? null;
}

/** Whether a project filter is currently narrowing the view (gates Clear). */
function filterActive(data: WorkbenchSourceData): boolean {
  return (
    data.projectFilterMode === "explicit" && data.selectedProjectIds.length > 0
  );
}

/** The scope clause for the context card (spec 3.5). "filtered to Mitochondria
 *  QC" for one project, "filtered to 3 projects" for many, with "+ Standalone"
 *  when the Standalone pill is part of the selection. Only the Experiments and
 *  Lists tabs show pills, so other tabs return "". */
function scopeClause(data: WorkbenchSourceData): string {
  if (data.activeTab !== "experiments" && data.activeTab !== "lists") return "";
  if (!filterActive(data)) return "";
  const keys = data.selectedProjectIds;
  const hasStandalone = keys.includes(data.standaloneFilterKey);
  const realKeys = keys.filter((k) => k !== data.standaloneFilterKey);
  let core: string;
  if (realKeys.length === 0) {
    core = "Standalone";
    return `filtered to ${core}`;
  }
  if (realKeys.length === 1) {
    const proj = data.projects.find((p) => data.projectKeyOf(p) === realKeys[0]);
    core = proj ? proj.name : "1 project";
  } else {
    core = `${realKeys.length} projects`;
  }
  return hasStandalone ? `filtered to ${core} + Standalone` : `filtered to ${core}`;
}

/** The per-tab meta sub for the context card (spec 3.5), e.g. "8 in flight". */
function tabSub(data: WorkbenchSourceData): string {
  switch (data.activeTab) {
    case "projects": {
      const n = data.projects.length;
      return `${n} project${n === 1 ? "" : "s"}`;
    }
    case "experiments": {
      const n = data.experiments.filter((t) => !t.is_complete).length;
      return `${n} in flight`;
    }
    case "lists": {
      const n = data.lists.filter((t) => !t.is_complete).length;
      return `${n} open list task${n === 1 ? "" : "s"}`;
    }
    case "notes": {
      const n = data.notes.length;
      return `${n} note${n === 1 ? "" : "s"}`;
    }
    case "oneonone": {
      const n = data.oneOnOnes.length;
      return `${n} active 1:1${n === 1 ? "" : "s"}`;
    }
  }
}

/** Build the context card (spec 3.5). Title "Workbench"; meta = "<tab>[,
 *  filtered to <scope>], <sub>"; plus a second stacked selection line under a
 *  hairline divider naming the open experiment / list / note / 1:1. */
function buildContextCard(data: WorkbenchSourceData): PaletteContextCard {
  const ctx = resolveContext(data);
  let selection: PaletteContextCard["selection"];

  // A real selection names the open entity plainly; a hover frames it as "the
  // card you were pointing at", so the user knows which one drives Suggested.
  const lead = ctx?.isHovered ? "Pointing at " : "";
  if (ctx?.kind === "experiment") {
    selection = {
      iconName: ICON_EXPERIMENT,
      text: `${lead}${ctx.task.name}, ${data.experimentDetailOf(ctx.task)}`,
    };
  } else if (ctx?.kind === "list") {
    selection = {
      iconName: ICON_LIST,
      text: `${lead}${ctx.task.name}, ${data.listDetailOf(ctx.task)}`,
    };
  } else if (ctx?.kind === "note") {
    selection = {
      iconName: ICON_NOTE,
      text: `${lead}${ctx.note.title}, ${data.noteDetailOf(ctx.note)}`,
    };
  } else if (ctx?.kind === "oneonone") {
    selection = {
      iconName: ICON_ONEONONE,
      text: `${lead}${data.oneOnOneNameOf(ctx.oo)}`,
    };
  } else if (ctx?.kind === "project") {
    selection = {
      iconName: ICON_PROJECT,
      text: `${lead}${ctx.project.name}, ${data.projectDetailOf(ctx.project)}`,
    };
  }

  const scope = scopeClause(data);
  const metaParts = [tabNoun(data)];
  if (scope) metaParts.push(scope);
  metaParts.push(tabSub(data));

  return {
    // No "grid" / "home" glyph in the registry, so reuse "layer" (the closest
    // workbench-surface stand-in the registry offers).
    iconName: "layer",
    title: "Workbench",
    meta: metaParts.join(", "),
    selection,
  };
}

// BeakerSearch v2 (sub-flow framework, chunk 2). The sentinel id the move-note
// picker uses for the "Unfiled" (notebook_id null) row, kept off the real
// notebook-id string space so onPick can tell it apart.
const MOVE_NOTEBOOK_UNFILED_ID = "__unfiled__";

/** BeakerSearch v2 (sub-flow framework, chunk 2). The INLINE move-to-notebook
 *  flow, mirroring the Gantt move-to-project flow (single stage, renders inline).
 *  Items are the viewer's notebooks (label = notebook title, tone "note", detail =
 *  note count when known) plus a leading "Unfiled" option (notebook_id null);
 *  picking one calls the REAL owner-aware notebooksApi.moveNoteToNotebook via
 *  moveNoteToNotebook then COMPLETES (onPick returns void). Single stage, so the
 *  framework renders it inline under the command row. */
function buildMoveNotebookSubflow(
  note: Note,
  data: WorkbenchSourceData,
  handlers: WorkbenchSourceHandlers,
): PaletteSubflow {
  const unfiledItem: PaletteNavItem = {
    id: MOVE_NOTEBOOK_UNFILED_ID,
    label: "Unfiled",
    detail: "no notebook",
    keywords: "no notebook none floating remove",
    iconName: ICON_NOTE,
    tone: "note",
    onRun: () => {},
  };
  const notebookItems: PaletteNavItem[] = data.notebooks.map((nb) => {
    const count = data.notes.filter((n) => n.notebook_id === nb.id).length;
    return {
      id: nb.id,
      label: data.notebookTitleOf(nb),
      detail: `${count} note${count === 1 ? "" : "s"}`,
      keywords: nb.members.join(" "),
      iconName: ICON_NOTEBOOK,
      tone: "note",
      onRun: () => {},
    };
  });
  return {
    title: `Move "${note.title}" to a notebook`,
    placeholder: "Pick a notebook",
    items: [unfiledItem, ...notebookItems],
    onPick: (item) => {
      const notebookId =
        item.id === MOVE_NOTEBOOK_UNFILED_ID ? null : item.id;
      void handlers.moveNoteToNotebook(note, notebookId);
    },
  };
}

/** Build the full command set with stable ids + page-defined groups (spec 6).
 *  The selection-specific rows carry stable ids the Suggested rule names. */
function buildCommands(
  data: WorkbenchSourceData,
  handlers: WorkbenchSourceHandlers,
): EditorCommand[] {
  const out: EditorCommand[] = [];
  // SELECTED > HOVERED. A hovered card drives the same per-entity action rows as a
  // selection (same ids, same enabled gating), so Suggested can name them either
  // way. The oneonone rows only ever fire from a real selection (no hovered 1:1).
  const ctx = resolveContext(data);
  const single = singleProjectFilter(data);

  // ── Selected / hovered entity row actions (spec 6.5). ─────────────────────
  if (ctx?.kind === "experiment") {
    const t = ctx.task;
    out.push({
      id: "workbench-experiment-open",
      label: `Open "${t.name}"`,
      detail: "view and edit details",
      group: WORKBENCH_GROUP_SELECTED,
      iconName: "eye",
      run: () =>
        handlers.requestOpen({ kind: "experiment", key: data.taskKeyOf(t) }),
    });
    out.push({
      id: "workbench-experiment-comment",
      label: `Add a comment to "${t.name}"`,
      detail: "open with the comments rail",
      group: WORKBENCH_GROUP_SELECTED,
      iconName: "share",
      run: () => handlers.openTaskComments(t),
    });
  } else if (ctx?.kind === "list") {
    const t = ctx.task;
    const canToggle = canToggleListComplete(t);
    out.push({
      id: "workbench-list-open",
      label: `Open "${t.name}"`,
      detail: "full view",
      group: WORKBENCH_GROUP_SELECTED,
      iconName: "eye",
      run: () => handlers.requestOpen({ kind: "list", key: data.taskKeyOf(t) }),
    });
    out.push({
      id: "workbench-list-toggle",
      label: `Mark "${t.name}" ${t.is_complete ? "incomplete" : "done"}`,
      detail: canToggle
        ? t.is_complete
          ? "currently complete"
          : "fills the sub-tasks"
        : "shared, view only",
      group: WORKBENCH_GROUP_SELECTED,
      iconName: "check",
      enabled: canToggle,
      run: () => handlers.toggleListComplete(t),
    });
    out.push({
      id: "workbench-list-expand",
      label: `Expand "${t.name}" inline`,
      detail: "see the sub-tasks on the board",
      group: WORKBENCH_GROUP_SELECTED,
      iconName: "list",
      run: () => handlers.expandListInline(t),
    });
  } else if (ctx?.kind === "note") {
    const n = ctx.note;
    const editable = data.noteEditableOf(n);
    out.push({
      id: "workbench-note-open",
      label: `Open "${n.title}"`,
      detail: "view and edit",
      group: WORKBENCH_GROUP_SELECTED,
      iconName: "eye",
      run: () =>
        handlers.requestOpen({
          kind: "note",
          key: noteKey(n, data.currentUser),
        }),
    });
    out.push({
      id: "workbench-note-comment",
      label: `Add a comment to "${n.title}"`,
      detail: "open with the comments rail",
      group: WORKBENCH_GROUP_SELECTED,
      iconName: "share",
      run: () => handlers.openNoteComments(n),
    });
    // BeakerSearch v2 (sub-flow framework, chunk 2). The INLINE move-to-notebook
    // flow, pick a notebook (or Unfiled), then the real owner-aware move write
    // runs. run stays terminal-safe (opens the note) for a caller without the
    // framework. Gated to an own note (a shared-in note is read-only).
    out.push({
      id: "workbench-note-move",
      label: `Move "${n.title}" to a notebook`,
      detail: editable ? "pick a notebook" : "shared, view only",
      group: WORKBENCH_GROUP_SELECTED,
      iconName: "folder",
      enabled: editable,
      run: () =>
        handlers.requestOpen({
          kind: "note",
          key: noteKey(n, data.currentUser),
        }),
      subflow: () => buildMoveNotebookSubflow(n, data, handlers),
    });
    out.push({
      id: "workbench-note-delete",
      label: `Delete "${n.title}"`,
      detail: editable ? "moves to Trash, 10s undo" : "shared, view only",
      group: WORKBENCH_GROUP_SELECTED,
      iconName: "trash",
      enabled: editable,
      run: () => handlers.deleteNote(n),
    });
  } else if (ctx?.kind === "oneonone") {
    const oo = ctx.oo;
    const name = data.oneOnOneNameOf(oo);
    out.push({
      id: "workbench-oneonone-open",
      label: `Open ${name}`,
      detail: "weekly goals, meetings, notes, agenda",
      group: WORKBENCH_GROUP_SELECTED,
      iconName: "users",
      run: () =>
        handlers.requestOpen({ kind: "oneonone", key: `oneonone-${oo.id}` }),
    });
    const areas: { id: string; area: "goals" | "meetings" | "notes" | "agenda"; label: string }[] = [
      { id: "workbench-oneonone-goals", area: "goals", label: "Weekly goals" },
      { id: "workbench-oneonone-meetings", area: "meetings", label: "Meeting notes" },
      { id: "workbench-oneonone-notes", area: "notes", label: "Notes" },
      { id: "workbench-oneonone-agenda", area: "agenda", label: "Agenda" },
    ];
    for (const a of areas) {
      out.push({
        id: a.id,
        label: a.label,
        detail: `jump to the ${a.label.toLowerCase()} area`,
        group: WORKBENCH_GROUP_SELECTED,
        iconName: "list",
        run: () => handlers.setOneOnOneArea(a.area),
      });
    }
    out.push({
      id: "workbench-oneonone-delete",
      label: `Delete ${name}`,
      detail: data.isLabHead ? "removes the 1:1" : "lab head only",
      group: WORKBENCH_GROUP_SELECTED,
      iconName: "trash",
      enabled: data.isLabHead,
      run: () => handlers.deleteOneOnOne(oo),
    });
  }

  // ── Create (spec 6.1). ────────────────────────────────────────────────────
  out.push({
    id: "workbench-new-project",
    label: "New project",
    group: WORKBENCH_GROUP_CREATE,
    iconName: "plus",
    run: handlers.createProject,
  });
  out.push({
    id: "workbench-new-experiment",
    label: "New experiment",
    detail: single ? `in ${single.name}` : undefined,
    group: WORKBENCH_GROUP_CREATE,
    iconName: "plus",
    run: handlers.createExperiment,
  });
  out.push({
    id: "workbench-new-list",
    label: "New list task",
    group: WORKBENCH_GROUP_CREATE,
    iconName: "plus",
    run: handlers.createListTask,
  });
  out.push({
    id: "workbench-new-note",
    label: "New note",
    group: WORKBENCH_GROUP_CREATE,
    iconName: "plus",
    run: handlers.createNote,
  });
  out.push({
    id: "workbench-new-log",
    label: "New running log",
    keywords: "journal diary",
    group: WORKBENCH_GROUP_CREATE,
    iconName: "plus",
    run: handlers.createRunningLog,
  });
  out.push({
    id: "workbench-new-oneonone",
    label: "New 1:1",
    detail: data.isLabHead ? undefined : "lab head only",
    keywords: "mentoring check-in",
    group: WORKBENCH_GROUP_CREATE,
    iconName: "userPlus",
    enabled: data.isLabHead,
    run: handlers.createOneOnOne,
  });

  // ── Switch tab (spec 6.2). The 1:1 tab self-hides when !showOneOnOneTab. ───
  for (const item of tabSwitchList(data)) {
    out.push({
      id: `workbench-tab-${item.tab}`,
      label: item.commandLabel,
      keywords: item.keywords,
      group: WORKBENCH_GROUP_TABS,
      iconName: item.iconName,
      enabled: data.activeTab !== item.tab,
      run: () => handlers.setActiveTab(item.tab),
    });
  }

  // ── Filter (spec 6.3). Enabled only on the Experiments / Lists tabs (the
  // tabs that show the pills); hidden everywhere else by gating enabled. ─────
  const filterTab = data.activeTab === "experiments" || data.activeTab === "lists";
  for (const p of data.projects) {
    const fk = data.projectKeyOf(p);
    const active = data.selectedProjectIds.includes(fk);
    out.push({
      id: `workbench-filter-${fk}`,
      label: `${active ? "Remove" : "Filter by"} project, ${p.name}`,
      keywords: [p.name, p.owner].filter(Boolean).join(" "),
      group: WORKBENCH_GROUP_FILTER,
      iconName: "folder",
      enabled: filterTab,
      run: () => handlers.toggleProjectFilter(fk),
    });
  }
  out.push({
    id: "workbench-filter-standalone",
    label: "Add Standalone to the filter",
    keywords: "orphan no project",
    group: WORKBENCH_GROUP_FILTER,
    iconName: "list",
    enabled: filterTab,
    run: handlers.toggleStandaloneFilter,
  });
  out.push({
    id: "workbench-filter-clear",
    label: "Clear project filter",
    group: WORKBENCH_GROUP_FILTER,
    iconName: "refresh",
    enabled: filterTab && filterActive(data),
    run: handlers.clearProjectFilter,
  });

  // ── Open a notebook (spec 6.4). ───────────────────────────────────────────
  for (const nb of data.notebooks) {
    out.push({
      id: `workbench-notebook-${nb.id}`,
      label: `Open notebook, ${data.notebookTitleOf(nb)}`,
      keywords: nb.members.join(" "),
      group: WORKBENCH_GROUP_NOTEBOOKS,
      iconName: ICON_NOTEBOOK,
      run: () =>
        handlers.requestOpen({ kind: "notebook", key: `notebook-${nb.id}` }),
    });
  }
  out.push({
    id: "workbench-notebook-all",
    label: "All notes",
    group: WORKBENCH_GROUP_NOTEBOOKS,
    iconName: ICON_NOTE,
    run: handlers.selectAllNotes,
  });
  out.push({
    id: "workbench-notebook-unfiled",
    label: "Unfiled notes",
    keywords: "no notebook",
    group: WORKBENCH_GROUP_NOTEBOOKS,
    iconName: ICON_NOTE,
    run: handlers.selectUnfiledNotes,
  });

  return out;
}

/** The composite BeakerSearch-local key for a note (collision-safe across shared
 *  notes), note-<owner>:<id>. The owner falls back to the current user for a
 *  personal note that carries no explicit owner. */
export function noteKey(note: Note, currentUser: string): string {
  const owner = note.username || currentUser;
  return `note-${owner}:${note.id}`;
}

/** The ordered ids of the contextually relevant commands for the current
 *  selection (spec 6.5 -> Suggested) plus the orientation defaults. Ids that are
 *  absent / disabled are silently skipped by the palette. The mockup leads the
 *  selected-experiment Suggested with Open, Add a comment, then New experiment. */
function buildSuggestedIds(data: WorkbenchSourceData): string[] {
  const ids: string[] = [];
  // SELECTED > HOVERED, both lead with the same per-entity action ids. A hovered
  // project carries no per-entity command rows, so it falls through to the
  // orientation defaults below (the same defaults a bare tab shows).
  const ctx = resolveContext(data);

  if (ctx?.kind === "experiment") {
    ids.push("workbench-experiment-open", "workbench-experiment-comment");
  } else if (ctx?.kind === "list") {
    ids.push(
      "workbench-list-open",
      "workbench-list-toggle",
      "workbench-list-expand",
    );
  } else if (ctx?.kind === "note") {
    ids.push(
      "workbench-note-open",
      "workbench-note-comment",
      "workbench-note-move",
      "workbench-note-delete",
    );
  } else if (ctx?.kind === "oneonone") {
    ids.push(
      "workbench-oneonone-open",
      "workbench-oneonone-goals",
      "workbench-oneonone-delete",
    );
  }

  // Orientation defaults, ranked after a real selection, biased to the tab the
  // user is standing on (the create that the active tab is about leads).
  switch (data.activeTab) {
    case "projects":
      ids.push("workbench-new-project");
      break;
    case "experiments":
      ids.push("workbench-new-experiment");
      break;
    case "lists":
      ids.push("workbench-new-list");
      break;
    case "notes":
      ids.push("workbench-new-note", "workbench-new-log");
      break;
    case "oneonone":
      ids.push("workbench-new-oneonone");
      break;
  }
  // A common second move regardless of tab.
  if (data.activeTab !== "experiments") ids.push("workbench-new-experiment");
  if (data.activeTab !== "notes") ids.push("workbench-new-note");
  if (filterActive(data)) ids.push("workbench-filter-clear");

  return ids;
}

/** The Suggested heading hint (spec 6.5). A real selection reads "for the
 *  selected ...", a hover reads "for the ... you were pointing at". A hovered
 *  project has no per-entity Suggested rows, so it carries no hint. */
function buildSuggestedHint(data: WorkbenchSourceData): string | undefined {
  const ctx = resolveContext(data);
  if (ctx?.kind === "experiment") {
    return ctx.isHovered
      ? "for the experiment you were pointing at"
      : "for the selected experiment";
  }
  if (ctx?.kind === "list") {
    return ctx.isHovered
      ? "for the list task you were pointing at"
      : "for the selected list task";
  }
  if (ctx?.kind === "note") {
    return ctx.isHovered
      ? "for the note you were pointing at"
      : "for the selected note";
  }
  if (ctx?.kind === "oneonone") return "for the selected 1:1";
  return undefined;
}

/** The five tab switches (spec 4.4 / 6.2). The 1:1 one self-hides when
 *  !showOneOnOneTab. Each carries the nav label, the command label, the
 *  registered icon, and fuzzy keywords. */
function tabSwitchList(data: WorkbenchSourceData): {
  tab: WorkbenchTab;
  navLabel: string;
  commandLabel: string;
  iconName: IconName;
  keywords: string;
}[] {
  const list: {
    tab: WorkbenchTab;
    navLabel: string;
    commandLabel: string;
    iconName: IconName;
    keywords: string;
  }[] = [
    {
      tab: "projects",
      navLabel: "Go to Projects",
      commandLabel: "Go to Projects",
      iconName: ICON_PROJECT,
      keywords: "projects tab",
    },
    {
      tab: "experiments",
      navLabel: "Go to Experiments",
      commandLabel: "Go to Experiments",
      iconName: ICON_EXPERIMENT,
      keywords: "experiments tab bench",
    },
    {
      tab: "notes",
      navLabel: "Go to Notes",
      commandLabel: "Go to Notes",
      iconName: ICON_NOTE,
      keywords: "notes tab",
    },
    {
      tab: "lists",
      navLabel: "Go to Lists",
      commandLabel: "Go to Lists",
      iconName: ICON_LIST,
      keywords: "lists tab to-do",
    },
  ];
  if (data.showOneOnOneTab) {
    list.push({
      tab: "oneonone",
      navLabel: `Go to ${data.oneOnOneTabLabel}`,
      commandLabel: `Go to ${data.oneOnOneTabLabel}`,
      iconName: ICON_ONEONONE,
      keywords: "1:1 mentoring check-in one on one",
    });
  }
  return list;
}

// ── Per-entity nav items (spec 4.1 fuzzy fields + 4.2 cross-tab jump) ───────

function experimentNavItem(
  task: Task,
  data: WorkbenchSourceData,
  handlers: WorkbenchSourceHandlers,
  detailOverride?: string,
): PaletteNavItem {
  const key = data.taskKeyOf(task);
  const projectLabel = data.projectLabelForTask(task);
  return {
    id: `experiment-${key}`,
    label: task.name,
    detail: detailOverride ?? data.experimentDetailOf(task),
    keywords: [projectLabel, task.is_shared_with_me ? task.owner : ""]
      .filter(Boolean)
      .join(" "),
    iconName: ICON_EXPERIMENT,
    tone: "task",
    onRun: () => handlers.requestOpen({ kind: "experiment", key }),
  };
}

function listNavItem(
  task: Task,
  data: WorkbenchSourceData,
  handlers: WorkbenchSourceHandlers,
  detailOverride?: string,
): PaletteNavItem {
  const key = data.taskKeyOf(task);
  const projectLabel = data.projectLabelForTask(task);
  const subTaskTitles = (task.sub_tasks ?? []).map((st) => st.text).join(" ");
  return {
    id: `list-${key}`,
    label: task.name,
    detail: detailOverride ?? data.listDetailOf(task),
    keywords: [projectLabel, subTaskTitles, task.is_shared_with_me ? task.owner : ""]
      .filter(Boolean)
      .join(" "),
    iconName: ICON_LIST,
    tone: "task",
    onRun: () => handlers.requestOpen({ kind: "list", key }),
  };
}

function projectNavItem(
  project: Project,
  data: WorkbenchSourceData,
  handlers: WorkbenchSourceHandlers,
  detailOverride?: string,
): PaletteNavItem {
  return {
    id: `project-${data.projectKeyOf(project)}`,
    label: project.name,
    detail: detailOverride ?? data.projectDetailOf(project),
    keywords: [project.owner, project.is_shared_with_me ? "shared" : ""]
      .filter(Boolean)
      .join(" "),
    iconName: ICON_PROJECT,
    tone: "project",
    onRun: () => {
      handlers.recordRecent({
        kind: "project",
        key: data.projectKeyOf(project),
      });
      handlers.openProject(project);
    },
  };
}

function noteNavItem(
  note: Note,
  data: WorkbenchSourceData,
  handlers: WorkbenchSourceHandlers,
  detailOverride?: string,
): PaletteNavItem {
  const key = noteKey(note, data.currentUser);
  return {
    id: key,
    label: note.title,
    detail: detailOverride ?? data.noteDetailOf(note),
    keywords: [
      note.description ? note.description.slice(0, 80) : "",
      note.is_running_log ? "running log" : "",
      note.is_shared ? "shared" : "",
    ]
      .filter(Boolean)
      .join(" "),
    iconName: ICON_NOTE,
    tone: "note",
    onRun: () => handlers.requestOpen({ kind: "note", key }),
  };
}

function notebookNavItem(
  nb: Notebook,
  data: WorkbenchSourceData,
  handlers: WorkbenchSourceHandlers,
): PaletteNavItem {
  const title = data.notebookTitleOf(nb);
  const shared = nb.members.length >= 2;
  const noteCount = data.notes.filter((n) => n.notebook_id === nb.id).length;
  return {
    id: `notebook-${nb.id}`,
    label: `${title} notebook`,
    detail: shared
      ? `${noteCount} note${noteCount === 1 ? "" : "s"}, shared with ${nb.members.length}`
      : `${noteCount} note${noteCount === 1 ? "" : "s"}, personal`,
    keywords: nb.members.join(" "),
    iconName: ICON_NOTEBOOK,
    tone: "note",
    onRun: () =>
      handlers.requestOpen({ kind: "notebook", key: `notebook-${nb.id}` }),
  };
}

function oneOnOneNavItem(
  oo: OneOnOne,
  data: WorkbenchSourceData,
  handlers: WorkbenchSourceHandlers,
  detailOverride?: string,
): PaletteNavItem {
  return {
    id: `oneonone-${oo.id}`,
    label: data.oneOnOneNameOf(oo),
    detail: detailOverride ?? "weekly goals",
    keywords: [oo.labHead, oo.member].filter(Boolean).join(" "),
    iconName: ICON_ONEONONE,
    tone: "person",
    onRun: () =>
      handlers.requestOpen({ kind: "oneonone", key: `oneonone-${oo.id}` }),
  };
}

/** Build the nav groups (spec 4 + 5), in the approved mockup order, Jump to an
 *  experiment, Jump to a project, Jump to a note (+ notebooks), Jump to a 1:1,
 *  Go to a tab, Recently opened. The entity jump groups lead with the on-screen
 *  scope (empty query) and widen to the full lists as the palette fuzzy-matches
 *  while typing (the page passes the in-view set first via group ordering, and
 *  the full set is reachable because every nav item is scored). The page scopes
 *  the empty view by passing the on-screen-scoped lists for the active tab and
 *  the full lists for the rest. */
function buildNavGroups(
  data: WorkbenchSourceData,
  handlers: WorkbenchSourceHandlers,
): PaletteNavGroup[] {
  const groups: PaletteNavGroup[] = [];

  // Jump to an experiment. On-screen scope leads the empty view; the page hands
  // onScreenExperiments for the in-view set and experiments (the full list) so
  // a typed query widens. We pass the full list so fuzzy-match reaches all, but
  // lead with the on-screen ones so the resting view matches the tab + filter.
  const experimentItems = orderedByScope(
    data.experiments,
    data.onScreenExperiments,
    (t) => data.taskKeyOf(t),
  ).map((t) => experimentNavItem(t, data, handlers));
  groups.push({
    title: "Jump to an experiment",
    hint:
      data.activeTab === "experiments"
        ? `in view (${data.onScreenExperiments.length})`
        : `all (${data.experiments.length})`,
    items: experimentItems,
  });

  // Jump to a project.
  const projectItems = data.projects.map((p) =>
    projectNavItem(p, data, handlers),
  );
  groups.push({ title: "Jump to a project", items: projectItems });

  // Jump to a note (notes then notebooks, both indigo).
  const noteItems = orderedByScope(
    data.notes,
    data.onScreenNotes,
    (n) => noteKey(n, data.currentUser),
  ).map((n) => noteNavItem(n, data, handlers));
  const notebookItems = data.notebooks.map((nb) =>
    notebookNavItem(nb, data, handlers),
  );
  groups.push({
    title: "Jump to a note",
    items: [...noteItems, ...notebookItems],
  });

  // Jump to a 1:1 (omitted entirely when the 1:1 tab is gated off).
  if (data.showOneOnOneTab && data.oneOnOnes.length > 0) {
    groups.push({
      title: "Jump to a 1:1",
      items: data.oneOnOnes.map((oo) => oneOnOneNavItem(oo, data, handlers)),
    });
  }

  // Go to a tab (the five tab switches, the 1:1 one self-hides).
  groups.push({
    title: "Go to a tab",
    items: tabSwitchList(data).map((item) => ({
      id: `tab-${item.tab}`,
      label: item.navLabel,
      keywords: item.keywords,
      iconName: item.iconName,
      onRun: () => handlers.setActiveTab(item.tab),
    })),
  });

  // Recently opened (cross-tab MRU, spec 5). Resolve each ref to the live entity
  // and reopen via the same cross-tab jump. Omit the whole group when empty.
  const recentItems = resolveRecent(data, handlers);
  if (recentItems.length > 0) {
    groups.push({ title: "Recently opened", items: recentItems });
  }

  return groups;
}

/** Lead the on-screen-scoped entities first, then the rest of the full list, so
 *  the empty-query view matches the tab + filter while a typed query still
 *  reaches every entity (the palette fuzzy-scores them all). De-duped by key. */
function orderedByScope<T>(
  full: T[],
  onScreen: T[],
  keyOf: (x: T) => string,
): T[] {
  const leadKeys = new Set(onScreen.map(keyOf));
  const rest = full.filter((x) => !leadKeys.has(keyOf(x)));
  return [...onScreen, ...rest];
}

/** Resolve the MRU refs (spec 5) to live nav items, dropping any no longer
 *  present, preserving order, with an "opened recently" detail and the
 *  per-entity tone. Exported indirectly via buildNavGroups; kept here so the
 *  resolution is unit-tested. */
function resolveRecent(
  data: WorkbenchSourceData,
  handlers: WorkbenchSourceHandlers,
): PaletteNavItem[] {
  const out: PaletteNavItem[] = [];
  for (const ref of data.recent) {
    switch (ref.kind) {
      case "experiment": {
        const t = data.experiments.find((x) => data.taskKeyOf(x) === ref.key);
        if (t) out.push(experimentNavItem(t, data, handlers, "opened recently"));
        break;
      }
      case "list": {
        const t = data.lists.find((x) => data.taskKeyOf(x) === ref.key);
        if (t) out.push(listNavItem(t, data, handlers, "opened recently"));
        break;
      }
      case "note": {
        const n = data.notes.find(
          (x) => noteKey(x, data.currentUser) === ref.key,
        );
        if (n) out.push(noteNavItem(n, data, handlers, "opened recently"));
        break;
      }
      case "notebook": {
        const id = ref.key.replace(/^notebook-/, "");
        const nb = data.notebooks.find((x) => x.id === id);
        if (nb) {
          const item = notebookNavItem(nb, data, handlers);
          out.push({ ...item, detail: "opened recently" });
        }
        break;
      }
      case "oneonone": {
        const id = ref.key.replace(/^oneonone-/, "");
        const oo = data.oneOnOnes.find((x) => x.id === id);
        if (oo) out.push(oneOnOneNavItem(oo, data, handlers, "opened recently"));
        break;
      }
      case "project": {
        const p = data.projects.find((x) => data.projectKeyOf(x) === ref.key);
        if (p) out.push(projectNavItem(p, data, handlers, "opened recently"));
        break;
      }
    }
  }
  return out;
}

/** Build the whole Workbench BeakerSearch source from a pure state snapshot. */
export function buildWorkbenchSource(
  data: WorkbenchSourceData,
  handlers: WorkbenchSourceHandlers,
): BeakerSearchSource {
  return {
    id: "workbench",
    contextCard: buildContextCard(data),
    commands: buildCommands(data, handlers),
    suggestedIds: buildSuggestedIds(data),
    suggestedHint: buildSuggestedHint(data),
    navGroups: buildNavGroups(data, handlers),
  };
}

// Re-export so the hook / tests can name the icon + tone sets without re-deriving.
export type { IconName, PaletteTone };
