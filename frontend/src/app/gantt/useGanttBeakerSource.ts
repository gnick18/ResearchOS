// sequence editor master (Gantt source sub-bot). BeakerSearch step 3, the thin
// HOOK that wires the live Gantt page state + handlers into the pure
// buildGanttSource builder and registers the result with the shared palette.
//
// All the testable logic lives in gantt-beaker-source.ts (no React, no store).
// This hook only reads the store slices + queries the page already reads, closes
// the handler bag over the real store actions + tasksApi / goalsApi + the
// queryClient refetch set (the spec 7 invalidation table), formats the date
// window the way the Toolbar does, keeps a small session-local recently-opened
// list, and calls buildGanttSource inside a useMemo so the registration object
// is stable.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useCallback, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  goalsApi,
  tasksApi,
  fetchAllTasksIncludingShared,
  fetchAllProjectsIncludingShared,
} from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAppStore } from "@/lib/store";
import { useBeakerSearchSource } from "@/components/beaker-search/useBeakerSearchSource";
import { useBeakerHoveredKey } from "@/components/beaker-search/BeakerSearchProvider";
import { parseBeakerTargetKey } from "@/components/beaker-search/beaker-hover";
import { encodeFilterKey, STANDALONE_FILTER_KEY } from "@/lib/search/filterKey";
import { taskKey } from "@/lib/types";
import type { HighLevelGoal, Project, Task, ViewMode } from "@/lib/types";
import {
  buildGanttSource,
  type GanttSourceData,
  type GanttSourceHandlers,
  type GanttWindow,
} from "./gantt-beaker-source";

// How many recently-opened task keys the session-local list keeps (spec 5).
const RECENT_CAP = 6;

