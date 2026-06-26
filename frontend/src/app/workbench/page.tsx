"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
  labApi,
} from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useAppStore } from "@/lib/store";
import AppShell from "@/components/AppShell";
import NotesPanel from "@/components/NotesPanel";
import WorkbenchExperimentsPanel from "@/components/workbench/WorkbenchExperimentsPanel";
import WorkbenchListsPanel from "@/components/workbench/WorkbenchListsPanel";
import WorkbenchProjectsPanel from "@/components/workbench/WorkbenchProjectsPanel";
import WorkbenchOneOnOnePanel from "@/components/workbench/WorkbenchOneOnOnePanel";
import WorkbenchProjectRail from "@/components/workbench/WorkbenchProjectRail";
import { shouldShowOneOnOneTab } from "@/components/workbench/oneOnOneGate";
import { oneOnOneTabLabel } from "@/lib/one-on-one/label";
import { Icon } from "@/components/icons";
import { matchesAnyProjectFilter } from "@/lib/search/filterKey";
import { useWorkbenchBeakerSource } from "./useWorkbenchBeakerSource";
import { useClassDashboard } from "@/hooks/useClassDashboard";
import { useIsClassStudent } from "@/hooks/useIsClassStudent";
import { useStudentAssignmentCount } from "@/hooks/useStudentAssignmentCount";
import { CLASS_MODE_ENABLED } from "@/lib/lab/class-mode-config";
import ClassAssignmentsPanel from "@/components/lab-overview/ClassAssignmentsPanel";
import type {
  WorkbenchPendingOpen,
  WorkbenchSelection,
} from "./useWorkbenchBeakerSource";
import type { Project } from "@/lib/types";

type TabType =
  | "assignments"
  | "projects"
  | "experiments"
  | "notes"
  | "lists"
  | "oneonone";

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

const projectKey = (p: Pick<Project, "id" | "owner">) => `${p.owner}:${p.id}`;

