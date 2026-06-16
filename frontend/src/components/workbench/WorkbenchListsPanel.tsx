"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { type DateSignalKind } from "@/components/workbench/ListTaskRow";
import ExpandableListCard from "@/components/workbench/ExpandableListCard";
import SharedFromPill from "@/components/workbench/SharedFromPill";
import type {
  WorkbenchInitialOpen,
  WorkbenchRecentRef,
} from "@/app/workbench/workbench-beaker-source";
import { usePiRecordMenu } from "@/hooks/usePiRecordMenu";

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
  /** BeakerSearch cross-tab jump (spec 4.2). A pending {kind:"list", key} intent
   *  opens the matching list task in full view once on mount, then clears via
   *  onInitialOpenConsumed. The full view is used (not the inline accordion) so a
   *  cross-tab jump lands somewhere visible regardless of bucket scroll. */
  initialOpen?: WorkbenchInitialOpen;
  onInitialOpenConsumed?: () => void;
  /** BeakerSearch v2 chunk 3, the live-selection lift. Reports the open list
   *  card (the inline-expanded card or the full-view popup) up to the page so the
   *  BeakerSearch context card + Suggested describe the card the user actually
   *  clicked. Fires with the open list, null when nothing is open. */
  onSelectionChange?: (sel: WorkbenchRecentRef | null) => void;
}

