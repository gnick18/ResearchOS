"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { goalsApi, dependenciesApi, fetchAllTasksIncludingShared, fetchAllProjectsIncludingShared, labApi } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { useIsClassMode } from "@/hooks/useIsClassMode";
import { useIsClassStudent } from "@/hooks/useIsClassStudent";
import { useAppStore } from "@/lib/store";
import AppShell from "@/components/AppShell";
import GanttChart from "@/components/GanttChart";
import Toolbar from "@/components/Toolbar";
import BulkMoveModal from "@/components/BulkMoveModal";
import TaskModal from "@/components/TaskModal";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import HighLevelGoalModal from "@/components/HighLevelGoalModal";
import HighLevelGoalSidebar from "@/components/HighLevelGoalSidebar";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { matchesAnyProjectFilter } from "@/lib/search/filterKey";
import { taskKey } from "@/lib/types";
import type { HighLevelGoal, Project, Task } from "@/lib/types";
import { useGanttBeakerSource } from "./useGanttBeakerSource";

// Composite key for project lookups: shared and own projects can share a
// numeric id and must not collide. Mirrors the `taskKey` pattern in
// lib/types.ts and the helper used on /search, /experiments, /results.
const projectKey = (p: Pick<Project, "id" | "owner">) => `${p.owner}:${p.id}`;

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const projectFilterMode = useAppStore((s) => s.projectFilterMode);
  const selectedTags = useAppStore((s) => s.selectedTags);
  const showShared = useAppStore((s) => s.showShared);
  const editingTaskKey = useAppStore((s) => s.editingTaskKey);
  const setEditingTaskKey = useAppStore((s) => s.setEditingTaskKey);
  const setIsCreatingTask = useAppStore((s) => s.setIsCreatingTask);
  const isCreatingGoal = useAppStore((s) => s.isCreatingGoal);
  const setIsCreatingGoal = useAppStore((s) => s.setIsCreatingGoal);
  const editingGoal = useAppStore((s) => s.editingGoal);
  const setEditingGoal = useAppStore((s) => s.setEditingGoal);
  
  // State for delete confirmation
  const [, setDeletingGoal] = useState<HighLevelGoal | null>(null);

  // BeakerBot post-write highlight: taskKeys to briefly glow on the Gantt
  // after an experiment tool creates or reschedules. Populated from the
  // ?highlightTasks= param (comma-separated "self:<id>" keys), then stripped
  // from the URL immediately so a refresh does not re-highlight.
  const [highlightTaskKeys, setHighlightTaskKeys] = useState<string[]>([]);

  // RS-2: the task opened from the lab rollup (read-only, owner-routed). Kept
  // separate from editingTaskKey because lab tasks live outside the personal
  // allTasks set the editingTaskKey lookup uses.
  const [labTaskOpen, setLabTaskOpen] = useState<
    (Task & { username?: string }) | null
  >(null);

  useEffect(() => {
    const raw = searchParams?.get("highlightTasks");
    if (!raw) return;
    const keys = raw.split(",").filter(Boolean);
    if (keys.length === 0) return;
    setHighlightTaskKeys(keys);
    // Strip the param from the URL (replace so it does not create a history
    // entry), mirroring how /?openTask= and /datahub?analysis= strip theirs.
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.delete("highlightTasks");
    const clean = next.toString() ? `?${next.toString()}` : "";
    router.replace(`/gantt${clean}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount when param is present; router is stable
  }, []);

  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  // RS-2: a PI can view the lab-wide rollup (every member's tasks on one
  // timeline) and flip back to their own. The lab view is READ-ONLY: GanttChart's
  // lab mode disables every drag/resize handler, and a click opens the task
  // read-only (edit-as-lab-head lives in the popup).
  //
  // UX-clawback (2026-06-26): a PI now lands on their OWN editable timeline by
  // default so the first thing they see is a surface they can actually drag and
  // schedule on. They flip to "Lab rollup" via the in-page scope toggle below
  // whenever they want the cross-member overview. This is the Gantt's own view
  // default and is intentionally NOT wired to the global piViewMode lens (the
  // header Lab / My-work toggle): the read-only rollup was a poor first landing
  // even for a PI whose header lens reads "lab".
  const isLabHead = useIsLabHead(currentUser || null) === true;
  // CT-6: any class folder (instructor OR student). High-level lab goals have no
  // classroom meaning, so the goals sidebar + create button + goal markers are
  // hidden in a class. Loading resolves to false (goals show briefly then hide),
  // which is fine since /gantt is hidden from the student nav anyway.
  const isClassInstructor = useIsClassMode(currentUser || null) === true;
  const isClassStudent = useIsClassStudent(currentUser || null) === true;
  const inClass = isClassInstructor || isClassStudent;
  // Always start on the personal (editable) timeline. The PI opts into the lab
  // rollup with the in-page scope toggle. (Previously this auto-flipped to "lab"
  // when the global piViewMode lens resolved to "lab", which dumped PIs onto a
  // read-only surface on arrival.)
  const [ganttScope, setGanttScope] = useState<"mine" | "lab">("mine");
  const labMode = isLabHead && ganttScope === "lab";

  // Personal data (own + shared-with-me), the default source.
  const { data: personalProjects = [] } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });
  // Lab-wide full tasks/projects/users, fetched only in the lab rollup.
  const { data: labProjectsFull = [] } = useQuery({
    queryKey: ["lab", "gantt-projects-full"],
    queryFn: () => labApi.getProjectsFull(),
    enabled: labMode,
  });
  const { data: labTasksFull = [] } = useQuery({
    queryKey: ["lab", "gantt-tasks-full"],
    queryFn: () => labApi.getTasksFull(),
    enabled: labMode,
  });
  // MUST match the canonical ["lab","users"] shape (an array): useLabData +
  // useGanttBeakerSource read this key and call .filter on it. Returning the raw
  // { users } object (what labApi.getUsers gives) poisoned the shared cache and
  // crashed the Gantt with "labUsers.filter is not a function".
  const { data: labUsers = [] } = useQuery({
    queryKey: ["lab", "users"],
    queryFn: () => labApi.getUsers().then((r) => r.users),
    enabled: labMode,
  });
  const labUserColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of labUsers) m.set(u.username, u.color);
    return m;
  }, [labUsers]);

  const projects = labMode ? labProjectsFull : personalProjects;

  const { data: goals = [] } = useQuery({
    queryKey: ["goals", currentUser],
    queryFn: goalsApi.list,
  });

  const activeProjects = useMemo(() => 
    projects.filter((p) => !p.is_archived),
    [projects]
  );

  // Use a distinct query key from the rest of the app: other pages cache the
  // current user's own tasks under ["tasks", currentUser] via `fetchAllTasks`.
  // Without a distinct key, React Query would hand the Gantt a stale 15-task
  // result when the user navigates back from one of those pages. The key still
  // begins with "tasks" so existing `invalidateQueries({ queryKey: ["tasks"] })`
  // calls elsewhere will continue to invalidate it via prefix match.
  const { data: personalTasks = [] } = useQuery({
    queryKey: ["tasks", "with-shared", currentUser],
    queryFn: fetchAllTasksIncludingShared,
  });
  // The lab rollup swaps in every member's full tasks; the existing activeTasks /
  // projectColors memos below operate on whichever source is chosen.
  const allTasks: Task[] = labMode ? labTasksFull : personalTasks;

  useEffect(() => {
    console.log("[Gantt] Data loaded:", {
      currentUser,
      projectsCount: projects.length,
      tasksCount: allTasks.length,
      activeProjectsCount: activeProjects.length,
      sampleTask: allTasks[0] ? { id: allTasks[0].id, name: allTasks[0].name, project_id: allTasks[0].project_id } : null,
      sampleProject: projects[0] ? { id: projects[0].id, name: projects[0].name } : null,
    });
  }, [projects, allTasks, activeProjects, currentUser]);

  const activeTasks = useMemo(() => {
    if (projects.length === 0) {
      console.log("[Gantt] Projects not loaded yet, returning all tasks:", allTasks.length);
      return allTasks;
    }
    
    console.log("[Gantt.activeTasks] Projects loaded:", projects.length, "project IDs:", projects.map(p => p.id));
    console.log("[Gantt.activeTasks] All tasks:", allTasks.length, "task project IDs:", allTasks.map(t => t.project_id));
    
    let tasks = allTasks.filter((t) => {
      if (t.is_shared_with_me) {
        console.log("[Gantt.activeTasks] Task", t.id, "is shared with me, keeping");
        return true;
      }
      const project = projects.find(
        (p) => p.id === t.project_id && p.owner === t.owner,
      );
      const result = project && !project.is_archived;
      if (!project) {
        console.log("[Gantt.activeTasks] Task", t.id, "project", t.project_id, "not found in projects array");
      } else if (project.is_archived) {
        console.log("[Gantt.activeTasks] Task", t.id, "project", project.name, "is archived");
      }
      return result;
    });
    
    if (!showShared) {
      tasks = tasks.filter((t) => {
        return !t.is_shared_with_me;
      });
    }

    console.log("[Gantt] Active tasks filtered:", {
      allTasksCount: allTasks.length,
      projectsCount: projects.length,
      activeTasksCount: tasks.length,
    });
    
    return tasks;
  }, [allTasks, projects, showShared]);

  const { data: personalDependencies = [] } = useQuery({
    queryKey: ["dependencies", currentUser],
    queryFn: () => dependenciesApi.list(),
  });
  // Dependency arrows are a within-owner planning detail; the lab rollup is a
  // cross-member timeline overview, so it shows none (v1).
  const dependencies = labMode ? [] : personalDependencies;

  // Filter dependencies to only include those between active tasks
  const activeDependencies = useMemo(() => {
    const activeTaskIds = new Set(activeTasks.map((t) => t.id));
    return dependencies.filter(
      (d) => activeTaskIds.has(d.parent_id) && activeTaskIds.has(d.child_id)
    );
  }, [dependencies, activeTasks]);

  const filteredTasks = useMemo(() => {
    console.log("[Gantt.filteredTasks] Computing from activeTasks:", activeTasks.length);
    let tasks = activeTasks;

    if (projectFilterMode === "explicit") {
      // Composite-key match (alex:1 vs morgan:1 disambiguated by owner).
      // Shared-into-me tasks bypass the project filter on purpose: their
      // project lives in the other user's namespace and would never
      // satisfy a local owner:id key.
      // When selectedProjectIds is empty in explicit mode, this collapses
      // every non-shared task away (the Clear button state). The Shared
      // bypass keeps shared-in tasks visible regardless.
      tasks = tasks.filter((t) => {
        if (t.is_shared_with_me) return true;
        return matchesAnyProjectFilter(t, selectedProjectIds);
      });
      console.log("[Gantt.filteredTasks] After project filter:", tasks.length);
    }
    
    if (selectedTags.length > 0) {
      tasks = tasks.filter(
        (t) => t.tags && t.tags.some((tag) => selectedTags.includes(tag))
      );
      console.log("[Gantt.filteredTasks] After tag filter:", tasks.length);
    }
    
    console.log("[Gantt.filteredTasks] Final count:", tasks.length, "Sample:", tasks[0] ? { id: tasks[0].id, name: tasks[0].name, start: tasks[0].start_date } : null);
    return tasks;
  }, [activeTasks, selectedProjectIds, selectedTags, projectFilterMode]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const p of activeProjects) p.tags?.forEach((t) => tagSet.add(t));
    for (const t of activeTasks) t.tags?.forEach((tag) => tagSet.add(tag));
    return Array.from(tagSet).sort();
  }, [activeProjects, activeTasks]);

  // Keyed by composite `${owner}:${id}` so a shared project and an own
  // project with the same numeric id keep distinct colors. The Gantt's
  // child components (GanttChart / Toolbar) take the same
  // composite-keyed shape — see `projectKey` / `taskProjectKey` helpers
  // at the top of this file for lookups.
  const projectColors = useMemo(() => {
    const defaultColors = [
      "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
      "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
    ];
    const map: Record<string, string> = {};
    activeProjects.forEach((p, i) => {
      map[projectKey(p)] = p.color || defaultColors[i % defaultColors.length];
    });
    return map;
  }, [activeProjects]);

  const handleTaskClick = useCallback(
    (key: string) => {
      setEditingTaskKey(key);
    },
    [setEditingTaskKey]
  );

  const handleCreateTask = useCallback(
    () => setIsCreatingTask(true),
    [setIsCreatingTask]
  );

  const handleCreateGoal = useCallback(
    () => setIsCreatingGoal(true),
    [setIsCreatingGoal]
  );

  // Delete goal handler with confirmation
  const handleDeleteGoal = useCallback(
    async (goal: HighLevelGoal) => {
      if (!confirm(`Are you sure you want to delete "${goal.name}"? This action cannot be undone.`)) {
        return;
      }
      try {
        await goalsApi.delete(goal.id);
        await queryClient.refetchQueries({ queryKey: ["goals"] });
        setEditingGoal(null);
        setIsCreatingGoal(false);
        setDeletingGoal(null);
      } catch (err) {
        console.error("Failed to delete goal:", err);
        alert("Failed to delete goal");
      }
    },
    [queryClient, setEditingGoal, setIsCreatingGoal]
  );

  // Register the Gantt page's BeakerSearch source (step 3) while mounted. The
  // hook reads the same store slices + queries above and builds the source via
  // the pure buildGanttSource builder. No props needed, it reads the store.
  useGanttBeakerSource();

  // Find the task and project for the detail popup
  const editingTask = editingTaskKey
    ? allTasks.find((t) => taskKey(t) === editingTaskKey)
    : null;
  const editingProject = editingTask
    ? projects.find(
        (p) => p.id === editingTask.project_id && p.owner === editingTask.owner,
      )
    : undefined;

  return (
    <AppShell>
      {/* RS-2 scope toggle: a PI flips the Gantt between their own timeline and
          the lab-wide rollup. Members never see it. */}
      {isLabHead && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-raised px-4 py-2">
          <span className="text-meta font-medium text-foreground-muted">
            View
          </span>
          <div
            className="flex items-center gap-0.5 rounded-full border border-border bg-surface px-0.5 py-0.5"
            role="group"
            aria-label="Gantt scope"
          >
            {(
              [
                ["mine", "My timeline"],
                ["lab", "Lab rollup"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setGanttScope(value)}
                aria-pressed={ganttScope === value}
                data-testid={`gantt-scope-${value}`}
                className={`rounded-full px-2.5 py-1 text-meta font-medium transition ${
                  ganttScope === value
                    ? "bg-brand-action text-white"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {labMode ? (
        // Read-only lab rollup: every member's tasks on one timeline, color-coded
        // by member. Drags are disabled by GanttChart's isLabMode; a click opens
        // the task read-only.
        <div className="flex flex-1 overflow-hidden">
          <GanttChart
            tasks={activeTasks}
            dependencies={[]}
            projectColors={projectColors}
            projects={activeProjects}
            goals={[]}
            onTaskClick={() => {}}
            onGoalClick={() => {}}
            isLabMode
            userColors={labUserColors}
            onTaskClickLab={(t) => setLabTaskOpen(t)}
            highlightTaskKeys={[]}
            onHighlightDone={() => {}}
          />
        </div>
      ) : (
        <>
          {/* UX-clawback purpose cue (2026-06-26): name the page's differentiator
              up front and make the dependency-link capability discoverable. The
              link itself is performed by dragging one experiment bar onto another
              (handleDropOnTask in GanttChart); that gesture was undiscoverable, so
              this one-liner plus the hover tip surface it without building a new
              dependency system. */}
          <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2">
            <Icon
              name="connector"
              className="h-4 w-4 shrink-0 text-brand-action"
            />
            <p className="text-meta text-foreground-muted">
              Schedule dependency-linked tasks: drag one experiment bar onto
              another to link them, and rescheduling a task cascades to everything
              downstream.
            </p>
            <Tooltip
              label="Drag an experiment bar and drop it on another experiment to link them. You then pick how they schedule (start together, or one after the other). Moving a linked task shifts its dependents automatically."
              placement="bottom"
            >
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface-raised px-2.5 py-1 text-meta font-medium text-foreground">
                <Icon name="connector" className="h-3.5 w-3.5" />
                Link tasks
              </span>
            </Tooltip>
          </div>

          <Toolbar
            projects={activeProjects}
            allTags={allTags}
            onCreateTask={handleCreateTask}
            onCreateGoal={handleCreateGoal}
            projectColors={projectColors}
            showGoalButton={!inClass}
          />

          <div className="flex flex-1 overflow-hidden">
            <GanttChart
              tasks={filteredTasks}
              dependencies={activeDependencies}
              projectColors={projectColors}
              projects={activeProjects}
              goals={inClass ? [] : goals}
              onTaskClick={handleTaskClick}
              onGoalClick={(goal) => setEditingGoal(goal)}
              highlightTaskKeys={highlightTaskKeys}
              onHighlightDone={() => setHighlightTaskKeys([])}
            />
            {/* High-level goals are a research-lab concept; hidden in a class. */}
            {!inClass && (
              <HighLevelGoalSidebar
                goals={goals}
                onEditGoal={(goal) => setEditingGoal(goal)}
                onDeleteGoal={handleDeleteGoal}
              />
            )}
          </div>

          <BulkMoveModal />
          <TaskModal projects={activeProjects} />

          {/* Task Detail Popup when a task is selected */}
          {editingTask && (
            <TaskDetailPopup
              task={editingTask}
              project={editingProject}
              onClose={() => setEditingTaskKey(null)}
              readOnly={editingTask.is_shared_with_me === true && editingTask.shared_permission !== "edit"}
              username={editingTask.is_shared_with_me ? editingTask.owner : undefined}
            />
          )}

          {/* High-Level Goal Modal (never in a class, goals are hidden there) */}
          {!inClass && (isCreatingGoal || editingGoal) && (
            <HighLevelGoalModal
              projects={activeProjects}
              onClose={() => {
                setIsCreatingGoal(false);
                setEditingGoal(null);
              }}
              editingGoal={editingGoal}
              onDeleteGoal={handleDeleteGoal}
            />
          )}
        </>
      )}

      {/* Lab rollup task popup (read-only, owner-routed; edit-as-lab-head lives
          inside the popup). */}
      {labTaskOpen && (
        <TaskDetailPopup
          task={labTaskOpen}
          readOnly
          username={labTaskOpen.owner ?? labTaskOpen.username}
          onClose={() => setLabTaskOpen(null)}
          onNavigateToTask={(t) => setLabTaskOpen(t as Task & { username?: string })}
        />
      )}
    </AppShell>
  );
}
