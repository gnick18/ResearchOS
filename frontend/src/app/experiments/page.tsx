"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dependenciesApi, fetchAllProjectsIncludingShared, fetchAllTasksIncludingShared } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAppStore } from "@/lib/store";
import AppShell from "@/components/AppShell";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import TaskModal from "@/components/TaskModal";
import NotesPanel from "@/components/NotesPanel";
import { taskKey, type Project, type Task } from "@/lib/types";

// Composite key for project lookups: per-user ID spaces mean alex's project 1
// and morgan's project 1 are different projects. Plain p.id keys collide when
// shared projects sit alongside own projects. Mirrors search/page.tsx.
const projectKey = (p: Pick<Project, "id" | "owner">) => `${p.owner}:${p.id}`;
const taskProjectKey = (t: Pick<Task, "owner" | "project_id">) =>
  `${t.owner}:${t.project_id}`;

// Dependencies are stored per-user (one user's `dependencies/` folder), so
// `parent_id` and `child_id` are always references into the current user's
// task namespace — i.e. "self:<id>" in the `taskKey()` scheme. We compose dep
// map keys with the same "self:" prefix so they line up with the keys we use
// for tasks in the merged view. Shared tasks pulled in from other owners
// never participate in current-user dep chains (their parent/child ids live
// in a different owner's namespace and the dep records aren't even fetched),
// so they always fall through as standalone single-task chains. Mirrors the
// per-user ID collision sweep documented in AGENTS.md §8.
const depKey = (id: number) => `self:${id}`;

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

// Interface for dependency chains
interface ExperimentChain {
  rootTask: Task;
  chainTasks: Task[]; // All tasks in the chain, ordered from root to leaf
}

type TabType = "experiments" | "notes";

