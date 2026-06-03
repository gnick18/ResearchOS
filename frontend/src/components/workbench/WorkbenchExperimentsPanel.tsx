"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  dependenciesApi,
  fetchAllMethodsIncludingShared,
  fetchAllTasksIncludingShared,
} from "@/lib/local-api";
import { useAppStore } from "@/lib/store";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { matchesAnyProjectFilter } from "@/lib/search/filterKey";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import TaskModal from "@/components/TaskModal";
import Tooltip from "@/components/Tooltip";
import SharedFromPill from "@/components/workbench/SharedFromPill";
import ExperimentResultCard, {
  type ExperimentCardMethod,
} from "@/components/experiments/ExperimentResultCard";
import type { FreshnessKind } from "@/components/experiments/FreshnessTag";
import {
  probeTaskResults,
  type TaskResultProbe,
} from "@/lib/experiments/findTaskResultsBase";
import { taskKey, type Method, type Project, type Task } from "@/lib/types";
import { resolveMethodById } from "@/lib/methods/lookup";
import {
  assignSection,
  computeBlockingParents,
  findNextInChain,
  type WorkbenchSection,
} from "@/lib/workbench/sectionAssignment";
import { BEAKERBOT_LAB_USERNAME } from "@/components/onboarding/v4/steps/lab/lib/lab-fake-user";

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

const projectKey = (p: Pick<Project, "id" | "owner">) => `${p.owner}:${p.id}`;

const SECTION_ORDER: WorkbenchSection[] = [
  "ready",
  "blocked",
  "running",
  "awaiting",
  "recent",
];

// The four in-flight pipeline stages rendered as a side-by-side kanban
// row (experiments-kanban density redesign, 2026-06-02). "recent" is NOT
// a board column — it lives in the results zone below the board with its
// project-grouped wide grid.
const BOARD_STAGES: WorkbenchSection[] = [
  "ready",
  "blocked",
  "running",
  "awaiting",
];

const SECTION_LABEL: Record<WorkbenchSection, string> = {
  ready: "Ready to start",
  blocked: "Blocked",
  running: "Running",
  awaiting: "Awaiting writeup",
  recent: "Recent results",
  scheduled: "Scheduled later",
};

const SECTION_HELP: Record<WorkbenchSection, string> = {
  ready: "Started or scheduled to start, dependencies clear",
  blocked: "Waiting on an incomplete parent task",
  running: "Today falls between start and end date",
  awaiting: "Completed, but no results.md or images on disk yet",
  recent: "Completed with results in the last 30 days",
  scheduled: "Future-scheduled experiments",
};

const EARLIER_LABEL = "Earlier results";
const EARLIER_HELP = "Completed more than 30 days ago — full archive";

const RECENT_WINDOW_DAYS = 30;
const FRESHNESS_WINDOW_DAYS = 7;

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + "T00:00:00Z").getTime();
  const b = new Date(bIso + "T00:00:00Z").getTime();
  return Math.round((a - b) / 86_400_000);
}

interface SectionEntry {
  task: Task;
  section: WorkbenchSection;
  probe: TaskResultProbe;
  daysFromEnd: number | null;
  daysFromStart: number | null;
  blockingParents: Task[];
  nextInChain: Task | null;
}

function freshnessFor(entry: SectionEntry): {
  kind: FreshnessKind;
  label?: string;
} {
  const { section, daysFromEnd, daysFromStart, task } = entry;
  if (section === "ready") {
    if (daysFromStart === null) return { kind: "running", label: "Ready" };
    if (daysFromStart === 0) return { kind: "running", label: "Starts today" };
    if (daysFromStart > 0)
      return { kind: "running", label: `Should have started ${daysFromStart}d ago` };
    return { kind: "running", label: `Starts in ${-daysFromStart}d` };
  }
  if (section === "blocked") {
    return { kind: "awaiting", label: "Blocked" };
  }
  if (section === "running") {
    const dayN = Math.max(
      1,
      Math.min(task.duration_days, (daysFromStart ?? 0) + 1),
    );
    return { kind: "running", label: `Day ${dayN} of ${task.duration_days}` };
  }
  if (section === "awaiting") {
    if (daysFromEnd !== null && daysFromEnd > 0)
      return { kind: "awaiting", label: `Completed ${daysFromEnd}d ago • no write-up` };
    return { kind: "awaiting", label: "Completed • no write-up" };
  }
  if (section === "recent") {
    if (daysFromEnd === 0) return { kind: "fresh", label: "Result today" };
    if (daysFromEnd === 1) return { kind: "fresh", label: "Result yesterday" };
    if (daysFromEnd !== null && daysFromEnd <= FRESHNESS_WINDOW_DAYS)
      return { kind: "fresh", label: `Result + ${daysFromEnd}d` };
    return {
      kind: "earlier",
      label: daysFromEnd !== null ? `${daysFromEnd}d ago` : "Earlier",
    };
  }
  return { kind: "earlier" };
}

