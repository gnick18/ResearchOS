"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { fetchAllMethodsIncludingShared, fetchAllProjectsIncludingShared, fetchAllTasksIncludingShared } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import AppShell from "@/components/AppShell";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import ExportFormatDialog, { type ExportProgressUi } from "@/components/ExportFormatDialog";
// TODO(manager): unstub once Sub-bot A lands frontend/src/lib/export/orchestrate.ts.
import {
  exportExperiments,
  exportExperimentsToFile,
  downloadResult,
  estimateMultiExportSize,
  type ExportSizeEstimate,
} from "@/lib/export/orchestrate";
import type { ExportFormat } from "@/lib/export/types";
import { buildCombinedPdf } from "@/lib/export/combined-pdf";
import { taskKey, type Task, type Method, type Project } from "@/lib/types";
import { resolveMethodById } from "@/lib/methods/lookup";
import {
  encodeFilterKey,
  matchesMethodFilter,
  matchesProjectFilter,
  type FilterKey,
} from "@/lib/search/filterKey";

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

interface SearchFilters {
  keywords: string;
  dateFrom: string;
  dateTo: string;
  taskType: "all" | "experiment" | "purchase" | "list";
  // Composite "<owner>:<id>" keys for the Method / Project filters. Numeric
  // ids collide across owners (alex's project 1 vs morgan's project 1, the
  // public method 2 vs alex's private method 2), so the form layer carries
  // the owner alongside the id and resolves it via lib/search/filterKey.ts.
  // Persona 18 caught the collision on the Project dropdown; the same
  // composite-key shape lands on Method here. Null = no filter.
  methodKey: FilterKey | null;
  methodFolder: string;
  projectKey: FilterKey | null;
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
  });

  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  // BeakerSearch global object search, chunk 3. Deep-link `/search?keywords=<q>`
  // seeds the keyword box and runs the search once on mount, then strips just
  // that param so a reload does not re-trigger. This is how the palette's "Search
  // everything for <q>" row hands a query off to the full faceted search. Other
  // params pass through untouched.
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!searchParams) return;
    const seed = searchParams.get("keywords");
    if (seed == null || seed.trim() === "") return;
    setFilters((prev) => ({ ...prev, keywords: seed }));
    setHasSearched(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("keywords");
    const queryString = next.toString();
    router.replace(queryString ? `/search?${queryString}` : "/search");
    // Run once for the param present at mount; the strip prevents a re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });

  const { data: methods = [] } = useQuery({
    queryKey: ["methods", currentUser],
    queryFn: fetchAllMethodsIncludingShared,
  });

  // Use the canonical merged-view loader instead of
  // `projects.map(p => tasksApi.listByProject(...))`. The latter reads raw
  // on-disk task files for each owner — it does NOT decorate shared tasks
  // with `is_shared_with_me: true`, so `taskKey()` collapses to `self:<id>`
  // for every task in this path and shared+own tasks with the same numeric
  // id silently collide downstream. See `/experiments` fix at `caa22513`.
  // `fetchAllTasksIncludingShared` is the canonical merged-view loader (used
  // by `/`, `/gantt`, `/settings`, `/experiments`) — decorates with
  // `is_shared_with_me: true`, surfaces Option-C hosted tasks, dedups via
  // composite key, and has a dev-mode duplicate-key guardrail.
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasksIncludingShared,
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

  // Composite key for project lookups: alex's project 1 and morgan's
  // project 1 are different projects and must not collide. Mirrors the
  // `taskKey` pattern in lib/types.ts. Cross-user views (Lab Mode, shared
  // projects) hit this — without it, lookups silently return whichever
  // project the array iteration order happened to surface last.
  const projectKey = (p: Pick<Project, "id" | "owner">) => `${p.owner}:${p.id}`;
  const taskProjectKey = (t: Pick<Task, "owner" | "project_id">) =>
    `${t.owner}:${t.project_id}`;

  // Project colors
  const projectColors = useMemo(() => {
    const map: Record<string, string> = {};
    projects.forEach((p, i) => {
      map[projectKey(p)] = p.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    });
    return map;
  }, [projects]);

  // Per-task method resolver: routes through `task.method_attachments` so
  // each attachment's `owner` disambiguates against per-user id collisions
  // (e.g. alex's task attaching public method 2 when alex also owns a
  // private method id 2). Bare `method_ids[0]` entries without a matching
  // attachment (newly-created tasks pre-backfill) fall back to task-owner-
  // first byId resolution.
  const resolveTaskMethod = useCallback(
    (task: Task, methodId: number): Method | null =>
      resolveMethodById(methodId, task.method_attachments, methods, task.owner) ??
      null,
    [methods],
  );

  // Project lookup
  const projectLookup = useMemo(() => {
    const map: Record<string, Project> = {};
    projects.forEach((p) => {
      map[projectKey(p)] = p;
    });
    return map;
  }, [projects]);

  // Perform search
  const searchResults = useMemo(() => {
    if (!hasSearched) return [];

    const results: SearchResult[] = [];
    const keywords = filters.keywords.toLowerCase().trim().split(/\s+/).filter(Boolean);

    for (const task of allTasks) {
      // Filter by task type
      if (filters.taskType !== "all" && task.task_type !== filters.taskType) {
        continue;
      }

      // Filter by project (composite owner:id match — see filterKey.ts).
      // Persona 18 collision class: bare `task.project_id === filters.id`
      // silently merges alex's project 1 with morgan's project 1.
      if (!matchesProjectFilter(task, filters.projectKey)) {
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

      // Pick the primary method for filter/display purposes — the first one
      // attached to this task (method_ids[0]). Legacy single-method tasks
      // are normalised at the read boundary, so we don't have to think
      // about the old top-level method_id field here.
      const primaryMethodId: number | null = task.method_ids?.[0] ?? null;

      // Filter by method (composite owner:id match — see filterKey.ts).
      // Same collision class as projects: the public method id 2 and
      // alex's private method id 2 are different records; matching on a
      // raw numeric id silently merges them.
      if (!matchesMethodFilter(task, filters.methodKey)) {
        continue;
      }

      // Filter by method folder
      if (filters.methodFolder) {
        const taskMethod = primaryMethodId != null ? resolveTaskMethod(task, primaryMethodId) : null;
        if (!taskMethod || taskMethod.folder_path !== filters.methodFolder) {
          continue;
        }
      }

      // Filter by keywords
      if (keywords.length > 0) {
        const taskName = task.name.toLowerCase();
        const taskTags = (task.tags || []).join(" ").toLowerCase();
        const taskMethod = primaryMethodId != null ? resolveTaskMethod(task, primaryMethodId) : null;
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
      const lookupKey = taskProjectKey(task);
      const project = projectLookup[lookupKey];
      if (project) {
        results.push({
          task,
          project,
          method: primaryMethodId != null ? resolveTaskMethod(task, primaryMethodId) : null,
          color: projectColors[lookupKey] || DEFAULT_COLORS[0],
        });
      }
    }

    // Sort by start date (most recent first)
    return results.sort((a, b) => b.task.start_date.localeCompare(a.task.start_date));
  }, [hasSearched, filters, allTasks, resolveTaskMethod, projectLookup, projectColors]);

  const handleSearch = useCallback(() => {
    setHasSearched(true);
  }, []);

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
    });
    setHasSearched(false);
  }, []);

  const updateFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const toggleTaskSelection = useCallback((task: Task) => {
    const key = taskKey(task);
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

  const handleResultCardClick = useCallback(
    (task: Task) => {
      if (selectMode) toggleTaskSelection(task);
      else setSelectedTask(task);
    },
    [selectMode, toggleTaskSelection]
  );

  // Cheap up-front size walk so the export dialog can show a soft warning
  // for big multi-selects. Runs when the dialog opens; cleared when it
  // closes. The estimate is bounded by attachment file-system metadata
  // reads — no byte content is loaded.
  useEffect(() => {
    if (!exportDialogOpen) {
      setExportSizeEstimate(null);
      return;
    }
    const tasksToExport = searchResults
      .filter((r) => selectedTaskKeys.has(taskKey(r.task)))
      .map((r) => r.task);
    if (tasksToExport.length < 2) return;
    let cancelled = false;
    estimateMultiExportSize(tasksToExport)
      .then((estimate) => {
        if (!cancelled) setExportSizeEstimate(estimate);
      })
      .catch(() => {
        // Estimate failures are non-fatal — the dialog just won't show
        // a size hint or the large-export warning.
      });
    return () => {
      cancelled = true;
    };
  }, [exportDialogOpen, searchResults, selectedTaskKeys]);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      const tasksToExport = searchResults
        .filter((r) => selectedTaskKeys.has(taskKey(r.task)))
        .map((r) => r.task);
      if (tasksToExport.length === 0) return;

      setExporting(true);
      setExportProgress(null);
      try {
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
    [searchResults, selectedTaskKeys, currentUser, cancelSelectMode]
  );

  // FSA streaming-to-disk variant. Same payload prep + progress wiring as
  // `handleExport`, but pipes bytes straight into the user-chosen file via
  // `showSaveFilePicker` so the full archive never materializes as a Blob.
  // Only invoked when the dialog renders the Save-to-disk section (gated
  // on `supportsFileSystemAccessSave()` and `taskCount > 1`).
  const handleExportToFile = useCallback(
    async (format: ExportFormat) => {
      const tasksToExport = searchResults
        .filter((r) => selectedTaskKeys.has(taskKey(r.task)))
        .map((r) => r.task);
      if (tasksToExport.length < 2) return;
      setExporting(true);
      setExportProgress(null);
      try {
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
        // saved === false ⇒ user cancelled the picker; keep the dialog
        // open so they can retry or pick a different format.
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
    [searchResults, selectedTaskKeys, currentUser, cancelSelectMode]
  );

  // Combined-PDF path (combined-pdf bot, 2026-05-28). Merges every selected
  // experiment into ONE navigable PDF (cover + clickable index + bookmarks)
  // via `buildCombinedPdf` instead of the default zip-of-individual-PDFs.
  // The Search page selects experiments only, so every item is kind
  // "experiment"; the builder also supports notes for other callers.
  const handleExportCombined = useCallback(async () => {
    const tasksToExport = searchResults
      .filter((r) => selectedTaskKeys.has(taskKey(r.task)))
      .map((r) => r.task);
    if (tasksToExport.length === 0) return;

    setExporting(true);
    setExportProgress(null);
    try {
      const blob = await buildCombinedPdf({
        title:
          tasksToExport.length === 1
            ? tasksToExport[0].name
            : `${tasksToExport.length} experiments`,
        items: tasksToExport.map((t) => ({
          kind: "experiment" as const,
          id: t.id,
        })),
      });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadResult({
        blob,
        filename: `combined-${stamp}.pdf`,
        mimeType: "application/pdf",
      });
      setExportDialogOpen(false);
      cancelSelectMode();
    } catch (error) {
      console.error("Combined PDF export failed:", error);
      alert(
        `Failed to export combined PDF: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  }, [searchResults, selectedTaskKeys, cancelSelectMode]);

  return (
    <AppShell>
      <div className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-heading font-semibold text-foreground">Search</h2>
          <p className="text-body text-foreground-muted mt-0.5">
            Find tasks, experiments, and purchases across all projects
          </p>
        </div>

        {/* Search Form */}
        <div className="bg-surface-raised border border-border rounded-xl p-6 mb-6">
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
                data-tour-target="search-input"
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Types</option>
                <option value="experiment">Experiments</option>
                <option value="purchase">Purchases</option>
                <option value="list">List Tasks</option>
              </select>
            </div>

            {/* Project */}
            <div>
              <label className="block text-meta font-medium text-foreground-muted mb-1">
                Project
              </label>
              <select
                value={filters.projectKey ?? ""}
                onChange={(e) =>
                  updateFilter("projectKey", e.target.value ? e.target.value : null)
                }
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Projects</option>
                {projects.map((p) => {
                  // Composite "<owner>:<id>" is both the React key AND the
                  // option value: a bare `p.id` collides for alex's project
                  // 1 vs morgan's project 1, browsers snap selectedIndex to
                  // the first match, and filtering silently widens to both
                  // (persona 18). encodeFilterKey mirrors `taskKey()` in
                  // lib/types.ts so the form, lookup map, and color map all
                  // share one key shape.
                  const key = encodeFilterKey(p);
                  return (
                    <option key={key} value={key}>
                      {p.name}
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
                onChange={(e) =>
                  updateFilter("methodKey", e.target.value ? e.target.value : null)
                }
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Any Method</option>
                {methods.map((m) => {
                  // Same composite-key shape as the Project select above.
                  // Method.owner is `"public"` for marketplace methods and
                  // a username otherwise, so two methods with id 2 (one
                  // public, one alex's private) get distinct option values
                  // instead of both rendering as `value="2"`.
                  const key = encodeFilterKey(m);
                  return (
                    <option key={key} value={key}>
                      {m.name}
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
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              data-tour-target="search-submit"
              className="ros-btn-raise px-4 py-2 text-body bg-brand-action text-white rounded-lg hover:bg-brand-action/90"
            >
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
                {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} found
              </h3>
              {searchResults.length > 0 && (
                <div className="flex items-center gap-2">
                  {selectMode ? (
                    <>
                      <span className="text-meta text-foreground-muted">
                        {selectedTaskKeys.size} selected
                      </span>
                      <button
                        onClick={() => setExportDialogOpen(true)}
                        disabled={selectedTaskKeys.size === 0}
                        className="ros-btn-raise px-3 py-1.5 text-meta bg-brand-action text-white rounded-lg hover:bg-brand-action/90 disabled:opacity-50 disabled:cursor-not-allowed"
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

            {searchResults.length === 0 ? (
              <div className="text-center py-12 bg-surface-sunken rounded-lg">
                <p className="text-body text-foreground-muted">No matches found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {searchResults.map(({ task, project, method, color }) => {
                  const key = taskKey(task);
                  const isSelected = selectedTaskKeys.has(key);
                  return (
                  <div
                    key={key}
                    onClick={() => handleResultCardClick(task)}
                    className={`bg-surface-raised border rounded-lg overflow-hidden hover:shadow-md transition-all cursor-pointer relative ${
                      isSelected
                        ? "border-blue-500 ring-2 ring-blue-200"
                        : "border-border"
                    }`}
                  >
                    {/* Color bar */}
                    <div className="h-1" style={{ backgroundColor: color }} />

                    {selectMode && (
                      <div
                        className={`absolute top-2 right-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          isSelected
                            ? "bg-brand-action border-brand-action text-white"
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

                    <div className="p-4">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="text-body font-medium text-foreground line-clamp-2">
                          {task.name}
                        </h4>
                        {task.is_complete && (
                          <span className="ml-2 flex-shrink-0 text-meta px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 rounded-full">
                            Complete
                          </span>
                        )}
                      </div>

                      {/* Project & Type */}
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="text-meta px-2 py-0.5 rounded-full text-white"
                          style={{ backgroundColor: color }}
                        >
                          {project.name}
                        </span>
                        <span className={`text-meta px-2 py-0.5 rounded-full ${
                          task.task_type === "experiment"
                            ? "bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-300"
                            : task.task_type === "purchase"
                            ? "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300"
                            : "bg-surface-sunken text-foreground-muted"
                        }`}>
                          {task.task_type}
                        </span>
                      </div>

                      {/* Date */}
                      <p className="text-meta text-foreground-muted mb-2">
                        {task.start_date} → {task.end_date} ({task.duration_days}d)
                      </p>

                      {/* Method */}
                      {method && (
                        <p className="text-meta text-purple-600 dark:text-purple-300 mb-2">
                          Method: {method.name}
                        </p>
                      )}

                      {/* Tags */}
                      {task.tags && task.tags.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {task.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="text-meta px-1.5 py-0.5 bg-surface-sunken text-foreground-muted rounded"
                            >
                              #{tag}
                            </span>
                          ))}
                          {task.tags.length > 3 && (
                            <span className="text-meta text-foreground-muted">
                              +{task.tags.length - 3}
                            </span>
                          )}
                        </div>
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
          <div className="text-center py-16 bg-surface-sunken rounded-lg">
            <p className="text-title text-foreground-muted mb-2">Search to get started</p>
            <p className="text-body text-foreground-muted">
              Enter keywords, dates, or filters above
            </p>
          </div>
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
        />
      )}

      <ExportFormatDialog
        isOpen={exportDialogOpen}
        taskCount={selectedTaskKeys.size}
        isExporting={exporting}
        sizeEstimate={exportSizeEstimate}
        progress={exportProgress}
        onClose={() => setExportDialogOpen(false)}
        onExport={handleExport}
        onExportToFile={handleExportToFile}
        onExportCombined={handleExportCombined}
      />
    </AppShell>
  );
}
