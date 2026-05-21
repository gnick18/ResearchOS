"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAllTasksIncludingShared,
  tasksApi,
} from "@/lib/local-api";
import { useAppStore } from "@/lib/store";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { matchesAnyProjectFilter } from "@/lib/search/filterKey";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import TaskModal from "@/components/TaskModal";
import { taskKey, type Project, type Task } from "@/lib/types";
import {
  bucketListTasks,
  type ListSection,
} from "@/lib/workbench/listSectionAssignment";
import ListTaskRow, {
  type DateSignalKind,
} from "@/components/workbench/ListTaskRow";
import SharedFromPill from "@/components/workbench/SharedFromPill";

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

const projectKey = (p: Pick<Project, "id" | "owner">) => `${p.owner}:${p.id}`;

const UPCOMING_HORIZON_DAYS = 14;

const SECTION_ORDER: ListSection[] = [
  "overdue",
  "doing",
  "upcoming",
  "recentlyDone",
  "earlier",
];

const SECTION_LABEL: Record<ListSection, string> = {
  overdue: "Overdue",
  doing: "Doing",
  upcoming: "Upcoming",
  recentlyDone: "Recently done",
  earlier: "Earlier",
};

const SECTION_HELP: Record<ListSection, string> = {
  overdue: "End date passed, not yet complete",
  doing: "Today falls between start and end date",
  upcoming: "Scheduled to start later",
  recentlyDone: "Completed in the last 30 days",
  earlier: "Completed more than 30 days ago",
};

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + "T00:00:00Z").getTime();
  const b = new Date(bIso + "T00:00:00Z").getTime();
  return Math.round((a - b) / 86_400_000);
}

interface DateSignal {
  text: string;
  kind: DateSignalKind;
}

function dateSignalFor(task: Task, today: string): DateSignal {
  if (task.is_complete) {
    if (!task.end_date) return { text: "Done", kind: "done" };
    const days = daysBetween(today, task.end_date);
    if (days <= 0) return { text: "Done today", kind: "done" };
    if (days === 1) return { text: "Done yesterday", kind: "done" };
    return { text: `Done ${days}d ago`, kind: "done" };
  }
  if (task.end_date && task.end_date < today) {
    const days = daysBetween(today, task.end_date);
    return { text: `${days}d overdue`, kind: "overdue" };
  }
  if (task.start_date <= today) {
    if (task.start_date === today) return { text: "Started today", kind: "doing" };
    const days = daysBetween(today, task.start_date);
    if (days === 1) return { text: "Started yesterday", kind: "doing" };
    return { text: `Started ${days}d ago`, kind: "doing" };
  }
  const days = daysBetween(task.start_date, today);
  if (days === 0) return { text: "Starts today", kind: "upcoming" };
  if (days === 1) return { text: "Starts tomorrow", kind: "upcoming" };
  return { text: `Starts in ${days}d`, kind: "upcoming" };
}

interface Props {
  projects: Project[];
}

