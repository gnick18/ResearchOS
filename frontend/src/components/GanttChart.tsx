"use client";

import { useCallback, useMemo, useRef, useState, useEffect, useLayoutEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tasksApi, dependenciesApi } from "@/lib/local-api";
import { taskKey } from "@/lib/types";
import type { Dependency, Task, ShiftResult, Project, HighLevelGoal } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import LoadingOverlay from "@/components/LoadingOverlay";
import Tooltip from "@/components/Tooltip";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { patchStreak, readStreak } from "@/lib/streak/streak-sidecar";

interface GanttChartProps {
  tasks: Task[];
  dependencies: Dependency[];
  // Keyed by composite `${owner}:${id}` (see `taskProjectKey` below) so a
  // shared project and an own project with the same numeric id keep
  // distinct colors. Matches the pattern in /search, /experiments, /results.
  projectColors: Record<string, string>;
  projects: Project[];
  goals: HighLevelGoal[];
  onTaskClick: (taskKey: string) => void;
  onGoalClick: (goal: HighLevelGoal) => void;
  // Lab Mode props
  isLabMode?: boolean;
  userColors?: Map<string, string>; // username -> color mapping for lab mode
  onTaskClickLab?: (task: Task & { username?: string }) => void; // callback with full task for lab mode
}

// Composite key for project lookups inside the chart. Mirrors the helper
// in app/gantt/page.tsx where the projectColors map is built.
const taskProjectKey = (t: Pick<Task, "owner" | "project_id">) =>
  `${t.owner}:${t.project_id}`;

interface TaskPosition {
  left: number;
  width: number;
  top: number;
  height: number;
}

// Mutable ref to store task elements for position calculation.
// Keyed by composite (owner, id) string so shared tasks that share a numeric
// id with an own task don't clobber each other.
type TaskElementMap = Map<string, { element: HTMLDivElement; weekIdx: number; rowIdx: number; spanInfo: { startIdx: number; span: number } }>;

// Darker versions of project colors for experiments
const DARKER_EXPERIMENT_COLORS = [
  "#1e40af", // darker blue
  "#047857", // darker green
  "#b45309", // darker amber
  "#b91c1c", // darker red
  "#6d28d9", // darker purple
  "#be185d", // darker pink
  "#0e7490", // darker cyan
  "#4d7c0f", // darker lime
  "#c2410c", // darker orange
  "#4338ca", // darker indigo
];

// Helper to adjust color brightness (factor < 1 darkens, > 1 lightens)
function adjustColorBrightness(hexColor: string, factor: number): string {
  // Remove # if present
  const hex = hexColor.replace('#', '');
  
  // Parse RGB values
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  // Adjust each component
  const adjust = (value: number) => {
    const adjusted = Math.round(value * factor);
    return Math.max(0, Math.min(255, adjusted));
  };
  
  // Convert back to hex
  const toHex = (value: number) => value.toString(16).padStart(2, '0');
  
  return `#${toHex(adjust(r))}${toHex(adjust(g))}${toHex(adjust(b))}`;
}

// Helper to desaturate a color (mix with gray, factor 0 = fully gray, 1 = original color)
function desaturateColor(hexColor: string, factor: number): string {
  // Remove # if present
  const hex = hexColor.replace('#', '');
  
  // Parse RGB values
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  // Calculate grayscale equivalent (luminosity method)
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  
  // Mix original color with gray based on factor
  const mix = (original: number) => {
    return Math.round(original * factor + gray * (1 - factor));
  };
  
  // Convert back to hex
  const toHex = (value: number) => value.toString(16).padStart(2, '0');
  
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

// Helper to create a muted, lighter color for completed tasks
function getCompletedTaskColor(hexColor: string): { color: string; opacity: number } {
  // First desaturate (make more gray/dull)
  const desaturated = desaturateColor(hexColor, 0.4); // 60% gray mix
  // Then lighten
  const lightened = adjustColorBrightness(desaturated, 1.4);
  // Return with reduced opacity for subtle appearance
  return { color: lightened, opacity: 0.65 };
}

// Build dependency chains - groups of tasks that are connected by dependencies.
// Returns a map of taskKey -> chain info. Dependencies are loaded only from the
// current user's directory, so they only ever connect own (non-shared) tasks;
// shared tasks always appear as singleton chains here.
function buildDependencyChains(
  tasks: Task[],
  dependencies: Dependency[]
): Map<string, { chainId: number; positionInChain: number; chainTasks: Task[]; chainColor: string }> {
  const result = new Map<string, { chainId: number; positionInChain: number; chainTasks: Task[]; chainColor: string }>();

  if (tasks.length === 0) return result;

  // Dep parent_id/child_id are numeric ids in the current user's namespace.
  // Resolve them to composite keys via own (non-shared) tasks only.
  const ownTaskKeyById = new Map<number, string>();
  const taskByKey = new Map<string, Task>();
  for (const t of tasks) {
    taskByKey.set(taskKey(t), t);
    if (!t.is_shared_with_me) ownTaskKeyById.set(t.id, taskKey(t));
  }

  const parentMap = new Map<string, string[]>();
  const childMap = new Map<string, string[]>();

  dependencies.forEach(dep => {
    const pKey = ownTaskKeyById.get(dep.parent_id);
    const cKey = ownTaskKeyById.get(dep.child_id);
    if (!pKey || !cKey) return;
    if (!childMap.has(pKey)) childMap.set(pKey, []);
    childMap.get(pKey)!.push(cKey);
    if (!parentMap.has(cKey)) parentMap.set(cKey, []);
    parentMap.get(cKey)!.push(pKey);
  });

  // Find connected components using BFS
  const visited = new Set<string>();
  let chainId = 0;

  // Sort tasks by start date for consistent processing
  const sortedTasks = [...tasks].sort((a, b) => a.start_date.localeCompare(b.start_date));

  sortedTasks.forEach(task => {
    const tk = taskKey(task);
    if (visited.has(tk)) return;

    const chainKeys: string[] = [];
    const queue = [tk];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      chainKeys.push(current);

      const parents = parentMap.get(current) || [];
      const children = childMap.get(current) || [];

      [...parents, ...children].forEach(k => {
        if (taskByKey.has(k) && !visited.has(k)) {
          queue.push(k);
        }
      });
    }

    const chainTasks = chainKeys
      .map(k => taskByKey.get(k))
      .filter((t): t is Task => t !== undefined)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));

    const firstTask = chainTasks[0];
    const chainColor = firstTask?.experiment_color || DARKER_EXPERIMENT_COLORS[chainId % DARKER_EXPERIMENT_COLORS.length];

    chainTasks.forEach((t, positionInChain) => {
      result.set(taskKey(t), {
        chainId,
        positionInChain,
        chainTasks,
        chainColor,
      });
    });

    chainId++;
  });

  return result;
}

