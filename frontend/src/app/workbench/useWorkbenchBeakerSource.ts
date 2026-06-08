// sequence editor master (Workbench source sub-bot). BeakerSearch step 3, the
// thin HOOK that wires the live Workbench page state + handlers into the pure
// buildWorkbenchSource builder and registers the result with the shared palette.
//
// All the testable logic lives in workbench-beaker-source.ts (no React, no
// store). This hook takes the page's REAL state + handlers (the live activeTab +
// setActiveTab, the lifted pendingOpen setter for the cross-tab jump, the
// lightweight focused selection the page tracks, the role-relative 1:1 label +
// gate), reads the same shared queries the page + panels read (["projects"],
// ["tasks"], ["notes"], ["shared-notebooks", "mine"], ["one-on-ones"]), closes
// over the store actions the panels' own buttons drive (the create flags, the
// project filter, the note mutations), maintains a per-user localStorage MRU of
// recently-opened entities, and calls buildWorkbenchSource inside a useMemo so
// the registration object is stable.
//
// The cross-tab jump (spec 4.2) is the one part needing a page change. The hook
// closes over the page's setPendingOpen + setActiveTab so a BeakerSearch jump
// sets the open intent THEN switches the tab; each panel reads its slice on
// mount via a new initialOpen prop (modeled on NotesPanel's initialNotebookId).
// The project jump is a real route push (router.push), not a tab.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
  labApi,
  notebooksApi,
  notesApi,
} from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAppStore } from "@/lib/store";
import { useBeakerSearchSource } from "@/components/beaker-search/useBeakerSearchSource";
import { useBeakerHoveredKey } from "@/components/beaker-search/BeakerSearchProvider";
import { parseBeakerTargetKey } from "@/components/beaker-search/beaker-hover";
import {
  matchesAnyProjectFilter,
  STANDALONE_FILTER_KEY,
} from "@/lib/search/filterKey";
import { oneOnOneLabel } from "@/lib/one-on-one/label";
import { normalizeSharedWith } from "@/lib/sharing/unified";
import { taskKey } from "@/lib/types";
import type { Note, Notebook, OneOnOne, Project, Task } from "@/lib/types";
import {
  buildWorkbenchSource,
  type WorkbenchRecentRef,
  type WorkbenchSourceData,
  type WorkbenchSourceHandlers,
  type WorkbenchTab,
} from "./workbench-beaker-source";

// How many recently-opened entities the MRU keeps (spec 5, the last ~8 across
// all tabs).
const MRU_CAP = 8;

/** The lifted cross-tab open intent (spec 4.2). The page holds this as state and
 *  hands each panel its slice on mount. A BeakerSearch jump sets it then switches
 *  the tab; the panel opens the target once and clears it. */
export type WorkbenchPendingOpen = WorkbenchRecentRef | null;

/** The lightweight focused selection the page tracks so the context card + the
 *  Suggested actions can name the open entity (spec 3.3). The panels own their
 *  own popup state internally; the page lifts only the identity of the most
 *  recently opened entity (set by the same jump / MRU path), so the source can
 *  echo it without rewiring every panel's selection state. */
export type WorkbenchSelection = WorkbenchRecentRef | null;

/** The page's live state + handlers, passed straight into the hook so the
 *  palette drives the same flows the page's own controls do. The page owns
 *  activeTab + the pendingOpen seam + the create flows it already wires. */
export interface WorkbenchBeakerPageDeps {
  activeTab: WorkbenchTab;
  setActiveTab: (tab: WorkbenchTab) => void;
  /** The lifted cross-tab open-intent setter (spec 4.2). */
  setPendingOpen: (intent: WorkbenchPendingOpen) => void;
  /** The page's focused selection (the most recently opened entity), so the
   *  context card + Suggested name it. Null when nothing is open. */
  selection: WorkbenchSelection;
  /** The role-relative 1:1 tab label (oneOnOneTabLabel). */
  oneOnOneTabLabel: string;
  /** The 1:1 tab gate (shouldShowOneOnOneTab). */
  showOneOnOneTab: boolean;
  isLabHead: boolean;
}

const MRU_STORAGE_PREFIX = "workbench-beaker-mru-v1:";

