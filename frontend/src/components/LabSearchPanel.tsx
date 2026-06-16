"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi, tasksApi, LabSearchResult, LabProject, LabMethod, LabTask } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import ExportFormatDialog, { type ExportProgressUi } from "@/components/ExportFormatDialog";
import ProgressEntertainer from "@/components/progress/ProgressEntertainer";
// TODO(manager): unstub once Sub-bot A lands frontend/src/lib/export/orchestrate.ts.
import {
  exportExperiments,
  exportExperimentsToFile,
  downloadResult,
  estimateMultiExportSize,
  type ExportSizeEstimate,
} from "@/lib/export/orchestrate";
import type { ExportFormat } from "@/lib/export/types";
import type { Task } from "@/lib/types";
import {
  encodeFilterKey,
  narrowLabSearchByCompositeKeys,
  type FilterKey,
} from "@/lib/search/filterKey";

interface LabSearchPanelProps {
  selectedUsernames: Set<string>;
  onClose?: () => void;
  onTaskClick?: (task: LabTask) => void;
}

// Composite key for selecting lab task results across users — task ids are
// per-user, so we namespace by owner.
const labResultKey = (username: string, id: number) => `${username}:${id}`;

interface SearchFilters {
  keywords: string;
  dateFrom: string;
  dateTo: string;
  taskType: "all" | "experiment" | "purchase" | "list";
  // Composite "<owner>:<id>" keys for the Method / Project filters. A raw
  // numeric id collides across users (alex's project 1 vs morgan's project
  // 1, alex's private method 2 vs the public method 2), browsers snap
  // selectedIndex to the first matching <option value>, and the search
  // silently merges results from both owners. Persona 18 caught this on
  // /search; lib/search/filterKey.ts is the shared encoder/parser, and
  // narrowLabSearchByCompositeKeys bridges to the labApi.search payload.
  // Null = no filter.
  methodKey: FilterKey | null;
  methodFolder: string;
  projectKey: FilterKey | null;
  completionStatus: "all" | "complete" | "incomplete";
  username: string; // Specific user filter
}