// Dynamic row assignment based on date conflicts
// Tasks are assigned to rows such that:
// 1. Top row is prioritized (first available)
// 2. Dependent tasks (same chain) are placed on the same row when possible
// 3. When conflicts occur (including within same chain), tasks shift to lower rows
// 4. Gap days between dependent tasks are reserved to prevent overlap with connection lines
function assignRowsDynamic(
  tasks: Task[],
  dependencies: Dependency[],
  dates: Date[]
): Map<string, number> {
  const rowAssignments = new Map<string, number>();

  if (tasks.length === 0) return rowAssignments;

  // Map dep numeric ids onto composite keys; only own (non-shared) tasks
  // participate in dependency-aware row packing since dependency records are
  // loaded only from the viewer's own directory.
  const ownTaskKeyById = new Map<number, string>();
  const taskByKey = new Map<string, Task>();
  for (const t of tasks) {
    taskByKey.set(taskKey(t), t);
    if (!t.is_shared_with_me) ownTaskKeyById.set(t.id, taskKey(t));
  }

  const childMap = new Map<string, string[]>();
  dependencies.forEach(dep => {
    const pKey = ownTaskKeyById.get(dep.parent_id);
    const cKey = ownTaskKeyById.get(dep.child_id);
    if (!pKey || !cKey) return;
    if (!childMap.has(pKey)) childMap.set(pKey, []);
    childMap.get(pKey)!.push(cKey);
  });

  // Track which rows are occupied on each day
  const dayOccupancy = new Map<string, Set<number>>();
  dates.forEach(d => {
    dayOccupancy.set(formatDate(d), new Set());
  });

  // Sort all tasks by start date (regardless of chain)
  const sortedTasks = [...tasks].sort((a, b) => a.start_date.localeCompare(b.start_date));

  sortedTasks.forEach(task => {
    const tk = taskKey(task);
    // Find all dates this task spans
    const taskDates: string[] = [];
    const taskStart = parseLocalDate(task.start_date);
    const taskEnd = parseLocalDate(task.end_date);
    for (let d = new Date(taskStart); d <= taskEnd; d.setDate(d.getDate() + 1)) {
      const ds = formatDate(d);
      if (dayOccupancy.has(ds)) {
        taskDates.push(ds);
      }
    }

    // Reserve gap days between this task and its dependent children so other
    // tasks don't overlap connector lines.
    const gapDates: string[] = [];
    const childKeys = childMap.get(tk) || [];
    childKeys.forEach(ck => {
      const childTask = taskByKey.get(ck);
      if (childTask) {
        const parentEnd = parseLocalDate(task.end_date);
        const childStart = parseLocalDate(childTask.start_date);
        const daysDiff = Math.round((childStart.getTime() - parentEnd.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff > 1) {
          for (let d = new Date(parentEnd); d < childStart; d.setDate(d.getDate() + 1)) {
            const ds = formatDate(d);
            if (dayOccupancy.has(ds) && !taskDates.includes(ds)) {
              gapDates.push(ds);
            }
          }
        }
      }
    });

    const allDates = [...taskDates, ...gapDates];

    let assignedRow = 0;
    const maxRows = 100;

    for (let row = 0; row < maxRows; row++) {
      const isAvailable = allDates.every(ds => {
        const occupancy = dayOccupancy.get(ds);
        return occupancy && !occupancy.has(row);
      });

      if (isAvailable) {
        assignedRow = row;
        break;
      }
    }

    rowAssignments.set(tk, assignedRow);

    allDates.forEach(ds => {
      dayOccupancy.get(ds)?.add(assignedRow);
    });
  });

  return rowAssignments;
}

// Helper to parse a date string (YYYY-MM-DD) as local date at midnight
function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Check if a date is a weekend
function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6;
}