interface Props {
  projects: Project[];
}

export default function WorkbenchExperimentsPanel({ projects }: Props) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [earlierLayout, setEarlierLayout] = useState<"flat" | "grouped">(
    "flat",
  );
  // Earlier-results archive navigation (grows unbounded over years).
  // By-project groups are collapsible and default-collapsed; expanded groups
  // and flat mode cap their card count behind a "show more" control.
  const EARLIER_GROUP_CAP = 12;
  const EARLIER_FLAT_PAGE = 24;
  const [expandedEarlierGroups, setExpandedEarlierGroups] = useState<
    Set<string>
  >(() => new Set());
  const [expandedEarlierGroupCaps, setExpandedEarlierGroupCaps] = useState<
    Set<string>
  >(() => new Set());
  const [earlierFlatVisible, setEarlierFlatVisible] =
    useState(EARLIER_FLAT_PAGE);
  const toggleEarlierGroup = useCallback((pk: string) => {
    setExpandedEarlierGroups((prev) => {
      const next = new Set(prev);
      if (next.has(pk)) next.delete(pk);
      else next.add(pk);
      return next;
    });
  }, []);
  const setEarlierLayoutReset = useCallback(
    (layout: "flat" | "grouped") => {
      setEarlierLayout(layout);
      setEarlierFlatVisible(EARLIER_FLAT_PAGE);
      setExpandedEarlierGroupCaps(new Set());
    },
    [EARLIER_FLAT_PAGE],
  );
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

  const { data: dependencies = [] } = useQuery({
    queryKey: ["dependencies", currentUser],
    queryFn: () => dependenciesApi.list(),
  });

  const { data: methods = [] } = useQuery({
    queryKey: ["methods", currentUser, "with-shared"],
    queryFn: fetchAllMethodsIncludingShared,
  });

  // Local-tz YYYY-MM-DD (mirrors the off-by-one fix on /experiments).
  const today = new Date().toLocaleDateString("en-CA");

  // All experiment tasks, with the project-pill filter scoped to the
  // current user's OWN experiments. Tasks shared INTO the current user
  // (`is_shared_with_me`) live in a different namespace — they belong to
  // the sharer's project, which the recipient never has in their own
  // `selectedProjectIds` set, so blindly applying the filter would hide
  // every shared card (Onboarding v4 §6.16 cursor-demo regression, HR
  // 2026-05-22). Shared cards always render; owned cards stay subject to
  // the project pill selector.
  const experiments = useMemo(() => {
    const all = allTasks.filter((t) => t.task_type === "experiment");
    return all.filter((t) => {
      if (t.is_shared_with_me) return true;
      return matchesAnyProjectFilter(t, selectedProjectIds);
    });
  }, [allTasks, selectedProjectIds]);

  const blockingMap = useMemo(
    () => computeBlockingParents(allTasks, dependencies),
    [allTasks, dependencies],
  );

  // Probe each experiment for results.md / Images/ presence.
  // Mirrors LabExperimentsPanel: one probe per task, batched in a single effect.
  const [probes, setProbes] = useState<Map<string, TaskResultProbe>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const next = new Map<string, TaskResultProbe>();
    (async () => {
      await Promise.all(
        experiments.map(async (t) => {
          const probe = await probeTaskResults({ id: t.id, owner: t.owner });
          next.set(taskKey(t), probe);
        }),
      );
      if (!cancelled) setProbes(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [experiments]);

  // Assemble per-task entries with section assignment.
  const entries: SectionEntry[] = useMemo(() => {
    return experiments.map((t) => {
      const key = taskKey(t);
      const probe = probes.get(key) ?? {
        hasResult: false,
        heroImagePath: null,
        resultsPreview: null,
      };
      // Shared-into-me tasks don't participate in this user's dep graph,
      // so they get an empty blockers list and never land in "blocked".
      const blockingParents = t.is_shared_with_me
        ? []
        : blockingMap.get(key) ?? [];
      const section = assignSection(t, {
        today,
        hasResult: probe.hasResult,
        blockingParents,
      });
      const daysFromEnd = t.end_date ? daysBetween(today, t.end_date) : null;
      const daysFromStart = t.start_date
        ? daysBetween(today, t.start_date)
        : null;
      const nextInChain =
        section === "running" ? findNextInChain(t, allTasks, dependencies) : null;
      return {
        task: t,
        section,
        probe,
        daysFromEnd,
        daysFromStart,
        blockingParents,
        nextInChain,
      };
    });
  }, [experiments, probes, blockingMap, today, allTasks, dependencies]);

  // Filter out "scheduled" + "recent" beyond the 30-day window from the
  // visible body. They land in a separate scheduled-later/earlier hint
  // below the main sections.
  const visibleEntries = useMemo(() => {
    return entries.filter((e) => {
      if (e.section === "scheduled") return false;
      if (e.section === "recent") {
        // Cap "Recent results" at the 30-day window; older landings go to
        // "Earlier".
        return (
          e.daysFromEnd !== null &&
          e.daysFromEnd >= 0 &&
          e.daysFromEnd <= RECENT_WINDOW_DAYS
        );
      }
      return true;
    });
  }, [entries]);

  // Completed experiments past the 30-day Recent window. The Earlier
  // section absorbs everything the standalone /results page used to host
  // (no time cap — scrollable archive). Newest-completed first, which
  // for `daysFromEnd` (days since completion) means smallest first.
  const earlierEntries = useMemo(() => {
    const list = entries.filter(
      (e) =>
        e.section === "recent" &&
        (e.daysFromEnd === null || e.daysFromEnd > RECENT_WINDOW_DAYS),
    );
    list.sort((a, b) => (a.daysFromEnd ?? Infinity) - (b.daysFromEnd ?? Infinity));
    return list;
  }, [entries]);

  const scheduledCount = useMemo(
    () => entries.filter((e) => e.section === "scheduled").length,
    [entries],
  );

  const grouped = useMemo(() => {
    const m = new Map<WorkbenchSection, SectionEntry[]>();
    for (const key of SECTION_ORDER) m.set(key, []);
    for (const e of visibleEntries) m.get(e.section)?.push(e);

    // Per-section default sort.
    m.get("ready")?.sort((a, b) =>
      a.task.start_date.localeCompare(b.task.start_date),
    );
    m.get("blocked")?.sort((a, b) =>
      a.task.start_date.localeCompare(b.task.start_date),
    );
    m.get("running")?.sort((a, b) =>
      b.task.start_date.localeCompare(a.task.start_date),
    );
    m.get("awaiting")?.sort(
      (a, b) => (b.daysFromEnd ?? 0) - (a.daysFromEnd ?? 0),
    );
    m.get("recent")?.sort(
      (a, b) => (a.daysFromEnd ?? 0) - (b.daysFromEnd ?? 0),
    );
    return m;
  }, [visibleEntries]);

  // Project lookup tables.
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

  // Method lookup: route through each task's `method_attachments` so per-
  // attachment `owner` disambiguates against per-user id collisions (e.g.
  // alex's task attaching public method 2 when alex also owns a private
  // method id 2). Bare `method_ids` entries without a matching attachment
  // (newly-created tasks pre-attachment-backfill) fall through to task-
  // owner-first byId resolution via `resolveMethodById`. Mirrors the
  // pattern landed at MethodTabs.tsx in 3f8b42d2.
  const methodLookup = useCallback(
    (task: Task, mid: number): Method | null =>
      resolveMethodById(mid, task.method_attachments, methods, task.owner) ??
      null,
    [methods],
  );

  const handleCreateExperiment = useCallback(() => {
    setNewTaskStartDate(null);
    setRestrictedTaskType("experiment");
    setIsCreatingTask(true);
    // Onboarding v4 §6.5: the new workbench-create-experiment-open
    // sub-step waits for this DOM event to advance. Cheap no-op when no
    // tour is active (one ignored dispatch).
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tour:workbench-experiment-modal-opened"),
      );
    }
  }, [setIsCreatingTask, setNewTaskStartDate, setRestrictedTaskType]);

  // Open a task by id (own-namespace lookup). Used by the "next in chain"
  // and "blocked-by parent" click-throughs.
  const handleOpenTaskById = useCallback(
    (id: number) => {
      const t = allTasks.find(
        (x) => x.id === id && !x.is_shared_with_me && x.owner === currentUser,
      );
      if (t) setSelectedTask(t);
    },
    [allTasks, currentUser],
  );

  const totalCount = visibleEntries.length;

  // All four board stages empty -> collapse the 4-column board to a single
  // quiet message (the Recent/Earlier results grids below still render, so
  // this is distinct from the whole-panel "No experiments yet" state).
  const boardAllEmpty = useMemo(
    () =>
      BOARD_STAGES.every((key) => (grouped.get(key)?.length ?? 0) === 0),
    [grouped],
  );

  const renderCard = (entry: SectionEntry, compact = false) => {
    const t = entry.task;
    const cardMethods: ExperimentCardMethod[] = (t.method_ids ?? [])
      .map((mid) => methodLookup(t, mid))
      .filter((m): m is Method => m !== null)
      .map((m) => ({ id: m.id, name: m.name, color: null }));
    const fresh = freshnessFor(entry);
    const projectName = projectNameFor(t);
    const sharedIndicator = t.is_shared_with_me ? (
      <SharedFromPill owner={t.owner} />
    ) : undefined;

    // Onboarding v4 §6.16 (HR 2026-05-22): stamp the BeakerBot-shared
    // experiment cards so the lab-permission-practice step's cursor demo
    // can target the EDIT card vs the VIEW card distinctly. Only fires
    // for `BEAKERBOT_LAB_USERNAME` shares so an unrelated teammate's
    // shares with matching `shared_permission` never collide.
    const labTourTarget =
      t.is_shared_with_me && t.owner === BEAKERBOT_LAB_USERNAME
        ? t.shared_permission === "edit"
          ? "workbench-shared-edit-experiment"
          : t.shared_permission === "view"
            ? "workbench-shared-view-experiment"
            : undefined
        : undefined;

    return (
      <div
        key={taskKey(t)}
        className="flex flex-col gap-2"
        data-tour-target={labTourTarget}
      >
        <ExperimentResultCard
          task={{
            id: t.id,
            name: t.name,
            username: t.owner,
            experiment_color: t.experiment_color,
            project_name: projectName,
            // VCP R3 attribution stamps — surface last-editor + when in
            // the experiment card footer. Self-hides on pre-R3 tasks.
            last_edited_by: t.last_edited_by,
            last_edited_at: t.last_edited_at,
          }}
          heroImagePath={entry.probe.heroImagePath}
          resultsPreview={entry.probe.resultsPreview}
          methods={cardMethods}
          freshnessKind={fresh.kind}
          freshnessLabel={fresh.label}
          onClick={() => setSelectedTask(t)}
          sharedIndicator={sharedIndicator}
          compact={compact}
        />
        {entry.section === "blocked" && entry.blockingParents.length > 0 && (
          <div className="text-meta text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-0.5 leading-snug flex items-center gap-1 min-w-0">
            <svg
              aria-hidden
              className="w-3 h-3 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
            <span className="font-medium flex-shrink-0">Blocked:</span>
            <span className="flex-1 min-w-0 truncate">
              {entry.blockingParents.map((p, i) => (
                <span key={p.id}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenTaskById(p.id);
                    }}
                    className="underline cursor-pointer hover:text-amber-900 hover:bg-amber-100 rounded"
                  >
                    {p.name}
                  </button>
                  {i < entry.blockingParents.length - 1 ? ", " : ""}
                </span>
              ))}
            </span>
          </div>
        )}
        {entry.section === "running" && entry.nextInChain && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedTask(entry.nextInChain!);
            }}
            className="text-meta text-gray-600 hover:text-gray-900 text-left bg-gray-50 border border-gray-200 rounded-md px-1.5 py-0.5 leading-snug flex items-center gap-1 min-w-0 cursor-pointer hover:bg-gray-100"
          >
            <span className="font-medium flex-shrink-0">Next:</span>
            <span className="flex-1 min-w-0 truncate">{entry.nextInChain.name}</span>
            <svg
              aria-hidden
              className="w-3 h-3 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        )}
      </div>
    );
  };

  return (
    <div data-current-tab="experiments" data-tour-target="workbench-shared-experiments">
      {totalCount === 0 ? (
        <>
          <div className="flex justify-end mb-4">
            <button
              onClick={handleCreateExperiment}
              data-tour-target="workbench-new-experiment"
              className="px-3 py-1.5 text-body bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + New Experiment
            </button>
          </div>
          <div className="text-center py-16">
            <p className="text-lg text-gray-400 mb-2">No experiments yet</p>
            <p className="text-body text-gray-300 mb-6">
              Create an experiment task to see it here
            </p>
            <button
              onClick={handleCreateExperiment}
              data-tour-target="workbench-new-experiment"
              className="px-6 py-3 text-body bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + New Experiment
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-8">
          {/* Pipeline board: the four in-flight stages as a side-by-side
              kanban row (each column is self-labeled, so the row header
              carries only the + New Experiment button). When all four
              stages are empty the board collapses to one quiet message. */}
          <section>
            <div className="flex items-center justify-end mb-3">
              <button
                onClick={handleCreateExperiment}
                data-tour-target="workbench-new-experiment"
                className="px-3 py-1.5 text-body bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                + New Experiment
              </button>
            </div>
            {boardAllEmpty ? (
              // All four board stages empty -> a single quiet message in
              // place of the 4-column board. Recent/Earlier results below
              // still render normally.
              <p className="text-body text-gray-400 text-center py-8">
                No in-flight experiments
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {BOARD_STAGES.map((key) => {
                  const items = grouped.get(key) ?? [];
                  return (
                    <div key={key} className="flex flex-col">
                      <div className="flex items-center gap-1.5 mb-3">
                        <h3 className="text-meta font-semibold text-gray-900 uppercase tracking-wide">
                          {SECTION_LABEL[key]}
                          <span className="ml-1.5 text-gray-400 normal-case font-normal">
                            ({items.length})
                          </span>
                        </h3>
                        <Tooltip label={SECTION_HELP[key]} placement="top">
                          <span
                            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-gray-300 hover:text-gray-500 cursor-help"
                            aria-label={SECTION_HELP[key]}
                          >
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                          </span>
                        </Tooltip>
                      </div>
                      {items.length === 0 ? (
                        key === "awaiting" ? (
                          <div className="text-meta text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                            All recent experiments have results logged.
                          </div>
                        ) : (
                          <p className="text-meta text-gray-300">Nothing here</p>
                        )
                      ) : (
                        <div className="space-y-3 max-h-[34rem] overflow-y-auto pr-1">
                          {items.map((e) => renderCard(e, true))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Recent results zone: project-grouped, wide grid, full
              (non-compact) cards since results carry media. */}
          {(() => {
            const items = grouped.get("recent") ?? [];
            if (items.length === 0) return null;
            // Project-grouped layout (Recent results only).
            const groups = new Map<string, SectionEntry[]>();
            for (const e of items) {
              const pk = `${e.task.owner}:${e.task.project_id}`;
              if (!groups.has(pk)) groups.set(pk, []);
              groups.get(pk)!.push(e);
            }
            const sortedProjectKeys = Array.from(groups.keys()).sort(
              (a, b) => {
                // Most-recent-result-within-project first
                // (smallest daysFromEnd wins).
                const aMin = Math.min(
                  ...groups.get(a)!.map((e) => e.daysFromEnd ?? Infinity),
                );
                const bMin = Math.min(
                  ...groups.get(b)!.map((e) => e.daysFromEnd ?? Infinity),
                );
                return aMin - bMin;
              },
            );
            const showProjectHeaders = sortedProjectKeys.length >= 2;
            return (
              <section>
                <div className="flex items-baseline justify-between mb-3">
                  <h3 className="text-body font-semibold text-gray-900 uppercase tracking-wide">
                    {SECTION_LABEL.recent}
                    <span className="ml-2 text-gray-400 normal-case font-normal">
                      ({items.length})
                    </span>
                  </h3>
                  <span className="text-meta text-gray-400">
                    {SECTION_HELP.recent}
                  </span>
                </div>
                <div className="space-y-5">
                  {sortedProjectKeys.map((pk) => {
                    const projectEntries = groups.get(pk)!;
                    const firstTask = projectEntries[0].task;
                    const pName = projectNameFor(firstTask);
                    const pColor = projectColors[pk] ?? DEFAULT_COLORS[0];
                    return (
                      <div key={pk}>
                        {showProjectHeaders && (
                          <div className="flex items-center gap-2 mb-2">
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: pColor }}
                              aria-hidden
                            />
                            <span className="text-meta font-medium text-gray-600">
                              {pName}
                            </span>
                            <span className="text-meta text-gray-400">
                              ({projectEntries.length})
                            </span>
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                          {projectEntries.map((e) => renderCard(e))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}
          {earlierEntries.length > 0 && (
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-body font-semibold text-gray-900 uppercase tracking-wide">
                  {EARLIER_LABEL}
                  <span className="ml-2 text-gray-400 normal-case font-normal">
                    ({earlierEntries.length})
                  </span>
                </h3>
                <span className="text-meta text-gray-400">{EARLIER_HELP}</span>
              </div>
              <div className="flex items-center gap-1 mb-3 text-meta">
                <button
                  type="button"
                  onClick={() => setEarlierLayoutReset("flat")}
                  className={`px-2 py-1 rounded-md transition-colors ${
                    earlierLayout === "flat"
                      ? "bg-gray-200 text-gray-900 font-medium"
                      : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  Flat
                </button>
                <button
                  type="button"
                  onClick={() => setEarlierLayoutReset("grouped")}
                  className={`px-2 py-1 rounded-md transition-colors ${
                    earlierLayout === "grouped"
                      ? "bg-gray-200 text-gray-900 font-medium"
                      : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  By project
                </button>
              </div>
              {earlierLayout === "flat" ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {earlierEntries
                      .slice(0, earlierFlatVisible)
                      .map((e) => renderCard(e))}
                  </div>
                  {earlierEntries.length > earlierFlatVisible && (
                    <button
                      type="button"
                      onClick={() =>
                        setEarlierFlatVisible((v) => v + EARLIER_FLAT_PAGE)
                      }
                      className="mt-3 text-meta font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md px-2 py-1 transition-colors"
                    >
                      Show more (
                      {earlierEntries.length - earlierFlatVisible} more)
                    </button>
                  )}
                </>
              ) : (
                (() => {
                  const groups = new Map<string, SectionEntry[]>();
                  for (const e of earlierEntries) {
                    const pk = `${e.task.owner}:${e.task.project_id}`;
                    if (!groups.has(pk)) groups.set(pk, []);
                    groups.get(pk)!.push(e);
                  }
                  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
                    const aMin = Math.min(
                      ...groups.get(a)!.map((e) => e.daysFromEnd ?? Infinity),
                    );
                    const bMin = Math.min(
                      ...groups.get(b)!.map((e) => e.daysFromEnd ?? Infinity),
                    );
                    return aMin - bMin;
                  });
                  return (
                    <div className="space-y-2">
                      {sortedKeys.map((pk) => {
                        const projectEntries = groups.get(pk)!;
                        const firstTask = projectEntries[0].task;
                        const pName = projectNameFor(firstTask);
                        const pColor = projectColors[pk] ?? DEFAULT_COLORS[0];
                        const isExpanded = expandedEarlierGroups.has(pk);
                        const capLifted = expandedEarlierGroupCaps.has(pk);
                        const visibleEntries =
                          capLifted ||
                          projectEntries.length <= EARLIER_GROUP_CAP
                            ? projectEntries
                            : projectEntries.slice(0, EARLIER_GROUP_CAP);
                        const hiddenCount =
                          projectEntries.length - visibleEntries.length;
                        return (
                          <div key={pk}>
                            <button
                              type="button"
                              onClick={() => toggleEarlierGroup(pk)}
                              aria-expanded={isExpanded}
                              className="flex w-full items-center gap-2 px-1 py-1.5 rounded-md text-left hover:bg-gray-50 transition-colors"
                            >
                              <svg
                                viewBox="0 0 12 12"
                                aria-hidden="true"
                                className={`w-3 h-3 flex-shrink-0 text-gray-400 transition-transform ${
                                  isExpanded ? "rotate-90" : ""
                                }`}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M4 2l4 4-4 4" />
                              </svg>
                              <span
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: pColor }}
                                aria-hidden="true"
                              />
                              <span
                                className="text-body font-bold uppercase tracking-widest"
                                style={{ color: pColor }}
                              >
                                {pName}
                              </span>
                              <span className="text-meta text-gray-400 font-normal normal-case tracking-normal">
                                ({projectEntries.length})
                              </span>
                            </button>
                            {isExpanded && (
                              <div className="mt-2 mb-2 pl-5">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                  {visibleEntries.map((e) => renderCard(e))}
                                </div>
                                {hiddenCount > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedEarlierGroupCaps((prev) => {
                                        const next = new Set(prev);
                                        next.add(pk);
                                        return next;
                                      })
                                    }
                                    className="mt-3 text-meta font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md px-2 py-1 transition-colors"
                                  >
                                    Show all {projectEntries.length}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              )}
            </section>
          )}

          {scheduledCount > 0 && (
            <div className="text-meta text-gray-400 pt-2">
              <span>{scheduledCount} scheduled later</span>
            </div>
          )}
        </div>
      )}

      {/* Task Detail Popup */}
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

      {/* Create Task Modal */}
      <TaskModal projects={projects} />
    </div>
  );
}