// weeksToShow per view mode, mirrored from Toolbar so the window math matches
// what the user sees.
function weeksForViewMode(mode: ViewMode): number {
  switch (mode) {
    case "1week":
      return 1;
    case "2week":
      return 2;
    case "3week":
      return 3;
    case "1month":
      return 4;
    case "3month":
      return 13;
    case "6month":
      return 26;
    case "1year":
      return 52;
    case "all":
      return 8;
    default:
      return 2;
  }
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Compute the visible window labels the same way Toolbar's displayDateRange
 *  does (ganttStartDate Monday + weeksToShow * 7 - 1). */
function ganttWindow(ganttStartDate: string | null, viewMode: ViewMode): GanttWindow {
  const start = ganttStartDate
    ? new Date(ganttStartDate + "T00:00:00")
    : getMonday(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + weeksForViewMode(viewMode) * 7 - 1);
  return { startLabel: monthLabel(start), endLabel: monthLabel(end) };
}

/** Register the Gantt page's BeakerSearch source while the page is mounted.
 *  Call once from app/gantt/page.tsx after the queries + store reads. */
export function useGanttBeakerSource(): void {
  const queryClient = useQueryClient();
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  // Store slices (the same ones the page / Toolbar read).
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const projectFilterMode = useAppStore((s) => s.projectFilterMode);
  const selectedTags = useAppStore((s) => s.selectedTags);
  const showShared = useAppStore((s) => s.showShared);
  const viewMode = useAppStore((s) => s.viewMode);
  const ganttStartDate = useAppStore((s) => s.ganttStartDate);
  const editingTaskKey = useAppStore((s) => s.editingTaskKey);
  const editingGoal = useAppStore((s) => s.editingGoal);

  // Store actions.
  const setEditingTaskKey = useAppStore((s) => s.setEditingTaskKey);
  const setEditingGoal = useAppStore((s) => s.setEditingGoal);
  const setProjectFilterMode = useAppStore((s) => s.setProjectFilterMode);
  const setSelectedProjects = useAppStore((s) => s.setSelectedProjects);
  const toggleTag = useAppStore((s) => s.toggleTag);
  const setShowShared = useAppStore((s) => s.setShowShared);
  const setGanttStartDate = useAppStore((s) => s.setGanttStartDate);
  const ganttNavigateWeeks = useAppStore((s) => s.ganttNavigateWeeks);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const setNewTaskStartDate = useAppStore((s) => s.setNewTaskStartDate);
  const setIsCreatingTask = useAppStore((s) => s.setIsCreatingTask);
  const setIsCreatingGoal = useAppStore((s) => s.setIsCreatingGoal);

  // Queries (mirrors of the page's, sharing the cache by key so no extra fetch).
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });
  const { data: goals = [] } = useQuery({
    queryKey: ["goals", currentUser],
    queryFn: goalsApi.list,
  });
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", "with-shared", currentUser],
    queryFn: fetchAllTasksIncludingShared,
  });

  const activeProjects = useMemo<Project[]>(
    () => projects.filter((p) => !p.is_archived),
    [projects],
  );

  // Same scoping the page's activeTasks / filteredTasks compute. We recompute it
  // here so the source's empty-query nav list matches the chart's visible bars.
  const filteredTasks = useMemo<Task[]>(() => {
    let tasks = allTasks;
    if (projects.length > 0) {
      tasks = tasks.filter((t) => {
        if (t.is_shared_with_me) return true;
        const project = projects.find(
          (p) => p.id === t.project_id && p.owner === t.owner,
        );
        return Boolean(project && !project.is_archived);
      });
    }
    if (!showShared) tasks = tasks.filter((t) => !t.is_shared_with_me);
    if (projectFilterMode === "explicit") {
      tasks = tasks.filter((t) => {
        if (t.is_shared_with_me) return true;
        return selectedProjectIds.some((key) => {
          const [owner, idStr] = key.split(":");
          return key !== STANDALONE_FILTER_KEY
            ? t.owner === owner && String(t.project_id) === idStr
            : !t.project_id;
        });
      });
    }
    if (selectedTags.length > 0) {
      tasks = tasks.filter(
        (t) => t.tags && t.tags.some((tag) => selectedTags.includes(tag)),
      );
    }
    return tasks;
  }, [
    allTasks,
    projects,
    showShared,
    projectFilterMode,
    selectedProjectIds,
    selectedTags,
  ]);

  const allTags = useMemo<string[]>(() => {
    const tagSet = new Set<string>();
    for (const p of activeProjects) p.tags?.forEach((t) => tagSet.add(t));
    for (const t of allTasks) {
      const project = projects.find(
        (p) => p.id === t.project_id && p.owner === t.owner,
      );
      if (t.is_shared_with_me || (project && !project.is_archived)) {
        t.tags?.forEach((tag) => tagSet.add(tag));
      }
    }
    return Array.from(tagSet).sort();
  }, [activeProjects, allTasks, projects]);

  // Session-local recently-opened task keys, newest first, capped + de-duped.
  const recentRef = useRef<string[]>([]);
  const recordRecent = useCallback((key: string) => {
    const next = [key, ...recentRef.current.filter((k) => k !== key)];
    recentRef.current = next.slice(0, RECENT_CAP);
  }, []);

  // The refetch helper (spec 7 invalidation table).
  const refetch = useCallback(
    (queryKey: (string | number)[]) =>
      queryClient.refetchQueries({ queryKey }),
    [queryClient],
  );

  // Wrap setEditingTaskKey so every palette-driven open records a recent.
  const openTask = useCallback(
    (key: string | null) => {
      if (key) recordRecent(key);
      setEditingTaskKey(key);
    },
    [recordRecent, setEditingTaskKey],
  );

  const handlers = useMemo<GanttSourceHandlers>(
    () => ({
      setEditingTaskKey: openTask,
      setEditingGoal,
      setProjectFilterMode,
      setSelectedProjects,
      toggleTag,
      setShowShared,
      setGanttStartDate,
      ganttNavigateWeeks,
      setViewMode: (value: string) => setViewMode(value as ViewMode),
      setNewTaskStartDate,
      createTask: () => setIsCreatingTask(true),
      createGoal: () => setIsCreatingGoal(true),
      markTaskComplete: async (task: Task) => {
        await tasksApi.update(
          task.id,
          { is_complete: !task.is_complete },
          task.is_shared_with_me ? task.owner : undefined,
        );
        await refetch(["tasks"]);
        await refetch(["task", taskKey(task)]);
      },
      deleteTask: async (task: Task) => {
        if (!confirm(`Delete "${task.name}"? It moves to Trash.`)) return;
        await tasksApi.delete(task.id);
        if (editingTaskKey === taskKey(task)) setEditingTaskKey(null);
        await refetch(["tasks"]);
        await refetch(["task"]);
        await refetch(["dependencies"]);
      },
      markGoalComplete: async (goal: HighLevelGoal) => {
        await goalsApi.update(goal.id, { is_complete: !goal.is_complete });
        await refetch(["goals"]);
      },
      deleteGoal: async (goal: HighLevelGoal) => {
        if (
          !confirm(
            `Are you sure you want to delete "${goal.name}"? This action cannot be undone.`,
          )
        ) {
          return;
        }
        await goalsApi.delete(goal.id);
        await refetch(["goals"]);
        setEditingGoal(null);
        setIsCreatingGoal(false);
      },
    }),
    [
      openTask,
      setEditingGoal,
      setProjectFilterMode,
      setSelectedProjects,
      toggleTag,
      setShowShared,
      setGanttStartDate,
      ganttNavigateWeeks,
      setViewMode,
      setNewTaskStartDate,
      setIsCreatingTask,
      setIsCreatingGoal,
      setEditingTaskKey,
      editingTaskKey,
      refetch,
    ],
  );

  const window = useMemo<GanttWindow>(
    () => ganttWindow(ganttStartDate, viewMode),
    [ganttStartDate, viewMode],
  );

  // HOVERED. The bar the cursor was over when the palette opened (null while
  // closed). Parse its data-beaker-target key the same way the provider stamps it
  // ("task:<composite key>" / "goal:<id>"), then resolve to the live entity.
  // SELECTED still outranks this in the builder, so a real open task / goal wins.
  const hoveredKey = useBeakerHoveredKey();
  const hovered = useMemo<GanttSourceData["hovered"]>(() => {
    const parsed = parseBeakerTargetKey(hoveredKey);
    if (!parsed) return null;
    if (parsed.kind === "task") {
      const task = allTasks.find((t) => taskKey(t) === parsed.key);
      return task ? { kind: "task", task } : null;
    }
    if (parsed.kind === "goal") {
      const goal = goals.find((g) => String(g.id) === parsed.key);
      return goal ? { kind: "goal", goal } : null;
    }
    return null;
  }, [hoveredKey, allTasks, goals]);

  const source = useMemo(() => {
    const data: GanttSourceData = {
      allTasks,
      filteredTasks,
      activeProjects,
      goals,
      allTags,
      projectFilterMode,
      selectedProjectIds,
      selectedTags,
      showShared,
      ganttStartDate,
      window,
      editingTaskKey,
      editingGoal,
      hovered,
      recentTaskKeys: recentRef.current,
      taskKeyOf: (task) => taskKey(task),
      filterKeyOf: (project) => encodeFilterKey(project),
      standaloneFilterKey: STANDALONE_FILTER_KEY,
    };
    return buildGanttSource(data, handlers);
  }, [
    allTasks,
    filteredTasks,
    activeProjects,
    goals,
    allTags,
    projectFilterMode,
    selectedProjectIds,
    selectedTags,
    showShared,
    ganttStartDate,
    window,
    editingTaskKey,
    editingGoal,
    hovered,
    handlers,
  ]);

  useBeakerSearchSource(source);
}