// Generate array of dates for a given range - now strictly limited to weeksToShow
// If customStartDate is provided, use that as the start (must be a Monday)
function getDateRange(tasks: Task[], weeksToShow: number, customStartDate: string | null = null): Date[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  if (customStartDate) {
    // Use the custom start date (should be a Monday)
    const [year, month, day] = customStartDate.split('-').map(Number);
    start.setFullYear(year, month - 1, day);
  } else {
    // Start from the Monday of the current week (or today if it's Monday)
    start.setDate(start.getDate() - start.getDay() + 1); // Monday
    if (start.getDay() === 0) start.setDate(start.getDate() - 6); // Handle Sunday
  }

  // End exactly weeksToShow weeks out
  const end = new Date(start);
  end.setDate(end.getDate() + weeksToShow * 7 - 1); // -1 because we include the start day

  const dates: Date[] = [];
  const d = new Date(start);
  while (d <= end) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function formatDate(d: Date): string {
  // Use local date components to avoid timezone issues
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
}

function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Split dates into weeks (Mon-Sun)
function splitIntoWeeks(dates: Date[]): Date[][] {
  const weeks: Date[][] = [];
  let currentWeek: Date[] = [];
  for (const d of dates) {
    currentWeek.push(d);
    if (d.getDay() === 0 || d === dates[dates.length - 1]) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);
  return weeks;
}

// Calculate days remaining until goal end date
function getDaysLeft(endDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = parseLocalDate(endDate);
  const diffTime = end.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Get goals that overlap with a date range
function getGoalsForDateRange(
  goals: HighLevelGoal[],
  startDate: string,
  endDate: string
): HighLevelGoal[] {
  return goals.filter(
    (goal) => goal.start_date <= endDate && goal.end_date >= startDate
  );
}

// Get the span (number of days) a task covers within a week
// For non-7-day projects, weekends are shown but hashed/greyed
function getTaskSpanInWeek(
  task: Task, 
  weekDates: Date[], 
  project: Project | undefined,
  allDates: Date[]
): { 
  startIdx: number; 
  span: number; 
  weekendSegments?: { startIdx: number; span: number }[];
  extendsBeyondEnd?: boolean;
  extendsBeyondStart?: boolean;
} | null {
  const weekStart = formatDate(weekDates[0]);
  const weekEnd = formatDate(weekDates[weekDates.length - 1]);
  const visibleStart = formatDate(allDates[0]);
  const visibleEnd = formatDate(allDates[allDates.length - 1]);

  // Surface corrupted task data loudly instead of silently dropping the task.
  // end_date is supposed to be derived from start_date + duration_days; if it's
  // inverted, something upstream wrote a stale value. The reconcile pass in
  // fetchAllTasks heals these on next read, but warn here so a regression
  // doesn't go unnoticed in the meantime.
  if (task.end_date < task.start_date) {
    console.warn(
      `[GanttChart] task ${task.id} (${task.name}) has end_date ${task.end_date} < start_date ${task.start_date}; dropping from view`,
    );
  }

  // Task doesn't overlap this week at all
  if (task.end_date < weekStart || task.start_date > weekEnd) return null;

  // Check if task extends beyond visible range
  const extendsBeyondStart = task.start_date < visibleStart;
  const extendsBeyondEnd = task.end_date > visibleEnd;

  const startIdx = Math.max(
    0,
    weekDates.findIndex((d) => formatDate(d) >= task.start_date)
  );
  const endIdx = weekDates.findIndex((d) => formatDate(d) > task.end_date);
  const span = (endIdx === -1 ? weekDates.length : endIdx) - startIdx;

  if (span <= 0) return null;

  // If project is 7-day active or task has weekend override, no special weekend handling
  const is7Day = project?.weekend_active ?? false;
  const hasWeekendOverride = task.weekend_override ?? false;

  if (is7Day || hasWeekendOverride) {
    return { startIdx, span, extendsBeyondEnd, extendsBeyondStart };
  }

  // For non-7-day projects, identify weekend segments within the task span
  const weekendSegments: { startIdx: number; span: number }[] = [];
  let weekendStart = -1;
  let weekendCount = 0;

  for (let i = startIdx; i < startIdx + span; i++) {
    const d = weekDates[i];
    if (isWeekend(d)) {
      if (weekendStart === -1) weekendStart = i;
      weekendCount++;
    } else {
      if (weekendStart !== -1 && weekendCount > 0) {
        weekendSegments.push({ startIdx: weekendStart, span: weekendCount });
        weekendStart = -1;
        weekendCount = 0;
      }
    }
  }
  // Don't forget the last weekend segment
  if (weekendStart !== -1 && weekendCount > 0) {
    weekendSegments.push({ startIdx: weekendStart, span: weekendCount });
  }

  return { startIdx, span, weekendSegments, extendsBeyondEnd, extendsBeyondStart };
}

export default function GanttChart({
  tasks,
  dependencies,
  projectColors,
  projects,
  goals,
  onTaskClick,
  onGoalClick,
  isLabMode = false,
  userColors,
  onTaskClickLab,
}: GanttChartProps) {
  const queryClient = useQueryClient();
  const viewMode = useAppStore((s) => s.viewMode);
  const ganttStartDate = useAppStore((s) => s.ganttStartDate);
  const setIsCreatingTask = useAppStore((s) => s.setIsCreatingTask);
  const setNewTaskStartDate = useAppStore((s) => s.setNewTaskStartDate);
  const setGanttLoading = useAppStore((s) => s.setGanttLoading);
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [showShiftConfirm, setShowShiftConfirm] = useState(false);
  const [shiftResult, setShiftResult] = useState<ShiftResult | null>(null);
  const [pendingMove, setPendingMove] = useState<{ taskId: number; newDate: string; owner?: string } | null>(null);
  
  // Dependency popup state
  const [showDepPopup, setShowDepPopup] = useState(false);
  const [depParentTask, setDepParentTask] = useState<Task | null>(null);
  const [depChildTask, setDepChildTask] = useState<Task | null>(null);
  const [dragOverTask, setDragOverTask] = useState<Task | null>(null);
  
  // Goal hover state
  const [, setHoveredGoal] = useState<HighLevelGoal | null>(null);

  // ---- PTO (Streak Phase S4) ------------------------------------------
  // Load the active user's PTO list once per user-switch. Used for:
  //   1. Striped PTO overlay on day cells / headers (visual)
  //   2. Right-click "Mark / Unmark as PTO" context menu (mutation)
  //   3. (Indirectly) chain reschedule via tasksApi.move — that call site
  //      reads its own copy of pto_dates inside local-api.ts to avoid a
  //      prop-drilling round trip.
  // In lab mode the streak/PTO surface is hidden — lab mode is a
  // shared-view of other users' work and PTO is per-individual private.
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";
  const ptoQueryEnabled = !isLabMode && currentUser.length > 0;
  const { data: streakSidecar } = useQuery({
    queryKey: ["streak", currentUser],
    queryFn: () => readStreak(currentUser),
    enabled: ptoQueryEnabled,
  });
  // Memoize directly off streakSidecar so the dep array only changes
  // when the underlying sidecar object identity changes (react-query
  // returns a stable ref between fetches when the JSON is identical).
  // Set lookup is O(1) per day-render; the array would be O(n) per cell.
  const ptoSet = useMemo(
    () => new Set(streakSidecar?.pto_dates ?? []),
    [streakSidecar],
  );

  // Right-click context menu state. One menu at a time; click-outside
  // dismisses (effect below).
  const [ptoMenu, setPtoMenu] = useState<{
    date: string;
    x: number;
    y: number;
  } | null>(null);

  const handleDayContextMenu = useCallback(
    (e: React.MouseEvent, date: string) => {
      // Lab mode users don't own the underlying PTO list, so the right-click
      // affordance just stays out of their way. The native context menu
      // falls through (no preventDefault).
      if (isLabMode || !currentUser) return;
      e.preventDefault();
      setPtoMenu({ date, x: e.clientX, y: e.clientY });
    },
    [isLabMode, currentUser],
  );

  const closePtoMenu = useCallback(() => setPtoMenu(null), []);

  // Click-outside / Escape to dismiss the context menu.
  useEffect(() => {
    if (!ptoMenu) return;
    const onDocClick = () => closePtoMenu();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePtoMenu();
    };
    // Defer attaching the click handler one tick so the same click that
    // opened the menu doesn't immediately close it.
    const t = window.setTimeout(() => {
      document.addEventListener("click", onDocClick);
      document.addEventListener("contextmenu", onDocClick);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("contextmenu", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [ptoMenu, closePtoMenu]);

  const handlePtoToggle = useCallback(async () => {
    if (!ptoMenu || !currentUser) return;
    const target = ptoMenu.date;
    closePtoMenu();
    await patchStreak(currentUser, (cur) => {
      const isMarked = cur.pto_dates.includes(target);
      return {
        ...cur,
        pto_dates: isMarked
          ? cur.pto_dates.filter((d) => d !== target)
          : [...cur.pto_dates, target],
      };
    });
    // Invalidate so the new PTO list reflows visually (striped overlay)
    // and any in-flight chain reschedule pulls the updated list.
    await queryClient.invalidateQueries({ queryKey: ["streak", currentUser] });
  }, [ptoMenu, currentUser, queryClient, closePtoMenu]);

  // Use refs for task elements and positions to avoid render loops
  const taskElementsRef = useRef<TaskElementMap>(new Map());
  // Keyed by composite (owner, id) so two tasks with the same numeric id never
  // share a position entry.
  const [, setTaskPositions] = useState<Map<string, TaskPosition>>(new Map());
  const [, setContainerRect] = useState<DOMRect | null>(null);

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

  // Filter tasks for lab mode - exclude list tasks (must be before dates)
  // Also filter out tasks without valid dates to prevent crashes
  const filteredTasks = useMemo(() => {
    console.log("[GanttChart.filteredTasks] Input tasks:", tasks.length, "tasks:", tasks.map(t => ({ id: t.id, name: t.name, start: t.start_date, end: t.end_date, type: t.task_type })));
    
    const result = tasks.filter(t => t.start_date && t.end_date);
    console.log("[GanttChart.filteredTasks] After date filter:", result.length);
    
    if (!isLabMode) {
      console.log("[GanttChart.filteredTasks] Returning (non-lab mode):", result.length);
      return result;
    }
    const labResult = result.filter(t => t.task_type !== "list");
    console.log("[GanttChart.filteredTasks] Returning (lab mode):", labResult.length);
    return labResult;
  }, [tasks, isLabMode]);

  const dates = useMemo(() => getDateRange(filteredTasks, weeksToShow, ganttStartDate), [filteredTasks, weeksToShow, ganttStartDate]);
  const weeks = useMemo(() => splitIntoWeeks(dates), [dates]);

  const today = formatDate(new Date());

  // §6.8 onboarding-v4 cascade marker (v4 §6.8 cascade polish sub-bot
  // 2026-05-21): the chained-deps demo's third drag drops Demo A onto
  // this specific day so B + C visibly cascade. Stamp the date as
  // today + 7 days; at the default ~6-week zoom, this lands well past
  // the demo bars' start (today). Computed here (not at each cell)
  // so the marker resolves to ONE date across all renders, and the
  // selector inside the cursor script gets a unique element. Match by
  // date string equality below in the day-header render — header cells
  // render once per visible day, unlike row cells which render once
  // per row × day.
  const ganttLaterMarkerDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return formatDate(d);
  })();

  // Build dependency chains for grouping and coloring
  const chainInfo = useMemo(() => {
    return buildDependencyChains(filteredTasks, dependencies);
  }, [filteredTasks, dependencies]);

  // Dynamic row assignment based on date conflicts
  const rowAssignments = useMemo(() => {
    return assignRowsDynamic(filteredTasks, dependencies, dates);
  }, [filteredTasks, dependencies, dates]);

  // Sort tasks: high-level first, then by start date
  const sortedTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => {
      if (a.is_high_level && !b.is_high_level) return -1;
      if (!a.is_high_level && b.is_high_level) return 1;
      return a.start_date.localeCompare(b.start_date);
    });
  }, [filteredTasks]);

  // §6.8 onboarding-v4 walkthrough anchors. The chained-deps demo step
  // spawns three tasks named per `DEP_CHAIN_NAMES` ("BeakerBot Boil",
  // "BeakerBot Brew", "BeakerBot Sip") and the cursor script targets
  // them via `[data-tour-target='gantt-demo-bar-{0,1,2}']`. Match by
  // task name so the attrs only land on the demo bars (not arbitrary
  // user tasks). `gantt-first-task-bar` lands on the very first sorted
  // bar so the early Gantt step always has an anchor regardless of
  // whether the demo tasks exist yet.
  const DEMO_BAR_NAMES = ["BeakerBot Boil", "BeakerBot Brew", "BeakerBot Sip"];
  const demoBarIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of sortedTasks) {
      const idx = DEMO_BAR_NAMES.indexOf(t.name);
      if (idx >= 0 && !map.has(taskKey(t))) {
        map.set(taskKey(t), idx);
      }
    }
    return map;
  }, [sortedTasks]);
  const firstTaskKey = sortedTasks.length > 0 ? taskKey(sortedTasks[0]) : null;

  // Check if a task has dependents (children). Dependencies are loaded only
  // from the viewer's own directory, so a shared task never has dependents
  // here even if its numeric id collides with one of the viewer's own.
  const hasDependents = useCallback((task: Task) => {
    if (task.is_shared_with_me) return false;
    return dependencies.some(d => d.parent_id === task.id);
  }, [dependencies]);

  // Compute experiment colors based on dependency chains.
  // Returns a map of taskKey -> color for experiments. Keyed by composite key
  // so an own task and a shared task with the same numeric id never share an
  // entry (would otherwise cause one to "steal" the other's color).
  const experimentColors = useMemo(() => {
    const colorMap = new Map<string, string>();
    const experiments = tasks.filter(t => t.task_type === "experiment");

    if (experiments.length === 0) return colorMap;

    // Dependencies are only loaded for own tasks; map dep numeric ids to
    // composite keys via own (non-shared) experiments.
    const ownExpKeyById = new Map<number, string>();
    const expByKey = new Map<string, Task>();
    for (const e of experiments) {
      expByKey.set(taskKey(e), e);
      if (!e.is_shared_with_me) ownExpKeyById.set(e.id, taskKey(e));
    }

    const parentMap = new Map<string, string[]>();
    const childMap = new Map<string, string[]>();

    dependencies.forEach(dep => {
      const pKey = ownExpKeyById.get(dep.parent_id);
      const cKey = ownExpKeyById.get(dep.child_id);
      if (!pKey || !cKey) return;
      if (!parentMap.has(cKey)) parentMap.set(cKey, []);
      parentMap.get(cKey)!.push(pKey);
      if (!childMap.has(pKey)) childMap.set(pKey, []);
      childMap.get(pKey)!.push(cKey);
    });

    // Find all connected components (chains) using BFS
    const visited = new Set<string>();
    const chains: string[][] = [];

    experiments.forEach(exp => {
      const ek = taskKey(exp);
      if (visited.has(ek)) return;

      const chain: string[] = [];
      const queue = [ek];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        chain.push(current);

        const parents = parentMap.get(current) || [];
        parents.forEach(p => {
          if (!visited.has(p)) queue.push(p);
        });

        const children = childMap.get(current) || [];
        children.forEach(c => {
          if (!visited.has(c)) queue.push(c);
        });
      }

      if (chain.length > 0) {
        chains.push(chain);
      }
    });

    // Get colors currently in use by multi-experiment chains
    const chainColorsInUse = new Set<string>();
    chains.forEach(chain => {
      if (chain.length > 1) {
        const leftmostKey = chain.reduce((earliest, key) => {
          const exp = expByKey.get(key);
          const earliestExp = expByKey.get(earliest);
          if (!exp || !earliestExp) return earliest;
          return exp.start_date < earliestExp.start_date ? key : earliest;
        }, chain[0]);

        const leftmostTask = expByKey.get(leftmostKey);
        if (leftmostTask?.experiment_color) {
          chainColorsInUse.add(leftmostTask.experiment_color);
        }
      }
    });

    const availableColors = DARKER_EXPERIMENT_COLORS.filter(c => !chainColorsInUse.has(c));

    chains.forEach(chain => {
      const leftmostKey = chain.reduce((earliest, key) => {
        const exp = expByKey.get(key);
        const earliestExp = expByKey.get(earliest);
        if (!exp || !earliestExp) return earliest;
        return exp.start_date < earliestExp.start_date ? key : earliest;
      }, chain[0]);

      const leftmostTask = expByKey.get(leftmostKey);

      let chainColor: string;

      if (chain.length > 1) {
        if (leftmostTask?.experiment_color) {
          chainColor = leftmostTask.experiment_color;
        } else if (availableColors.length > 0) {
          chainColor = availableColors.shift()!;
        } else {
          const colorCounts = new Map<string, number>();
          DARKER_EXPERIMENT_COLORS.forEach(c => colorCounts.set(c, 0));
          colorMap.forEach(c => colorCounts.set(c, (colorCounts.get(c) || 0) + 1));

          let minCount = Infinity;
          let leastUsedColor = DARKER_EXPERIMENT_COLORS[0];
          colorCounts.forEach((count, color) => {
            if (count < minCount) {
              minCount = count;
              leastUsedColor = color;
            }
          });
          chainColor = leastUsedColor;
        }
      } else {
        if (availableColors.length > 0) {
          chainColor = availableColors.shift()!;
        } else {
          const colorCounts = new Map<string, number>();
          DARKER_EXPERIMENT_COLORS.forEach(c => colorCounts.set(c, 0));
          colorMap.forEach(c => colorCounts.set(c, (colorCounts.get(c) || 0) + 1));

          let minCount = Infinity;
          let leastUsedColor = DARKER_EXPERIMENT_COLORS[0];
          colorCounts.forEach((count, color) => {
            if (count < minCount) {
              minCount = count;
              leastUsedColor = color;
            }
          });
          chainColor = leastUsedColor;
        }
      }

      chain.forEach(key => {
        colorMap.set(key, chainColor);
      });
    });

    return colorMap;
  }, [tasks, dependencies]);

  // Effect to persist experiment colors back to the task when they change.
  // Use a ref to prevent infinite loops.
  // Skip in Lab Mode - it's a read-only view of other users' data.
  const isUpdatingColors = useRef(false);

  useEffect(() => {
    // Skip in lab mode - we don't write to other users' tasks
    if (isLabMode) return;
    
    // Skip if already updating
    if (isUpdatingColors.current) return;
    
    // Only update experiments that are owned by the current user (not shared with them)
    const ownedExperiments = tasks.filter(t => 
      t.task_type === "experiment" && !t.is_shared_with_me
    );
    
    // Check if any owned experiment needs a color update
    const needsUpdate = ownedExperiments.some(exp => {
      const computedColor = experimentColors.get(taskKey(exp));
      return computedColor && exp.experiment_color !== computedColor;
    });

    if (!needsUpdate) return;

    const updateColors = async () => {
      isUpdatingColors.current = true;
      const updates: Promise<unknown>[] = [];

      ownedExperiments.forEach(exp => {
        const computedColor = experimentColors.get(taskKey(exp));
        if (computedColor && exp.experiment_color !== computedColor) {
          updates.push(tasksApi.update(exp.id, { experiment_color: computedColor }));
        }
      });
      
      if (updates.length > 0) {
        try {
          await Promise.all(updates);
          // Refetch to refresh the tasks with new colors
          await queryClient.refetchQueries({ queryKey: ["tasks"] });
        } catch (err) {
          console.error("Failed to update experiment colors:", err);
        }
      }
      isUpdatingColors.current = false;
    };
    
    updateColors();
  }, [experimentColors, tasks, queryClient, isLabMode]);

  // Update container rect on resize
  useEffect(() => {
    const updateRect = () => {
      if (containerRef.current) {
        setContainerRect(containerRef.current.getBoundingClientRect());
      }
    };
    updateRect();
    window.addEventListener('resize', updateRect);
    return () => window.removeEventListener('resize', updateRect);
  }, []);

  // Calculate task positions after render using useLayoutEffect
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    
    const containerBounds = containerRef.current.getBoundingClientRect();
    const newPositions = new Map<string, TaskPosition>();

    taskElementsRef.current.forEach((data, tk) => {
      const taskBounds = data.element.getBoundingClientRect();
      newPositions.set(tk, {
        left: taskBounds.left - containerBounds.left,
        width: taskBounds.width,
        top: taskBounds.top - containerBounds.top,
        height: taskBounds.height,
      });
    });

    // eslint-disable-next-line react-hooks/set-state-in-effect -- measure DOM after render via useLayoutEffect; classic sync-to-DOM pattern
    setTaskPositions(newPositions);
  }, [tasks, weeks]); // Re-calculate when tasks or weeks change

  // Handle drag start
  const handleDragStart = useCallback((e: React.DragEvent, task: Task) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.id.toString());
  }, []);

  // Handle drag over a date cell
  const handleDragOver = useCallback((e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverDate(dateStr);
  }, []);

  // Handle drag leave
  const handleDragLeave = useCallback(() => {
    setDragOverDate(null);
  }, []);

  // Handle drop on a date cell
  const handleDrop = useCallback(async (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    setDragOverDate(null);
    
    if (!draggedTask) return;

    const taskId = draggedTask.id;
    const originalStart = draggedTask.start_date;

    // Don't do anything if dropped on the same start date
    if (originalStart === targetDate) {
      setDraggedTask(null);
      return;
    }

    // Show loading indicator
    setGanttLoading(true, "Moving task...");

    // If this is a shared task the user has edit permission on, route the
    // move (and its dependency cascade) through the owner's directory.
    const moveOwner =
      draggedTask.is_shared_with_me && draggedTask.shared_permission === "edit"
        ? draggedTask.owner
        : undefined;

    // Check if task has dependents
    if (hasDependents(draggedTask)) {
      // Try move with confirmation check
      try {
        const result = await tasksApi.move(taskId, {
          new_start_date: targetDate,
          confirmed: false,
        }, moveOwner);

        if (result.requires_confirmation) {
          setGanttLoading(false);
          setShiftResult(result);
          setPendingMove({ taskId, newDate: targetDate, owner: moveOwner });
          setShowShiftConfirm(true);
        } else {
          // No confirmation needed, refresh
          await queryClient.refetchQueries({ queryKey: ["tasks"] });
          setGanttLoading(false);
        }
      } catch {
        setGanttLoading(false);
        alert("Failed to move task");
      }
    } else {
      // No dependents, just move directly
      try {
        await tasksApi.move(taskId, {
          new_start_date: targetDate,
          confirmed: true,
        }, moveOwner);
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        setGanttLoading(false);
      } catch {
        setGanttLoading(false);
        alert("Failed to move task");
      }
    }

    setDraggedTask(null);
  }, [draggedTask, hasDependents, queryClient, setGanttLoading]);

  // Handle confirmed shift
  const handleConfirmShift = useCallback(async () => {
    if (!pendingMove) return;
    setGanttLoading(true, "Applying changes...");
    try {
      await tasksApi.move(pendingMove.taskId, {
        new_start_date: pendingMove.newDate,
        confirmed: true,
      }, pendingMove.owner);
      await Promise.all([
        await queryClient.refetchQueries({ queryKey: ["tasks"] }),
        await queryClient.refetchQueries({ queryKey: ["dependencies"] }),
      ]);
      setShowShiftConfirm(false);
      setShiftResult(null);
      setPendingMove(null);
      setGanttLoading(false);
    } catch {
      setGanttLoading(false);
      alert("Failed to move task");
    }
  }, [pendingMove, queryClient, setGanttLoading]);

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    setDraggedTask(null);
    setDragOverDate(null);
    setDragOverTask(null);
  }, []);

  // Handle drag over a task bar
  const handleDragOverTask = useCallback((e: React.DragEvent, task: Task) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTask(task);
    setDragOverDate(null); // Clear date highlight when over a task
  }, []);

  // Handle drop on a task bar - show dependency popup
  const handleDropOnTask = useCallback((e: React.DragEvent, targetTask: Task) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTask(null);

    if (!draggedTask || taskKey(draggedTask) === taskKey(targetTask)) {
      setDraggedTask(null);
      return;
    }
    
    // Show dependency popup
    setDepParentTask(targetTask); // The task being dropped ON is the parent
    setDepChildTask(draggedTask); // The dragged task is the child
    setShowDepPopup(true);
    setDraggedTask(null);
  }, [draggedTask]);

  // Handle creating dependency
  const handleCreateDependency = useCallback(async (depType: "SS" | "FS" | "SF") => {
    if (!depParentTask || !depChildTask) return;
    
    setGanttLoading(true, "Creating dependency...");
    
    try {
      // For SS (Start at Same time) dependencies, we allow multiple parents
      // to create sibling relationships. We only remove the reverse dependency
      // (if child→parent exists) to avoid cycles.
      if (depType === "SS") {
        // Remove any reverse dependency (child→parent) to avoid cycles
        const reverseDep = dependencies.find(
          (d) => d.parent_id === depChildTask.id && d.child_id === depParentTask.id
        );
        if (reverseDep) {
          await dependenciesApi.delete(reverseDep.id);
        }
        
        // Also remove any existing dependency where the new parent is a child of the new child
        // This handles the case where we're "promoting" a task up the chain
        // E.g., A → B → C, drag C to A with SS: we need to remove B → C
        const existingParentOfChild = dependencies.find(
          (d) => d.child_id === depChildTask.id && d.parent_id !== depParentTask.id
        );
        if (existingParentOfChild) {
          // Check if the existing parent is a descendant of the new parent
          // If so, we're moving the child UP the chain and should remove the old dependency
          const isDescendant = (ancestorId: number, descendantId: number): boolean => {
            const visited = new Set<number>();
            const queue = [ancestorId];
            while (queue.length > 0) {
              const current = queue.shift()!;
              if (current === descendantId) return true;
              if (visited.has(current)) continue;
              visited.add(current);
              dependencies
                .filter(d => d.parent_id === current)
                .forEach(d => {
                  if (!visited.has(d.child_id)) queue.push(d.child_id);
                });
            }
            return false;
          };
          
          if (isDescendant(depParentTask.id, existingParentOfChild.parent_id)) {
            // The existing parent is downstream of the new parent
            // Remove the old dependency so the child can move up
            await dependenciesApi.delete(existingParentOfChild.id);
          }
        }
      } else {
        // For FS and SF, use the original behavior: remove all existing parent dependencies
        const existingChildDeps = dependencies.filter(
          (d) => d.child_id === depChildTask.id
        );
        for (const dep of existingChildDeps) {
          await dependenciesApi.delete(dep.id);
        }
        // Also remove any reverse dependency (child→parent)
        const reverseDep = dependencies.find(
          (d) => d.parent_id === depChildTask.id && d.child_id === depParentTask.id
        );
        if (reverseDep) {
          await dependenciesApi.delete(reverseDep.id);
        }
      }

      // Create the dependency
      await dependenciesApi.create({
        parent_id: depParentTask.id,
        child_id: depChildTask.id,
        dep_type: depType,
      });
      
      // Calculate new start date for child task
      let newStartDate: string;
      if (depType === "FS") {
        // Start after parent ends
        const parentEnd = new Date(depParentTask.end_date);
        parentEnd.setDate(parentEnd.getDate() + 1);
        newStartDate = parentEnd.toISOString().split("T")[0];
      } else if (depType === "SS") {
        // Start at same time - ensure consistent date format
        const parentStart = new Date(depParentTask.start_date);
        newStartDate = parentStart.toISOString().split("T")[0];
      } else {
        // SF: Finish before parent starts
        const parentStart = new Date(depParentTask.start_date);
        parentStart.setDate(parentStart.getDate() - depChildTask.duration_days + 1);
        newStartDate = parentStart.toISOString().split("T")[0];
      }
      
      // Update child task start date
      await tasksApi.update(depChildTask.id, { start_date: newStartDate });
      
      await Promise.all([
        await queryClient.refetchQueries({ queryKey: ["tasks"] }),
        await queryClient.refetchQueries({ queryKey: ["dependencies"] }),
      ]);
      setShowDepPopup(false);
      setDepParentTask(null);
      setDepChildTask(null);
      setGanttLoading(false);
    } catch (err) {
      console.error("Failed to create dependency:", err);
      setGanttLoading(false);
      alert("Failed to create dependency");
    }
  }, [depParentTask, depChildTask, dependencies, queryClient, setGanttLoading]);

  // Register task element ref for position calculation
  const registerTaskElement = useCallback((tk: string, element: HTMLDivElement | null, weekIdx: number, rowIdx: number, spanInfo: { startIdx: number; span: number }) => {
    if (element) {
      taskElementsRef.current.set(tk, { element, weekIdx, rowIdx, spanInfo });
    } else {
      taskElementsRef.current.delete(tk);
    }
  }, []);

  // Handle double-click on empty space to create a new task
  const handleDoubleClick = useCallback((dateStr: string) => {
    setNewTaskStartDate(dateStr);
    setIsCreatingTask(true);
  }, [setNewTaskStartDate, setIsCreatingTask]);

  if (filteredTasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        {isLabMode 
          ? "No tasks to display. Tasks will appear here when users create them."
          : "No tasks to display. Create a project and add tasks to get started."}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-gray-50 p-4 relative" data-tour-target="gantt-timeline" ref={containerRef}>
      {/* Shift Confirmation Modal */}
      {showShiftConfirm && shiftResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h4 className="text-lg font-semibold text-orange-800 mb-2">
              This change will affect {shiftResult.affected_tasks.length} task(s)
            </h4>
            <p className="text-sm text-gray-600 mb-3">
              Moving this task will also shift its dependent tasks.
            </p>
            <div className="max-h-40 overflow-y-auto mb-3 bg-gray-50 rounded-lg p-3">
              <ul className="text-xs text-gray-700 space-y-1">
                {shiftResult.affected_tasks.map((t) => (
                  <li key={t.task_id} className="flex justify-between">
                    <span className="font-medium">{t.name}</span>
                    <span>{t.old_start} → {t.new_start}</span>
                  </li>
                ))}
              </ul>
            </div>
            {shiftResult.warnings.length > 0 && (
              <div className="mb-3 bg-red-50 rounded-lg p-3">
                <p className="text-xs font-medium text-red-700 mb-1">Warnings:</p>
                <ul className="text-xs text-red-600 space-y-1">
                  {shiftResult.warnings.map((w, i) => (
                    <li key={i}>{w.message}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowShiftConfirm(false);
                  setShiftResult(null);
                  setPendingMove(null);
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmShift}
                className="px-4 py-2 text-sm text-white bg-orange-600 hover:bg-orange-700 rounded-lg"
              >
                Apply Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dependency Creation Popup */}
      {showDepPopup && depParentTask && depChildTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-2">
              Create Dependency?
            </h4>
            <p className="text-sm text-gray-600 mb-4">
              <strong>{depChildTask.name}</strong> will be linked to <strong>{depParentTask.name}</strong>
            </p>
            <p className="text-xs text-gray-500 mb-4">
              How should these tasks be scheduled?
            </p>
            <div className="space-y-2">
              <button
                onClick={() => handleCreateDependency("SS")}
                className="w-full text-left px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <p className="text-sm font-medium text-blue-900">Start at same time</p>
                <p className="text-xs text-blue-600">Both tasks begin on the same day</p>
              </button>
              <button
                onClick={() => handleCreateDependency("FS")}
                className="w-full text-left px-4 py-3 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
              >
                <p className="text-sm font-medium text-green-900">Start after</p>
                <p className="text-xs text-green-600">{depChildTask.name} starts after {depParentTask.name} ends</p>
              </button>
              <button
                onClick={() => handleCreateDependency("SF")}
                className="w-full text-left px-4 py-3 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
              >
                <p className="text-sm font-medium text-purple-900">Finish before</p>
                <p className="text-xs text-purple-600">{depChildTask.name} finishes before {depParentTask.name} starts</p>
              </button>
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => {
                  setShowDepPopup(false);
                  setDepParentTask(null);
                  setDepChildTask(null);
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {weeks.map((weekDates, weekIdx) => {
        // Find tasks that appear in this week
        const weekStart = formatDate(weekDates[0]);
        const weekEnd = formatDate(weekDates[weekDates.length - 1]);
        const weekTasks = sortedTasks.filter(
          (t) => t.start_date <= weekEnd && t.end_date >= weekStart
        );

        if (weekTasks.length === 0 && weekIdx > weeksToShow) return null;

        const weekLabel = `${formatMonthLabel(weekDates[0])} – ${formatMonthLabel(weekDates[weekDates.length - 1])}`;

        return (
          <div key={weekIdx} className="mb-6 relative" style={{ zIndex: 1 }}>
            {/* Week header */}
            <div className="text-xs font-semibold text-gray-500 mb-2 px-1">
              {weekLabel}
            </div>

            {/* Goal bars - thin colored bars above date headers (hidden in lab mode) */}
            {!isLabMode && getGoalsForDateRange(goals, weekStart, weekEnd).length > 0 && (
              <div 
                className="relative mb-1"
                style={{ 
                  height: `${Math.max(1, getGoalsForDateRange(goals, weekStart, weekEnd).length) * 5 + 3}px` 
                }}
              >
                {(() => {
                  // Get unique goals for this week
                  const weekGoals = getGoalsForDateRange(goals, weekStart, weekEnd);
                  
                  // Calculate duration for each goal and sort by duration (longer first = lower)
                  const goalsWithDuration = weekGoals.map(goal => {
                    const goalStartIdx = weekDates.findIndex(wd => formatDate(wd) >= goal.start_date);
                    const goalEndIdx = weekDates.findIndex(wd => formatDate(wd) > goal.end_date);
                    const spanStart = Math.max(0, goalStartIdx === -1 ? 0 : goalStartIdx);
                    const spanEnd = goalEndIdx === -1 ? weekDates.length : goalEndIdx;
                    const span = spanEnd - spanStart;
                    
                    // Calculate total goal duration in days
                    const startDate = parseLocalDate(goal.start_date);
                    const endDate = parseLocalDate(goal.end_date);
                    const totalDuration = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                    
                    return {
                      goal,
                      spanStart,
                      span,
                      totalDuration,
                    };
                  }).filter(g => g.span > 0);
                  
                  // Sort by duration descending (longer goals go to lower rows)
                  goalsWithDuration.sort((a, b) => b.totalDuration - a.totalDuration);
                  
                  // Assign row positions (longer goals get higher row index = lower visually)
                  const rowPositions = new Map<number, number>();
                  goalsWithDuration.forEach((g, index) => {
                    rowPositions.set(g.goal.id, index);
                  });
                  
                  return goalsWithDuration.map(({ goal, spanStart, span }) => {
                    const row = rowPositions.get(goal.id) || 0;
                    const barHeight = 5; // Slightly wider for easier hover interaction
                    const barGap = 2; // gap between bars
                    const topOffset = row * (barHeight + barGap);
                    
                    const daysLeft = getDaysLeft(goal.end_date);
                    const isOverdue = daysLeft < 0;
                    const isUrgent = daysLeft >= 0 && daysLeft <= 3;
                    
                    return (
                      <div
                        key={`goal-${goal.id}`}
                        className="absolute rounded cursor-pointer transition-all hover:h-5 hover:z-10 group"
                        style={{
                          left: `${(spanStart / weekDates.length) * 100}%`,
                          width: `${(span / weekDates.length) * 100}%`,
                          top: `${topOffset}px`,
                          height: `${barHeight}px`,
                          backgroundColor: goal.color || '#f59e0b',
                          opacity: isOverdue ? 0.6 : 1,
                        }}
                        onClick={() => onGoalClick(goal)}
                        onMouseEnter={() => setHoveredGoal(goal)}
                        onMouseLeave={() => setHoveredGoal(null)}
                      >
                        {/* Hover tooltip */}
                        <div className="absolute left-0 top-full mt-1 bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
                          <div className="font-medium">{goal.name}</div>
                          <div className={isOverdue ? 'text-red-300' : isUrgent ? 'text-yellow-300' : 'text-gray-300'}>
                            {isOverdue 
                              ? `${Math.abs(daysLeft)} days overdue` 
                              : daysLeft === 0 
                              ? 'Due today!' 
                              : `${daysLeft} days left`}
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}

            {/* Day headers - also drop targets (disabled in lab mode) */}
            <div className="grid gap-px bg-gray-200 rounded-t-lg overflow-hidden"
              style={{ gridTemplateColumns: `repeat(${weekDates.length}, 1fr)` }}
            >
              {weekDates.map((d) => {
                const ds = formatDate(d);
                const isToday = ds === today;
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                const isPto = ptoSet.has(ds);
                const isDropTarget = !isLabMode && draggedTask && dragOverDate === ds;
                // §6.8 onboarding-v4 cascade marker (v4 §6.8 cascade
                // polish sub-bot 2026-05-21): exactly ONE header
                // (today + 7 days) gets the tour-target attr so the
                // chained-deps cursor has a stable, clearly-later
                // destination. Headers render once per visible date,
                // so this attr is unique across the chart. Guarded by
                // `!isLabMode` because the cascade demo only runs in
                // the user's own Gantt (the lab Gantt disables drag).
                const isLaterMarker =
                  !isLabMode && ds === ganttLaterMarkerDate;
                const headerEl = (
                  <div
                    onDragOver={isLabMode ? undefined : (e) => handleDragOver(e, ds)}
                    onDragLeave={isLabMode ? undefined : handleDragLeave}
                    onDrop={isLabMode ? undefined : (e) => handleDrop(e, ds)}
                    onContextMenu={(e) => handleDayContextMenu(e, ds)}
                    // Two testids per header. The generic one (day-header-X)
                    // gives PTO + Gantt tests a stable handle for ANY day;
                    // the pto-specific one is a faster filter for assertions
                    // that only care about PTO-marked headers.
                    data-testid={`day-header-${ds}`}
                    data-pto-header={isPto ? "true" : undefined}
                    data-tour-target={
                      isLaterMarker ? "gantt-later-date-marker" : undefined
                    }
                    className={`relative px-2 py-1.5 text-center text-xs font-medium transition-colors ${
                      isDropTarget
                        ? "bg-blue-200 text-blue-800"
                        : isToday
                        ? "bg-red-500 text-white"
                        : isWeekend
                        ? "bg-gray-100 text-gray-400"
                        : "bg-white text-gray-600"
                    }`}
                  >
                    {formatDayLabel(d)}
                    {/* PTO indicator: a small dot in the header. Counter-direction
                        stripes live on the cell body (below) so the header stays
                        legible at small viewports. */}
                    {isPto && !isToday && (
                      <span
                        aria-hidden="true"
                        className="absolute right-1 top-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-500"
                      />
                    )}
                  </div>
                );
                // Tooltip is appended only on PTO headers — adding it to every
                // day cell would be noise. Per Grant's standing rule we use
                // the <Tooltip> component, never native title=.
                return isPto ? (
                  <Tooltip
                    key={`header-${weekIdx}-${ds}`}
                    label="PTO — won't break your streak"
                    placement="top"
                  >
                    {headerEl}
                  </Tooltip>
                ) : (
                  <div key={`header-${weekIdx}-${ds}`}>{headerEl}</div>
                );
              })}
            </div>

            {/* Task rows - dynamic row assignment */}
            <div className="bg-white border border-gray-200 border-t-0 rounded-b-lg overflow-hidden relative">
              {weekTasks.length === 0 ? (
                <div
                  className="h-20 flex items-center justify-center text-xs text-gray-300 cursor-pointer hover:bg-gray-50"
                  onDoubleClick={isLabMode ? undefined : () => handleDoubleClick(weekStart)}
                >
                  {isLabMode ? "No tasks this week" : "Double-click to add a task"}
                </div>
              ) : (
                (() => {
                  // Group week tasks by their assigned row
                  const tasksByRow = new Map<number, Task[]>();
                  weekTasks.forEach(task => {
                    const row = rowAssignments.get(taskKey(task)) ?? 0;
                    if (!tasksByRow.has(row)) {
                      tasksByRow.set(row, []);
                    }
                    tasksByRow.get(row)!.push(task);
                  });
                  
                  // Sort tasks within each row by start date
                  tasksByRow.forEach(tasksInRow => {
                    tasksInRow.sort((a, b) => a.start_date.localeCompare(b.start_date));
                  });
                  
                  // Get all row numbers and sort them
                  const rowNumbers = Array.from(tasksByRow.keys()).sort((a, b) => a - b);
                  
                  // Render each row
                  return rowNumbers.map((rowNum) => {
                    const tasksInRow = tasksByRow.get(rowNum) || [];
                    
                    return (
                      <div
                        key={`row-${weekIdx}-${rowNum}`}
                        className="relative h-12 border-b border-gray-50 last:border-b-0"
                        style={{
                          display: "grid",
                          gridTemplateColumns: `repeat(${weekDates.length}, 1fr)`,
                        }}
                      >
                        {/* Background grid cells - also drop targets (disabled in lab mode) */}
                        {weekDates.map((d) => {
                          const ds = formatDate(d);
                          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                          const isPto = ptoSet.has(ds);
                          const isToday2 = ds === today;
                          const isDropTarget = !isLabMode && draggedTask && dragOverDate === ds;
                          return (
                            <div
                              key={`cell-${weekIdx}-row${rowNum}-${ds}`}
                              onDragOver={isLabMode ? undefined : (e) => handleDragOver(e, ds)}
                              onDragLeave={isLabMode ? undefined : handleDragLeave}
                              onDrop={isLabMode ? undefined : (e) => handleDrop(e, ds)}
                              onDoubleClick={isLabMode ? undefined : () => handleDoubleClick(ds)}
                              onContextMenu={(e) => handleDayContextMenu(e, ds)}
                              data-testid={isPto ? `pto-day-cell-${ds}` : undefined}
                              className={`relative border-r border-gray-50 last:border-r-0 transition-colors ${
                                isDropTarget ? "bg-blue-100" : ""
                              } ${isWeekend ? "bg-gray-50/50" : ""} ${
                                isPto ? "pto-day-cell" : ""
                              } ${
                                isToday2 ? "bg-red-50/30" : ""
                              }`}
                              // PTO uses -45deg sky-blue stripes; weekends use 45deg
                              // black/15 stripes elsewhere in the chart, so the two
                              // overlays are visually distinguishable when a PTO date
                              // happens to fall on a weekend.
                              style={
                                isPto
                                  ? {
                                      backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(14, 165, 233, 0.18) 3px, rgba(14, 165, 233, 0.18) 6px)`,
                                    }
                                  : undefined
                              }
                            />
                          );
                        })}

                        {/* Render all tasks in this row */}
                        {tasksInRow.map((task) => {
                          // For Gantt grouping + coloring, prefer the
                          // cross-owner host (Option C) when set: alex's
                          // task hosted into morgan's project takes morgan's
                          // project colour on her timeline, since "appearing
                          // here" is the relevant semantic. Falls back to
                          // (project_id, owner) match for normal tasks.
                          const ext = task.external_project;
                          const taskProject =
                            (ext
                              ? projects.find((p) => p.id === ext.id && p.owner === ext.owner)
                              : undefined) ||
                            projects.find(
                              (p) => p.id === task.project_id && p.owner === task.owner,
                            );
                          const spanInfo = getTaskSpanInWeek(task, weekDates, taskProject, dates);
                          if (!spanInfo) return null;
                          const tk = taskKey(task);
                          const taskWeekKey = `${tk}-w${weekIdx}-r${rowNum}`;

                          // Get chain info for this task
                          const taskChainInfo = chainInfo.get(tk);
                          const chainColor = taskChainInfo?.chainColor;
                          const positionInChain = taskChainInfo?.positionInChain ?? 0;
                          const chainTasks = taskChainInfo?.chainTasks || [task];

                          // Base color for the task
                          // In Lab Mode: use user colors instead of project colors
                          // For completed tasks, use a muted, lighter, semi-transparent version
                          let projectBaseColor: string;
                          if (isLabMode && userColors) {
                            // In lab mode, use user color (task has username property from lab API)
                            const taskWithUsername = task as Task & { username?: string };
                            projectBaseColor = userColors.get(taskWithUsername.username || '') || "#6b7280";
                          } else {
                            projectBaseColor = task.is_high_level
                              ? "#f59e0b"
                              : projectColors[taskProjectKey(task)] || "#3b82f6";
                          }
                          const completedStyle = task.is_complete
                            ? getCompletedTaskColor(projectBaseColor)
                            : null;
                          const baseColor = task.is_complete
                            ? completedStyle!.color
                            : projectBaseColor;
                          const completedOpacity = task.is_complete ? completedStyle!.opacity : 1;

                          // For experiments in a chain, we'll use the chain color as an accent
                          const isExperimentChain = task.task_type === "experiment" && chainTasks.length > 1;
                          
                          // Main task color is always the project color (or user color in lab mode)
                          const taskColor = baseColor;

                          const isTaskDragged = draggedTask !== null && taskKey(draggedTask) === tk;
                          // §6.8 walkthrough anchors (computed once per
                          // sortedTasks above). `demoBarIdx` only lands
                          // when the task name matches one of
                          // `DEP_CHAIN_NAMES`; `isFirstTaskBar` only
                          // lands on the first bar's first weekly slice.
                          // Guard both attrs with `weekIdx === 0` so a
                          // task spanning multiple weeks only emits the
                          // attr once (querySelector picks the first
                          // match, but duplicate attrs would confuse
                          // CSS selectors and screen readers).
                          const demoBarIdx =
                            weekIdx === 0 ? demoBarIndexByKey.get(tk) : undefined;
                          const isFirstTaskBar = firstTaskKey === tk && weekIdx === 0;
                          const tourTarget =
                            demoBarIdx !== undefined
                              ? `gantt-demo-bar-${demoBarIdx}`
                              : isFirstTaskBar
                                ? "gantt-first-task-bar"
                                : undefined;

                          return (
                            <div
                              key={taskWeekKey}
                              className="absolute inset-y-0"
                              style={{
                                left: `${(spanInfo.startIdx / weekDates.length) * 100}%`,
                                width: `${(spanInfo.span / weekDates.length) * 100}%`,
                              }}
                            >
                              {/* Task bar */}
                              <div
                                ref={(el) => registerTaskElement(tk, el, weekIdx, rowNum, spanInfo)}
                                data-tour-target={tourTarget}
                                draggable={!isLabMode}
                                onDragStart={isLabMode ? undefined : (e) => handleDragStart(e, task)}
                                onDragEnd={isLabMode ? undefined : handleDragEnd}
                                onDragOver={isLabMode ? undefined : (e) => handleDragOverTask(e, task)}
                                onDrop={isLabMode ? undefined : (e) => handleDropOnTask(e, task)}
                                onClick={() => {
                                  if (isLabMode && onTaskClickLab) {
                                    onTaskClickLab(task as Task & { username?: string });
                                  } else {
                                    onTaskClick(tk);
                                  }
                                }}
                                className={`absolute inset-x-0 top-1 bottom-1 rounded-lg cursor-pointer flex items-center px-3 text-white text-xs font-medium truncate shadow-sm hover:shadow-md transition-all overflow-hidden ${
                                  isTaskDragged ? "opacity-50 scale-95" : ""
                                } ${dragOverTask !== null && taskKey(dragOverTask) === tk ? "ring-2 ring-orange-400 ring-offset-1" : ""}`}
                                style={{
                                  backgroundColor: taskColor,
                                  opacity: task.is_high_level ? 0.6 : isTaskDragged ? 0.3 : task.is_complete ? completedOpacity : 1,
                                }}
                                title={`${task.name}\n${task.start_date} → ${task.end_date}${isLabMode ? "" : "\nDrag to reschedule, or drop on another task to create dependency"}`}
                              >
                                {/* Chain accent bar - top stripe showing chain color for all tasks in a chain */}
                                {chainColor && chainTasks.length > 1 && (
                                  <div
                                    className="absolute top-0 left-0 right-0 h-1"
                                    style={{
                                      backgroundColor: chainColor,
                                      opacity: 0.9,
                                    }}
                                  />
                                )}
                                
                                {/* Experiment accent bar - top stripe for standalone experiments (not in a chain) */}
                                {task.task_type === "experiment" && (!chainColor || chainTasks.length <= 1) && (
                                  <div
                                    className="absolute top-0 left-0 right-0 h-1"
                                    style={{
                                      backgroundColor: task.experiment_color || experimentColors.get(tk) || 'rgba(255, 255, 255, 0.5)',
                                      opacity: 0.9,
                                    }}
                                  />
                                )}
                                
                                {/* List task accent - left border with checklist icon on right */}
                                {task.task_type === "list" && (
                                  <>
                                    {/* Main left border - thicker and more prominent */}
                                    <div
                                      className="absolute top-0 bottom-0 left-0 w-2 rounded-l-lg"
                                      style={{
                                        backgroundColor: 'rgba(255, 255, 255, 0.6)',
                                      }}
                                    />
                                    {/* Checklist icon indicator - right side */}
                                    <div className="absolute top-0.5 right-1.5 text-[10px] opacity-80">
                                      ☰
                                    </div>
                                  </>
                                )}
                                
                                {/* Purchase task accent - diagonal stripe pattern on right side */}
                                {task.task_type === "purchase" && (
                                  <>
                                    {/* Shopping cart indicator - right side stripe pattern */}
                                    <div
                                      className="absolute top-0 bottom-0 right-0 w-5 rounded-r-lg"
                                      style={{
                                        background: `repeating-linear-gradient(
                                          -45deg,
                                          transparent,
                                          transparent 2px,
                                          rgba(255, 255, 255, 0.2) 2px,
                                          rgba(255, 255, 255, 0.2) 4px
                                        )`,
                                      }}
                                    />
                                    {/* Dollar sign indicator - bigger */}
                                    <div className="absolute top-0 right-1 text-xs opacity-70 font-bold">
                                      $
                                    </div>
                                  </>
                                )}
                                {/* Fade gradient for tasks extending beyond visible start */}
                                {spanInfo.extendsBeyondStart && (
                                  <div 
                                    className="absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-black/20 to-transparent pointer-events-none"
                                    style={{ borderRadius: '0.5rem 0 0 0.5rem' }}
                                  />
                                )}
                                
                                {/* Fade gradient for tasks extending beyond visible end */}
                                {spanInfo.extendsBeyondEnd && (
                                  <div 
                                    className="absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-black/20 to-transparent pointer-events-none"
                                    style={{ borderRadius: '0 0.5rem 0.5rem 0' }}
                                  />
                                )}
                                
                                {/* Weekend segments overlay (hashed/greyed) */}
                                {spanInfo.weekendSegments && spanInfo.weekendSegments.map((seg, segIdx) => (
                                  <div
                                    key={segIdx}
                                    className="absolute inset-y-0 pointer-events-none"
                                    style={{
                                      left: `${((seg.startIdx - spanInfo.startIdx) / spanInfo.span) * 100}%`,
                                      width: `${(seg.span / spanInfo.span) * 100}%`,
                                      background: `repeating-linear-gradient(
                                        45deg,
                                        transparent,
                                        transparent 2px,
                                        rgba(0, 0, 0, 0.15) 2px,
                                        rgba(0, 0, 0, 0.15) 4px
                                      )`,
                                      backgroundColor: 'rgba(150, 150, 150, 0.3)',
                                    }}
                                  />
                                ))}
                                
                                {/* Progress bar background - shows subtask completion */}
                                {(() => {
                                  // Calculate progress percentage
                                  let progressPercent = 0;
                                  if (task.is_complete) {
                                    progressPercent = 100;
                                  } else if (task.sub_tasks && task.sub_tasks.length > 0) {
                                    const completedCount = task.sub_tasks.filter(st => st.is_complete).length;
                                    progressPercent = Math.round((completedCount / task.sub_tasks.length) * 100);
                                  }
                                  
                                  if (progressPercent > 0 && !task.is_complete) {
                                    // For high-level tasks, use the task color; for others, use white overlay
                                    const progressBgColor = task.is_high_level
                                      ? adjustColorBrightness(taskColor, 1.3) // Lighter version of task color
                                      : 'rgba(255, 255, 255, 0.25)';
                                    
                                    return (
                                      <div 
                                        className="absolute inset-y-0 left-0 rounded-l-lg transition-all"
                                        style={{
                                          width: `${progressPercent}%`,
                                          backgroundColor: progressBgColor,
                                        }}
                                      />
                                    );
                                  }
                                  return null;
                                })()}
                                
                                {/* Chain indicator - colored dots showing chain membership */}
                                {isExperimentChain && chainTasks.length > 1 && chainColor && (
                                  <div className="absolute bottom-1 right-2 flex gap-0.5">
                                    {chainTasks.map((_, idx) => (
                                      <div
                                        key={idx}
                                        className="w-1.5 h-1.5 rounded-full"
                                        style={{
                                          backgroundColor: idx === positionInChain 
                                            ? chainColor
                                            : `${chainColor}60`,
                                        }}
                                      />
                                    ))}
                                  </div>
                                )}
                                
                                {/* Progress indicator - shows completion count for subtasks */}
                                {task.sub_tasks && task.sub_tasks.length > 0 && !task.is_complete && (
                                  <span className="absolute bottom-0.5 left-3 text-[9px] opacity-70 z-10">
                                    {task.sub_tasks.filter(st => st.is_complete).length}/{task.sub_tasks.length}
                                  </span>
                                )}
                                
                                <span className="truncate relative z-10">
                                  {/* Username indicator in lab mode */}
                                  {isLabMode && (() => {
                                    const taskWithUsername = task as Task & { username?: string };
                                    return taskWithUsername.username ? (
                                      <span className="mr-1 opacity-70">[{taskWithUsername.username.charAt(0).toUpperCase()}]</span>
                                    ) : null;
                                  })()}
                                  {/* Shared experiment owner initial indicator (non-lab mode) */}
                                  {!isLabMode && task.owner && (task.is_shared_with_me || (task.shared_with && task.shared_with.length > 0)) && (
                                    <span className="mr-1 opacity-70 text-[10px]" title={`Shared by: ${task.owner}`}>
                                      [{task.owner.charAt(0).toUpperCase()}]
                                    </span>
                                  )}
                                  {task.name}
                                </span>
                                {task.is_complete && (
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 flex-shrink-0 z-10 text-white/80">✓</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })()
              )}
            </div>
          </div>
        );
      })}

      {/* Drag hint - hidden in lab mode */}
      {!isLabMode && (
        <p className="text-xs text-gray-400 mt-3 text-center">
          Drag tasks to reschedule. Drop on another task to create a dependency. Double-click to create a new task.
        </p>
      )}
      {isLabMode && (
        <p className="text-xs text-gray-400 mt-3 text-center">
          Lab Mode: View-only. Tasks are colored by user.
        </p>
      )}
      
      {/* Loading overlay for operations */}
      <LoadingOverlay />

      {/* PTO right-click context menu (Streak Phase S4, proposal §6.4).
          Renders inside the chart container so absolute positioning anchors
          to clientX/clientY in viewport coords via position: fixed. */}
      {ptoMenu && (
        <div
          role="menu"
          data-testid="pto-context-menu"
          className="fixed z-50 min-w-[200px] rounded-md border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: ptoMenu.y, left: ptoMenu.x }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={handlePtoToggle}
            data-testid="pto-context-menu-toggle"
            className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-sky-50"
          >
            {ptoSet.has(ptoMenu.date)
              ? `Unmark ${ptoMenu.date} as PTO`
              : `Mark ${ptoMenu.date} as PTO`}
          </button>
        </div>
      )}
    </div>
  );
}
