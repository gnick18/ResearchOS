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
import TaskDetailPopup from "@/components/TaskDetailPopup";
import TaskModal from "@/components/TaskModal";
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
import {
  assignSection,
  computeBlockingParents,
  findNextInChain,
  type WorkbenchSection,
} from "@/lib/workbench/sectionAssignment";

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

  // All experiment tasks, filtered by the global project selector.
  const experiments = useMemo(() => {
    let xs = allTasks.filter((t) => t.task_type === "experiment");
    if (selectedProjectIds.length > 0) {
      xs = xs.filter((t) => selectedProjectIds.includes(t.project_id));
    }
    return xs;
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

  // Method lookup: own + shared, keyed by `${owner}:${id}` falling back
  // to id-only for legacy refs.
  const methodLookup = useMemo(() => {
    const byOwnerId = new Map<string, Method>();
    for (const m of methods) {
      const owner = m.is_shared_with_me ? m.owner : "self";
      byOwnerId.set(`${owner}:${m.id}`, m);
    }
    const byIdOnly = new Map<number, Method>();
    for (const m of methods) {
      if (!byIdOnly.has(m.id)) byIdOnly.set(m.id, m);
    }
    return (task: Task, mid: number): Method | null => {
      const owner = task.is_shared_with_me ? task.owner : "self";
      return (
        byOwnerId.get(`${owner}:${mid}`) ??
        byIdOnly.get(mid) ??
        null
      );
    };
  }, [methods]);

  const handleCreateExperiment = useCallback(() => {
    setNewTaskStartDate(null);
    setRestrictedTaskType("experiment");
    setIsCreatingTask(true);
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

  const renderCard = (entry: SectionEntry) => {
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

    return (
      <div key={taskKey(t)} className="flex flex-col gap-2">
        <ExperimentResultCard
          task={{
            id: t.id,
            name: t.name,
            username: t.owner,
            experiment_color: t.experiment_color,
            project_name: projectName,
          }}
          heroImagePath={entry.probe.heroImagePath}
          resultsPreview={entry.probe.resultsPreview}
          methods={cardMethods}
          freshnessKind={fresh.kind}
          freshnessLabel={fresh.label}
          onClick={() => setSelectedTask(t)}
          sharedIndicator={sharedIndicator}
        />
        {entry.section === "blocked" && entry.blockingParents.length > 0 && (
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 leading-snug flex items-start gap-1">
            <svg
              aria-hidden
              className="w-3 h-3 mt-0.5 flex-shrink-0"
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
            <span>
              <span className="font-medium">Blocked by:</span>{" "}
              {entry.blockingParents.map((p, i) => (
                <span key={p.id}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenTaskById(p.id);
                    }}
                    className="underline hover:text-amber-900"
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
            className="text-[11px] text-gray-600 hover:text-gray-900 text-left bg-gray-50 border border-gray-200 rounded-md px-2 py-1 leading-snug flex items-start gap-1"
          >
            <span className="font-medium">Next:</span>
            <span className="flex-1">{entry.nextInChain.name}</span>
            <svg
              aria-hidden
              className="w-3 h-3 mt-0.5 flex-shrink-0"
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
    <div data-current-tab="experiments">
      <div className="flex justify-end mb-4">
        <button
          onClick={handleCreateExperiment}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + New Experiment
        </button>
      </div>

      {totalCount === 0 ? (
        <div className="text-center py-16">
          <p className="text-lg text-gray-400 mb-2">No experiments yet</p>
          <p className="text-sm text-gray-300 mb-6">
            Create an experiment task to see it here
          </p>
          <button
            onClick={handleCreateExperiment}
            className="px-6 py-3 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + New Experiment
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {SECTION_ORDER.map((key) => {
            const items = grouped.get(key) ?? [];
            if (items.length === 0 && key !== "awaiting") return null;
            return (
              <section key={key}>
                <div className="flex items-baseline justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                    {SECTION_LABEL[key]}
                    <span className="ml-2 text-gray-400 normal-case font-normal">
                      ({items.length})
                    </span>
                  </h3>
                  <span className="text-xs text-gray-400">
                    {SECTION_HELP[key]}
                  </span>
                </div>
                {items.length === 0 && key === "awaiting" ? (
                  <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 inline-block">
                    All recent experiments have results logged.
                  </div>
                ) : key === "recent" ? (
                  (() => {
                    // Project-grouped layout (Recent results only).
                    // Other stage-organized sections stay priority-ordered.
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
                      <div className="space-y-5">
                        {sortedProjectKeys.map((pk) => {
                          const projectEntries = groups.get(pk)!;
                          const firstTask = projectEntries[0].task;
                          const pName = projectNameFor(firstTask);
                          const pColor =
                            projectColors[pk] ?? DEFAULT_COLORS[0];
                          return (
                            <div key={pk}>
                              {showProjectHeaders && (
                                <div className="flex items-center gap-2 mb-2">
                                  <span
                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: pColor }}
                                    aria-hidden
                                  />
                                  <span className="text-xs font-medium text-gray-600">
                                    {pName}
                                  </span>
                                  <span className="text-xs text-gray-400">
                                    ({projectEntries.length})
                                  </span>
                                </div>
                              )}
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {projectEntries.map(renderCard)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {items.map(renderCard)}
                  </div>
                )}
              </section>
            );
          })}
          {earlierEntries.length > 0 && (
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                  {EARLIER_LABEL}
                  <span className="ml-2 text-gray-400 normal-case font-normal">
                    ({earlierEntries.length})
                  </span>
                </h3>
                <span className="text-xs text-gray-400">{EARLIER_HELP}</span>
              </div>
              <div className="flex items-center gap-1 mb-3 text-xs">
                <button
                  type="button"
                  onClick={() => setEarlierLayout("flat")}
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
                  onClick={() => setEarlierLayout("grouped")}
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {earlierEntries.map(renderCard)}
                </div>
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
                    <div className="space-y-6">
                      {sortedKeys.map((pk) => {
                        const projectEntries = groups.get(pk)!;
                        const firstTask = projectEntries[0].task;
                        const pName = projectNameFor(firstTask);
                        const pColor = projectColors[pk] ?? DEFAULT_COLORS[0];
                        return (
                          <div key={pk}>
                            <h4
                              className="text-sm font-bold uppercase tracking-widest mb-3 px-1"
                              style={{ color: pColor }}
                            >
                              {pName}
                              <span className="ml-2 text-gray-400 font-normal normal-case tracking-normal">
                                ({projectEntries.length})
                              </span>
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                              {projectEntries.map(renderCard)}
                            </div>
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
            <div className="text-xs text-gray-400 pt-2">
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
