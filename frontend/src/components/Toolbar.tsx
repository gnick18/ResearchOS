"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { encodeFilterKey, parseFilterKey, STANDALONE_FILTER_KEY } from "@/lib/search/filterKey";
import type { Project, ViewMode } from "@/lib/types";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";

const VIEW_MODES: { label: string; value: ViewMode }[] = [
  { label: "1W", value: "1week" },
  { label: "2W", value: "2week" },
  { label: "3W", value: "3week" },
  { label: "1M", value: "1month" },
  { label: "3M", value: "3month" },
  { label: "6M", value: "6month" },
  { label: "1Y", value: "1year" },
  { label: "All", value: "all" },
];

// Helper to format date as YYYY-MM-DD
function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper to format date for display
function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Helper to get the Monday of a week
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

interface ToolbarProps {
  projects: Project[];
  allTags: string[];
  onCreateTask: () => void;
  onCreateGoal: () => void;
  // Keyed by composite `${owner}:${id}` so a shared project and an own
  // project with the same numeric id keep distinct colors.
  projectColors?: Record<string, string>;
  /** Show the "+ Goal" button. Default true; the class-mode Gantt passes false
   *  because high-level (research lab) goals have no classroom meaning. */
  showGoalButton?: boolean;
}

// Composite key for the projectColors lookup. Mirrors the helper in
// app/gantt/page.tsx where the map is built.
const projectKey = (p: Pick<Project, "id" | "owner">) => `${p.owner}:${p.id}`;