export default function WorkbenchListsPanel({
  projects,
  initialOpen = null,
  onInitialOpenConsumed,
  onSelectionChange,
}: Props) {
  const queryClient = useQueryClient();
  // The popup mount path stays alive ONLY as the "Open full view" escape
  // hatch from inside the inline-expanded panel. Card clicks themselves
  // toggle the inline accordion instead of opening the popup (single-
  // expanded contract: opening one collapses the previous). The Gantt
  // page keeps its own popup wiring and is unaffected.
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [expandedTaskKey, setExpandedTaskKey] = useState<string | null>(null);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const setIsCreatingTask = useAppStore((s) => s.setIsCreatingTask);
  const setNewTaskStartDate = useAppStore((s) => s.setNewTaskStartDate);
  const setRestrictedTaskType = useAppStore((s) => s.setRestrictedTaskType);

  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  // PI capability revamp Phase 2: right-click PI actions on member-owned task
  // rows. The hook itself gates (returns no menu) for a non-PI viewer or a PI
  // looking at their own task, so wiring it unconditionally is safe.
  const piMenu = usePiRecordMenu();

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
      // A falsy project_id (0/null) means standalone, not a dangling reference.
      // Render it as "Standalone" rather than "Unknown project (#0)".
      if (!task.project_id) return "Standalone";
      const hit = projects.find(
        (p) => p.id === task.project_id && p.owner === task.owner,
      );
      return hit?.name ?? `Unknown project (#${task.project_id})`;
    },
    [projects],
  );

  // BeakerSearch cross-tab jump (spec 4.2). Resolve the pending taskKey to the
  // full Task (owner-correct) and open its full view once, then clear the intent.
  useEffect(() => {
    if (!initialOpen || initialOpen.kind !== "list") return;
    if (allTasks.length === 0) return;
    const t = allTasks.find((x) => taskKey(x) === initialOpen.key);
    if (t) setSelectedTask(t);
    onInitialOpenConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpen, allTasks]);

  // BeakerSearch v2 chunk 3, the live-selection lift. Report the open list card
  // up to the page so the BeakerSearch source names the card the user actually
  // clicked. The full-view popup (selectedTask) outranks the inline-expanded card
  // (expandedTaskKey); null when neither is open. One thin effect covers the open
  // paths (inline expand, full view, the cross-tab jump) and the close-to-null.
  useEffect(() => {
    const key =
      selectedTask != null ? taskKey(selectedTask) : expandedTaskKey;
    onSelectionChange?.(key ? { kind: "list", key } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTask, expandedTaskKey]);

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
    (task: Task, isFirstCardOverall: boolean) => {
      const pk = `${task.owner}:${task.project_id}`;
      const color = projectColors[pk] ?? "#9ca3af";
      const signal = dateSignalFor(task, today);
      const sharedIndicator = task.is_shared_with_me ? (
        <SharedFromPill owner={task.owner} />
      ) : undefined;
      const canToggle = !task.is_shared_with_me || task.shared_permission === "edit";
      const tk = taskKey(task);
      const isExpanded = expandedTaskKey === tk;
      const row = (
        <ExpandableListCard
          key={tk}
          task={task}
          projectName={projectNameFor(task)}
          projectColor={color}
          dateSignal={signal.text}
          dateKind={signal.kind}
          sharedIndicator={sharedIndicator}
          isExpanded={isExpanded}
          onToggleExpand={() =>
            setExpandedTaskKey((prev) => (prev === tk ? null : tk))
          }
          onToggleComplete={() => handleToggleComplete(task)}
          canToggleComplete={canToggle}
          onOpenFullView={() => setSelectedTask(task)}
          onHeaderContextMenu={(e) =>
            piMenu.handleContextMenu(e, {
              recordType: "task",
              record: {
                owner: task.owner,
                id: task.id,
                flagged: !!task.flagged,
              },
              onEditAsPi: () => setSelectedTask(task),
            })
          }
        />
      );
      // BeakerSearch hover-as-context (step 4): tag every list card wrapper with
      // its composite taskKey so the palette can resolve the list the cursor was
      // pointing at when nothing is selected (SELECTED still outranks HOVERED).
      // Workbench expansion manager 2026-05-22 (§6.7b): the first list card
      // rendered across every section also carries
      // `data-tour-target="workbench-list-card-first"`, so the
      // workbench-list-add-items cursor demo can deterministically resolve the
      // just-created list. Render-scoped — the flag is recomputed on every render,
      // so a back-step into the same step gets a fresh latch. The wrapper sits
      // above the ExpandableListCard (which replaced ListTaskRow in the parallel
      // inline-expand UX chip d3991231), so both targets resolve the entire card
      // including its expanded panel.
      return (
        <div
          key={`card-wrapper-${tk}`}
          data-beaker-target={`list:${tk}`}
          data-tour-target={
            isFirstCardOverall ? "workbench-list-card-first" : undefined
          }
        >
          {row}
        </div>
      );
    },
    [projectColors, projectNameFor, today, handleToggleComplete, expandedTaskKey, piMenu],
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

  // Workbench expansion manager 2026-05-22 (§6.7b): track whether the
  // first card across all rendered sections has been stamped with the
  // `workbench-list-card-first` latch. Reset on every render so a
  // back-step into the same step gets a fresh latch on whatever the
  // current first card is. Mirrors the LabExperimentsPanel pattern.
  let firstCardWrapped = false;
  const renderFirstAwareRow = (task: Task) => {
    const isFirst = !firstCardWrapped;
    if (isFirst) firstCardWrapped = true;
    return renderRow(task, isFirst);
  };

  return (
    <div data-current-tab="lists">
      {/* Top-right action only when there is content; the empty state below
          carries the single big primary action (Grant 2026-06-09). */}
      {!isEmpty && (
        <div className="flex justify-end mb-4">
          <button
            onClick={handleCreateListTask}
            data-tour-target="workbench-new-list-button"
            className="ros-btn-raise px-3 py-1.5 text-body bg-violet-600 text-white rounded-lg hover:bg-violet-700"
          >
            + New List Task
          </button>
        </div>
      )}

      {isEmpty ? (
        <div className="text-center py-16">
          <p className="text-title text-foreground mb-2">No list tasks yet</p>
          <p className="text-body text-foreground-muted mb-6">
            Create a list task to see it here
          </p>
          <button
            onClick={handleCreateListTask}
            data-tour-target="workbench-new-list-button"
            className="ros-btn-raise px-6 py-3 text-body bg-violet-600 text-white rounded-lg hover:bg-violet-700"
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
                    className={`text-body font-semibold uppercase tracking-wide ${
                      key === "overdue" ? "text-red-700 dark:text-red-300" : "text-gray-900"
                    }`}
                  >
                    {SECTION_LABEL[key]}
                    <span className="ml-2 text-foreground-muted normal-case font-normal">
                      ({items.length})
                    </span>
                  </h3>
                  <span className="text-meta text-foreground-muted">
                    {SECTION_HELP[key]}
                  </span>
                </div>
                <div className="space-y-2">{items.map(renderFirstAwareRow)}</div>
                {key === "upcoming" && upcomingLater.length > 0 && (
                  <p className="mt-2 text-meta text-foreground-muted pl-1">
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
                className="flex items-center gap-1.5 text-meta text-gray-600 hover:text-gray-900 group"
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
                  {buckets.earlier.map(renderFirstAwareRow)}
                </div>
              )}
            </section>
          )}

          {totalActive === 0 && (
            <div className="text-meta text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 rounded-md px-3 py-2 inline-block">
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

      {/* PI capability revamp Phase 2: the Assign-to-member modal home for the
          right-click PI menu on task rows. Inert until a PI opens it. */}
      {piMenu.modals}
    </div>
  );
}
