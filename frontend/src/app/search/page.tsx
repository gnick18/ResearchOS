"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectsApi, tasksApi, methodsApi } from "@/lib/api";
import AppShell from "@/components/AppShell";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import type { Task, Method, Project } from "@/lib/types";

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

interface SearchFilters {
  keywords: string;
  dateFrom: string;
  dateTo: string;
  taskType: "all" | "experiment" | "purchase" | "list";
  methodId: number | null;
  methodFolder: string;
  projectId: number | null;
  completionStatus: "all" | "complete" | "incomplete";
}

interface SearchResult {
  task: Task;
  project: Project;
  method: Method | null;
  color: string;
}

export default function SearchPage() {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  
  const [filters, setFilters] = useState<SearchFilters>({
    keywords: "",
    dateFrom: "",
    dateTo: "",
    taskType: "all",
    methodId: null,
    methodFolder: "",
    projectId: null,
    completionStatus: "all",
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: projectsApi.list,
  });

  const { data: methods = [] } = useQuery({
    queryKey: ["methods"],
    queryFn: methodsApi.list,
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      if (projects.length === 0) return [];
      const results = await Promise.all(
        projects.map((p) => tasksApi.listByProject(p.id))
      );
      return results.flat();
    },
    enabled: projects.length > 0,
  });

  // Get unique method folders for the dropdown
  const methodFolders = useMemo(() => {
    const folders = new Set<string>();
    methods.forEach((m) => {
      if (m.folder_path) {
        folders.add(m.folder_path);
      }
    });
    return Array.from(folders).sort();
  }, [methods]);

  // Project colors
  const projectColors = useMemo(() => {
    const map: Record<number, string> = {};
    projects.forEach((p, i) => {
      map[p.id] = p.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    });
    return map;
  }, [projects]);

  // Method lookup
  const methodLookup = useMemo(() => {
    const map: Record<number, Method> = {};
    methods.forEach((m) => {
      map[m.id] = m;
    });
    return map;
  }, [methods]);

  // Project lookup
  const projectLookup = useMemo(() => {
    const map: Record<number, Project> = {};
    projects.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }, [projects]);

  // Perform search
  const searchResults = useMemo(() => {
    if (!hasSearched) return [];

    const results: SearchResult[] = [];
    const keywords = filters.keywords.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const methodFilter = filters.methodId ? methodLookup[filters.methodId] : null;

    for (const task of allTasks) {
      // Filter by task type
      if (filters.taskType !== "all" && task.task_type !== filters.taskType) {
        continue;
      }

      // Filter by project
      if (filters.projectId !== null && task.project_id !== filters.projectId) {
        continue;
      }

      // Filter by completion status
      if (filters.completionStatus === "complete" && !task.is_complete) {
        continue;
      }
      if (filters.completionStatus === "incomplete" && task.is_complete) {
        continue;
      }

      // Filter by date range
      if (filters.dateFrom && task.end_date < filters.dateFrom) {
        continue;
      }
      if (filters.dateTo && task.start_date > filters.dateTo) {
        continue;
      }

      // Filter by method
      if (filters.methodId !== null && task.method_id !== filters.methodId) {
        continue;
      }

      // Filter by method folder
      if (filters.methodFolder) {
        const taskMethod = task.method_id ? methodLookup[task.method_id] : null;
        if (!taskMethod || taskMethod.folder_path !== filters.methodFolder) {
          continue;
        }
      }

      // Filter by keywords
      if (keywords.length > 0) {
        const taskName = task.name.toLowerCase();
        const taskTags = (task.tags || []).join(" ").toLowerCase();
        const taskMethod = task.method_id ? methodLookup[task.method_id] : null;
        const methodName = taskMethod?.name.toLowerCase() || "";
        const methodTags = (taskMethod?.tags || []).join(" ").toLowerCase();
        
        const searchableText = `${taskName} ${taskTags} ${methodName} ${methodTags}`;
        
        // All keywords must match (AND logic)
        const allMatch = keywords.every((kw) => searchableText.includes(kw));
        if (!allMatch) {
          continue;
        }
      }

      // Task passed all filters
      const project = projectLookup[task.project_id];
      if (project) {
        results.push({
          task,
          project,
          method: task.method_id ? methodLookup[task.method_id] : null,
          color: projectColors[task.project_id] || DEFAULT_COLORS[0],
        });
      }
    }

    // Sort by start date (most recent first)
    return results.sort((a, b) => b.task.start_date.localeCompare(a.task.start_date));
  }, [hasSearched, filters, allTasks, methodLookup, projectLookup, projectColors]);

  const handleSearch = useCallback(() => {
    setHasSearched(true);
  }, []);

  const handleClear = useCallback(() => {
    setFilters({
      keywords: "",
      dateFrom: "",
      dateTo: "",
      taskType: "all",
      methodId: null,
      methodFolder: "",
      projectId: null,
      completionStatus: "all",
    });
    setHasSearched(false);
  }, []);

  const updateFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Search</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Find tasks, experiments, and purchases across all projects
          </p>
        </div>

        {/* Search Form */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Keywords */}
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Keywords
              </label>
              <input
                type="text"
                value={filters.keywords}
                onChange={(e) => updateFilter("keywords", e.target.value)}
                placeholder="Search by name, tags, method..."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>

            {/* Date From */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Date From
              </label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => updateFilter("dateFrom", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Date To */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Date To
              </label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => updateFilter("dateTo", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Task Type */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Task Type
              </label>
              <select
                value={filters.taskType}
                onChange={(e) => updateFilter("taskType", e.target.value as SearchFilters["taskType"])}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Types</option>
                <option value="experiment">Experiments</option>
                <option value="purchase">Purchases</option>
                <option value="list">List Tasks</option>
              </select>
            </div>

            {/* Project */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Project
              </label>
              <select
                value={filters.projectId ?? ""}
                onChange={(e) => updateFilter("projectId", e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Method */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Specific Method
              </label>
              <select
                value={filters.methodId ?? ""}
                onChange={(e) => updateFilter("methodId", e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Any Method</option>
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Method Folder */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Method Category
              </label>
              <select
                value={filters.methodFolder}
                onChange={(e) => updateFilter("methodFolder", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Any Category</option>
                {methodFolders.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
              </select>
            </div>

            {/* Completion Status */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Completion Status
              </label>
              <select
                value={filters.completionStatus}
                onChange={(e) => updateFilter("completionStatus", e.target.value as SearchFilters["completionStatus"])}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All</option>
                <option value="complete">Complete</option>
                <option value="incomplete">Incomplete</option>
              </select>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 mt-6">
            <button
              onClick={handleSearch}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Search
            </button>
            <button
              onClick={handleClear}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Results */}
        {hasSearched && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">
                {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} found
              </h3>
            </div>

            {searchResults.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-400">No results match your search criteria</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {searchResults.map(({ task, project, method, color }) => (
                  <div
                    key={task.id}
                    onClick={() => setSelectedTask(task)}
                    className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-all cursor-pointer"
                  >
                    {/* Color bar */}
                    <div className="h-1" style={{ backgroundColor: color }} />
                    
                    <div className="p-4">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="text-sm font-medium text-gray-900 line-clamp-2">
                          {task.name}
                        </h4>
                        {task.is_complete && (
                          <span className="ml-2 flex-shrink-0 text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-600 rounded-full">
                            Complete
                          </span>
                        )}
                      </div>

                      {/* Project & Type */}
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-full text-white"
                          style={{ backgroundColor: color }}
                        >
                          {project.name}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                          task.task_type === "experiment"
                            ? "bg-purple-50 text-purple-600"
                            : task.task_type === "purchase"
                            ? "bg-amber-50 text-amber-600"
                            : "bg-gray-100 text-gray-600"
                        }`}>
                          {task.task_type}
                        </span>
                      </div>

                      {/* Date */}
                      <p className="text-xs text-gray-400 mb-2">
                        {task.start_date} → {task.end_date} ({task.duration_days}d)
                      </p>

                      {/* Method */}
                      {method && (
                        <p className="text-xs text-purple-600 mb-2">
                          Method: {method.name}
                        </p>
                      )}

                      {/* Tags */}
                      {task.tags && task.tags.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {task.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded"
                            >
                              #{tag}
                            </span>
                          ))}
                          {task.tags.length > 3 && (
                            <span className="text-[10px] text-gray-400">
                              +{task.tags.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Initial state */}
        {!hasSearched && (
          <div className="text-center py-16 bg-gray-50 rounded-lg">
            <p className="text-lg text-gray-400 mb-2">Enter search criteria above</p>
            <p className="text-sm text-gray-300">
              Use keywords, dates, and filters to find tasks across all projects
            </p>
          </div>
        )}
      </div>

      {/* Task Detail Popup */}
      {selectedTask && (
        <TaskDetailPopup
          task={selectedTask}
          project={projects.find((p) => p.id === selectedTask.project_id)}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </AppShell>
  );
}