export default function LabSearchPanel({
  selectedUsernames,
  onTaskClick,
}: LabSearchPanelProps) {
  const { users, tasks } = useLabData();
  const { currentUser } = useCurrentUser();
  const [results, setResults] = useState<LabSearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTaskKeys, setSelectedTaskKeys] = useState<Set<string>>(new Set());
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportSizeEstimate, setExportSizeEstimate] =
    useState<ExportSizeEstimate | null>(null);
  const [exportProgress, setExportProgress] =
    useState<ExportProgressUi | null>(null);

  const [filters, setFilters] = useState<SearchFilters>({
    keywords: "",
    dateFrom: "",
    dateTo: "",
    taskType: "all",
    methodKey: null,
    methodFolder: "",
    projectKey: null,
    completionStatus: "all",
    username: "", // Empty means all selected users
  });

  const { data: projects = [] } = useQuery<LabProject[]>({
    queryKey: ["lab", "projects"],
    queryFn: () => labApi.getProjects(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const { data: methods = [] } = useQuery<LabMethod[]>({
    queryKey: ["lab", "methods"],
    queryFn: () => labApi.getMethods(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const { data: methodFolders = [] } = useQuery<string[]>({
    queryKey: ["lab", "method-folders"],
    queryFn: () => labApi.getMethodFolders(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Perform search. Filters the already-cached lab queries (tasks /
  // projects / methods) client-side instead of round-tripping through
  // `labApi.search`. The cache IS the data source: on the real `/lab`
  // page it's labApi-fetched user data; inside DemoLabModeViewer it's
  // the demo bundle the viewer pre-seeded. The previous direct
  // `labApi.search()` call always re-read the on-disk lab folder and
  // bypassed the demo viewer's scoped React Query cache — typing
  // "qPCR" in the demo returned 0 results even though the seeded
  // bundle had matches. See `narrowLabSearchByCompositeKeys` for the
  // composite-key project/method narrowing rule, mirrored here.
  const performSearch = useCallback(() => {
    setLoading(true);
    setHasSearched(true);

    try {
      const q = filters.keywords.trim().toLowerCase();
      const dateFrom = filters.dateFrom || null;
      const dateTo = filters.dateTo || null;
      const completion = filters.completionStatus;

      // The baseline username scope is "specific user filter beats global
      // user-multi-select"; the composite-key narrowing below may override
      // both when a project/method is picked, because the owner half of
      // the composite key is itself the disambiguator.
      const baselineUsernames = filters.username
        ? [filters.username]
        : Array.from(selectedUsernames);

      const { usernames: usernamesCsv, projectId, methodId } =
        narrowLabSearchByCompositeKeys({
          baselineUsernames,
          projectKey: filters.projectKey,
          methodKey: filters.methodKey,
        });
      const targetUsernames = usernamesCsv
        ? new Set(usernamesCsv.split(",").map((s) => s.trim()).filter(Boolean))
        : null;

      const taskTypeFilter = filters.taskType === "all" ? null : filters.taskType;

      const previewFrom = (text: string): string => {
        if (!q) return text.slice(0, 160);
        const idx = text.toLowerCase().indexOf(q);
        if (idx === -1) return text.slice(0, 160);
        const start = Math.max(0, idx - 40);
        const end = Math.min(text.length, idx + q.length + 80);
        return (
          (start > 0 ? "…" : "") +
          text.slice(start, end) +
          (end < text.length ? "…" : "")
        );
      };

      const next: LabSearchResult[] = [];

      // Tasks. useLabData already excludes goals (is_high_level), so the
      // legacy `if (raw.is_high_level) continue` branch is implicit.
      for (const task of tasks) {
        if (targetUsernames && !targetUsernames.has(task.username)) continue;
        if (taskTypeFilter && task.task_type !== taskTypeFilter) continue;
        if (projectId !== null && task.project_id !== projectId) continue;
        if (methodId !== null && !(task.method_ids || []).includes(methodId)) continue;
        if (completion === "complete" && !task.is_complete) continue;
        if (completion === "incomplete" && task.is_complete) continue;
        if (dateFrom && task.end_date < dateFrom) continue;
        if (dateTo && task.start_date > dateTo) continue;

        let matchField: string = "filter";
        let matchPreview = "";

        if (q) {
          // The cached LabTask shape exposes `name` and `notes`
          // (deviation_log). Tags aren't carried on LabTask — the
          // labTaskFrom transform in local-api.ts and the demo
          // aggregator both drop them — so the tag-substring branch of
          // the original labApi.search semantics is unreachable here
          // and we degrade to name + deviation_log only.
          const name = task.name?.toLowerCase() ?? "";
          const deviation = (task.notes ?? "").toLowerCase();
          if (name.includes(q)) {
            matchField = "name";
          } else if (deviation.includes(q)) {
            matchField = "deviation_log";
            matchPreview = previewFrom(task.notes ?? "");
          } else {
            continue; // no text match
          }
        }

        next.push({
          type: "task",
          id: task.id,
          name: task.name,
          username: task.username,
          user_color: task.user_color,
          user_color_secondary: task.user_color_secondary,
          match_field: matchField,
          match_preview: matchPreview,
        });
      }

      // Projects & methods only surface when not filtering to a specific
      // task type — same rule as the original labApi.search.
      if (!taskTypeFilter) {
        for (const project of projects) {
          if (targetUsernames && !targetUsernames.has(project.username)) continue;
          if (projectId !== null && project.id !== projectId) continue;
          if (q && !project.name.toLowerCase().includes(q)) continue;
          next.push({
            type: "project",
            id: project.id,
            name: project.name,
            username: project.username,
            user_color: project.user_color,
            // LabProject doesn't carry a secondary color today; mirror
            // labApi.search which read it off the user metadata. We
            // pull the per-user secondary from the LabUser list.
            user_color_secondary:
              users.find((u) => u.username === project.username)
                ?.color_secondary ?? null,
            match_field: q ? "name" : "filter",
            match_preview: "",
          });
        }

        // Methods are only listed when no project filter is set — same
        // carve-out as labApi.search.
        if (projectId === null) {
          for (const method of methods) {
            if (
              targetUsernames &&
              method.username !== "public" &&
              !targetUsernames.has(method.username)
            ) {
              continue;
            }
            if (methodId !== null && method.id !== methodId) continue;
            if (q && !method.name.toLowerCase().includes(q)) continue;
            next.push({
              type: "method",
              id: method.id,
              name: method.name,
              username: method.username,
              user_color: method.user_color,
              user_color_secondary:
                users.find((u) => u.username === method.username)
                  ?.color_secondary ?? null,
              match_field: q ? "name" : "filter",
              match_preview: "",
            });
          }
        }
      }

      setResults(next);
      setTotalCount(next.length);
    } catch (err) {
      console.error("Search failed:", err);
      setResults([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [filters, selectedUsernames, tasks, projects, methods, users]);

  const handleSearch = useCallback(() => {
    performSearch();
  }, [performSearch]);

  const handleClear = useCallback(() => {
    setFilters({
      keywords: "",
      dateFrom: "",
      dateTo: "",
      taskType: "all",
      methodKey: null,
      methodFolder: "",
      projectKey: null,
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

  const toggleResultSelection = useCallback((result: LabSearchResult) => {
    if (result.type !== "task") return;
    const key = labResultKey(result.username, result.id);
    setSelectedTaskKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const enterSelectMode = useCallback(() => {
    setSelectMode(true);
  }, []);

  const cancelSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedTaskKeys(new Set());
  }, []);

  // Estimate the eventual on-disk size of the export when the dialog
  // opens, so the soft "Large export" warning can fire for 50+ tasks or
  // >500 MB. The lab-panel needs to resolve the selected results into
  // real Task records first — those records are what the size walker
  // walks. Failures are swallowed (the warning just won't show).
  const computeExportEstimate = useCallback(async () => {
    const picks = results.filter(
      (r) => r.type === "task" && selectedTaskKeys.has(labResultKey(r.username, r.id))
    );
    if (picks.length < 2) return;
    try {
      const fetched = await Promise.all(
        picks.map((r) => tasksApi.get(r.id, r.username))
      );
      const tasks = fetched.filter((t): t is Task => t != null);
      if (tasks.length < 2) return;
      const estimate = await estimateMultiExportSize(tasks);
      setExportSizeEstimate(estimate);
    } catch {
      // estimate failure is non-fatal
    }
  }, [results, selectedTaskKeys]);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      // Resolve selected lab results into full Task records on disk. The
      // owner is the result's username; tasksApi.get supports owner-scoped
      // reads.
      const picks = results.filter(
        (r) => r.type === "task" && selectedTaskKeys.has(labResultKey(r.username, r.id))
      );
      if (picks.length === 0) return;

      setExporting(true);
      setExportProgress(null);
      try {
        const fetched = await Promise.all(
          picks.map((r) => tasksApi.get(r.id, r.username))
        );
        const tasksToExport = fetched.filter((t): t is Task => t != null);
        if (tasksToExport.length === 0) {
          throw new Error("Could not load any of the selected experiments.");
        }
        const result = await exportExperiments(
          tasksToExport,
          format,
          currentUser,
          (p) =>
            setExportProgress({
              current: p.current,
              total: p.total,
              taskName: p.task.name,
              zipPercent: p.zipPercent,
            }),
        );
        downloadResult(result);
        setExportDialogOpen(false);
        cancelSelectMode();
      } catch (error) {
        console.error("Export failed:", error);
        alert(
          `Failed to export: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      } finally {
        setExporting(false);
        setExportProgress(null);
      }
    },
    [results, selectedTaskKeys, currentUser, cancelSelectMode]
  );

  // FSA streaming-to-disk variant of `handleExport`. Pipes the multi-zip
  // output directly into the user-chosen file via `showSaveFilePicker`
  // so the full archive never materializes as a Blob. Only invoked when
  // the dialog renders the Save-to-disk section (gated on
  // `supportsFileSystemAccessSave()` + `taskCount > 1`).
  const handleExportToFile = useCallback(
    async (format: ExportFormat) => {
      const picks = results.filter(
        (r) => r.type === "task" && selectedTaskKeys.has(labResultKey(r.username, r.id))
      );
      if (picks.length < 2) return;
      setExporting(true);
      setExportProgress(null);
      try {
        const fetched = await Promise.all(
          picks.map((r) => tasksApi.get(r.id, r.username))
        );
        const tasksToExport = fetched.filter((t): t is Task => t != null);
        if (tasksToExport.length < 2) {
          throw new Error("Could not load enough of the selected experiments.");
        }
        const { saved } = await exportExperimentsToFile(
          tasksToExport,
          format,
          currentUser,
          (p) =>
            setExportProgress({
              current: p.current,
              total: p.total,
              taskName: p.task.name,
              zipPercent: p.zipPercent,
            }),
        );
        if (saved) {
          setExportDialogOpen(false);
          cancelSelectMode();
        }
      } catch (error) {
        console.error("Export-to-file failed:", error);
        alert(
          `Failed to save: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      } finally {
        setExporting(false);
        setExportProgress(null);
      }
    },
    [results, selectedTaskKeys, currentUser, cancelSelectMode]
  );

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
        <mark className="bg-yellow-200 text-yellow-900 dark:text-yellow-300 px-0.5 rounded">
          {text.slice(idx, idx + query.length)}
        </mark>
        {text.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div className="space-y-6">
      {/* Search Form */}
      <div className="bg-surface-raised border border-border rounded-xl p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Keywords */}
          <div className="lg:col-span-2">
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Keywords
            </label>
            <input
              type="text"
              value={filters.keywords}
              onChange={(e) => updateFilter("keywords", e.target.value)}
              placeholder="Search by name, tags, method..."
              data-tour-target="lab-mode-search-keyword-input"
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-emerald-500"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
          </div>

          {/* Date From */}
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Date From
            </label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => updateFilter("dateFrom", e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Date To
            </label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => updateFilter("dateTo", e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Task Type */}
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Task Type
            </label>
            <select
              value={filters.taskType}
              onChange={(e) => updateFilter("taskType", e.target.value as SearchFilters["taskType"])}
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="all">All Types</option>
              <option value="experiment">Experiments</option>
              <option value="purchase">Purchases</option>
              <option value="list">List Tasks</option>
            </select>
          </div>

          {/* User Filter */}
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              User
            </label>
            <select
              value={filters.username}
              onChange={(e) => updateFilter("username", e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Project
            </label>
            <select
              value={filters.projectKey ?? ""}
              onChange={(e) => updateFilter("projectKey", e.target.value || null)}
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">All Projects</option>
              {projects.map((p) => {
                // Composite "<owner>:<id>" is both the React key AND the
                // option value. A bare `p.id` collides for alex's project
                // 1 vs morgan's project 1 because browsers snap
                // selectedIndex to the first matching value, silently
                // widening the filter to both owners (persona 18 on the
                // /search page; same bug class here). encodeFilterKey
                // keeps this in lockstep with the /search dropdowns and
                // with narrowLabSearchByCompositeKeys below.
                const key = encodeFilterKey({ owner: p.username, id: p.id });
                return (
                  <option key={key} value={key}>
                    {p.name} ({p.username})
                  </option>
                );
              })}
            </select>
          </div>

          {/* Method */}
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Specific Method
            </label>
            <select
              value={filters.methodKey ?? ""}
              onChange={(e) => updateFilter("methodKey", e.target.value || null)}
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Any Method</option>
              {methods.map((m) => {
                // Same composite-key shape as the Project select above.
                // For public marketplace methods, LabMethod.username is
                // the synthetic marker "public" (set in labApi.getMethods);
                // narrowLabSearchByCompositeKeys treats that marker as
                // "do not narrow" so the marketplace pool still searches
                // across every user's task method_ids.
                const key = encodeFilterKey({ owner: m.username, id: m.id });
                return (
                  <option key={key} value={key}>
                    {m.name} {m.is_public ? "(public)" : `(${m.username})`}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Method Folder */}
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Method Category
            </label>
            <select
              value={filters.methodFolder}
              onChange={(e) => updateFilter("methodFolder", e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Completion Status
            </label>
            <select
              value={filters.completionStatus}
              onChange={(e) => updateFilter("completionStatus", e.target.value as SearchFilters["completionStatus"])}
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
            className="ros-btn-raise px-4 py-2 text-body bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            )}
            Search
          </button>
          <button
            onClick={handleClear}
            className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Results */}
      {hasSearched && (
        <div>
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h3 className="text-body font-semibold text-foreground">
              {totalCount} result{totalCount !== 1 ? "s" : ""} found
            </h3>
            {results.some((r) => r.type === "task") && (
              <div className="flex items-center gap-2">
                {selectMode ? (
                  <>
                    <span className="text-meta text-foreground-muted">
                      {selectedTaskKeys.size} selected
                    </span>
                    <button
                      onClick={() => {
                        setExportDialogOpen(true);
                        setExportSizeEstimate(null);
                        // Fire-and-forget — the dialog renders a normal
                        // format-picker until the estimate resolves, then
                        // gates behind a soft warning if it crosses the
                        // large-export thresholds.
                        void computeExportEstimate();
                      }}
                      disabled={selectedTaskKeys.size === 0}
                      className="ros-btn-raise px-3 py-1.5 text-meta bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Export selected
                    </button>
                    <button
                      onClick={cancelSelectMode}
                      className="px-3 py-1.5 text-meta text-foreground-muted hover:bg-surface-sunken rounded-lg"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={enterSelectMode}
                    className="ros-btn-neutral px-3 py-1.5 text-meta text-foreground-muted"
                  >
                    Select
                  </button>
                )}
              </div>
            )}
          </div>

          {results.length === 0 ? (
            <div className="text-center py-12 bg-surface-raised rounded-lg border border-border">
              <svg className="w-12 h-12 mx-auto mb-3 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-body text-foreground-muted">No results match your search criteria</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {results.map((result, index) => {
                const isTask = result.type === "task";
                const selectionKey = isTask ? labResultKey(result.username, result.id) : null;
                const isSelected = selectionKey !== null && selectedTaskKeys.has(selectionKey);
                const handleClick = () => {
                  if (selectMode) {
                    toggleResultSelection(result);
                    return;
                  }
                  if (isTask && onTaskClick) {
                    const task = tasks.find(t => t.id === result.id && t.username === result.username);
                    if (task) {
                      onTaskClick(task);
                    }
                  }
                };

                const selectableInThisMode = !selectMode || isTask;

                return (
                  <div
                    key={`${result.type}-${result.id}-${index}`}
                    className={`bg-surface-raised border rounded-lg overflow-hidden transition-all relative ${
                      isSelected
                        ? "border-emerald-500 ring-2 ring-emerald-200"
                        : "border-border"
                    } ${
                      selectableInThisMode
                        ? "hover:shadow-md cursor-pointer"
                        : "opacity-60 cursor-not-allowed"
                    }`}
                    onClick={selectableInThisMode ? handleClick : undefined}
                  >
                    {selectMode && isTask && (
                      <div
                        className={`absolute top-2 right-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          isSelected
                            ? "bg-emerald-500 border-emerald-500 text-white"
                            : "border-border bg-surface-raised"
                        }`}
                      >
                        {isSelected && (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </div>
                    )}
                  {/* Color bar — gradient when the user has opted into a
                      2-stop combination, solid otherwise. */}
                  <div
                    className="h-1"
                    style={{
                      background: result.user_color_secondary
                        ? `linear-gradient(90deg, ${result.user_color} 0%, ${result.user_color_secondary} 100%)`
                        : result.user_color,
                    }}
                  />

                  <div className="p-4">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="text-body font-medium text-foreground line-clamp-2">
                        {filters.keywords ? highlightMatch(result.name, filters.keywords) : result.name}
                      </h4>
                    </div>

                    {/* User & Type */}
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="text-meta px-2 py-0.5 rounded-full text-white"
                        style={{
                          background: result.user_color_secondary
                            ? `linear-gradient(135deg, ${result.user_color} 0%, ${result.user_color_secondary} 100%)`
                            : result.user_color,
                        }}
                      >
                        {result.username}
                      </span>
                      <span className={`text-meta px-2 py-0.5 rounded-full ${
                        result.type === "task"
                          ? "bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300"
                          : result.type === "project"
                          ? "bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-300"
                          : "bg-green-50 dark:bg-green-500/15 text-green-600 dark:text-green-300"
                      }`}>
                        {result.type}
                      </span>
                    </div>

                    {/* Match preview */}
                    {result.match_field !== "name" && result.match_field !== "filter" && result.match_preview && (
                      <p className="text-meta text-foreground-muted line-clamp-2">
                        {filters.keywords ? highlightMatch(result.match_preview, filters.keywords) : result.match_preview}
                      </p>
                    )}

                    {/* Match field indicator */}
                    {result.match_field !== "name" && result.match_field !== "filter" && (
                      <p className="text-meta text-foreground-muted mt-1">
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
        <div className="text-center py-16 bg-surface-raised rounded-lg border border-border">
          <svg className="w-12 h-12 mx-auto mb-3 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-title text-foreground-muted mb-2">Enter search criteria above</p>
          <p className="text-body text-foreground-muted">
            Use keywords, dates, and filters to find tasks across all researchers
          </p>
        </div>
      )}

      {/* Format picker — hidden while the export is actively running.
          The ProgressEntertainer below takes over the screen for the
          duration of the export so the user gets a clear "we're
          working on it" signal + a bit of slapstick to entertain them
          while big multi-experiment ZIPs pack (Grant brief 2026-05-23
          on the Centrifuge scene → reuse as a progress entertainer). */}
      <ExportFormatDialog
        isOpen={exportDialogOpen && !exporting}
        taskCount={selectedTaskKeys.size}
        isExporting={exporting}
        sizeEstimate={exportSizeEstimate}
        progress={exportProgress}
        onClose={() => setExportDialogOpen(false)}
        onExport={handleExport}
        onExportToFile={handleExportToFile}
      />

      <ProgressEntertainer
        open={exporting}
        title="Preparing your export…"
        subtitle={progressSubtitle(exportProgress, selectedTaskKeys.size)}
        progress={progressFraction(exportProgress, selectedTaskKeys.size)}
      />
    </div>
  );
}

/** Derive the human-readable subtitle for ProgressEntertainer from
 *  the multi-stage export progress (per-experiment build, then ZIP
 *  packaging). Mirrors the inline progress line in ExportFormatDialog
 *  so callers don't see two different progress vocabularies for the
 *  same operation. */
function progressSubtitle(
  progress: ExportProgressUi | null,
  totalCount: number,
): string | undefined {
  if (!progress) return totalCount > 1
    ? `Packaging ${totalCount} experiments…`
    : undefined;
  if (typeof progress.zipPercent === "number") {
    return `Packaging archive… ${Math.round(progress.zipPercent)}%`;
  }
  if (progress.total > 1) {
    return `Exporting "${progress.taskName}" — ${progress.current} of ${progress.total}`;
  }
  return `Exporting "${progress.taskName}"`;
}

/** Derive a 0..1 progress fraction. During per-experiment build the
 *  fraction is completed-experiments / total. During ZIP pack it's
 *  the streamed zipPercent. Undefined when no progress is available
 *  yet → ProgressEntertainer falls back to indeterminate mode. */
function progressFraction(
  progress: ExportProgressUi | null,
  _totalCount: number,
): number | undefined {
  if (!progress) return undefined;
  if (typeof progress.zipPercent === "number") {
    return Math.min(1, Math.max(0, progress.zipPercent / 100));
  }
  // current is 1-indexed; subtract 1 because the build for `current`
  // is in flight, not done.
  const denom = Math.max(1, progress.total);
  return Math.min(1, Math.max(0, (progress.current - 1) / denom));
}