export default function WorkbenchPage() {
  // Sub-tab state stays purely local. The onboarding orchestrator's
  // `workbench-experiments-tab` gate reads tab state from the DOM via
  // `WorkbenchExperimentsPanel`'s `data-current-tab="experiments"`
  // root attribute (only present when that panel is mounted). That
  // lets the gate work without coupling Workbench's routing to the
  // onboarding system — the planned Lists-tab redesign can route
  // however it wants and this gate keeps working.
  // Experiments is the default landing view (workbench IA redesign, 2026-06-25):
  // 9 of 10 times a member arrives at /workbench to edit an experiment or a
  // note, not to browse the projects grid. Projects moved out of the subtab row
  // into the left WorkbenchProjectRail (it was always a filter over the other
  // tabs), so the page now opens on the tab people actually want. The "projects"
  // tab machinery is intact: the rail's "Manage projects" control sets it, and
  // the `?tab=projects` deep-link below still lands there. The class-dashboard
  // forced landing and the `?tab=`/`?note=` deep-links run on mount and still
  // win over this default.
  const [activeTab, setActiveTab] = useState<TabType>("experiments");

  // Shared Notebooks Phase 4 (notebooks-phase4-widget sub-bot, 2026-06-02):
  // the Shared Notebook home/dashboard widget deep-links here with
  // `?tab=notes&notebook=<id>` to open the full Phase 2 SharedNotebookView for
  // a chosen 1:1 notebook. Read the query string ONCE on mount (window, not
  // useSearchParams, to avoid a CSR-bailout Suspense boundary): if `tab=notes`,
  // land on the Notes tab; the `notebook` id is handed to NotesPanel as its
  // initial selection. Absent params leave the default Experiments tab + the
  // Personal notes section untouched.
  const [initialNotebookId, setInitialNotebookId] = useState<string | null>(
    null,
  );

  // BeakerSearch cross-tab jump seam (spec 4.2). A palette jump sets pendingOpen
  // then switches the tab; each panel reads its slice on mount via an initialOpen
  // prop (modeled on NotesPanel's initialNotebookId), opens the target once, and
  // calls back to clear pendingOpen. The page also tracks a lightweight focused
  // selection (the most recently opened entity) so the source's context card +
  // Suggested actions can name the open thing without rewiring panel state.
  const [pendingOpen, setPendingOpen] = useState<WorkbenchPendingOpen>(null);
  const [selection, setSelection] = useState<WorkbenchSelection>(null);
  // BeakerSearch v2 chunk 3, the WORKBENCH LIVE-SELECTION lift. The card the
  // user actually clicks / opens in a panel (not the last palette-opened proxy)
  // drives the context card + Suggested. Each panel reports its own selection
  // up through onSelectionChange; the page holds it here and feeds it to the
  // source as the real selection. A reported selection (the clicked card) wins
  // over the consumed-pendingOpen fallback below, so the clicked card outranks a
  // stale palette jump and clears to null when the panel's popup closes.
  const [liveSelection, setLiveSelection] = useState<WorkbenchSelection>(null);
  const reportSelection = useCallback((sel: WorkbenchSelection) => {
    setLiveSelection(sel);
  }, []);
  // The selection the source echoes. The panel-reported live selection (the
  // clicked card) wins; the consumed-pendingOpen promotion is the fallback for
  // the seams a panel does not report (the notebook rail jump). The CLICKED card
  // must win, so liveSelection is checked first.
  const effectiveSelection: WorkbenchSelection = liveSelection ?? selection;
  // Clearing the pending intent once a panel has consumed it. The same call also
  // promotes the consumed intent to the focused selection so the source echoes
  // it (a "__create__" / "__all__" sentinel is a transient action, not a real
  // selection, so those do not become the selection).
  const consumePendingOpen = () => {
    if (
      pendingOpen &&
      !pendingOpen.key.startsWith("__")
    ) {
      setSelection(pendingOpen);
    }
    setPendingOpen(null);
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    // Deep-link tab selection. The Notes deep-link (`?tab=notes`, optionally
    // with `&notebook=<id>`) is the long-standing case the Shared Notebook
    // widget relies on; the others are accepted symmetrically so any link can
    // land on its tab. Unknown / absent values leave the new Projects default.
    const tab = params.get("tab");
    if (
      tab === "notes" ||
      tab === "experiments" ||
      tab === "lists" ||
      tab === "projects" ||
      tab === "oneonone"
    ) {
      setActiveTab(tab);
    }
    const nb = params.get("notebook");
    if (nb) setInitialNotebookId(nb);
    // Note deep-link (`?note=<note-owner:id>`), set by a BeakerSearch global note
    // result so a handwritten/scanned page found from any page opens here. Land
    // on the Notes tab and hand the key to the panel's open seam (same shape the
    // in-page palette jump uses). Decoded already by URLSearchParams.
    const noteKeyParam = params.get("note");
    if (noteKeyParam) {
      setActiveTab("notes");
      setPendingOpen({ kind: "note", key: noteKeyParam });
    }
  }, []);

  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);

  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  // 1:1 ("Mentoring" / "Check-ins") tab (oneonone surface bot, 2026-06-07).
  // The label is role-relative and the tab is gated: a lab head always sees it
  // (they can set one up), a member sees it only when they are in >= 1 1:1, and
  // a solo user with no lab head + no 1:1s never sees an empty tab.
  const accountType = useAccountType(currentUser);
  const isLabHead = accountType === "lab_head";
  const { data: oneOnOnes = [] } = useQuery({
    queryKey: ["one-on-ones"],
    queryFn: () => labApi.getOneOnOnes(),
  });
  const showOneOnOneTab = shouldShowOneOnOneTab(accountType, oneOnOnes.length);
  const oneOnOneLabelText = oneOnOneTabLabel(isLabHead ? "lab_head" : "lab");

  // Class dashboard (CT-5): when the active folder is a class with a published
  // instructor template, FORCE the workbench to render only the template tabs in
  // order, land on the template landing tab, and show the instructor intro banner
  // above the tabs. With no template (not a class, or flag off), `resolved` is the
  // default (all tabs, default landing, no intro) and `isForced` is false, so the
  // workbench is byte-identical to today. The hook is inert on a flag-off build.
  const {
    resolved: classDashboard,
    isForced: classDashboardForced,
  } = useClassDashboard(currentUser || null);

  // Class Mode (CT-2): a STUDENT (member of a class folder) lands here (the
  // landing redirect sends lab_head -> /lab-overview, everyone else -> /workbench),
  // so their assignments panel mounts above the workbench tabs. Gated student-only
  // + flag-off inert, so a research-lab / solo / instructor workbench is unchanged.
  const isClassStudent = useIsClassStudent(currentUser || null);
  const showStudentAssignments =
    CLASS_MODE_ENABLED && isClassStudent === true && !!currentUser;
  const assignmentCount = useStudentAssignmentCount(showStudentAssignments);

  // A tab is renderable iff it survives the forced template AND its own gate
  // (oneonone keeps its existing visibility rule). When not forced, the resolved
  // set is the full default order, so every tab passes this check unchanged.
  const forcedTabs = classDashboard.tabs;
  const tabIsAllowed = useCallback(
    // The student Assignments tab is intrinsic to a class student, not a
    // template content tab, so a forced class template never evicts it. The early
    // return also narrows `id` to the template tab union for forcedTabs.includes.
    (id: TabType) => {
      if (id === "assignments") return showStudentAssignments;
      return forcedTabs.includes(id);
    },
    [forcedTabs, showStudentAssignments],
  );

  // FORCE the landing tab once a class template is in effect. Guarded by
  // `classDashboardForced` so a non-class / flag-off folder never moves the tab
  // off the existing Projects default or the `?tab=` deep-link. Runs once per
  // forced-landing value; the deep-link effect above still wins for an explicit
  // `?tab=`/`?note=` link because it runs on mount before this settles.
  const forcedLanding = classDashboardForced ? classDashboard.landingTab : null;
  useEffect(() => {
    if (forcedLanding) setActiveTab(forcedLanding);
  }, [forcedLanding]);

  // If the forced template drops the active tab, fall back to the landing tab so
  // a student is never stranded on a hidden tab.
  useEffect(() => {
    if (classDashboardForced && !tabIsAllowed(activeTab)) {
      setActiveTab(classDashboard.landingTab);
    }
  }, [classDashboardForced, tabIsAllowed, activeTab, classDashboard.landingTab]);

  // Register the Workbench BeakerSearch source while this page is mounted. It is
  // a READER over the same queries above + the panels' real handlers; the only
  // page state it drives is setActiveTab + the pendingOpen cross-tab seam.
  useWorkbenchBeakerSource({
    // BeakerSearch never targets the student Assignments tab; treat it as the
    // projects context so the reader stays on the existing WorkbenchTab union.
    activeTab: activeTab === "assignments" ? "projects" : activeTab,
    setActiveTab,
    setPendingOpen,
    selection: effectiveSelection,
    oneOnOneTabLabel: oneOnOneLabelText,
    showOneOnOneTab,
    isLabHead,
  });

  // If the gate hides the tab while it is active (e.g. the viewer's last 1:1
  // was removed), fall back to the default Projects view.
  useEffect(() => {
    if (activeTab === "oneonone" && !showOneOnOneTab) {
      setActiveTab("projects");
    }
  }, [activeTab, showOneOnOneTab]);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });

  // The header only needs a top-line count; the panel does its own fetches
  // and section assignment. Sharing the same query key (["tasks", user])
  // means the cache is reused.
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasksIncludingShared,
  });

  const projectColors = useMemo(() => {
    const map: Record<string, string> = {};
    projects.forEach((p, i) => {
      map[projectKey(p)] = p.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    });
    return map;
  }, [projects]);

  const upcomingCount = useMemo(() => {
    let xs = allTasks.filter(
      (t) => t.task_type === "experiment" && !t.is_complete,
    );
    // Composite-key match (alex:1 vs morgan:1 are different projects). See
    // matchesAnyProjectFilter / store.ts selectedProjectIds type comment.
    xs = xs.filter((t) => matchesAnyProjectFilter(t, selectedProjectIds));
    return xs.length;
  }, [allTasks, selectedProjectIds]);

  const openListCount = useMemo(() => {
    let xs = allTasks.filter(
      (t) => t.task_type === "list" && !t.is_complete,
    );
    xs = xs.filter((t) => matchesAnyProjectFilter(t, selectedProjectIds));
    return xs.length;
  }, [allTasks, selectedProjectIds]);

  const subtitle =
    activeTab === "projects"
      ? `${projects.length} project${projects.length !== 1 ? "s" : ""}`
      : activeTab === "experiments"
        ? `${upcomingCount} experiment${upcomingCount !== 1 ? "s" : ""} in flight`
        : activeTab === "lists"
          ? `${openListCount} open list task${openListCount !== 1 ? "s" : ""}`
          : activeTab === "oneonone"
            ? `${oneOnOnes.length} active 1:1${oneOnOnes.length !== 1 ? "s" : ""}`
            : "Meeting notes and running logs";

  return (
    <AppShell>
      <div className="flex-1 overflow-auto px-6 pt-3 pb-6">
        {/* Class dashboard intro banner (CT-5): the instructor-pinned intro /
            syllabus the class head set, shown above the tabs. Only present when a
            class template forces the workbench and carries an intro; absent (and
            thus byte-identical to today) on every research-lab / solo / flag-off
            folder. */}
        {classDashboardForced && classDashboard.intro && (
          <div className="mb-4 rounded-lg border border-border bg-surface-sunken px-4 py-3">
            {classDashboard.intro.title && (
              <h3 className="text-body font-semibold text-foreground mb-1">
                {classDashboard.intro.title}
              </h3>
            )}
            {classDashboard.intro.body && (
              <p className="text-meta text-foreground-muted whitespace-pre-wrap">
                {classDashboard.intro.body}
              </p>
            )}
          </div>
        )}
        {/* Compact header: the page title + its subtitle sit INLINE with the
            tabs in a single band, instead of stacking a tall title row above a
            separate tab row. Reclaims the vertical space the stacked chrome
            wasted (Grant 2026-06-11). */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4 border-b border-border pb-2">
          <div className="flex items-baseline gap-2 mr-1">
            <h2 className="text-title font-semibold text-foreground">Workbench</h2>
            <span className="text-meta text-foreground-muted">{subtitle}</span>
          </div>
          <div className="flex items-center gap-1">
          {showStudentAssignments && (
          <button
            onClick={() => setActiveTab("assignments")}
            className={`px-3 py-1.5 rounded-lg text-body font-medium transition-colors flex items-center gap-2 ${
              activeTab === "assignments"
                ? "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300"
                : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
            }`}
          >
            <Icon name="mortarboard" className="w-4 h-4" />
            Assignments
            {assignmentCount > 0 && (
              <span className="ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-teal-600 px-1.5 text-[0.7rem] font-semibold leading-5 text-white">
                {assignmentCount}
              </span>
            )}
          </button>
          )}
          {/* Projects is no longer a peer subtab. It moved to the left
              WorkbenchProjectRail (rail footer "Manage projects" sets
              activeTab to "projects"), so the row slims to Experiments /
              Notes / Lists. The "projects" tab + its render branch + the
              `?tab=projects` deep-link are unchanged. */}
          {tabIsAllowed("experiments") && (
          <button
            onClick={() => setActiveTab("experiments")}
            data-tour-target="workbench-experiments-tab"
            className={`px-3 py-1.5 rounded-lg text-body font-medium transition-colors flex items-center gap-2 ${
              activeTab === "experiments"
                ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
            Experiments
          </button>
          )}
          {tabIsAllowed("notes") && (
          <button
            onClick={() => setActiveTab("notes")}
            data-tour-target="workbench-notes-tab"
            className={`px-3 py-1.5 rounded-lg text-body font-medium transition-colors flex items-center gap-2 ${
              activeTab === "notes"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Notes
          </button>
          )}
          {tabIsAllowed("lists") && (
          <button
            onClick={() => setActiveTab("lists")}
            data-tour-target="workbench-lists-tab"
            className={`px-3 py-1.5 rounded-lg text-body font-medium transition-colors flex items-center gap-2 ${
              activeTab === "lists"
                ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
                : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            Lists
          </button>
          )}
          {showOneOnOneTab && tabIsAllowed("oneonone") && (
            <button
              onClick={() => setActiveTab("oneonone")}
              data-tour-target="workbench-oneonone-tab"
              className={`px-3 py-1.5 rounded-lg text-body font-medium transition-colors flex items-center gap-2 ${
                activeTab === "oneonone"
                  ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
              }`}
            >
              <Icon name="users" className="w-4 h-4" />
              {oneOnOneLabelText}
            </button>
          )}
          </div>
        </div>

        {/* Project rail + panel body. The rail is the left filter-column that
            replaced the horizontal project pills (it drives the same
            `selectedProjectIds` store). It shows on Experiments and Lists
            (project-filterable) and on Notes (project-agnostic, so the filter
            section is greyed with a hint, but Manage / New stay live). It is
            hidden on the projects-management grid (the grid IS the projects
            view), on the 1:1 tab, and on the student Assignments tab. */}
        {(() => {
          const showRail =
            activeTab === "experiments" ||
            activeTab === "lists" ||
            activeTab === "notes";
          const railFilterEnabled =
            activeTab === "experiments" || activeTab === "lists";
          return (
            <div className="flex min-h-0 gap-4">
              {showRail && (
                <WorkbenchProjectRail
                  projects={projects}
                  projectColors={projectColors}
                  currentUser={currentUser}
                  filterEnabled={railFilterEnabled}
                  onManageProjects={() => setActiveTab("projects")}
                />
              )}
              <div className="min-w-0 flex-1">
                {activeTab === "assignments" &&
                  showStudentAssignments &&
                  currentUser && (
                    <ClassAssignmentsPanel currentUser={currentUser} />
                  )}
                {activeTab === "projects" && (
                  <WorkbenchProjectsPanel projects={projects} />
                )}
                {activeTab === "notes" && (
                  <NotesPanel
                    initialNotebookId={initialNotebookId}
                    initialOpen={
                      pendingOpen &&
                      (pendingOpen.kind === "note" ||
                        pendingOpen.kind === "notebook")
                        ? pendingOpen
                        : null
                    }
                    onInitialOpenConsumed={consumePendingOpen}
                    onSelectionChange={reportSelection}
                  />
                )}
                {activeTab === "experiments" && (
                  <WorkbenchExperimentsPanel
                    projects={projects}
                    initialOpen={
                      pendingOpen && pendingOpen.kind === "experiment"
                        ? pendingOpen
                        : null
                    }
                    onInitialOpenConsumed={consumePendingOpen}
                    onSelectionChange={reportSelection}
                  />
                )}
                {activeTab === "lists" && (
                  <WorkbenchListsPanel
                    projects={projects}
                    initialOpen={
                      pendingOpen && pendingOpen.kind === "list"
                        ? pendingOpen
                        : null
                    }
                    onInitialOpenConsumed={consumePendingOpen}
                    onSelectionChange={reportSelection}
                  />
                )}
                {activeTab === "oneonone" && showOneOnOneTab && (
                  <WorkbenchOneOnOnePanel
                    currentUser={currentUser}
                    isLabHead={isLabHead}
                    initialOpen={
                      pendingOpen && pendingOpen.kind === "oneonone"
                        ? pendingOpen
                        : null
                    }
                    onInitialOpenConsumed={consumePendingOpen}
                    onSelectionChange={reportSelection}
                  />
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </AppShell>
  );
}