export default function WorkbenchListsPanel({ projects }: Props) {
  const queryClient = useQueryClient();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const setIsCreatingTask = useAppStore((s) => s.setIsCreatingTask);
  const setNewTaskStartDate = useAppStore((s) => s.setNewTaskStartDate);
  const setRestrictedTaskType = useAppStore((s) => s.setRestrictedTaskType);

  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasksIncludingShared,
    enabled: projects.length > 0,
  });

  // Local-tz YYYY-MM-DD (mirrors the off-by-one fix on /experiments).
  const today = new Date().toLocaleDateString("en-CA");

  // All list tasks, filtered by the global project selector.
  // Composite-key match (alex:1 vs morgan:1 disambiguated by owner).
  const lists = useMemo(() => {
    let xs = allTasks.filter((t) => t.task_type === "list");
    xs = xs.filter((t) => matchesAnyProjectFilter(t, selectedProjectIds));
    return xs;
  }, [allTasks, selectedProjectIds]);

  const buckets = useMemo(
    () => bucketListTasks(lists, { today }),
    [lists, today],
  );

  // Upcoming horizon split. Anything beyond UPCOMING_HORIZON_DAYS lands in a
  // "Scheduled later" footer hint matching the Experiments tab pattern.
  const upcomingNear = useMemo(
    () =>
      buckets.upcoming.filter(
        (t) => daysBetween(t.start_date, today) <= UPCOMING_HORIZON_DAYS,
      ),
    [buckets.upcoming, today],
  );
  const upcomingLater = useMemo(
    () =>
      buckets.upcoming.filter(
        (t) => daysBetween(t.start_date, today) > UPCOMING_HORIZON_DAYS,
      ),
    [buckets.upcoming, today],
  );

  const projectColors = useMemo(() => {
    const map: Record<string, string> = {};
    projects.forEach((p, i) => {
      map[projectKey(p)] = p.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    });
    return map;
  }, [projects]);

  const projectNameFor = useCallback(
    (task: Task): string => {
      const hit = projects.find(
        (p) => p.id === task.project_id && p.owner === task.owner,
      );
      return hit?.name ?? `Unknown project (#${task.project_id})`;
    },
    [projects],
  );

  const handleCreateListTask = useCallback(() => {
    setNewTaskStartDate(null);
    setRestrictedTaskType("list");
    setIsCreatingTask(true);
  }, [setIsCreatingTask, setNewTaskStartDate, setRestrictedTaskType]);

  const handleToggleComplete = useCallback(
    async (task: Task) => {
      const nextComplete = !task.is_complete;
      // Forward-cascade only: completing the parent fills sub-tasks so the
      // "all green" dot strip matches the parent state. Un-completing does
      // not touch sub-tasks (one-way; user-edited sub-task state stays).
      const cascadeSubTasks =
        nextComplete && task.sub_tasks && task.sub_tasks.length > 0
          ? task.sub_tasks.map((st) =>
              st.is_complete ? st : { ...st, is_complete: true },
            )
          : undefined;
      try {
        await tasksApi.update(task.id, {
          is_complete: nextComplete,
          ...(cascadeSubTasks ? { sub_tasks: cascadeSubTasks } : {}),
        });
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
      } catch {
        alert("Failed to update task");
      }
    },
    [queryClient],
  );

  const renderRow = useCallback(
    (task: Task) => {
      const pk = `${task.owner}:${task.project_id}`;
      const color = projectColors[pk] ?? "#9ca3af";
      const signal = dateSignalFor(task, today);
      const sharedIndicator = task.is_shared_with_me ? (
        <SharedFromPill owner={task.owner} />
      ) : undefined;
      const canToggle = !task.is_shared_with_me || task.shared_permission === "edit";
      return (
        <ListTaskRow
          key={taskKey(task)}
          task={task}
          projectName={projectNameFor(task)}
          projectColor={color}
          dateSignal={signal.text}
          dateKind={signal.kind}
          sharedIndicator={sharedIndicator}
          onOpen={() => setSelectedTask(task)}
          onToggleComplete={() => handleToggleComplete(task)}
          canToggleComplete={canToggle}
        />
      );
    },
    [projectColors, projectNameFor, today, handleToggleComplete],
  );

  const totalActive =
    buckets.overdue.length + buckets.doing.length + buckets.upcoming.length;

  const isEmpty =
    buckets.overdue.length === 0 &&
    buckets.doing.length === 0 &&
    buckets.upcoming.length === 0 &&
    buckets.recentlyDone.length === 0 &&
    buckets.earlier.length === 0;

  const sectionItems: Record<ListSection, Task[]> = {
    overdue: buckets.overdue,
    doing: buckets.doing,
    upcoming: upcomingNear,
    recentlyDone: buckets.recentlyDone,
    earlier: buckets.earlier,
  };

  return (
    <div data-current-tab="lists">
      <div className="flex justify-end mb-4">
        <button
          onClick={handleCreateListTask}
          className="px-3 py-1.5 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700"
        >
          + New List Task
        </button>
      </div>

      {isEmpty ? (
        <div className="text-center py-16">
          <p className="text-lg text-gray-400 mb-2">No list tasks yet</p>
          <p className="text-sm text-gray-300 mb-6">
            Create a list task to see it here
          </p>
          <button
            onClick={handleCreateListTask}
            className="px-6 py-3 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700"
          >
            + New List Task
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {SECTION_ORDER.filter((key) => key !== "earlier").map((key) => {
            const items = sectionItems[key];
            if (items.length === 0) return null;
            return (
              <section key={key}>
                <div className="flex items-baseline justify-between mb-3">
                  <h3
                    className={`text-sm font-semibold uppercase tracking-wide ${
                      key === "overdue" ? "text-red-700" : "text-gray-900"
                    }`}
                  >
                    {SECTION_LABEL[key]}
                    <span className="ml-2 text-gray-400 normal-case font-normal">
                      ({items.length})
                    </span>
                  </h3>
                  <span className="text-xs text-gray-400">
                    {SECTION_HELP[key]}
                  </span>
                </div>
                <div className="space-y-2">{items.map(renderRow)}</div>
                {key === "upcoming" && upcomingLater.length > 0 && (
                  <p className="mt-2 text-xs text-gray-400 pl-1">
                    + {upcomingLater.length} scheduled later than{" "}
                    {UPCOMING_HORIZON_DAYS}d out
                  </p>
                )}
              </section>
            );
          })}

          {buckets.earlier.length > 0 && (
            <section className="pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setEarlierOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 group"
              >
                <svg
                  className={`w-3 h-3 transition-transform ${
                    earlierOpen ? "rotate-90" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
                <span>
                  {SECTION_LABEL.earlier}{" "}
                  <span className="text-gray-400">
                    ({buckets.earlier.length})
                  </span>
                </span>
                <span className="ml-2 text-gray-400">{SECTION_HELP.earlier}</span>
              </button>
              {earlierOpen && (
                <div className="mt-3 space-y-2">
                  {buckets.earlier.map(renderRow)}
                </div>
              )}
            </section>
          )}

          {totalActive === 0 && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 inline-block">
              No active list tasks — your queue is clear.
            </div>
          )}
        </div>
      )}

      {selectedTask && (
        <TaskDetailPopup
          task={selectedTask}
          project={projects.find(
            (p) =>
              p.id === selectedTask.project_id &&
              p.owner === selectedTask.owner,
          )}
          onClose={() => setSelectedTask(null)}
          onNavigateToTask={(task) => setSelectedTask(task)}
        />
      )}

      <TaskModal projects={projects} />
    </div>
  );
}
