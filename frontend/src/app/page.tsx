"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi, fetchAllTasksIncludingShared, fetchAllProjectsIncludingShared } from "@/lib/local-api";
import {
  countOwnActiveProjects,
  countOwnActiveTasks,
  countOwnArchivedProjects,
} from "./page-counts";
import AppShell from "@/components/AppShell";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import ProjectCardKebab from "@/components/project-surface/ProjectCardKebab";
import Tooltip from "@/components/Tooltip";
import UserLoginScreen from "@/components/UserLoginScreen";
import SubTaskProgressDots from "@/components/workbench/SubTaskProgressDots";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useAppStore } from "@/lib/store";
import type { Task } from "@/lib/types";

// Only redirect to the user's default landing tab once per tab/session. If
// they manually navigate back to "/" later, we respect that.
let didLandingRedirect = false;

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

// Helper to make a color dull/muted for archived projects
function getMutedColor(color: string): string {
  // Convert hex to RGB, reduce saturation, add gray
  const hex = color.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  // Mix with gray and reduce intensity
  const mutedR = Math.round(r * 0.5 + 128 * 0.5);
  const mutedG = Math.round(g * 0.5 + 128 * 0.5);
  const mutedB = Math.round(b * 0.5 + 128 * 0.5);
  
  return `rgb(${mutedR}, ${mutedG}, ${mutedB})`;
}

