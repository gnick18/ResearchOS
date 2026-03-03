"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import { LabTask, LabUser, LabProject } from "@/lib/api";
import { useAppStore } from "@/lib/store";

interface LabGanttChartProps {
  tasks: LabTask[];
  users: LabUser[];
  projects: LabProject[];
  selectedUsernames: Set<string>;
  onTaskClick: (task: LabTask) => void;
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

// Generate array of dates for a given range
function getDateRange(weeksToShow: number, customStartDate: string | null = null): Date[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  if (customStartDate) {
    const [year, month, day] = customStartDate.split('-').map(Number);
    start.setFullYear(year, month - 1, day);
  } else {
    start.setDate(start.getDate() - start.getDay() + 1);
    if (start.getDay() === 0) start.setDate(start.getDate() - 6);
  }

  const end = new Date(start);
  end.setDate(end.getDate() + weeksToShow * 7 - 1);

  const dates: Date[] = [];
  const d = new Date(start);
  while (d <= end) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function formatDate(d: Date): string {
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

// Get the span (number of days) a task covers within a week
function getTaskSpanInWeek(
  task: LabTask,
  weekDates: Date[],
  allDates: Date[]
): {
  startIdx: number;
  span: number;
  extendsBeyondEnd?: boolean;
  extendsBeyondStart?: boolean;
} | null {
  const weekStart = formatDate(weekDates[0]);
  const weekEnd = formatDate(weekDates[weekDates.length - 1]);
  const visibleStart = formatDate(allDates[0]);
  const visibleEnd = formatDate(allDates[allDates.length - 1]);

  if (task.end_date < weekStart || task.start_date > weekEnd) return null;

  const extendsBeyondStart = task.start_date < visibleStart;
  const extendsBeyondEnd = task.end_date > visibleEnd;

  const startIdx = Math.max(
    0,
    weekDates.findIndex((d) => formatDate(d) >= task.start_date)
  );
  const endIdx = weekDates.findIndex((d) => formatDate(d) > task.end_date);
  const span = (endIdx === -1 ? weekDates.length : endIdx) - startIdx;

  if (span <= 0) return null;

  return { startIdx, span, extendsBeyondEnd, extendsBeyondStart };
}

// Dynamic row assignment based on date conflicts
function assignRowsDynamic(tasks: LabTask[], dates: Date[]): Map<number, number> {
  const rowAssignments = new Map<number, number>();

  if (tasks.length === 0) return rowAssignments;

  // Track which rows are occupied on each day
  const dayOccupancy = new Map<string, Set<number>>();
  dates.forEach(d => {
    dayOccupancy.set(formatDate(d), new Set());
  });

  // Sort all tasks by start date
  const sortedTasks = [...tasks].sort((a, b) => a.start_date.localeCompare(b.start_date));

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

    // Find the first available row
    let assignedRow = 0;
    const maxRows = 100;

    for (let row = 0; row < maxRows; row++) {
      const isAvailable = taskDates.every(ds => {
        const occupancy = dayOccupancy.get(ds);
        return occupancy && !occupancy.has(row);
      });

      if (isAvailable) {
        assignedRow = row;
        break;
      }
    }

    rowAssignments.set(task.id, assignedRow);

    taskDates.forEach(ds => {
      dayOccupancy.get(ds)?.add(assignedRow);
    });
  });

  return rowAssignments;
}

// Helper to adjust color brightness
function adjustColorBrightness(hexColor: string, factor: number): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  const adjust = (value: number) => {
    const adjusted = Math.round(value * factor);
    return Math.max(0, Math.min(255, adjusted));
  };

  const toHex = (value: number) => value.toString(16).padStart(2, '0');

  return `#${toHex(adjust(r))}${toHex(adjust(g))}${toHex(adjust(b))}`;
}

// Helper to desaturate a color
function desaturateColor(hexColor: string, factor: number): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

  const mix = (original: number) => {
    return Math.round(original * factor + gray * (1 - factor));
  };

  const toHex = (value: number) => value.toString(16).padStart(2, '0');

  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