export default function Toolbar({
  projects,
  allTags,
  onCreateTask,
  onCreateGoal,
  projectColors,
  showGoalButton = true,
}: ToolbarProps) {
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const toggleProject = useAppStore((s) => s.toggleProject);
  const setSelectedProjects = useAppStore((s) => s.setSelectedProjects);
  const projectFilterMode = useAppStore((s) => s.projectFilterMode);
  const setProjectFilterMode = useAppStore((s) => s.setProjectFilterMode);
  const selectedTags = useAppStore((s) => s.selectedTags);
  const toggleTag = useAppStore((s) => s.toggleTag);
  const showShared = useAppStore((s) => s.showShared);
  const setShowShared = useAppStore((s) => s.setShowShared);
  const ganttStartDate = useAppStore((s) => s.ganttStartDate);
  const setGanttStartDate = useAppStore((s) => s.setGanttStartDate);
  const ganttNavigateWeeks = useAppStore((s) => s.ganttNavigateWeeks);

  // Project filter dropdown UI state. The Gantt toolbar used to render
  // one chip per project; with 10+ projects that overflowed the toolbar
  // (Grant declutter pass, 2026-05-23). We render a single multi-select
  // dropdown instead: trigger label adapts to selection count, color
  // dots preserved, search filter keeps the list usable when the user
  // has many projects.
  const [showProjectFilter, setShowProjectFilter] = useState(false);
  const [projectFilterQuery, setProjectFilterQuery] = useState("");
  const projectFilterRef = useRef<HTMLDivElement | null>(null);

  // UX-clawback (2026-06-26): the secondary filters (Shared + Tags) used to sit
  // inline and helped the toolbar wrap into 2-3 rows. They now live behind a
  // single "Filters" overflow popover. Same store-backed handlers, just folded
  // out of the always-on row. The trigger carries a dot when any of them is
  // active so the user knows a filter is in effect without opening it.
  const [showFilters, setShowFilters] = useState(false);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const activeSecondaryFilterCount =
    (showShared ? 1 : 0) + selectedTags.length;

  // Deep-link hooks. `/gantt?createGoal=1` fires the create-goal flow.
  // `/gantt?project=<owner>:<id>` initializes the project filter to
  // that single project (used by the Project Surface "View timeline →"
  // link). The `project` param now carries a composite owner:id key,
  // a bare numeric form is rejected because two projects can share the
  // same numeric id across owners (persona 18 collision; same fix shape
  // as /search at ab1548a8). Each param strips after acting so a reload
  // doesn't re-trigger. The legacy `?animations=1` param is also
  // stripped on arrival so existing bookmarks don't leave the URL dirty
  // after the Gantt toolbar's animation picker moved to Settings.
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!searchParams) return;
    const hasLegacyAnimations = searchParams.get("animations") === "1";
    const wantsCreateGoal = searchParams.get("createGoal") === "1";
    const projectParam = searchParams.get("project");
    const projectKeyParts = parseFilterKey(projectParam);
    const wantsProjectFilter = projectKeyParts !== null;
    if (!hasLegacyAnimations && !wantsCreateGoal && !wantsProjectFilter) return;
    if (wantsCreateGoal) onCreateGoal();
    if (wantsProjectFilter && projectParam) setSelectedProjects([projectParam]);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("animations");
    next.delete("createGoal");
    next.delete("project");
    const query = next.toString();
    router.replace(query ? `/gantt?${query}` : "/gantt");
  }, [searchParams, router, onCreateGoal, setSelectedProjects]);

  // Close project-filter dropdown on outside click / Escape.
  useEffect(() => {
    if (!showProjectFilter) return;
    const onMouseDown = (e: MouseEvent) => {
      const root = projectFilterRef.current;
      if (root && !root.contains(e.target as Node)) {
        setShowProjectFilter(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowProjectFilter(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showProjectFilter]);

  // Close the Filters overflow popover on outside click / Escape. Mirrors the
  // project-filter dropdown handler above.
  useEffect(() => {
    if (!showFilters) return;
    const onMouseDown = (e: MouseEvent) => {
      const root = filtersRef.current;
      if (root && !root.contains(e.target as Node)) {
        setShowFilters(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowFilters(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showFilters]);

  // Derived: the visible rows in the dropdown body. Filtered by the
  // search query (case-insensitive substring on the project name).
  const filteredProjects = useMemo(() => {
    const q = projectFilterQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, projectFilterQuery]);

  // Derived: the label rendered on the trigger button.
  // "all" mode collapses to the literal "All" word regardless of how the
  // explicit array stands; "explicit" mode reads the array. An empty
  // explicit array means the user cleared the filter and nothing renders
  // on the Gantt, so the label says "None" rather than misleadingly
  // implying "all".
  const projectFilterLabel = useMemo(() => {
    if (projectFilterMode === "all") {
      return { kind: "all" as const };
    }
    if (selectedProjectIds.length === 0) {
      return { kind: "none" as const };
    }
    if (selectedProjectIds.length === 1) {
      const onlyKey = selectedProjectIds[0];
      // Standalone sentinel rendered as its own labeled chip on the
      // trigger so the user sees "Projects: Standalone" instead of "1
      // selected" when they've scoped to orphan tasks (project_id null).
      if (onlyKey === STANDALONE_FILTER_KEY) {
        return { kind: "standalone" as const };
      }
      const match = projects.find((p) => encodeFilterKey(p) === onlyKey);
      if (match) {
        return {
          kind: "one" as const,
          name: match.name,
          color: projectColors?.[projectKey(match)] ?? "#3b82f6",
        };
      }
      // The single selected id no longer matches any visible project
      // (could happen after a project archive). Fall back to "1
      // selected" so the trigger is still meaningful.
      return { kind: "many" as const, count: 1 };
    }
    return { kind: "many" as const, count: selectedProjectIds.length };
  }, [projectFilterMode, selectedProjectIds, projects, projectColors]);

  // Calculate weeks to show based on view mode
  const weeksToShow = useMemo(() => {
    switch (viewMode) {
      case "1week": return 1;
      case "2week": return 2;
      case "3week": return 3;
      case "1month": return 4;
      case "3month": return 13;
      case "6month": return 26;
      case "1year": return 52;
      case "all": return 8;
      default: return 2;
    }
  }, [viewMode]);

  // Calculate display date range
  const displayDateRange = useMemo(() => {
    const start = ganttStartDate 
      ? new Date(ganttStartDate + 'T00:00:00')
      : getMonday(new Date());
    
    const end = new Date(start);
    end.setDate(end.getDate() + weeksToShow * 7 - 1);
    
    return { start, end };
  }, [ganttStartDate, weeksToShow]);

  // Handle calendar date change
  const handleCalendarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedDate = e.target.value;
    if (!selectedDate) {
      setGanttStartDate(null);
      return;
    }
    
    const date = new Date(selectedDate + 'T00:00:00');
    const monday = getMonday(date);
    setGanttStartDate(formatDate(monday));
  };

  // Reset to current week
  const handleResetToToday = () => {
    setGanttStartDate(null);
  };

  // Get the current display start date for the calendar
  const displayStartDate = ganttStartDate || formatDate(getMonday(new Date()));

  return (
    <div className="border-b border-border bg-surface-raised px-4 py-3 flex items-center gap-4 flex-wrap">
      {/* Project filter — multi-select dropdown. Replaces the legacy
          chip-row that overflowed the toolbar past ~5 projects. */}
      <div className="relative" ref={projectFilterRef}>
        <button
          type="button"
          onClick={() => setShowProjectFilter((v) => !v)}
          data-tour-target="gantt-project-filter"
          aria-expanded={showProjectFilter}
          aria-haspopup="listbox"
          className={`
            px-2.5 py-1.5 text-meta rounded-lg border transition-colors flex items-center gap-1.5
            ${
              projectFilterMode === "explicit"
                ? "border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300"
                : "border-border bg-surface-raised text-foreground hover:border-border"
            }
          `}
        >
          <span className="text-foreground-muted font-medium">Projects:</span>
          {projectFilterLabel.kind === "all" && (
            <span className="font-medium">All</span>
          )}
          {projectFilterLabel.kind === "none" && (
            <span className="font-medium">None</span>
          )}
          {projectFilterLabel.kind === "one" && (
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: projectFilterLabel.color }}
                aria-hidden="true"
              />
              <span className="font-medium truncate max-w-[10rem]">
                {projectFilterLabel.name}
              </span>
            </span>
          )}
          {projectFilterLabel.kind === "standalone" && (
            <span className="font-medium">Standalone</span>
          )}
          {projectFilterLabel.kind === "many" && (
            <span className="font-medium">
              {projectFilterLabel.count} selected
            </span>
          )}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${showProjectFilter ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {showProjectFilter && (
          <div
            role="listbox"
            aria-label="Filter Gantt by project"
            className="absolute top-full left-0 mt-1 w-72 bg-surface-raised border border-border rounded-lg shadow-lg z-30"
          >
            <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 border-b border-border">
              <span className="text-meta font-medium text-foreground-muted uppercase tracking-wide">
                Filter by project
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setProjectFilterMode("all")}
                  disabled={projectFilterMode === "all"}
                  className="text-meta text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 hover:underline disabled:text-foreground-muted disabled:cursor-default disabled:hover:no-underline"
                >
                  Select all
                </button>
                <span className="text-foreground-muted" aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => {
                    setProjectFilterMode("explicit");
                    setSelectedProjects([]);
                  }}
                  disabled={projectFilterMode === "explicit" && selectedProjectIds.length === 0}
                  className="text-meta text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 hover:underline disabled:text-foreground-muted disabled:cursor-default disabled:hover:no-underline"
                >
                  Unselect all
                </button>
              </div>
            </div>
            <div className="px-2 pt-2">
              <input
                type="text"
                value={projectFilterQuery}
                onChange={(e) => setProjectFilterQuery(e.target.value)}
                placeholder="Search projects..."
                aria-label="Search projects"
                className="w-full px-2 py-1 text-meta border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="max-h-[300px] overflow-y-auto py-1.5">
              {filteredProjects.length === 0 ? (
                <p className="px-3 py-2 text-meta text-foreground-muted">
                  No projects match &ldquo;{projectFilterQuery}&rdquo;.
                </p>
              ) : (
                filteredProjects.map((p) => {
                  const pKey = encodeFilterKey(p);
                  // In "all" mode, every checkbox renders as checked so the
                  // visual state matches reality (the Gantt is showing every
                  // project). The store's toggleProject handler flips into
                  // "explicit" mode on first click, scoping the array to
                  // just that row.
                  const isSelected =
                    projectFilterMode === "all" ||
                    selectedProjectIds.includes(pKey);
                  const projectColor =
                    projectColors?.[projectKey(p)] ?? "#3b82f6";
                  return (
                    <button
                      key={pKey}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => toggleProject(pKey)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-meta text-left hover:bg-surface-sunken focus:outline-none focus:bg-surface-sunken"
                    >
                      <span
                        className={`
                          inline-flex items-center justify-center w-4 h-4 rounded border
                          ${isSelected ? "bg-brand-action border-brand-action text-white" : "bg-surface-raised border-border"}
                        `}
                        aria-hidden="true"
                      >
                        {isSelected && (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: projectColor }}
                        aria-hidden="true"
                      />
                      <span className="truncate text-foreground">{p.name}</span>
                    </button>
                  );
                })
              )}
              {/* Standalone sentinel row. Toggling this key visibility-OR's
                  orphan tasks (project_id null) into the filtered Workbench /
                  Gantt views. Lives at the end of the project rows, separated
                  by a faint divider, and uses a grey-dashed swatch instead of
                  a colored dot so it reads as "category", not "project". */}
              {(projectFilterQuery.trim() === "" ||
                "standalone".includes(projectFilterQuery.trim().toLowerCase())) && (
                <>
                  <div className="my-1 border-t border-dashed border-border" aria-hidden="true" />
                  <Tooltip
                    label="Toggle visibility of experiments with no project"
                    placement="bottom"
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={
                        projectFilterMode === "all" ||
                        selectedProjectIds.includes(STANDALONE_FILTER_KEY)
                      }
                      onClick={() => toggleProject(STANDALONE_FILTER_KEY)}
                      data-tour-target="gantt-project-filter-standalone"
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-meta text-left hover:bg-surface-sunken focus:outline-none focus:bg-surface-sunken"
                    >
                      <span
                        className={`
                          inline-flex items-center justify-center w-4 h-4 rounded border
                          ${
                            projectFilterMode === "all" ||
                            selectedProjectIds.includes(STANDALONE_FILTER_KEY)
                              ? "bg-brand-action border-brand-action text-white"
                              : "bg-surface-raised border-border"
                          }
                        `}
                        aria-hidden="true"
                      >
                        {(projectFilterMode === "all" ||
                          selectedProjectIds.includes(STANDALONE_FILTER_KEY)) && (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 border border-dashed border-border bg-surface-raised"
                        aria-hidden="true"
                      />
                      <span className="truncate text-foreground">Standalone</span>
                      <span className="ml-auto text-meta text-foreground-muted italic">no project</span>
                    </button>
                  </Tooltip>
                </>
              )}
            </div>
            {projectFilterMode === "all" && (
              <p className="px-3 py-1.5 text-meta text-foreground-muted border-t border-border">
                Showing all projects. Click a row to scope the Gantt.
              </p>
            )}
            {projectFilterMode === "explicit" && selectedProjectIds.length === 0 && (
              <p className="px-3 py-1.5 text-meta text-foreground-muted border-t border-border">
                Showing no projects. Pick rows or click Select all to reset.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Filters overflow (UX-clawback 2026-06-26): the secondary Shared toggle
          and Tag pills moved off the always-on row into a single popover so the
          toolbar stops wrapping. Reuses the exact same store handlers; only the
          chrome moved. A dot on the trigger flags any active secondary filter. */}
      <div className="relative" ref={filtersRef}>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          aria-haspopup="dialog"
          className={`
            px-2.5 py-1.5 text-meta rounded-lg border transition-colors flex items-center gap-1.5
            ${
              activeSecondaryFilterCount > 0
                ? "border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300"
                : "border-border bg-surface-raised text-foreground hover:border-border"
            }
          `}
        >
          <Icon name="filter" className="w-3.5 h-3.5" />
          <span className="font-medium">Filters</span>
          {activeSecondaryFilterCount > 0 && (
            <span
              className="inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-brand-action text-white text-[0.625rem] font-semibold"
              aria-label={`${activeSecondaryFilterCount} active`}
            >
              {activeSecondaryFilterCount}
            </span>
          )}
          <Icon
            name="chevronDown"
            className={`w-3 h-3 transition-transform ${showFilters ? "rotate-180" : ""}`}
          />
        </button>

        {showFilters && (
          <div
            role="dialog"
            aria-label="Gantt filters"
            className="absolute top-full left-0 mt-1 w-72 bg-surface-raised border border-border rounded-lg shadow-lg z-30 p-3 space-y-3"
          >
            {/* Shared toggle */}
            <div>
              <span className="text-meta font-medium text-foreground-muted uppercase tracking-wide">
                Sharing
              </span>
              <div className="mt-1.5">
                <button
                  onClick={() => setShowShared(!showShared)}
                  className={`
                    px-2.5 py-1 text-meta rounded-full transition-colors flex items-center gap-1
                    ${
                      showShared
                        ? "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 font-medium"
                        : "bg-surface-sunken text-foreground-muted"
                    }
                  `}
                  title="Toggle visibility of shared experiments"
                >
                  <Icon name="share" className="w-3 h-3" />
                  Shared
                </button>
              </div>
            </div>

            {/* Tag pills */}
            {allTags.length > 0 && (
              <div>
                <span className="text-meta font-medium text-foreground-muted uppercase tracking-wide">
                  Tags
                </span>
                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                  {allTags.map((tag) => {
                    const isSelected = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className={`
                          px-2.5 py-1 text-meta rounded-full transition-colors
                          ${
                            isSelected
                              ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-medium"
                              : "bg-surface-sunken text-foreground-muted"
                          }
                        `}
                      >
                        #{tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right-side controls grouped so they wrap together as a unit (not
          raggedly, control by control) and stay right-aligned at wide widths.
          ml-auto replaces the old flex-1 spacer, which took its own line when
          the root flex-wrapped on a narrow-desktop window. */}
      <div className="ml-auto flex items-center gap-4 flex-wrap justify-end">

      {/* View mode buttons */}
      <div className="flex items-center bg-surface-sunken rounded-lg p-0.5 ros-seg-track border border-border">
        {VIEW_MODES.map((vm) => (
          <button
            key={vm.value}
            onClick={() => setViewMode(vm.value)}
            className={`
              px-2.5 py-1 text-meta rounded-md transition-colors
              ${
                viewMode === vm.value
                  ? "bg-surface-raised text-foreground ros-seg-active font-medium"
                  : "text-foreground-muted hover:text-foreground"
              }
            `}
          >
            {vm.label}
          </button>
        ))}
      </div>

      {/* Add goal button. Hidden in class mode (high-level lab goals have no
          classroom meaning). */}
      {showGoalButton && (
      <button
        onClick={onCreateGoal}
        data-tour-target="gantt-goals-button"
        className="ros-btn-raise px-3 py-1.5 text-body bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors flex items-center gap-1"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="6"/>
          <circle cx="12" cy="12" r="2"/>
        </svg>
        Goal
      </button>
      )}

      {/* Add task button */}
      <button
        onClick={onCreateTask}
        data-tour-target="gantt-new-task-button"
        className="ros-btn-raise px-3 py-1.5 text-body bg-brand-action text-white rounded-lg hover:bg-brand-action/90 transition-colors"
      >
        + Task
      </button>

      {/* Week navigation controls */}
      <div className="flex items-center gap-1.5 border-l border-border pl-4">
        {/* Previous week button */}
        <Tooltip label="Go back 1 week" placement="bottom">
          <button
            onClick={() => ganttNavigateWeeks(-1)}
            className="px-2 py-1.5 text-body bg-surface-raised border border-border rounded-lg hover:bg-surface-sunken transition-colors flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </Tooltip>
        
        {/* Date picker */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={displayStartDate}
            onChange={handleCalendarChange}
            className="px-2 py-1 text-meta border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-32"
            title="Select a Monday to start from (will be adjusted to nearest Monday)"
          />
        </div>

        {/* Next week button */}
        <Tooltip label="Go forward 1 week" placement="bottom">
          <button
            onClick={() => ganttNavigateWeeks(1)}
            className="px-2 py-1.5 text-body bg-surface-raised border border-border rounded-lg hover:bg-surface-sunken transition-colors flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </Tooltip>

        {/* Reset button - only show when viewing a custom date */}
        {ganttStartDate && (
          <button
            onClick={handleResetToToday}
            className="px-2 py-1 text-meta text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 hover:underline"
            title="Reset to current week"
          >
            Today
          </button>
        )}

        {/* Date range display */}
        <span className="text-meta text-foreground-muted ml-1">
          {formatMonthLabel(displayDateRange.start)} – {formatMonthLabel(displayDateRange.end)}
        </span>
      </div>
      </div>

    </div>
  );
}