/** Parse a persisted MRU blob into a clean ref list, tolerating any malformed /
 *  legacy shape (a bad value yields an empty list, never a throw). */
function parseMru(raw: string | null): WorkbenchRecentRef[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const known: ReadonlySet<string> = new Set([
    "experiment",
    "list",
    "note",
    "notebook",
    "oneonone",
    "project",
  ]);
  const out: WorkbenchRecentRef[] = [];
  for (const item of parsed) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { key?: unknown }).key === "string" &&
      typeof (item as { kind?: unknown }).kind === "string" &&
      known.has((item as { kind: string }).kind)
    ) {
      out.push({
        kind: (item as WorkbenchRecentRef).kind,
        key: (item as WorkbenchRecentRef).key,
      });
    }
  }
  return out;
}

/** Push a just-opened ref to the front of the MRU (de-duped, capped). Pure. */
function pushMru(
  list: WorkbenchRecentRef[],
  ref: WorkbenchRecentRef,
): WorkbenchRecentRef[] {
  const next = [
    ref,
    ...list.filter((r) => !(r.kind === ref.kind && r.key === ref.key)),
  ];
  return next.slice(0, MRU_CAP);
}

/** A short relative "2h ago" / "yesterday" label for a timestamp, or "" when
 *  absent. Kept here (not in the pure builder) so the builder stays Date-free. */
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

/** Register the Workbench page's BeakerSearch source while the page is mounted.
 *  Call once from app/workbench/page.tsx after the existing hooks, handing in the
 *  page's live state + handlers. */
