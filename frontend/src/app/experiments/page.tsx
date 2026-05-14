"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { tasksApi, dependenciesApi, fetchAllProjectsIncludingShared } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAppStore } from "@/lib/store";
import AppShell from "@/components/AppShell";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import TaskModal from "@/components/TaskModal";
import NotesPanel from "@/components/NotesPanel";
import type { Task } from "@/lib/types";

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

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: async () => {
      if (projects.length === 0) return [];
      const results = await Promise.all(
        projects.map((p) => tasksApi.listByProject(p.id))
      );
      return results.flat();
    },
    enabled: projects.length > 0,
  });

  const { data: dependencies = [] } = useQuery({
    queryKey: ["dependencies", currentUser],
    queryFn: () => dependenciesApi.list(),
  });

  const today = new Date().toISOString().split("T")[0];

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

  // Build dependency chains for experiments
  const experimentChains = useMemo(() => {
    // Build lookup maps
    const taskMap = new Map<number, Task>();
    allTasks.forEach(t => taskMap.set(t.id, t));
    
    // Map of child_id -> parent_id (a task has at most one parent in a chain)
    const parentMap = new Map<number, number>();
    // Map of parent_id -> child_ids (a task can have multiple children)
    const childrenMap = new Map<number, number[]>();
    
    for (const dep of dependencies) {
      parentMap.set(dep.child_id, dep.parent_id);
      const existing = childrenMap.get(dep.parent_id) || [];
      existing.push(dep.child_id);
      childrenMap.set(dep.parent_id, existing);
    }
    
    // Find root tasks (tasks with no parent) for the given experiments
    const findRoot = (taskId: number): number => {
      const parentId = parentMap.get(taskId);
      if (parentId === undefined) return taskId;
      return findRoot(parentId);
    };
    
    // Build chain from root to all descendants
    const buildChain = (rootId: number, visited: Set<number> = new Set()): Task[] => {
      if (visited.has(rootId)) return [];
      visited.add(rootId);
      
      const task = taskMap.get(rootId);
      if (!task || task.task_type !== "experiment") return [];
      
      const result: Task[] = [task];
      const children = childrenMap.get(rootId) || [];
      
      for (const childId of children) {
        const childChain = buildChain(childId, visited);
        result.push(...childChain);
      }
      
      return result;
    };
    
    // Group experiments by their root
    const chainMap = new Map<number, Task[]>();
    const processedTasks = new Set<number>();
    
    for (const exp of upcomingExperiments) {
      if (processedTasks.has(exp.id)) continue;
      
      const rootId = findRoot(exp.id);
      const rootTask = taskMap.get(rootId);
      
      if (rootTask && rootTask.task_type === "experiment") {
        if (!chainMap.has(rootId)) {
          const chain = buildChain(rootId);
          chainMap.set(rootId, chain);
          chain.forEach(t => processedTasks.add(t.id));
        }
      } else {
        // Standalone experiment (no dependencies)
        chainMap.set(exp.id, [exp]);
        processedTasks.add(exp.id);
      }
    }
    
    // Convert to array of chains
    const chains: ExperimentChain[] = [];
    for (const [rootId, chainTasks] of chainMap) {
      const rootTask = taskMap.get(rootId);
      if (rootTask) {
        chains.push({ rootTask, chainTasks });
      }
    }
    
    // Sort chains by root task start date
    return chains.sort((a, b) => a.rootTask.start_date.localeCompare(b.rootTask.start_date));
  }, [upcomingExperiments, dependencies, allTasks]);

  // Build completed experiment chains
  const completedExperimentChains = useMemo(() => {
    const taskMap = new Map<number, Task>();
    allTasks.forEach(t => taskMap.set(t.id, t));
    
    const parentMap = new Map<number, number>();
    const childrenMap = new Map<number, number[]>();
    
    for (const dep of dependencies) {
      parentMap.set(dep.child_id, dep.parent_id);
      const existing = childrenMap.get(dep.parent_id) || [];
      existing.push(dep.child_id);
      childrenMap.set(dep.parent_id, existing);
    }
    
    const findRoot = (taskId: number): number => {
      const parentId = parentMap.get(taskId);
      if (parentId === undefined) return taskId;
      return findRoot(parentId);
    };
    
    const buildChain = (rootId: number, visited: Set<number> = new Set()): Task[] => {
      if (visited.has(rootId)) return [];
      visited.add(rootId);
      
      const task = taskMap.get(rootId);
      if (!task || task.task_type !== "experiment") return [];
      
      const result: Task[] = [task];
      const children = childrenMap.get(rootId) || [];
      
      for (const childId of children) {
        const childChain = buildChain(childId, visited);
        result.push(...childChain);
      }
      
      return result;
    };
    
    const chainMap = new Map<number, Task[]>();
    const processedTasks = new Set<number>();
    
    for (const exp of completedExperiments) {
      if (processedTasks.has(exp.id)) continue;
      
      const rootId = findRoot(exp.id);
      const rootTask = taskMap.get(rootId);
      
      if (rootTask && rootTask.task_type === "experiment") {
        if (!chainMap.has(rootId)) {
          const chain = buildChain(rootId);
          chainMap.set(rootId, chain);
          chain.forEach(t => processedTasks.add(t.id));
        }
      } else {
        chainMap.set(exp.id, [exp]);
        processedTasks.add(exp.id);
      }
    }
    
    const chains: ExperimentChain[] = [];
    for (const [rootId, chainTasks] of chainMap) {
      const rootTask = taskMap.get(rootId);
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

  // Project colors for filter buttons
  const projectColors = useMemo(() => {
    const map: Record<number, string> = {};
    projects.forEach((p, i) => {
      map[p.id] = p.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    });
    return map;
  }, [projects]);

  const handleCreateExperiment = useCallback(() => {
    setNewTaskStartDate(null);
    setRestrictedTaskType("experiment");
    setIsCreatingTask(true);
  }, [setIsCreatingTask, setNewTaskStartDate, setRestrictedTaskType]);

  // Group chains by project
  const groupedChains = useMemo(() => {
    const map: Record<number, { projectName: string; chains: ExperimentChain[]; color: string }> = {};
    
    for (const chain of experimentChains) {
      const projectId = chain.rootTask.project_id;
      if (!map[projectId]) {
        const project = projects.find((p) => p.id === projectId);
        if (project) {
          const color = project.color || DEFAULT_COLORS[projects.indexOf(project) % DEFAULT_COLORS.length];
          map[projectId] = { projectName: project.name, chains: [], color };
        }
      }
      if (map[projectId]) {
        map[projectId].chains.push(chain);
      }
    }
    
    return Object.values(map);
  }, [experimentChains, projects]);

  // Group completed chains by project
  const groupedCompletedChains = useMemo(() => {
    const map: Record<number, { projectName: string; chains: ExperimentChain[]; color: string }> = {};
    
    for (const chain of completedExperimentChains) {
      const projectId = chain.rootTask.project_id;
      if (!map[projectId]) {
        const project = projects.find((p) => p.id === projectId);
        if (project) {
          const color = project.color || DEFAULT_COLORS[projects.indexOf(project) % DEFAULT_COLORS.length];
          map[projectId] = { projectName: project.name, chains: [], color };
        }
      }
      if (map[projectId]) {
        map[projectId].chains.push(chain);
      }
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
                  key={p.id}
                  onClick={() => useAppStore.getState().toggleProject(p.id)}
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                    isSelected
                      ? "text-white font-medium"
                      : "bg-gray-100 text-gray-400"
                  }`}
                  style={
                    isSelected
                      ? { backgroundColor: projectColors[p.id] }
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
            {groupedChains.map(({ projectName, chains, color }) => {
              const totalExperiments = chains.reduce((sum, c) => sum + c.chainTasks.length, 0);
              
              return (
                <div key={projectName}>
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
                           key={rootTask.id}
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
                {groupedCompletedChains.map(({ projectName, chains, color }) => {
                  const totalExperiments = chains.reduce((sum, c) => sum + c.chainTasks.length, 0);
                  
                  return (
                    <div key={`completed-${projectName}`}>
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
                              key={rootTask.id}
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
          project={projects.find((p) => p.id === selectedTask.project_id)}
          onClose={() => setSelectedTask(null)}
          onNavigateToTask={(task) => setSelectedTask(task)}
        />
      )}

      {/* Create Task Modal */}
      <TaskModal projects={projects} />
    </AppShell>
  );
}
