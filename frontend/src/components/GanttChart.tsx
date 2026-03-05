"use client";

import { useCallback, useMemo, useRef, useState, useEffect, useLayoutEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { tasksApi, dependenciesApi } from "@/lib/api";
import type { Dependency, Task, ShiftResult, Project, HighLevelGoal } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import LoadingOverlay from "@/components/LoadingOverlay";

interface GanttChartProps {
  tasks: Task[];
  dependencies: Dependency[];
  projectColors: Record<number, string>;
  projects: Project[];
  goals: HighLevelGoal[];
  onTaskClick: (taskId: number) => void;
  onGoalClick: (goal: HighLevelGoal) => void;
  // Lab Mode props
  isLabMode?: boolean;
  userColors?: Map<string, string>; // username -> color mapping for lab mode
  onTaskClickLab?: (task: Task & { username?: string }) => void; // callback with full task for lab mode
}

interface TaskPosition {
  left: number;
  width: number;
  top: number;
  height: number;
}

// Mutable ref to store task elements for position calculation
type TaskElementMap = Map<number, { element: HTMLDivElement; weekIdx: number; rowIdx: number; spanInfo: { startIdx: number; span: number } }>;

// Interface for row assignment
interface TaskRowAssignment {
  taskId: number;
  row: number;
  chainId: number; // Which chain this task belongs to
  positionInChain: number; // Position within the chain (0 = first, 1 = second, etc.)
}

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

// Helper to get darker color for experiments
function getDarkerColor(index: number): string {
  return DARKER_EXPERIMENT_COLORS[index % DARKER_EXPERIMENT_COLORS.length];
}

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

// Build dependency chains - groups of tasks that are connected by dependencies
// Returns a map of task_id -> { chainId, positionInChain, chainTasks, chainColor }
function buildDependencyChains(
  tasks: Task[], 
  dependencies: Dependency[]
): Map<number, { chainId: number; positionInChain: number; chainTasks: Task[]; chainColor: string }> {
  const result = new Map<number, { chainId: number; positionInChain: number; chainTasks: Task[]; chainColor: string }>();
  
  if (tasks.length === 0) return result;
  
  // Build parent/child maps
  const parentMap = new Map<number, number[]>();
  const childMap = new Map<number, number[]>();
  const taskIds = new Set(tasks.map(t => t.id));
  
  dependencies.forEach(dep => {
    if (taskIds.has(dep.parent_id) && taskIds.has(dep.child_id)) {
      if (!childMap.has(dep.parent_id)) childMap.set(dep.parent_id, []);
      childMap.get(dep.parent_id)!.push(dep.child_id);
      
      if (!parentMap.has(dep.child_id)) parentMap.set(dep.child_id, []);
      parentMap.get(dep.child_id)!.push(dep.parent_id);
    }
  });
  
  // Find connected components using BFS
  const visited = new Set<number>();
  let chainId = 0;
  
  // Sort tasks by start date for consistent processing
  const sortedTasks = [...tasks].sort((a, b) => a.start_date.localeCompare(b.start_date));
  
  sortedTasks.forEach(task => {
    if (visited.has(task.id)) return;
    
    // BFS to find all connected tasks
    const chainTaskIds: number[] = [];
    const queue = [task.id];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      chainTaskIds.push(current);
      
      // Add parents and children
      const parents = parentMap.get(current) || [];
      const children = childMap.get(current) || [];
      
      [...parents, ...children].forEach(id => {
        if (taskIds.has(id) && !visited.has(id)) {
          queue.push(id);
        }
      });
    }
    
    // Get actual task objects and sort by start date
    const chainTasks = chainTaskIds
      .map(id => tasks.find(t => t.id === id))
      .filter((t): t is Task => t !== undefined)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    
    // Assign chain color based on the first task's experiment color or generate one
    const firstTask = chainTasks[0];
    const chainColor = firstTask?.experiment_color || DARKER_EXPERIMENT_COLORS[chainId % DARKER_EXPERIMENT_COLORS.length];
    
    // Store result for each task in the chain
    chainTasks.forEach((t, positionInChain) => {
      result.set(t.id, {
        chainId,
        positionInChain,
        chainTasks,
        chainColor
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
): Map<number, number> {
  const rowAssignments = new Map<number, number>();
  
  if (tasks.length === 0) return rowAssignments;
  
  // Build dependency chains
  const chainInfo = buildDependencyChains(tasks, dependencies);
  
  // Build a map of task_id -> its dependent child tasks
  const childMap = new Map<number, number[]>();
  const taskIds = new Set(tasks.map(t => t.id));
  dependencies.forEach(dep => {
    if (taskIds.has(dep.parent_id) && taskIds.has(dep.child_id)) {
      if (!childMap.has(dep.parent_id)) childMap.set(dep.parent_id, []);
      childMap.get(dep.parent_id)!.push(dep.child_id);
    }
  });
  
  // Track which rows are occupied on each day
  // date_str -> Set of occupied rows
  const dayOccupancy = new Map<string, Set<number>>();
  dates.forEach(d => {
    dayOccupancy.set(formatDate(d), new Set());
  });
  
  // Sort all tasks by start date (regardless of chain)
  const sortedTasks = [...tasks].sort((a, b) => a.start_date.localeCompare(b.start_date));
  
  // Process each task individually, checking for conflicts
  sortedTasks.forEach(task => {
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
    
    // Also include gap days between this task and its dependent children
    // These gap days should be reserved to prevent other tasks from overlapping with connection lines
    const gapDates: string[] = [];
    const children = childMap.get(task.id) || [];
    children.forEach(childId => {
      const childTask = tasks.find(t => t.id === childId);
      if (childTask) {
        // Gap is from day after parent ends to day before child starts
        const parentEnd = parseLocalDate(task.end_date);
        const childStart = parseLocalDate(childTask.start_date);
        // Only reserve gap if it's more than 1 day (otherwise no line is drawn)
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
    
    // Find the first row that's available for ALL dates of this task (including gap dates)
    let assignedRow = 0;
    const maxRows = 100; // Safety limit
    
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
    
    // Assign this row to the task
    rowAssignments.set(task.id, assignedRow);
    
    // Mark all dates as occupied (including gap dates)
    allDates.forEach(ds => {
      dayOccupancy.get(ds)?.add(assignedRow);
    });
  });
  
  return rowAssignments;
}

// Helper to parse a date string (YYYY-MM-DD) as local date at midnight
function parseLocalDate(dateStr: string): Date {
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
  const [pendingMove, setPendingMove] = useState<{ taskId: number; newDate: string } | null>(null);
  
  // Dependency popup state
  const [showDepPopup, setShowDepPopup] = useState(false);
  const [depParentTask, setDepParentTask] = useState<Task | null>(null);
  const [depChildTask, setDepChildTask] = useState<Task | null>(null);
  const [dragOverTask, setDragOverTask] = useState<Task | null>(null);
  
  // Goal hover state
  const [hoveredGoal, setHoveredGoal] = useState<HighLevelGoal | null>(null);
  
  // Use refs for task elements and positions to avoid render loops
  const taskElementsRef = useRef<TaskElementMap>(new Map());
  const [taskPositions, setTaskPositions] = useState<Map<number, TaskPosition>>(new Map());
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);

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
  const filteredTasks = useMemo(() => {
    if (!isLabMode) return tasks;
    return tasks.filter(t => t.task_type !== "list");
  }, [tasks, isLabMode]);

  const dates = useMemo(() => getDateRange(filteredTasks, weeksToShow, ganttStartDate), [filteredTasks, weeksToShow, ganttStartDate]);
  const weeks = useMemo(() => splitIntoWeeks(dates), [dates]);

  const today = formatDate(new Date());

  // Build dependency chains for grouping and coloring
  const chainInfo = useMemo(() => {
    return buildDependencyChains(filteredTasks, dependencies);
  }, [filteredTasks, dependencies]);

  // Dynamic row assignment based on date conflicts
  const rowAssignments = useMemo(() => {
    return assignRowsDynamic(filteredTasks, dependencies, dates);
  }, [filteredTasks, dependencies, dates]);

  // Get the maximum row number for rendering
  const maxRow = useMemo(() => {
    let max = 0;
    rowAssignments.forEach(row => {
      if (row > max) max = row;
    });
    return max;
  }, [rowAssignments]);

  // Sort tasks: high-level first, then by start date
  const sortedTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => {
      if (a.is_high_level && !b.is_high_level) return -1;
      if (!a.is_high_level && b.is_high_level) return 1;
      return a.start_date.localeCompare(b.start_date);
    });
  }, [filteredTasks]);

  // Get dependencies that involve visible tasks
  const visibleDependencies = useMemo(() => {
    const taskIds = new Set(filteredTasks.map(t => t.id));
    return dependencies.filter(d => taskIds.has(d.parent_id) && taskIds.has(d.child_id));
  }, [dependencies, filteredTasks]);

  // Check if a task has dependents (children)
  const hasDependents = useCallback((taskId: number) => {
    return dependencies.some(d => d.parent_id === taskId);
  }, [dependencies]);

  // Compute experiment colors based on dependency chains
  // Returns a map of task_id -> color for experiments
  const experimentColors = useMemo(() => {
    const colorMap = new Map<number, string>();
    const experiments = tasks.filter(t => t.task_type === "experiment");
    
    if (experiments.length === 0) return colorMap;

    // Build dependency graph for experiments only
    const experimentIds = new Set(experiments.map(e => e.id));
    const parentMap = new Map<number, number[]>(); // task_id -> array of parent task_ids
    const childMap = new Map<number, number[]>();  // task_id -> array of child task_ids
    
    dependencies.forEach(dep => {
      if (experimentIds.has(dep.parent_id) && experimentIds.has(dep.child_id)) {
        if (!parentMap.has(dep.child_id)) parentMap.set(dep.child_id, []);
        parentMap.get(dep.child_id)!.push(dep.parent_id);
        
        if (!childMap.has(dep.parent_id)) childMap.set(dep.parent_id, []);
        childMap.get(dep.parent_id)!.push(dep.child_id);
      }
    });

    // Find all connected components (chains) using BFS
    const visited = new Set<number>();
    const chains: number[][] = [];
    
    experiments.forEach(exp => {
      if (visited.has(exp.id)) return;
      
      // BFS to find all connected experiments
      const chain: number[] = [];
      const queue = [exp.id];
      
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        chain.push(current);
        
        // Add parents
        const parents = parentMap.get(current) || [];
        parents.forEach(p => {
          if (!visited.has(p)) queue.push(p);
        });
        
        // Add children
        const children = childMap.get(current) || [];
        children.forEach(c => {
          if (!visited.has(c)) queue.push(c);
        });
      }
      
      if (chain.length > 0) {
        chains.push(chain);
      }
    });

    // Get colors currently in use by chains (multi-experiment chains only)
    const chainColorsInUse = new Set<string>();
    chains.forEach(chain => {
      if (chain.length > 1) {
        // This is a multi-experiment chain, find its color
        const leftmostExp = chain.reduce((earliest, id) => {
          const exp = experiments.find(e => e.id === id);
          const earliestExp = experiments.find(e => e.id === earliest);
          if (!exp || !earliestExp) return earliest;
          return exp.start_date < earliestExp.start_date ? id : earliest;
        }, chain[0]);
        
        const leftmostTask = experiments.find(e => e.id === leftmostExp);
        if (leftmostTask?.experiment_color) {
          chainColorsInUse.add(leftmostTask.experiment_color);
        }
      }
    });

    // Find available colors (not currently used by chains)
    let availableColors = DARKER_EXPERIMENT_COLORS.filter(c => !chainColorsInUse.has(c));
    
    // Assign colors to each chain
    chains.forEach(chain => {
      // Find the leftmost experiment (earliest start date)
      const leftmostExp = chain.reduce((earliest, id) => {
        const exp = experiments.find(e => e.id === id);
        const earliestExp = experiments.find(e => e.id === earliest);
        if (!exp || !earliestExp) return earliest;
        return exp.start_date < earliestExp.start_date ? id : earliest;
      }, chain[0]);
      
      const leftmostTask = experiments.find(e => e.id === leftmostExp);
      
      // Determine the color for this chain
      let chainColor: string;
      
      if (chain.length > 1) {
        // Multi-experiment chain: use existing color or assign new
        if (leftmostTask?.experiment_color) {
          chainColor = leftmostTask.experiment_color;
        } else if (availableColors.length > 0) {
          chainColor = availableColors.shift()!;
        } else {
          // All colors are used, pick the least used color
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
        // Standalone experiment: always assign a new unique color
        if (availableColors.length > 0) {
          chainColor = availableColors.shift()!;
        } else {
          // All colors are used, pick the least used color
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
      
      // Assign the color to all experiments in the chain
      chain.forEach(id => {
        colorMap.set(id, chainColor);
      });
    });

    return colorMap;
  }, [tasks, dependencies]);

  // Effect to update experiment colors in the backend when they change
  // Use a ref to prevent infinite loops
  // Skip in Lab Mode - we don't update anything in the backend
  const isUpdatingColors = useRef(false);
  
  useEffect(() => {
    // Skip in lab mode - no backend updates
    if (isLabMode) return;
    
    // Skip if already updating
    if (isUpdatingColors.current) return;
    
    const experiments = tasks.filter(t => t.task_type === "experiment");
    
    // Check if any experiment needs a color update
    const needsUpdate = experiments.some(exp => {
      const computedColor = experimentColors.get(exp.id);
      return computedColor && exp.experiment_color !== computedColor;
    });
    
    if (!needsUpdate) return;
    
    const updateColors = async () => {
      isUpdatingColors.current = true;
      const updates: Promise<unknown>[] = [];
      
      experiments.forEach(exp => {
        const computedColor = experimentColors.get(exp.id);
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
    const newPositions = new Map<number, TaskPosition>();
    
    taskElementsRef.current.forEach((data, taskId) => {
      const taskBounds = data.element.getBoundingClientRect();
      newPositions.set(taskId, {
        left: taskBounds.left - containerBounds.left,
        width: taskBounds.width,
        top: taskBounds.top - containerBounds.top,
        height: taskBounds.height,
      });
    });
    
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

    // Check if task has dependents
    if (hasDependents(taskId)) {
      // Try move with confirmation check
      try {
        const result = await tasksApi.move(taskId, {
          new_start_date: targetDate,
          confirmed: false,
        });

        if (result.requires_confirmation) {
          setGanttLoading(false);
          setShiftResult(result);
          setPendingMove({ taskId, newDate: targetDate });
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
        });
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
      });
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
    
    if (!draggedTask || draggedTask.id === targetTask.id) {
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
  const registerTaskElement = useCallback((taskId: number, element: HTMLDivElement | null, weekIdx: number, rowIdx: number, spanInfo: { startIdx: number; span: number }) => {
    if (element) {
      taskElementsRef.current.set(taskId, { element, weekIdx, rowIdx, spanInfo });
    } else {
      taskElementsRef.current.delete(taskId);
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
    <div className="flex-1 overflow-auto bg-gray-50 p-4 relative" ref={containerRef}>
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
                const isDropTarget = !isLabMode && draggedTask && dragOverDate === ds;
                return (
                  <div
                    key={`header-${weekIdx}-${ds}`}
                    onDragOver={isLabMode ? undefined : (e) => handleDragOver(e, ds)}
                    onDragLeave={isLabMode ? undefined : handleDragLeave}
                    onDrop={isLabMode ? undefined : (e) => handleDrop(e, ds)}
                    className={`px-2 py-1.5 text-center text-xs font-medium transition-colors ${
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
                  </div>
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
                    const row = rowAssignments.get(task.id) ?? 0;
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
                          const isToday2 = ds === today;
                          const isDropTarget = !isLabMode && draggedTask && dragOverDate === ds;
                          return (
                            <div
                              key={`cell-${weekIdx}-row${rowNum}-${ds}`}
                              onDragOver={isLabMode ? undefined : (e) => handleDragOver(e, ds)}
                              onDragLeave={isLabMode ? undefined : handleDragLeave}
                              onDrop={isLabMode ? undefined : (e) => handleDrop(e, ds)}
                              onDoubleClick={isLabMode ? undefined : () => handleDoubleClick(ds)}
                              className={`border-r border-gray-50 last:border-r-0 transition-colors ${
                                isDropTarget ? "bg-blue-100" : ""
                              } ${isWeekend ? "bg-gray-50/50" : ""} ${
                                isToday2 ? "bg-red-50/30" : ""
                              }`}
                            />
                          );
                        })}

                        {/* Render all tasks in this row */}
                        {tasksInRow.map((task, taskIdxInRow) => {
                          const taskProject = projects.find(p => p.id === task.project_id);
                          const spanInfo = getTaskSpanInWeek(task, weekDates, taskProject, dates);
                          if (!spanInfo) return null;
                          const taskWeekKey = `${task.id}-w${weekIdx}-r${rowNum}`;

                          // Get chain info for this task
                          const taskChainInfo = chainInfo.get(task.id);
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
                              : projectColors[task.project_id] || "#3b82f6";
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

                          const isTaskDragged = draggedTask?.id === task.id;

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
                                ref={(el) => registerTaskElement(task.id, el, weekIdx, rowNum, spanInfo)}
                                draggable={!isLabMode}
                                onDragStart={isLabMode ? undefined : (e) => handleDragStart(e, task)}
                                onDragEnd={isLabMode ? undefined : handleDragEnd}
                                onDragOver={isLabMode ? undefined : (e) => handleDragOverTask(e, task)}
                                onDrop={isLabMode ? undefined : (e) => handleDropOnTask(e, task)}
                                onClick={() => {
                                  if (isLabMode && onTaskClickLab) {
                                    onTaskClickLab(task as Task & { username?: string });
                                  } else {
                                    onTaskClick(task.id);
                                  }
                                }}
                                className={`absolute inset-x-0 top-1 bottom-1 rounded-lg cursor-pointer flex items-center px-3 text-white text-xs font-medium truncate shadow-sm hover:shadow-md transition-all overflow-hidden ${
                                  isTaskDragged ? "opacity-50 scale-95" : ""
                                } ${dragOverTask?.id === task.id ? "ring-2 ring-orange-400 ring-offset-1" : ""}`}
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
                                      backgroundColor: task.experiment_color || experimentColors.get(task.id) || 'rgba(255, 255, 255, 0.5)',
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
                                  {!isLabMode && task.shared_with && task.shared_with.length > 0 && task.owner && (
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
    </div>
  );
}