export function useWorkbenchBeakerSource(deps: WorkbenchBeakerPageDeps): void {
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    activeTab,
    setActiveTab,
    setPendingOpen,
    selection,
    oneOnOneTabLabel,
    showOneOnOneTab,
    isLabHead,
  } = deps;

  // Store slices (the same ones the panels read).
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const projectFilterMode = useAppStore((s) => s.projectFilterMode);
  const setProjectFilterMode = useAppStore((s) => s.setProjectFilterMode);
  const toggleProject = useAppStore((s) => s.toggleProject);
  const setIsCreatingTask = useAppStore((s) => s.setIsCreatingTask);
  const setNewTaskStartDate = useAppStore((s) => s.setNewTaskStartDate);
  const setRestrictedTaskType = useAppStore((s) => s.setRestrictedTaskType);

  // Shared queries (same keys the page + panels read, so no extra fetch).
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasksIncludingShared,
  });
  const { data: notes = [] } = useQuery({
    queryKey: ["notes"],
    queryFn: () => notesApi.list(),
  });
  const { data: notebooks = [] } = useQuery({
    queryKey: ["shared-notebooks", "mine"],
    queryFn: () => labApi.getSharedNotebooks(),
  });
  const { data: oneOnOnes = [] } = useQuery({
    queryKey: ["one-on-ones"],
    queryFn: () => labApi.getOneOnOnes(),
  });

  const experiments = useMemo(
    () => allTasks.filter((t) => t.task_type === "experiment"),
    [allTasks],
  );
  const lists = useMemo(
    () => allTasks.filter((t) => t.task_type === "list"),
    [allTasks],
  );

  // On-screen scope (the panels' own predicate). Shared experiments bypass the
  // project filter (always render); owned tasks stay subject to the pills.
  const onScreenExperiments = useMemo(
    () =>
      experiments.filter(
        (t) => t.is_shared_with_me || matchesAnyProjectFilter(t, selectedProjectIds),
      ),
    [experiments, selectedProjectIds],
  );
  const onScreenLists = useMemo(
    () => lists.filter((t) => matchesAnyProjectFilter(t, selectedProjectIds)),
    [lists, selectedProjectIds],
  );
  // Notes are project-agnostic, so the on-screen scope is the full personal list
  // (the rail selection narrows it further, but the empty-query jump leads with
  // the whole list, which matches the resting Notes grid).
  const onScreenNotes = notes;

  // The per-user MRU, read from localStorage. The page records pushes through
  // the recordRecent handler below; we re-read after each push.
  const [mru, setMru] = useState<WorkbenchRecentRef[]>([]);
  useEffect(() => {
    if (typeof window === "undefined" || !currentUser) return;
    setMru(parseMru(window.localStorage.getItem(MRU_STORAGE_PREFIX + currentUser)));
  }, [currentUser]);

  const recordRecent = useCallback(
    (ref: WorkbenchRecentRef) => {
      setMru((prev) => {
        const next = pushMru(prev, ref);
        if (typeof window !== "undefined" && currentUser) {
          try {
            window.localStorage.setItem(
              MRU_STORAGE_PREFIX + currentUser,
              JSON.stringify(next),
            );
          } catch {
            // localStorage full / disabled, the MRU is best-effort.
          }
        }
        return next;
      });
    },
    [currentUser],
  );

  // The lifted cross-tab open intent (spec 4.2). Records the MRU, sets the
  // pending-open intent, then switches the tab so the target panel opens it on
  // mount. The project case is a real route push (handled in openProject).
  const requestOpen = useCallback(
    (ref: WorkbenchRecentRef) => {
      recordRecent(ref);
      if (ref.kind === "project") return; // openProject handles the route push.
      setPendingOpen(ref);
      const tab: WorkbenchTab =
        ref.kind === "experiment"
          ? "experiments"
          : ref.kind === "list"
            ? "lists"
            : ref.kind === "oneonone"
              ? "oneonone"
              : "notes"; // note + notebook both live on the Notes tab.
      setActiveTab(tab);
    },
    [recordRecent, setPendingOpen, setActiveTab],
  );

  // The project route push (spec 2.1 openProject rule, ?owner= when shared).
  const openProject = useCallback(
    (project: Project) => {
      const ownerSuffix =
        project.is_shared_with_me &&
        project.owner &&
        project.owner !== currentUser
          ? `?owner=${encodeURIComponent(project.owner)}`
          : "";
      router.push(`/workbench/projects/${project.id}${ownerSuffix}`);
    },
    [router, currentUser],
  );

  // Create flows (route through the SAME Zustand task-creation flags the panels'
  // own buttons set, so the modal opens pre-scoped with no new modal code).
  const createProject = useCallback(() => {
    // The Projects panel's "New project" opens ProjectCreateModal; the page does
    // not lift that flag, so a cold create routes to the Projects tab where the
    // panel's own button lives. Switching the tab surfaces the create affordance.
    setActiveTab("projects");
  }, [setActiveTab]);
  const createExperiment = useCallback(() => {
    setNewTaskStartDate(null);
    setRestrictedTaskType("experiment");
    setIsCreatingTask(true);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tour:workbench-experiment-modal-opened"),
      );
    }
  }, [setIsCreatingTask, setNewTaskStartDate, setRestrictedTaskType]);
  const createListTask = useCallback(() => {
    setNewTaskStartDate(null);
    setRestrictedTaskType("list");
    setIsCreatingTask(true);
  }, [setIsCreatingTask, setNewTaskStartDate, setRestrictedTaskType]);

  // Note / 1:1 create + per-entity row actions go through the panel on its tab.
  // The page does not lift those panel-local flows, so the palette opens the
  // entity (or switches the tab) and the panel's own affordance finishes the
  // action. We surface the tab + the pending-open intent so the user lands where
  // the action lives, the faithful minimal wiring (see the report).
  const createNote = useCallback(() => {
    setPendingOpen({ kind: "note", key: "__create__" });
    setActiveTab("notes");
  }, [setPendingOpen, setActiveTab]);
  const createRunningLog = useCallback(() => {
    setPendingOpen({ kind: "note", key: "__create-log__" });
    setActiveTab("notes");
  }, [setPendingOpen, setActiveTab]);
  const createOneOnOne = useCallback(() => {
    setPendingOpen({ kind: "oneonone", key: "__create__" });
    setActiveTab("oneonone");
  }, [setPendingOpen, setActiveTab]);

  // Filter actions (the store actions the pills drive).
  const toggleProjectFilter = useCallback(
    (filterKey: string) => toggleProject(filterKey),
    [toggleProject],
  );
  const toggleStandaloneFilter = useCallback(
    () => toggleProject(STANDALONE_FILTER_KEY),
    [toggleProject],
  );
  const clearProjectFilter = useCallback(
    () => setProjectFilterMode("all"),
    [setProjectFilterMode],
  );

  // Notebook rail selections (lifted via pendingOpen so they work cross-tab).
  const selectAllNotes = useCallback(() => {
    setPendingOpen({ kind: "notebook", key: "__all__" });
    setActiveTab("notes");
  }, [setPendingOpen, setActiveTab]);
  const selectUnfiledNotes = useCallback(() => {
    setPendingOpen({ kind: "notebook", key: "__unfiled__" });
    setActiveTab("notes");
  }, [setPendingOpen, setActiveTab]);

  // Per-entity row actions that need a tab + the entity open. They all reuse the
  // cross-tab jump (open the entity), and the more specific action (comment /
  // toggle / delete) follows on the panel; we open the entity so the panel
  // surfaces the action.
  const openTaskComments = useCallback(
    (task: Task) => {
      setPendingOpen({ kind: "experiment", key: taskKey(task) });
      setActiveTab("experiments");
    },
    [setPendingOpen, setActiveTab],
  );
  const toggleListComplete = useCallback(
    (task: Task) => {
      setPendingOpen({ kind: "list", key: taskKey(task) });
      setActiveTab("lists");
    },
    [setPendingOpen, setActiveTab],
  );
  const expandListInline = useCallback(
    (task: Task) => {
      setPendingOpen({ kind: "list", key: taskKey(task) });
      setActiveTab("lists");
    },
    [setPendingOpen, setActiveTab],
  );
  const openNoteComments = useCallback(
    (note: Note) => {
      setPendingOpen({ kind: "note", key: `note-${note.username || currentUser}:${note.id}` });
      setActiveTab("notes");
    },
    [setPendingOpen, setActiveTab, currentUser],
  );
  // BeakerSearch v2 (sub-flow framework, chunk 2). The REAL move-to-notebook
  // write the move sub-flow drives, the owner-aware notebooksApi.moveNoteToNotebook
  // the Notes panel uses (notebookId null => Unfiled / no notebook), then refetch
  // the same query keys the page + panels read so the resting view updates.
  const moveNoteToNotebook = useCallback(
    async (note: Note, notebookId: string | null) => {
      const owner =
        note.username && note.username !== currentUser ? note.username : undefined;
      await notebooksApi.moveNoteToNotebook(note.id, notebookId, owner);
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["notebook"] });
      queryClient.invalidateQueries({ queryKey: ["shared-notebooks", "mine"] });
    },
    [queryClient, currentUser],
  );
  const deleteNote = useCallback(
    (note: Note) => {
      setPendingOpen({ kind: "note", key: `note-${note.username || currentUser}:${note.id}` });
      setActiveTab("notes");
    },
    [setPendingOpen, setActiveTab, currentUser],
  );
  const setOneOnOneArea = useCallback(() => {
    setActiveTab("oneonone");
  }, [setActiveTab]);
  const deleteOneOnOne = useCallback(
    (oo: OneOnOne) => {
      setPendingOpen({ kind: "oneonone", key: `oneonone-${oo.id}` });
      setActiveTab("oneonone");
    },
    [setPendingOpen, setActiveTab],
  );

  // ── Pre-computed detail helpers (the builder stays string-only + Date-free) ─
  const projectKeyOf = useCallback(
    (p: Project) => `${p.owner}:${p.id}`,
    [],
  );
  const projectNameByKey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of projects) m[`${p.owner}:${p.id}`] = p.name;
    return m;
  }, [projects]);

  const projectLabelForTask = useCallback(
    (task: Task): string => {
      if (task.is_shared_with_me) {
        return task.owner ? `shared from ${task.owner}` : "shared";
      }
      const name = projectNameByKey[`${task.owner}:${task.project_id}`];
      return name ?? "Standalone";
    },
    [projectNameByKey],
  );

  const projectDetailOf = useCallback(
    (project: Project): string => {
      if (
        project.is_shared_with_me &&
        project.owner &&
        project.owner !== currentUser
      ) {
        return `shared from ${project.owner}`;
      }
      const own = allTasks.filter(
        (t) =>
          !t.is_shared_with_me &&
          t.owner === project.owner &&
          t.project_id === project.id,
      );
      const experimentsIn = own.filter((t) => t.task_type === "experiment");
      const complete = own.filter((t) => t.is_complete).length;
      const pct = own.length > 0 ? Math.round((complete / own.length) * 100) : 0;
      return `${experimentsIn.length} experiment${experimentsIn.length === 1 ? "" : "s"}, ${pct}% complete`;
    },
    [allTasks, currentUser],
  );

  const experimentDetailOf = useCallback(
    (task: Task): string => {
      const project = projectLabelForTask(task);
      if (task.is_complete) return `${project}, complete`;
      const today = new Date().toLocaleDateString("en-CA");
      if (task.start_date <= today && task.end_date >= today) {
        return `${project}, running`;
      }
      if (task.start_date > today) return `${project}, scheduled`;
      return `${project}, ready`;
    },
    [projectLabelForTask],
  );

  const listDetailOf = useCallback(
    (task: Task): string => {
      const project = projectLabelForTask(task);
      if (task.is_complete) return `${project}, done`;
      const today = new Date().toLocaleDateString("en-CA");
      if (task.end_date < today) return `${project}, overdue`;
      const done = (task.sub_tasks ?? []).filter((s) => s.is_complete).length;
      const total = (task.sub_tasks ?? []).length;
      return total > 0
        ? `${project}, ${done} of ${total} sub-tasks`
        : `${project}, due ${task.end_date}`;
    },
    [projectLabelForTask],
  );

  const notebookTitleByNote = useMemo(() => {
    const m: Record<string, string> = {};
    for (const nb of notebooks) {
      m[nb.id] = nb.title || nb.members.find((x) => x !== currentUser) || "Notebook";
    }
    return m;
  }, [notebooks, currentUser]);

  const noteDetailOf = useCallback(
    (note: Note): string => {
      const parts: string[] = [];
      if (note.notebook_id && notebookTitleByNote[note.notebook_id]) {
        parts.push(`in ${notebookTitleByNote[note.notebook_id]}`);
      }
      const rel = relativeTime(note.updated_at);
      if (rel) parts.push(`updated ${rel}`);
      if (note.is_running_log) parts.push("running log");
      return parts.join(", ") || "note";
    },
    [notebookTitleByNote],
  );

  const noteEditableOf = useCallback(
    (note: Note): boolean => {
      if (!note.username || note.username === currentUser) return true;
      const entry = normalizeSharedWith(note.shared_with ?? []).find(
        (s) => s.username === currentUser || s.username === "*",
      );
      return entry?.level === "edit";
    },
    [currentUser],
  );

  const notebookTitleOf = useCallback(
    (nb: Notebook): string =>
      nb.title || nb.members.find((x) => x !== currentUser) || "Notebook",
    [currentUser],
  );

  const oneOnOneNameOf = useCallback(
    (oo: OneOnOne): string => oneOnOneLabel(currentUser, oo),
    [currentUser],
  );

  // The focused selection (spec 3.3), resolved from the page's lifted selection
  // ref to the live entity object.
  const selected = useMemo(() => {
    const sel = selection;
    if (!sel) {
      return {
        selectedExperiment: null,
        selectedList: null,
        selectedNote: null,
        selectedOneOnOne: null,
      };
    }
    if (sel.kind === "experiment") {
      return {
        selectedExperiment:
          experiments.find((t) => taskKey(t) === sel.key) ?? null,
        selectedList: null,
        selectedNote: null,
        selectedOneOnOne: null,
      };
    }
    if (sel.kind === "list") {
      return {
        selectedExperiment: null,
        selectedList: lists.find((t) => taskKey(t) === sel.key) ?? null,
        selectedNote: null,
        selectedOneOnOne: null,
      };
    }
    if (sel.kind === "note") {
      return {
        selectedExperiment: null,
        selectedList: null,
        selectedNote:
          notes.find(
            (n) => `note-${n.username || currentUser}:${n.id}` === sel.key,
          ) ?? null,
        selectedOneOnOne: null,
      };
    }
    if (sel.kind === "oneonone") {
      const id = sel.key.replace(/^oneonone-/, "");
      return {
        selectedExperiment: null,
        selectedList: null,
        selectedNote: null,
        selectedOneOnOne: oneOnOnes.find((o) => o.id === id) ?? null,
      };
    }
    return {
      selectedExperiment: null,
      selectedList: null,
      selectedNote: null,
      selectedOneOnOne: null,
    };
  }, [selection, experiments, lists, notes, oneOnOnes, currentUser]);

  // HOVERED. The card / row the cursor was over when the palette opened (null
  // while closed). Parse its data-beaker-target key the same way the panels stamp
  // it (experiment:<taskKey> / list:<taskKey> / project:<owner>:<id> /
  // note:note-<owner>:<id>), then resolve to the live entity. SELECTED still
  // outranks this in the builder, so a real open entity wins over a stale hover.
  const hoveredKey = useBeakerHoveredKey();
  const hovered = useMemo<WorkbenchSourceData["hovered"]>(() => {
    const parsed = parseBeakerTargetKey(hoveredKey);
    if (!parsed) return null;
    if (parsed.kind === "experiment") {
      const task = experiments.find((t) => taskKey(t) === parsed.key);
      return task ? { kind: "experiment", task } : null;
    }
    if (parsed.kind === "list") {
      const task = lists.find((t) => taskKey(t) === parsed.key);
      return task ? { kind: "list", task } : null;
    }
    if (parsed.kind === "project") {
      const project = projects.find((p) => `${p.owner}:${p.id}` === parsed.key);
      return project ? { kind: "project", project } : null;
    }
    if (parsed.kind === "note") {
      const note = notes.find(
        (n) => `note-${n.username || currentUser}:${n.id}` === parsed.key,
      );
      return note ? { kind: "note", note } : null;
    }
    return null;
  }, [hoveredKey, experiments, lists, projects, notes, currentUser]);

  const handlers = useMemo<WorkbenchSourceHandlers>(
    () => ({
      setActiveTab,
      requestOpen,
      recordRecent,
      openProject,
      createProject,
      createExperiment,
      createListTask,
      createNote,
      createRunningLog,
      createOneOnOne,
      toggleProjectFilter,
      toggleStandaloneFilter,
      clearProjectFilter,
      selectAllNotes,
      selectUnfiledNotes,
      openTaskComments,
      toggleListComplete,
      expandListInline,
      openNoteComments,
      moveNoteToNotebook,
      deleteNote,
      setOneOnOneArea,
      deleteOneOnOne,
    }),
    [
      setActiveTab,
      requestOpen,
      recordRecent,
      openProject,
      createProject,
      createExperiment,
      createListTask,
      createNote,
      createRunningLog,
      createOneOnOne,
      toggleProjectFilter,
      toggleStandaloneFilter,
      clearProjectFilter,
      selectAllNotes,
      selectUnfiledNotes,
      openTaskComments,
      toggleListComplete,
      expandListInline,
      openNoteComments,
      moveNoteToNotebook,
      deleteNote,
      setOneOnOneArea,
      deleteOneOnOne,
    ],
  );

  const source = useMemo(() => {
    const data: WorkbenchSourceData = {
      activeTab,
      oneOnOneTabLabel,
      showOneOnOneTab,
      isLabHead,
      currentUser,
      projectFilterMode,
      selectedProjectIds,
      projects,
      experiments,
      lists,
      notes,
      notebooks,
      oneOnOnes,
      onScreenExperiments,
      onScreenLists,
      onScreenNotes,
      ...selected,
      hovered,
      recent: mru,
      taskKeyOf: taskKey,
      projectKeyOf,
      standaloneFilterKey: STANDALONE_FILTER_KEY,
      notebookTitleOf,
      projectDetailOf,
      oneOnOneNameOf,
      experimentDetailOf,
      listDetailOf,
      noteDetailOf,
      noteEditableOf,
      projectLabelForTask,
    };
    return buildWorkbenchSource(data, handlers);
  }, [
    activeTab,
    oneOnOneTabLabel,
    showOneOnOneTab,
    isLabHead,
    currentUser,
    projectFilterMode,
    selectedProjectIds,
    projects,
    experiments,
    lists,
    notes,
    notebooks,
    oneOnOnes,
    onScreenExperiments,
    onScreenLists,
    onScreenNotes,
    selected,
    hovered,
    mru,
    projectKeyOf,
    notebookTitleOf,
    projectDetailOf,
    oneOnOneNameOf,
    experimentDetailOf,
    listDetailOf,
    noteDetailOf,
    noteEditableOf,
    projectLabelForTask,
    handlers,
  ]);

  useBeakerSearchSource(source);
}