export default function ExperimentsPage() {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("experiments");
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const setIsCreatingTask = useAppStore((s) => s.setIsCreatingTask);
  const setNewTaskStartDate = useAppStore((s) => s.setNewTaskStartDate);
  const setRestrictedTaskType = useAppStore((s) => s.setRestrictedTaskType);

  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });

  // Use the canonical merged-view loader. `tasksApi.listByProject(id, owner)`
  // looked correct but skipped two things `fetchAllTasksIncludingShared` does:
  //   1. **Decorates shared tasks with `is_shared_with_me: true`.** Without
  //      it, `taskKey(t)` collapses to `self:<id>` for both own and shared
  //      tasks (its `ns` branch is `task.is_shared_with_me ? task.owner :
  //      "self"`). So a shared `morgan:5` and an own `alex:5` both keyed to
  //      `self:5` and collided in `taskMap`/`processedTasks`. That broke the
  //      prior fix at `a323cb7b`: the chain builders DID use `taskKey()` but
  //      `taskKey()` was an id-only namespace for these load-path tasks, so
  //      the collision the fix was trying to close re-opened one layer down.
  //   2. Surfaces **Option-C hosted tasks** (foreign-owned tasks shared INTO
  //      a project via `<projectId>-hosted.json` manifests). `listByProject`
  //      filtered on bare `project_id` in one owner's namespace, so a hosted
  //      task whose own `project_id` lives in a different owner's namespace
  //      silently disappeared.
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasksIncludingShared,
    enabled: projects.length > 0,
  });

  const { data: dependencies = [] } = useQuery({
    queryKey: ["dependencies", currentUser],
    queryFn: () => dependenciesApi.list(),
  });

  // Local-tz YYYY-MM-DD. The naïve `toISOString().split("T")[0]` returns the
  // UTC date, which drifts off-by-one for evening users in negative-UTC zones
  // (e.g. 9 PM CDT = next day in UTC). Same fix Batch B applied to
  // `isoDatePortion` in `lib/import/eln/apply.ts` (2026-05-14, `2958850c`).
  const today = new Date().toLocaleDateString("en-CA");

  // Filter for upcoming/current experiments (not complete, task_type = experiment)
  const upcomingExperiments = useMemo(() => {
    let experiments = allTasks.filter(
      (t) => t.task_type === "experiment" && !t.is_complete
    );

    // Apply project filter
    if (selectedProjectIds.length > 0) {
      experiments = experiments.filter((t) =>
        selectedProjectIds.includes(t.project_id)
      );
    }

    // Sort by start date
    return experiments.sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [allTasks, selectedProjectIds]);

  // Filter for completed experiments
  const completedExperiments = useMemo(() => {
    let experiments = allTasks.filter(
      (t) => t.task_type === "experiment" && t.is_complete
    );

    // Apply project filter
    if (selectedProjectIds.length > 0) {
      experiments = experiments.filter((t) =>
        selectedProjectIds.includes(t.project_id)
      );
    }

    // Sort by end date (most recent first)
    return experiments.sort((a, b) => {
      const dateA = a.end_date || a.start_date;
      const dateB = b.end_date || b.start_date;
      return dateB.localeCompare(dateA);
    });
  }, [allTasks, selectedProjectIds]);

  // Build dependency chains for experiments.
  //
  // All map keys are composite `taskKey(t)` strings ("self:<id>" for own
  // tasks, "<owner>:<id>" for shared) so that morgan's task 5 and alex's
  // task 5 don't collide into the same bucket — that was the bug that hid
  // 12 of 13 completed experiments after an ELN import landed alongside
  // shared tasks (AGENTS.md §8 "Per-user project-ID collision sweep").
  const experimentChains = useMemo(() => {
    // Build lookup maps. taskMap is keyed by composite key, not bare t.id,
    // so shared and own tasks with matching numeric ids stay distinct.
    const taskMap = new Map<string, Task>();
    allTasks.forEach((t) => taskMap.set(taskKey(t), t));

    // Map of child key -> parent key (a task has at most one parent in a chain).
    // Dependencies live in the current user's store and reference current-user
    // task ids, so all entries get the "self:" namespace via depKey().
    const parentMap = new Map<string, string>();
    // Map of parent key -> child keys (a task can have multiple children).
    const childrenMap = new Map<string, string[]>();

    for (const dep of dependencies) {
      const childK = depKey(dep.child_id);
      const parentK = depKey(dep.parent_id);
      parentMap.set(childK, parentK);
      const existing = childrenMap.get(parentK) || [];
      existing.push(childK);
      childrenMap.set(parentK, existing);
    }

    // Find root tasks (tasks with no parent) for the given experiments.
    const findRoot = (key: string): string => {
      const parentK = parentMap.get(key);
      if (parentK === undefined) return key;
      return findRoot(parentK);
    };

    // Build chain from root to all descendants.
    const buildChain = (rootKey: string, visited: Set<string> = new Set()): Task[] => {
      if (visited.has(rootKey)) return [];
      visited.add(rootKey);

      const task = taskMap.get(rootKey);
      if (!task || task.task_type !== "experiment") return [];

      const result: Task[] = [task];
      const children = childrenMap.get(rootKey) || [];

      for (const childK of children) {
        const childChain = buildChain(childK, visited);
        result.push(...childChain);
      }

      return result;
    };

    // Group experiments by their root.
    const chainMap = new Map<string, Task[]>();
    const processedTasks = new Set<string>();

    for (const exp of upcomingExperiments) {
      const expKey = taskKey(exp);
      if (processedTasks.has(expKey)) continue;

      const rootKey = findRoot(expKey);
      const rootTask = taskMap.get(rootKey);

      if (rootTask && rootTask.task_type === "experiment") {
        if (!chainMap.has(rootKey)) {
          const chain = buildChain(rootKey);
          chainMap.set(rootKey, chain);
          chain.forEach((t) => processedTasks.add(taskKey(t)));
        }
      } else {
        // Standalone experiment (no dependencies).
        chainMap.set(expKey, [exp]);
        processedTasks.add(expKey);
      }
    }

    // Convert to array of chains.
    const chains: ExperimentChain[] = [];
    for (const [rootKey, chainTasks] of chainMap) {
      const rootTask = taskMap.get(rootKey);
      if (rootTask) {
        chains.push({ rootTask, chainTasks });
      }
    }

    // Sort chains by root task start date.
    return chains.sort((a, b) => a.rootTask.start_date.localeCompare(b.rootTask.start_date));
  }, [upcomingExperiments, dependencies, allTasks]);

  // Build completed experiment chains. Same composite-key contract as
  // `experimentChains` above — see that comment for why every map key is a
  // `taskKey()` string rather than a bare numeric id.
  const completedExperimentChains = useMemo(() => {
    const taskMap = new Map<string, Task>();
    allTasks.forEach((t) => taskMap.set(taskKey(t), t));

    const parentMap = new Map<string, string>();
    const childrenMap = new Map<string, string[]>();

    for (const dep of dependencies) {
      const childK = depKey(dep.child_id);
      const parentK = depKey(dep.parent_id);
      parentMap.set(childK, parentK);
      const existing = childrenMap.get(parentK) || [];
      existing.push(childK);
      childrenMap.set(parentK, existing);
    }

    const findRoot = (key: string): string => {
      const parentK = parentMap.get(key);
      if (parentK === undefined) return key;
      return findRoot(parentK);
    };

    const buildChain = (rootKey: string, visited: Set<string> = new Set()): Task[] => {
      if (visited.has(rootKey)) return [];
      visited.add(rootKey);

      const task = taskMap.get(rootKey);
      if (!task || task.task_type !== "experiment") return [];

      const result: Task[] = [task];
      const children = childrenMap.get(rootKey) || [];

      for (const childK of children) {
        const childChain = buildChain(childK, visited);
        result.push(...childChain);
      }

      return result;
    };

    const chainMap = new Map<string, Task[]>();
    const processedTasks = new Set<string>();

    for (const exp of completedExperiments) {
      const expKey = taskKey(exp);
      if (processedTasks.has(expKey)) continue;

      const rootKey = findRoot(expKey);
      const rootTask = taskMap.get(rootKey);

      if (rootTask && rootTask.task_type === "experiment") {
        if (!chainMap.has(rootKey)) {
          const chain = buildChain(rootKey);
          chainMap.set(rootKey, chain);
          chain.forEach((t) => processedTasks.add(taskKey(t)));
        }
      } else {
        chainMap.set(expKey, [exp]);
        processedTasks.add(expKey);
      }
    }

    const chains: ExperimentChain[] = [];
    for (const [rootKey, chainTasks] of chainMap) {
      const rootTask = taskMap.get(rootKey);
      if (rootTask) {
        chains.push({ rootTask, chainTasks });
      }
    }

    return chains.sort((a, b) => {
      const dateA = a.rootTask.end_date || a.rootTask.start_date;
      const dateB = b.rootTask.end_date || b.rootTask.start_date;
      return dateB.localeCompare(dateA);
    });
  }, [completedExperiments, dependencies, allTasks]);

  // Project colors for filter buttons — keyed by composite `${owner}:${id}` so
  // shared projects don't overwrite own-project colors at the same numeric id.
  const projectColors = useMemo(() => {
    const map: Record<string, string> = {};
    projects.forEach((p, i) => {
      map[projectKey(p)] = p.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    });
    return map;
  }, [projects]);

  const handleCreateExperiment = useCallback(() => {
    setNewTaskStartDate(null);
    setRestrictedTaskType("experiment");
    setIsCreatingTask(true);
  }, [setIsCreatingTask, setNewTaskStartDate, setRestrictedTaskType]);

  // Group chains by project. Keyed by composite `${owner}:${id}` so two
  // numerically-equal project ids from different owners don't merge into one
  // bucket (a shared project would silently absorb the own-project chains).
  // The composite `key` is also carried out as `projectKey` on each bucket so
  // React keys downstream don't fall back to `projectName` (two different
  // projects can legitimately share a display name across owners).
  //
  // Orphan-project fallback: a task whose `project_id` references a project
  // that's missing from `projects` (deleted, partial ELN import, etc.) used
  // to drop silently — the bucket only got created when `projects.find(...)`
  // matched. Header would still count the task ("13 completed") but the body
  // would be short. Now: surface those under an "Unknown project" bucket so
  // the count and the rendered cards always reconcile.
  const groupedChains = useMemo(() => {
    const map: Record<string, { projectKey: string; projectName: string; chains: ExperimentChain[]; color: string }> = {};

    for (const chain of experimentChains) {
      const key = taskProjectKey(chain.rootTask);
      if (!map[key]) {
        const project = projects.find(
          (p) => p.id === chain.rootTask.project_id && p.owner === chain.rootTask.owner,
        );
        if (project) {
          const color = project.color || DEFAULT_COLORS[projects.indexOf(project) % DEFAULT_COLORS.length];
          map[key] = { projectKey: key, projectName: project.name, chains: [], color };
        } else {
          map[key] = {
            projectKey: key,
            projectName: `Unknown project (#${chain.rootTask.project_id})`,
            chains: [],
            color: "#9ca3af",
          };
        }
      }
      map[key].chains.push(chain);
    }

    return Object.values(map);
  }, [experimentChains, projects]);

  // Group completed chains by project (same composite-keying as above).
  const groupedCompletedChains = useMemo(() => {
    const map: Record<string, { projectKey: string; projectName: string; chains: ExperimentChain[]; color: string }> = {};

    for (const chain of completedExperimentChains) {
      const key = taskProjectKey(chain.rootTask);
      if (!map[key]) {
        const project = projects.find(
          (p) => p.id === chain.rootTask.project_id && p.owner === chain.rootTask.owner,
        );
        if (project) {
          const color = project.color || DEFAULT_COLORS[projects.indexOf(project) % DEFAULT_COLORS.length];
          map[key] = { projectKey: key, projectName: project.name, chains: [], color };
        } else {
          map[key] = {
            projectKey: key,
            projectName: `Unknown project (#${chain.rootTask.project_id})`,
            chains: [],
            color: "#9ca3af",
          };
        }
      }
      map[key].chains.push(chain);
    }

    return Object.values(map);
  }, [completedExperimentChains, projects]);

  // Handle clicking on a chain card
  const handleChainClick = useCallback((chain: ExperimentChain) => {
    setSelectedTask(chain.rootTask);
  }, []);

  return (
    <AppShell>
      <div className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Lab Notes</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              {activeTab === "experiments"
                ? `${upcomingExperiments.length} upcoming experiment${upcomingExperiments.length !== 1 ? "s" : ""}`
                : "Meeting notes and running logs"}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-gray-200 pb-3">
          <button
            onClick={() => setActiveTab("experiments")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === "experiments"
                ? "bg-blue-100 text-blue-700"
                : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
            Experiments
          </button>
          <button
            onClick={() => setActiveTab("notes")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === "notes"
                ? "bg-emerald-100 text-emerald-700"
                : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Notes
          </button>
        </div>

        {/* Notes Tab Content */}
        {activeTab === "notes" && (
          <NotesPanel />
        )}

        {/* Experiments Tab Content */}
        {activeTab === "experiments" && (
          <>
            {/* Project filter */}
            <div className="flex items-center gap-2 mb-6">
            {projects.map((p) => {
              const isSelected =
                selectedProjectIds.length === 0 ||
                selectedProjectIds.includes(p.id);
              return (
                <button
                  key={`${p.owner}:${p.id}`}
                  onClick={() => useAppStore.getState().toggleProject(p.id)}
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                    isSelected
                      ? "text-white font-medium"
                      : "bg-gray-100 text-gray-400"
                  }`}
                  style={
                    isSelected
                      ? { backgroundColor: projectColors[projectKey(p)] }
                      : undefined
                  }
                >
                  {p.name}
                </button>
              );
            })}
            <button
              onClick={handleCreateExperiment}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 ml-2"
            >
              + New Experiment
            </button>
          </div>

          {/* Experiments grouped by project */}
          {groupedChains.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-lg text-gray-400 mb-2">No upcoming experiments</p>
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
            {groupedChains.map(({ projectKey: bucketKey, projectName, chains, color }) => {
              const totalExperiments = chains.reduce((sum, c) => sum + c.chainTasks.length, 0);

              return (
                <div key={bucketKey}>
                  {/* Project header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <h3
                        className="text-sm font-bold uppercase tracking-widest"
                        style={{ color }}
                      >
                        {projectName}
                      </h3>
                      <span className="text-xs text-gray-400">
                        {totalExperiments} experiment{totalExperiments !== 1 ? "s" : ""}
                        {chains.length !== totalExperiments && ` in ${chains.length} chain${chains.length !== 1 ? "s" : ""}`}
                      </span>
                    </div>
                    <button
                      onClick={handleCreateExperiment}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      + Add
                    </button>
                  </div>

                  {/* Chain cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {chains.map((chain) => {
                      const rootTask = chain.rootTask;
                      const chainLength = chain.chainTasks.length;
                      const isChain = chainLength > 1;

                      // Determine status of the root task
                      let status: "overdue" | "inProgress" | "upcoming" = "upcoming";
                      if (rootTask.end_date < today) {
                        status = "overdue";
                      } else if (rootTask.start_date <= today && rootTask.end_date >= today) {
                        status = "inProgress";
                      }

                      return (
                        <div
                           key={taskKey(rootTask)}
                           className={`relative transition-all ${
                             isChain ? "stacked-card" : ""
                           }`}
                         >
                           {/* Stacked cards effect for chains */}
                           {isChain && (
                             <>
                               <div className="absolute top-2 left-2 right-2 h-full bg-gray-100 border border-gray-200 rounded-lg -z-10" />
                               <div className="absolute top-1 left-1 right-1 h-full bg-gray-50 border border-gray-200 rounded-lg -z-10" />
                             </>
                           )}

                           <div
                             className={`rounded-lg p-4 hover:shadow-md transition-all relative ${
                               status === "overdue"
                                 ? "bg-white border-2 border-red-200"
                                 : status === "inProgress"
                                 ? "bg-white border-2 border-emerald-200"
                                 : "bg-white border border-gray-200"
                             }`}
                           >
                             {/* Clickable area for opening experiment */}
                             <div
                               onClick={() => handleChainClick(chain)}
                               className="cursor-pointer"
                             >
                            {/* Green progress bar for in-progress experiments */}
                            {status === "inProgress" && (
                              <div className="mb-3">
                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-emerald-400 to-green-500 transition-all duration-300"
                                    style={{
                                      width: `${Math.min(100, Math.max(0, ((new Date(today).getTime() - new Date(rootTask.start_date).getTime()) / (1000 * 60 * 60 * 24) / rootTask.duration_days) * 100))}%`
                                    }}
                                  />
                                </div>
                              </div>
                            )}

                            <div className="flex items-start justify-between mb-2">
                              <h4 className="text-sm font-medium text-gray-900 line-clamp-2">
                                {rootTask.name}
                              </h4>
                              <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                                {isChain && (
                                  <span className="text-[10px] px-2 py-0.5 bg-blue-100 text-blue-600 rounded-full">
                                    {chainLength} tasks
                                  </span>
                                )}
                                {status === "overdue" && (
                                  <span className="text-[10px] px-2 py-0.5 bg-red-100 text-red-600 rounded-full">
                                    Overdue
                                  </span>
                                )}
                                {status === "inProgress" && (
                                  <span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-600 rounded-full">
                                    In Progress
                                  </span>
                                )}
                              </div>
                            </div>

                            {status === "overdue" && (
                              <p className="text-xs text-red-500 mb-2">
                                Ended {rootTask.end_date}
                              </p>
                            )}
                            {status === "inProgress" && (
                              <p className="text-xs text-emerald-600 mb-2">
                                Day {Math.max(1, Math.ceil((new Date(today).getTime() - new Date(rootTask.start_date).getTime()) / (1000 * 60 * 60 * 24)) + 1)} of {rootTask.duration_days}
                              </p>
                            )}
                            {status === "upcoming" && (
                              <p className="text-xs text-gray-500 mb-2">
                                Starts {rootTask.start_date}
                              </p>
                            )}

                            <div className="flex items-center gap-2 text-xs text-gray-400">
                              <span>{rootTask.start_date}</span>
                              <span>·</span>
                              <span>{rootTask.duration_days}d</span>
                            </div>

                            {rootTask.method_ids?.length > 0 && (
                              <span className="text-[10px] px-2 py-0.5 bg-purple-50 text-purple-600 rounded-full mt-2 inline-block">
                                Has Method
                              </span>
                            )}

                            {isChain && (
                              <div className="mt-2 pt-2 border-t border-gray-100">
                                <p className="text-[10px] text-gray-400">
                                  Click to view chain →
                                </p>
                              </div>
                            )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Completed Experiments Dropdown */}
        {completedExperiments.length > 0 && (
          <div className="mt-8">
            <button
              onClick={() => setShowCompleted(!showCompleted)}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <svg
                className={`w-4 h-4 transition-transform ${showCompleted ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="font-medium">
                {showCompleted ? "Hide" : "Show"} {completedExperiments.length} completed experiment{completedExperiments.length !== 1 ? "s" : ""}
              </span>
            </button>

            {showCompleted && (
              <div className="mt-4 space-y-8">
                {groupedCompletedChains.map(({ projectKey: bucketKey, projectName, chains, color }) => {
                  const totalExperiments = chains.reduce((sum, c) => sum + c.chainTasks.length, 0);

                  return (
                    <div key={`completed-${bucketKey}`}>
                      {/* Project header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <h3
                            className="text-sm font-bold uppercase tracking-widest"
                            style={{ color }}
                          >
                            {projectName}
                          </h3>
                          <span className="text-xs text-gray-400">
                            {totalExperiments} completed
                            {chains.length !== totalExperiments && ` in ${chains.length} chain${chains.length !== 1 ? "s" : ""}`}
                          </span>
                        </div>
                      </div>

                      {/* Completed chain cards */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {chains.map((chain) => {
                          const rootTask = chain.rootTask;
                          const chainLength = chain.chainTasks.length;
                          const isChain = chainLength > 1;

                          return (
                            <div
                              key={taskKey(rootTask)}
                              onClick={() => handleChainClick(chain)}
                              className={`relative cursor-pointer transition-all ${
                                isChain ? "stacked-card" : ""
                              }`}
                            >
                              {/* Stacked cards effect for chains */}
                              {isChain && (
                                <>
                                  <div className="absolute top-2 left-2 right-2 h-full bg-gray-200 border border-gray-300 rounded-lg -z-10" />
                                  <div className="absolute top-1 left-1 right-1 h-full bg-gray-100 border border-gray-200 rounded-lg -z-10" />
                                </>
                              )}

                              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 hover:shadow-md transition-all opacity-75 hover:opacity-100">
                                <div className="flex items-start justify-between mb-2">
                                  <h4 className="text-sm font-medium text-gray-700 line-clamp-2">
                                    {rootTask.name}
                                  </h4>
                                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                                    {isChain && (
                                      <span className="text-[10px] px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full">
                                        {chainLength} tasks
                                      </span>
                                    )}
                                    <span className="text-[10px] px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full">
                                      Completed
                                    </span>
                                  </div>
                                </div>
                                <p className="text-xs text-gray-500 mb-2">
                                  Finished {rootTask.end_date}
                                </p>
                                <div className="flex items-center gap-2 text-xs text-gray-400">
                                  <span>{rootTask.start_date}</span>
                                  <span>·</span>
                                  <span>{rootTask.duration_days}d</span>
                                </div>
                                {rootTask.method_ids?.length > 0 && (
                                  <span className="text-[10px] px-2 py-0.5 bg-purple-50 text-purple-600 rounded-full mt-2 inline-block">
                                    Has Method
                                  </span>
                                )}
                                {isChain && (
                                  <div className="mt-2 pt-2 border-t border-gray-200">
                                    <p className="text-[10px] text-gray-400">
                                      Click to view chain →
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
          </>
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
          onNavigateToTask={(task) => setSelectedTask(task)}
        />
      )}

      {/* Create Task Modal */}
      <TaskModal projects={projects} />
    </AppShell>
  );
}
