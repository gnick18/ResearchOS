"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { labApi, LabUser, LabSearchResult, LabProject, LabMethod, LabTask } from "@/lib/api";

interface LabSearchPanelProps {
  users: LabUser[];
  selectedUsernames: Set<string>;
  tasks: LabTask[];
  onClose?: () => void;
  onTaskClick?: (task: LabTask) => void;
}

interface SearchFilters {
  keywords: string;
  dateFrom: string;
  dateTo: string;
  taskType: "all" | "experiment" | "purchase" | "list";
  methodId: number | null;
  methodFolder: string;
  projectId: number | null;
  completionStatus: "all" | "complete" | "incomplete";
  username: string; // Specific user filter
}

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

export default function LabSearchPanel({
  users,
  selectedUsernames,
  tasks,
  onClose,
  onTaskClick,
}: LabSearchPanelProps) {
  const [results, setResults] = useState<LabSearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [projects, setProjects] = useState<LabProject[]>([]);
  const [methods, setMethods] = useState<LabMethod[]>([]);
  const [methodFolders, setMethodFolders] = useState<string[]>([]);
  
  const [filters, setFilters] = useState<SearchFilters>({
    keywords: "",
    dateFrom: "",
    dateTo: "",
    taskType: "all",
    methodId: null,
    methodFolder: "",
    projectId: null,
    completionStatus: "all",
    username: "", // Empty means all selected users
  });

  // Load projects, methods, and method folders on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [projectsRes, methodsRes, foldersRes] = await Promise.all([
          labApi.getProjects(),
          labApi.getMethods(),
          labApi.getMethodFolders(),
        ]);
        setProjects(projectsRes);
        setMethods(methodsRes);
        setMethodFolders(foldersRes);
      } catch (err) {
        console.error("Failed to load search data:", err);
      }
    };
    loadData();
  }, []);

  // Get user color by username
  const getUserColor = (username: string) => {
    const user = users.find(u => u.username === username);
    return user?.color || "#6b7280";
  };

  // Project colors
  const projectColors = useMemo(() => {
    const map: Record<string, string> = {};
    projects.forEach((p, i) => {
      map[`${p.username}-${p.id}`] = p.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    });
    return map;
  }, [projects]);

  // Method lookup
  const methodLookup = useMemo(() => {
    const map: Record<number, LabMethod> = {};
    methods.forEach((m) => {
      map[m.id] = m;
    });
    return map;
  }, [methods]);

  // Project lookup
  const projectLookup = useMemo(() => {
    const map: Record<string, LabProject> = {};
    projects.forEach((p) => {
      map[`${p.username}-${p.id}`] = p;
    });
    return map;
  }, [projects]);

  // Perform search
  const performSearch = async () => {
    setLoading(true);
    setHasSearched(true);
    
    try {
      // Build usernames parameter
      let usernamesParam: string | undefined;
      if (filters.username) {
        // Specific user selected
        usernamesParam = filters.username;
      } else {
        // Use the globally selected users
        usernamesParam = Array.from(selectedUsernames).join(",") || undefined;
      }

      // Build task types parameter
      let taskTypesParam: string | undefined;
      if (filters.taskType !== "all") {
        taskTypesParam = filters.taskType;
      }

      const response = await labApi.search({
        q: filters.keywords || undefined,
        usernames: usernamesParam,
        task_types: taskTypesParam,
        date_from: filters.dateFrom || undefined,
        date_to: filters.dateTo || undefined,
        project_id: filters.projectId || undefined,
        method_id: filters.methodId || undefined,
        method_folder: filters.methodFolder || undefined,
        completion_status: filters.completionStatus !== "all" ? filters.completionStatus : undefined,
      });

      setResults(response.results);
      setTotalCount(response.total_count);
    } catch (err) {
      console.error("Search failed:", err);
      setResults([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = useCallback(() => {
    performSearch();
  }, [filters, selectedUsernames]);

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
      username: "",
    });
    setResults([]);
    setTotalCount(0);
    setHasSearched(false);
  }, []);

  const updateFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  // Highlight search match in text
  const highlightMatch = (text: string, query: string) => {
    if (!query) return text;
    
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerText.indexOf(lowerQuery);
    
    if (idx === -1) return text;
    
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-200 text-yellow-900 px-0.5 rounded">
          {text.slice(idx, idx + query.length)}
        </mark>
        {text.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div className="space-y-6">
      {/* Search Form */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
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
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="all">All Types</option>
              <option value="experiment">Experiments</option>
              <option value="purchase">Purchases</option>
              <option value="list">List Tasks</option>
            </select>
          </div>

          {/* User Filter */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              User
            </label>
            <select
              value={filters.username}
              onChange={(e) => updateFilter("username", e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">All Selected Users</option>
              {users.map((u) => (
                <option key={u.username} value={u.username}>
                  {u.username}
                </option>
              ))}
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
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={`${p.username}-${p.id}`} value={p.id}>
                  {p.name} ({p.username})
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
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Any Method</option>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} {m.is_public ? "(public)" : `(${m.username})`}
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
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
            disabled={loading}
            className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            )}
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
              {totalCount} result{totalCount !== 1 ? "s" : ""} found
            </h3>
          </div>

          {results.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-gray-400">No results match your search criteria</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {results.map((result, index) => {
                // Handle click on task result
                const handleClick = () => {
                  if (result.type === "task" && onTaskClick) {
                    // Find the matching task from the tasks array
                    const task = tasks.find(t => t.id === result.id && t.username === result.username);
                    if (task) {
                      onTaskClick(task);
                    }
                  }
                };
                
                return (
                  <div
                    key={`${result.type}-${result.id}-${index}`}
                    className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-all cursor-pointer"
                    onClick={handleClick}
                  >
                  {/* Color bar */}
                  <div className="h-1" style={{ backgroundColor: result.user_color }} />
                  
                  <div className="p-4">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="text-sm font-medium text-gray-900 line-clamp-2">
                        {filters.keywords ? highlightMatch(result.name, filters.keywords) : result.name}
                      </h4>
                    </div>

                    {/* User & Type */}
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full text-white"
                        style={{ backgroundColor: result.user_color }}
                      >
                        {result.username}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        result.type === "task"
                          ? "bg-blue-50 text-blue-600"
                          : result.type === "project"
                          ? "bg-purple-50 text-purple-600"
                          : "bg-green-50 text-green-600"
                      }`}>
                        {result.type}
                      </span>
                    </div>

                    {/* Match preview */}
                    {result.match_field !== "name" && result.match_field !== "filter" && result.match_preview && (
                      <p className="text-xs text-gray-500 line-clamp-2">
                        {filters.keywords ? highlightMatch(result.match_preview, filters.keywords) : result.match_preview}
                      </p>
                    )}

                    {/* Match field indicator */}
                    {result.match_field !== "name" && result.match_field !== "filter" && (
                      <p className="text-[10px] text-gray-400 mt-1">
                        Matched in {result.match_field}
                      </p>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Initial state */}
      {!hasSearched && (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-lg text-gray-400 mb-2">Enter search criteria above</p>
          <p className="text-sm text-gray-300">
            Use keywords, dates, and filters to find tasks across all researchers
          </p>
        </div>
      )}
    </div>
  );
}