// Helper to create a muted, lighter color for completed tasks
function getCompletedTaskColor(hexColor: string): { color: string; opacity: number } {
  const desaturated = desaturateColor(hexColor, 0.4);
  const lightened = adjustColorBrightness(desaturated, 1.4);
  return { color: lightened, opacity: 0.65 };
}

export default function LabGanttChart({
  tasks,
  users,
  projects,
  selectedUsernames,
  onTaskClick,
}: LabGanttChartProps) {
  const viewMode = useAppStore((s) => s.viewMode);
  const ganttStartDate = useAppStore((s) => s.ganttStartDate);

  // Debug logging
  useEffect(() => {
    console.log("LabGanttChart - Props received:", {
      tasksCount: tasks?.length || 0,
      usersCount: users?.length || 0,
      projectsCount: projects?.length || 0,
      selectedUsernamesSize: selectedUsernames?.size || 0,
      selectedUsernames: selectedUsernames ? Array.from(selectedUsernames) : [],
      firstTask: tasks?.[0],
      users: users?.map(u => ({ username: u.username, color: u.color })),
    });
  }, [tasks, users, projects, selectedUsernames]);

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

  const dates = useMemo(() => getDateRange(weeksToShow, ganttStartDate), [weeksToShow, ganttStartDate]);
  const weeks = useMemo(() => splitIntoWeeks(dates), [dates]);

  // Debug date range
  useEffect(() => {
    if (dates.length > 0) {
      console.log("LabGanttChart - Date range:", {
        startDate: dates[0] ? formatDate(dates[0]) : 'N/A',
        endDate: dates[dates.length - 1] ? formatDate(dates[dates.length - 1]) : 'N/A',
        weeksCount: weeks.length,
        weeksToShow,
        ganttStartDate,
        viewMode,
      });
    }
  }, [dates, weeks, weeksToShow, ganttStartDate, viewMode]);

  const today = formatDate(new Date());

  // Filter tasks by selected users and exclude list tasks
  const filteredTasks = useMemo(() => {
    const result = tasks.filter(t => 
      selectedUsernames.has(t.username) && 
      t.task_type !== "list" // Hide list tasks from GANTT
    );
    console.log("LabGanttChart - Filtering tasks:", {
      totalTasks: tasks.length,
      selectedUsernames: Array.from(selectedUsernames),
      filteredCount: result.length,
      taskTypes: tasks.map(t => t.task_type),
      taskUsernames: tasks.map(t => t.username),
    });
    return result;
  }, [tasks, selectedUsernames]);

  // Get user color by username
  const getUserColor = useCallback((username: string) => {
    const user = users.find(u => u.username === username);
    return user?.color || "#6b7280";
  }, [users]);

  // Get project name by ID
  const getProjectName = useCallback((projectId: number, username: string) => {
    const project = projects.find(p => p.id === projectId && p.username === username);
    return project?.name || "Unknown Project";
  }, [projects]);

  // Dynamic row assignment
  const rowAssignments = useMemo(() => {
    return assignRowsDynamic(filteredTasks, dates);
  }, [filteredTasks, dates]);

  // Get the maximum row number
  const maxRow = useMemo(() => {
    let max = 0;
    rowAssignments.forEach(row => {
      if (row > max) max = row;
    });
    return max;
  }, [rowAssignments]);

  // Sort tasks by start date
  const sortedTasks = useMemo(() => {
    const result = [...filteredTasks].sort((a, b) => a.start_date.localeCompare(b.start_date));
    console.log("LabGanttChart - Sorted tasks:", {
      count: result.length,
      firstThree: result.slice(0, 3).map(t => ({
        id: t.id,
        name: t.name,
        start_date: t.start_date,
        end_date: t.end_date,
        task_type: t.task_type,
        username: t.username
      }))
    });
    return result;
  }, [filteredTasks]);

  // Find the earliest and latest task dates to determine if we need to adjust the view
  const taskDateRange = useMemo(() => {
    if (filteredTasks.length === 0) return null;
    
    const sorted = [...filteredTasks].sort((a, b) => a.start_date.localeCompare(b.start_date));
    const earliest = sorted[0]?.start_date;
    const latest = sorted[sorted.length - 1]?.end_date;
    
    return { earliest, latest };
  }, [filteredTasks]);

  // Check if any tasks fall within the visible date range
  const tasksInVisibleRange = useMemo(() => {
    const visibleStart = formatDate(dates[0]);
    const visibleEnd = formatDate(dates[dates.length - 1]);
    
    const result = filteredTasks.filter(t => 
      t.end_date >= visibleStart && t.start_date <= visibleEnd
    );
    
    console.log("LabGanttChart - Tasks in visible range:", {
      visibleStart,
      visibleEnd,
      filteredTasksCount: filteredTasks.length,
      tasksInVisibleRangeCount: result.length,
      taskDates: filteredTasks.slice(0, 5).map(t => ({
        name: t.name,
        start_date: t.start_date,
        end_date: t.end_date,
        inRange: t.end_date >= visibleStart && t.start_date <= visibleEnd
      }))
    });
    
    return result;
  }, [filteredTasks, dates]);

  // Auto-navigate to tasks if they're outside the visible date range
  useEffect(() => {
    if (tasksInVisibleRange.length === 0 && taskDateRange && filteredTasks.length > 0) {
      // Calculate the Monday of the week containing the earliest task
      const earliestDate = parseLocalDate(taskDateRange.earliest);
      const dayOfWeek = earliestDate.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(earliestDate);
      monday.setDate(monday.getDate() + mondayOffset);
      const mondayStr = formatDate(monday);
      
      // Update the gantt start date to show the tasks
      useAppStore.getState().setGanttStartDate(mondayStr);
    }
  }, [tasksInVisibleRange.length, taskDateRange, filteredTasks.length]);

  if (filteredTasks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-sm bg-white rounded-xl p-8 border border-gray-200">
        <p className="mb-2">No tasks to display.</p>
        <p className="text-xs text-gray-500">
          {tasks.length === 0 
            ? "No tasks found in the database." 
            : selectedUsernames.size === 0 
              ? "Select users to view their tasks."
              : "All tasks are filtered out (lists are hidden from GANTT)."}
        </p>
        <p className="text-xs text-gray-500 mt-2">
          Total tasks: {tasks.length} | Selected users: {selectedUsernames.size} | Filtered: {filteredTasks.length}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-white rounded-xl p-4 relative border border-gray-200">
      {/* View mode selector */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-gray-500">View:</span>
        <div className="flex gap-1">
          {["1week", "2week", "3week", "1month", "3month", "6month", "1year"].map((mode) => (
            <button
              key={mode}
              onClick={() => useAppStore.getState().setViewMode(mode as "1week" | "2week" | "3week" | "1month" | "3month" | "6month" | "1year" | "all")}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                viewMode === mode
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-gray-100 text-gray-500 hover:text-gray-900"
              }`}
            >
              {mode === "1week" ? "1W" : mode === "2week" ? "2W" : mode === "3week" ? "3W" : mode === "1month" ? "1M" : mode === "3month" ? "3M" : mode === "6month" ? "6M" : "1Y"}
            </button>
          ))}
        </div>
      </div>

      {weeks.map((weekDates, weekIdx) => {
        const weekStart = formatDate(weekDates[0]);
        const weekEnd = formatDate(weekDates[weekDates.length - 1]);
        const weekTasks = sortedTasks.filter(
          (t) => t.start_date <= weekEnd && t.end_date >= weekStart
        );

        // Debug week rendering - log all weeks
        console.log(`LabGanttChart - Week ${weekIdx} rendering:`, {
          weekIdx,
          weekStart,
          weekEnd,
          weekTasksCount: weekTasks.length,
          sortedTasksCount: sortedTasks.length,
          sampleTaskComparisons: sortedTasks.slice(0, 3).map(t => ({
            name: t.name,
            start_date: t.start_date,
            end_date: t.end_date,
            startCompare: `${t.start_date} <= ${weekEnd} = ${t.start_date <= weekEnd}`,
            endCompare: `${t.end_date} >= ${weekStart} = ${t.end_date >= weekStart}`,
            inWeek: t.start_date <= weekEnd && t.end_date >= weekStart
          }))
        });

        if (weekTasks.length === 0 && weekIdx > weeksToShow) return null;

        const weekLabel = `${formatMonthLabel(weekDates[0])} – ${formatMonthLabel(weekDates[weekDates.length - 1])}`;

        return (
          <div key={weekIdx} className="mb-6 relative" style={{ zIndex: 1 }}>
            {/* Week header */}
            <div className="text-xs font-semibold text-gray-500 mb-2 px-1">
              {weekLabel}
            </div>

            {/* Day headers */}
            <div className="grid gap-px bg-gray-200 rounded-t-lg overflow-hidden"
              style={{ gridTemplateColumns: `repeat(${weekDates.length}, 1fr)` }}
            >
              {weekDates.map((d) => {
                const ds = formatDate(d);
                const isToday = ds === today;
                const isWeekendDay = isWeekend(d);
                return (
                  <div
                    key={`header-${weekIdx}-${ds}`}
                    className={`px-2 py-1.5 text-center text-xs font-medium transition-colors ${
                      isToday
                        ? "bg-red-500 text-white"
                        : isWeekendDay
                        ? "bg-gray-100 text-gray-400"
                        : "bg-white text-gray-600"
                    }`}
                  >
                    {formatDayLabel(d)}
                  </div>
                );
              })}
            </div>

            {/* Task rows */}
            <div className="bg-white border border-gray-200 border-t-0 rounded-b-lg overflow-hidden relative">
              {weekTasks.length === 0 ? (
                <div className="h-12 flex items-center justify-center text-xs text-gray-400">
                  No tasks this week
                </div>
              ) : (
                (() => {
                  // Group week tasks by their assigned row
                  const tasksByRow = new Map<number, LabTask[]>();
                  weekTasks.forEach(task => {
                    const row = rowAssignments.get(task.id) ?? 0;
                    if (!tasksByRow.has(row)) {
                      tasksByRow.set(row, []);
                    }
                    tasksByRow.get(row)!.push(task);
                  });

                  // Sort tasks within each row
                  tasksByRow.forEach(tasksInRow => {
                    tasksInRow.sort((a, b) => a.start_date.localeCompare(b.start_date));
                  });

                  const rowNumbers = Array.from(tasksByRow.keys()).sort((a, b) => a - b);

                  return rowNumbers.map((rowNum) => {
                    const tasksInRow = tasksByRow.get(rowNum) || [];

                    return (
                      <div
                        key={`row-${weekIdx}-${rowNum}`}
                        className="relative h-12 border-b border-gray-100 last:border-b-0"
                        style={{
                          display: "grid",
                          gridTemplateColumns: `repeat(${weekDates.length}, 1fr)`,
                        }}
                      >
                        {/* Background grid cells */}
                        {weekDates.map((d) => {
                          const ds = formatDate(d);
                          const isWeekendDay = isWeekend(d);
                          const isToday2 = ds === today;
                          return (
                            <div
                              key={`cell-${weekIdx}-row${rowNum}-${ds}`}
                              className={`border-r border-gray-100 last:border-r-0 ${
                                isWeekendDay ? "bg-gray-50" : ""
                              } ${isToday2 ? "bg-red-50" : ""}`}
                            />
                          );
                        })}

                        {/* Render tasks in this row */}
                        {tasksInRow.map((task) => {
                          const spanInfo = getTaskSpanInWeek(task, weekDates, dates);
                          if (!spanInfo) return null;

                          // Use the task's user_color directly from the backend
                          // This ensures consistent coloring based on user assignment
                          const userColor = task.user_color || getUserColor(task.username);
                          const completedStyle = task.is_complete
                            ? getCompletedTaskColor(userColor)
                            : null;
                          const taskColor = task.is_complete
                            ? completedStyle!.color
                            : userColor;
                          const completedOpacity = task.is_complete ? completedStyle!.opacity : 1;

                          return (
                            <div
                              key={`${task.id}-w${weekIdx}-r${rowNum}`}
                              className="absolute inset-y-0"
                              style={{
                                left: `${(spanInfo.startIdx / weekDates.length) * 100}%`,
                                width: `${(spanInfo.span / weekDates.length) * 100}%`,
                              }}
                            >
                              <div
                                onClick={() => onTaskClick(task)}
                                className="absolute inset-x-0 top-1 bottom-1 rounded-lg cursor-pointer flex items-center px-2 text-white text-xs font-medium truncate shadow-sm hover:shadow-md transition-all overflow-hidden group"
                                style={{
                                  backgroundColor: taskColor,
                                  opacity: task.is_complete ? completedOpacity : 1,
                                }}
                                title={`${task.name} (${task.username})\n${task.start_date} → ${task.end_date}`}
                              >
                                {/* Username indicator - first letter badge */}
                                <div 
                                  className="absolute left-0 top-0 bottom-0 w-5 flex items-center justify-center bg-black/20 text-[10px] font-bold"
                                  style={{ borderRadius: "0.5rem 0 0 0.5rem" }}
                                >
                                  {task.username.charAt(0).toUpperCase()}
                                </div>

                                {/* Task type indicator */}
                                {task.task_type === "experiment" && (
                                  <div className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center text-[8px] bg-black/20 rounded-bl-lg">
                                    🔬
                                  </div>
                                )}
                                {task.task_type === "purchase" && (
                                  <div className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center text-[8px] bg-black/20 rounded-bl-lg">
                                    $
                                  </div>
                                )}

                                {/* Fade gradients for tasks extending beyond visible range */}
                                {spanInfo.extendsBeyondStart && (
                                  <div
                                    className="absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-black/20 to-transparent pointer-events-none"
                                    style={{ borderRadius: "0.5rem 0 0 0.5rem" }}
                                  />
                                )}
                                {spanInfo.extendsBeyondEnd && (
                                  <div
                                    className="absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-black/20 to-transparent pointer-events-none"
                                    style={{ borderRadius: "0 0.5rem 0.5rem 0" }}
                                  />
                                )}

                                {/* Weekend overlay */}
                                {(() => {
                                  const weekendSegments: { startIdx: number; span: number }[] = [];
                                  let weekendStart = -1;
                                  let weekendCount = 0;

                                  for (let i = spanInfo.startIdx; i < spanInfo.startIdx + spanInfo.span; i++) {
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
                                  if (weekendStart !== -1 && weekendCount > 0) {
                                    weekendSegments.push({ startIdx: weekendStart, span: weekendCount });
                                  }

                                  return weekendSegments.map((seg, segIdx) => (
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
                                        backgroundColor: "rgba(100, 100, 100, 0.2)",
                                      }}
                                    />
                                  ));
                                })()}

                                <span className="truncate relative z-10 ml-5">
                                  {task.name}
                                </span>
                                {task.is_complete && (
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 flex-shrink-0 z-10 text-white/80">✓</span>
                                )}

                                {/* Hover tooltip */}
                                <div className="absolute left-0 top-full mt-1 bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
                                  <div className="font-medium">{task.name}</div>
                                  <div className="text-gray-300">{task.username} • {getProjectName(task.project_id, task.username)}</div>
                                  <div className="text-gray-400">{task.start_date} → {task.end_date}</div>
                                </div>
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

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <span>Tasks colored by user:</span>
        {Array.from(selectedUsernames).map(username => {
          const user = users.find(u => u.username === username);
          if (!user) return null;
          return (
            <div key={username} className="flex items-center gap-1">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: user.color }}
              />
              <span>{username}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