export default function HomePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWeekendActive, setNewWeekendActive] = useState(false);
  const [newTags, setNewTags] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_COLORS[0]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const { currentUser: providerCurrentUser, isLoading: fsLoading } = useFileSystem();
  const currentUser = providerCurrentUser ?? "";
  const checkingUser = fsLoading;

  // Drag and drop state
  const [draggedProjectId, setDraggedProjectId] = useState<number | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<number | null>(null);

  // Redirect to lab page if the current user is "lab".
  // currentUser comes from FileSystemProvider, which loads it from IndexedDB on startup.
  useEffect(() => {
    if (currentUser && currentUser.toLowerCase() === "lab") {
      router.push("/lab");
    }
  }, [currentUser, router]);

  // One-shot redirect to the user's chosen default landing tab on first load.
  // Subsequent manual visits to "/" are respected. Skipped for the "lab"
  // user (handled by the dedicated redirect above).
  const defaultLandingTab = useAppStore((s) => s.defaultLandingTab);
  useEffect(() => {
    if (didLandingRedirect) return;
    if (!currentUser || currentUser.toLowerCase() === "lab") return;
    if (defaultLandingTab && defaultLandingTab !== "/") {
      didLandingRedirect = true;
      router.replace(defaultLandingTab);
    } else if (defaultLandingTab === "/") {
      didLandingRedirect = true;
    }
  }, [currentUser, defaultLandingTab, router]);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });

  const { activeProjects, archivedProjects } = useMemo(() => {
    const active = projects.filter((p) => !p.is_archived);
    const archived = projects.filter((p) => p.is_archived);
    return { activeProjects: active, archivedProjects: archived };
  }, [projects]);

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasksIncludingShared,
  });

  // Counts in the header reflect the viewer's own work only — projects
  // shared in from other users (is_shared_with_me) render as cards but
  // do not contribute to "N active projects / M active tasks / K archived".
  // The cards still come from the full active/archived lists above; only
  // the headline numbers are filtered.
  const ownActiveProjectsCount = useMemo(
    () => countOwnActiveProjects(activeProjects),
    [activeProjects],
  );
  const ownActiveTasksCount = useMemo(
    () => countOwnActiveTasks(allTasks),
    [allTasks],
  );
  const ownArchivedProjectsCount = useMemo(
    () => countOwnArchivedProjects(archivedProjects),
    [archivedProjects],
  );

  // Deep-link: `/?openTask=<id>` opens the task detail popup once the
  // task data has loaded, then strips that param so a reload doesn't
  // re-trigger. Other params (notably `?tutorial=1`) pass through
  // untouched so the sequencer's gate stays satisfied.
  //
  // `?openProject=<id>` previously opened the now-deleted
  // ProjectDetailPopup; it now navigates to the project route
  // (/workbench/projects/<id>) which is the canonical place every
  // project surface lives.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!searchParams) return;
    const wantsProject = searchParams.get("openProject");
    const wantsTask = searchParams.get("openTask");
    if (!wantsProject && !wantsTask) return;
    if (wantsProject) {
      const pid = Number(wantsProject);
      if (Number.isFinite(pid)) {
        const match = projects.find(
          (p) => p.id === pid && (p.owner ?? currentUser) === currentUser,
        );
        if (match) {
          const next = new URLSearchParams(searchParams.toString());
          next.delete("openProject");
          const ownerSuffix = match.is_shared_with_me
            ? `?owner=${encodeURIComponent(match.owner)}${next.toString() ? `&${next.toString()}` : ""}`
            : (next.toString() ? `?${next.toString()}` : "");
          router.replace(`/workbench/projects/${match.id}${ownerSuffix}`);
          return;
        }
      }
    }
    let didOpen = false;
    if (wantsTask) {
      const tid = Number(wantsTask);
      if (Number.isFinite(tid)) {
        const match = allTasks.find(
          (t) => t.id === tid && (t.owner ?? currentUser) === currentUser,
        );
        if (match) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- deep-link handler: opens popup imperatively once the async-loaded allTasks include the URL-referenced id. Cannot be useMemo (setSelectedTask is a side-effect, not derived state); cannot be useState lazy init (data arrives async after mount).
          setSelectedTask(match);
          didOpen = true;
        }
      }
    }
    if (didOpen) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("openTask");
      const query = next.toString();
      router.replace(query ? `/?${query}` : "/");
    }
  }, [searchParams, projects, allTasks, currentUser, router]);

  const today = new Date().toISOString().split("T")[0];

  // Compute summaries per project. Numeric ids are namespaced per-user, so a
  // shared project of id 5 and the receiver's own project of id 5 are
  // distinct; gating membership on `task.owner === project.owner` avoids the
  // collision (own project surfaces only own tasks; shared project surfaces
  // only the owner's tasks for that project_id, supplied by
  // `fetchAllTasksIncludingShared`).
  const projectSummaries = useMemo(() => {
    return projects.map((p, i) => {
      const projectOwner = p.is_shared_with_me ? p.owner : currentUser;
      const tasks = allTasks.filter(
        (t) => t.project_id === p.id && (t.owner ?? currentUser) === projectOwner
      );
      const total = tasks.length;
      const completed = tasks.filter((t) => t.is_complete).length;
      const upcoming = tasks
        .filter((t) => !t.is_complete && t.start_date >= today)
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
        .slice(0, 5);
      const overdue = tasks.filter(
        (t) => !t.is_complete && t.end_date < today
      );
      const inProgress = tasks.filter(
        (t) => !t.is_complete && t.start_date <= today && t.end_date >= today
      );
      const color = p.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
      const displayColor = p.is_archived ? getMutedColor(color) : color;

      return { project: p, total, completed, upcoming, overdue, inProgress, color, displayColor };
    });
  }, [projects, allTasks, today, currentUser]);

  // Get summaries for active and archived projects
  const activeSummaries = useMemo(() => 
    projectSummaries.filter((s) => !s.project.is_archived),
    [projectSummaries]
  );
  
  const archivedSummaries = useMemo(() => 
    projectSummaries.filter((s) => s.project.is_archived),
    [projectSummaries]
  );

  const handleCreateProject = useCallback(async () => {
    if (!newName.trim()) return;
    try {
      await projectsApi.create({
        name: newName.trim(),
        weekend_active: newWeekendActive,
        tags: newTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        color: newColor,
      });
      await queryClient.refetchQueries({ queryKey: ["projects"] });
      setCreating(false);
      setNewName("");
      setNewTags("");
      setNewWeekendActive(false);
    } catch {
      alert("Failed to create project");
    }
  }, [newName, newWeekendActive, newTags, newColor, queryClient]);

  // Drag and drop handlers
  //
  // Only own (non-shared-in) cards are draggable; shared-in cards don't attach
  // these handlers and pass draggable={false}. The early-return guards below
  // are belt-and-suspenders: if a shared card's id somehow reaches a handler
  // (event bubbling, stale state, etc.) we bail before mutating order, because
  // projectsApi.reorder is current-user-scoped and a shared id would silently
  // mis-order the receiver's own list (own id N and shared id N can collide
  // since project ids are namespaced per-owner).
  const handleDragStart = useCallback((e: React.DragEvent, projectId: number) => {
    const startProject = activeSummaries.find(
      (s) => s.project.id === projectId && !s.project.is_shared_with_me,
    );
    if (!startProject) {
      e.preventDefault();
      return;
    }
    setDraggedProjectId(projectId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", projectId.toString());
  }, [activeSummaries]);

  const handleDragOver = useCallback((e: React.DragEvent, projectId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverProjectId(projectId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverProjectId(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetProjectId: number) => {
    e.preventDefault();
    setDragOverProjectId(null);

    if (!draggedProjectId || draggedProjectId === targetProjectId) {
      setDraggedProjectId(null);
      return;
    }

    // Reorder is current-user-scoped — refuse if either endpoint is a
    // shared-in card. Own list indices must come from own cards only.
    const ownActive = activeSummaries.filter((s) => !s.project.is_shared_with_me);
    const draggedIsOwn = ownActive.some((s) => s.project.id === draggedProjectId);
    const targetIsOwn = ownActive.some((s) => s.project.id === targetProjectId);
    if (!draggedIsOwn || !targetIsOwn) {
      setDraggedProjectId(null);
      return;
    }

    // Find the indices and reorder within the own-only list
    const currentIds = ownActive.map((s) => s.project.id);
    const draggedIdx = currentIds.indexOf(draggedProjectId);
    const targetIdx = currentIds.indexOf(targetProjectId);

    if (draggedIdx === -1 || targetIdx === -1) {
      setDraggedProjectId(null);
      return;
    }

    // Reorder the array
    const newOrder = [...currentIds];
    newOrder.splice(draggedIdx, 1);
    newOrder.splice(targetIdx, 0, draggedProjectId);

    try {
      await projectsApi.reorder(newOrder);
      await queryClient.refetchQueries({ queryKey: ["projects"] });
    } catch {
      alert("Failed to reorder projects");
    }

    setDraggedProjectId(null);
  }, [draggedProjectId, activeSummaries, queryClient]);

  const handleDragEnd = useCallback(() => {
    setDraggedProjectId(null);
    setDragOverProjectId(null);
  }, []);

  // Format archived date
  const formatArchivedDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { 
      year: "numeric", 
      month: "short", 
      day: "numeric" 
    });
  };

  // Show login screen if no current user.
  // UserLoginScreen already calls useFileSystem().setCurrentUser internally, so
  // by the time onLogin fires the provider has the new user and lab redirect
  // logic in our useEffect will handle "lab" automatically.
  if (!checkingUser && !currentUser) {
    return (
      <UserLoginScreen
        onLogin={() => {
          queryClient.invalidateQueries();
        }}
      />
    );
  }

  // Race fix: when currentUser flips to "lab" via UserLoginScreen.handleLabModeLogin,
  // React re-renders this home page BEFORE the useEffect-scheduled router.push("/lab")
  // fires — causing a flash of the empty home view for the "lab" sentinel user (visible
  // to the user as "a blank user page named lab" before /lab loads). Skip paint
  // entirely on that transition; the useEffect above will navigate within the same tick.
  if (currentUser && currentUser.toLowerCase() === "lab") {
    return null;
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              Research Project Overview
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {ownActiveProjectsCount} active project{ownActiveProjectsCount !== 1 ? "s" : ""} ·{" "}
              {ownActiveTasksCount} active tasks
              {ownArchivedProjectsCount > 0 && (
                <span className="text-gray-300"> · {ownArchivedProjectsCount} archived</span>
              )}
            </p>
          </div>
          <button
            data-tour-target="home-new-project"
            onClick={() => {
              setCreating(true);
              // Onboarding v4 §6.1: notify the universal walkthrough's
              // home-create-project step that the form is opening, so
              // BeakerBot can swap into the fill-form speech without
              // waiting on the polling watcher. Cheap no-op when no
              // tour is active.
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent("tour:home-create-modal-opened"),
                );
              }
            }}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            + New Project
          </button>
        </div>

        {/* Create project form */}
        {creating && (
          <div
            data-tour-target="home-project-create-form"
            className="bg-white border border-gray-200 rounded-xl p-6 mb-8 max-w-lg"
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              New Research Project
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Project Name
                </label>
                <input
                  data-tour-target="home-project-name-input"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. CRISPR Gene Editing Study"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="e.g. sequencing, LC-MS, cell-culture"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Project Color
                </label>
                <div className="flex gap-2">
                  {DEFAULT_COLORS.map((c) => (
                    <Tooltip key={c} label={`Use color ${c}`} placement="bottom">
                      <button
                        onClick={() => setNewColor(c)}
                        aria-label={`Use color ${c}`}
                        className={`w-7 h-7 rounded-full transition-transform ${
                          newColor === c ? "ring-2 ring-offset-2 ring-gray-400 scale-110" : ""
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    </Tooltip>
                  ))}
                </div>
              </div>
              <label
                data-tour-target="home-project-weekend-toggle"
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={newWeekendActive}
                  onChange={(e) => setNewWeekendActive(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600"
                />
                <span className="text-sm text-gray-600">
                  7-day schedule (weekends active)
                </span>
              </label>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setCreating(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  data-tour-target="home-project-create-submit"
                  onClick={handleCreateProject}
                  className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                >
                  Create Project
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Active Project cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {activeSummaries.map(
            ({ project, total, completed, upcoming, overdue, inProgress, displayColor }) => {
              // Only own cards participate in reorder drag — shared-in cards
              // can't be reordered into the receiver's own list (the reorder
              // API is current-user-scoped), so they don't get draggable
              // affordances, drag handlers, or drag-state visual feedback.
              const cardIsDraggable = !project.is_shared_with_me;
              const isBeingDragged = cardIsDraggable && draggedProjectId === project.id;
              const isDropTarget = cardIsDraggable && dragOverProjectId === project.id;
              return (
              <div
                key={`${project.owner}:${project.id}`}
                draggable={cardIsDraggable}
                onDragStart={cardIsDraggable ? (e) => handleDragStart(e, project.id) : undefined}
                onDragOver={cardIsDraggable ? (e) => handleDragOver(e, project.id) : undefined}
                onDragLeave={cardIsDraggable ? handleDragLeave : undefined}
                onDrop={cardIsDraggable ? (e) => handleDrop(e, project.id) : undefined}
                onDragEnd={cardIsDraggable ? handleDragEnd : undefined}
                onClick={() => {
                  const href = project.is_shared_with_me
                    ? `/workbench/projects/${project.id}?owner=${encodeURIComponent(project.owner)}`
                    : `/workbench/projects/${project.id}`;
                  router.push(href);
                }}
                // Onboarding v4 §6.2 cursor-script anchor. The
                // walkthrough clicks `[data-tour-target^='home-project-card-']`
                // to navigate from Home into the new project's route
                // before typing the placeholder hypothesis into the
                // Overview textarea. The per-id suffix keeps the
                // selector specific to the freshly created project
                // (the only matching card on a fresh setup).
                data-tour-target={`home-project-card-${project.id}`}
                className={`group relative bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow cursor-pointer ${
                  isBeingDragged ? "opacity-50 scale-95" : ""
                } ${isDropTarget ? "ring-2 ring-blue-400 ring-offset-2" : ""}`}
              >
                <ProjectCardKebab project={project} />
                <div
                  className="h-1.5"
                  style={{ backgroundColor: displayColor }}
                />

                {/* Malformed-record banner. A project file on disk with a
                    blank name or a bad id renders as a ghost card; before
                    the orphan v2 pass the user had no clue what they were
                    looking at. The banner labels it explicitly and points
                    at the kebab so the cleanup action is obvious. The
                    banner does NOT navigate (the parent's onClick still
                    fires on the rest of the card, but the user will
                    almost always reach for the kebab Delete first when
                    they see this). The startup auto-purge in providers
                    should mean this banner is rarely seen, but if it
                    does surface, the affordance is clear. */}
                {(!project.name || project.name.trim().length === 0) && (
                  <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center gap-2">
                    <svg
                      className="w-4 h-4 text-red-500 flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="text-xs font-medium text-red-700">
                      Orphan project, click the kebab to clean up
                    </span>
                  </div>
                )}

                <div className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold text-gray-900">
                      {project.name && project.name.trim().length > 0
                        ? project.name
                        : (
                          <span className="italic text-gray-400">
                            (unnamed project)
                          </span>
                        )}
                    </h3>
                    <div className="flex items-center gap-2">
                      {project.weekend_active && (
                        <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                          7-day
                        </span>
                      )}
                      {cardIsDraggable && (
                        <Tooltip label="Drag to reorder" placement="bottom">
                          <span className="text-gray-300 cursor-grab" aria-label="Drag to reorder">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
                            </svg>
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mb-4">
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>
                        {completed}/{total} tasks
                      </span>
                      <span>
                        {total > 0
                          ? Math.round((completed / total) * 100)
                          : 0}
                        %
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${total > 0 ? (completed / total) * 100 : 0}%`,
                          backgroundColor: displayColor,
                        }}
                      />
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex gap-4 mb-4 text-xs">
                    <div>
                      <span className="text-gray-400">Active</span>
                      <p className="font-semibold text-gray-700">
                        {inProgress.length}
                      </p>
                    </div>
                    <div>
                      <span className={overdue.length > 0 ? "text-red-400" : "text-gray-400"}>Overdue</span>
                      <p className={`font-semibold ${overdue.length > 0 ? "text-red-600" : "text-gray-700"}`}>
                        {overdue.length}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-400">Upcoming</span>
                      <p className="font-semibold text-gray-700">
                        {upcoming.length}
                      </p>
                    </div>
                  </div>

                  {/* Upcoming tasks */}
                  {upcoming.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                        Next Up
                      </p>
                      <div className="space-y-1">
                        {upcoming.map((t) => {
                          const subTotal = t.sub_tasks?.length ?? 0;
                          const subDone =
                            t.sub_tasks?.filter((s) => s.is_complete).length ?? 0;
                          const showDots =
                            t.task_type === "list" && subTotal > 0;
                          return (
                            <div
                              key={t.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTask(t);
                              }}
                              className="flex items-center justify-between text-xs cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1 py-0.5"
                            >
                              <span className="text-gray-600 truncate mr-2 flex items-center gap-1.5">
                                {t.task_type === "experiment" && (
                                  <span className="w-1 h-3 rounded-full bg-purple-400 flex-shrink-0" />
                                )}
                                {t.name}
                              </span>
                              <span className="flex items-center gap-2 flex-shrink-0">
                                {showDots && (
                                  <SubTaskProgressDots
                                    completed={subDone}
                                    total={subTotal}
                                    hideCount
                                  />
                                )}
                                <span className="text-gray-400">
                                  {t.start_date}
                                </span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Tags */}
                  {project.tags && project.tags.length > 0 && (
                    <div className="flex gap-1 mt-3 flex-wrap">
                      {project.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              );
            }
          )}
        </div>

        {/* Archived Projects Section */}
        {archivedSummaries.length > 0 && (
          <div className="mt-12">
            <h3 className="text-lg font-semibold text-gray-500 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              Archived Projects
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {archivedSummaries.map(
                ({ project, total, completed, displayColor }) => (
                  <div
                    key={`${project.owner}:${project.id}`}
                    onClick={() => {
                      const href = project.is_shared_with_me
                        ? `/workbench/projects/${project.id}?owner=${encodeURIComponent(project.owner)}`
                        : `/workbench/projects/${project.id}`;
                      router.push(href);
                    }}
                    className="group relative bg-gray-50 border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow cursor-pointer opacity-75 hover:opacity-100"
                  >
                    <ProjectCardKebab project={project} />
                    {/* Color bar - muted */}
                    <div className="h-1.5" style={{ backgroundColor: displayColor }} />

                    <div className="p-5">
                      {/* Archived date badge */}
                      <div className="mb-2">
                        <span className="text-[10px] px-2 py-0.5 bg-gray-200 text-gray-500 rounded-full">
                          Archived {formatArchivedDate(project.archived_at)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-base font-semibold text-gray-600">
                          {project.name}
                        </h3>
                        {project.weekend_active && (
                          <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-400 rounded-full">
                            7-day
                          </span>
                        )}
                      </div>

                      {/* Progress bar */}
                      <div className="mb-4">
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>
                            {completed}/{total} tasks
                          </span>
                          <span>
                            {total > 0
                              ? Math.round((completed / total) * 100)
                              : 0}
                            %
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${total > 0 ? (completed / total) * 100 : 0}%`,
                              backgroundColor: displayColor,
                            }}
                          />
                        </div>
                      </div>

                      {/* Tags */}
                      {project.tags && project.tags.length > 0 && (
                        <div className="flex gap-1 mt-3 flex-wrap">
                          {project.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-400 rounded"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {projects.length === 0 && !creating && (
          <div className="text-center py-16">
            <p className="text-lg text-gray-400 mb-2">No projects yet</p>
            <p className="text-sm text-gray-300 mb-6">
              Create your first research project to get started
            </p>
            <button
              data-tour-target="home-new-project"
              onClick={() => {
              setCreating(true);
              // Onboarding v4 §6.1: notify the universal walkthrough's
              // home-create-project step that the form is opening, so
              // BeakerBot can swap into the fill-form speech without
              // waiting on the polling watcher. Cheap no-op when no
              // tour is active.
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent("tour:home-create-modal-opened"),
                );
              }
            }}
              className="px-6 py-3 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + New Project
            </button>
          </div>
        )}
      </div>

      {/* Task Detail Popup */}
      {selectedTask && (
        <TaskDetailPopup
          task={selectedTask}
          project={projects.find(
            (p) =>
              p.id === selectedTask.project_id && p.owner === selectedTask.owner,
          )}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {/* Loading overlay while checking user */}
      {checkingUser && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
            <p className="text-sm text-gray-500">Checking user...</p>
          </div>
        </div>
      )}
    </AppShell>
  );
}
