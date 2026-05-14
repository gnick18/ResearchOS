"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { fetchAllTasks, eventsApi, fetchAllProjectsIncludingShared } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAppStore } from "@/lib/store";
import { useExternalEvents } from "@/lib/calendar/use-external-events";
import { useCalendarNavStore } from "@/lib/calendar/calendar-nav-store";
import {
  EVENT_TYPE_COLORS,
  formatTime,
  toLocalDateString,
} from "@/components/calendar/utils";
import TaskDetailPopup from "./TaskDetailPopup";
import TaskQuickPopup from "./TaskQuickPopup";
import SidebarContentsPopup from "./SidebarContentsPopup";
import Tooltip from "./Tooltip";
import type { Task, Event, ExternalEvent } from "@/lib/types";

/**
 * Always-visible sidebar showing today's tasks.
 * Clicking a task opens a quick popup with checkbox and expand button.
 */
export default function DailyTasksSidebar() {
  const [quickPopupTask, setQuickPopupTask] = useState<Task | null>(null);
  const [quickPopupPosition, setQuickPopupPosition] = useState({ x: 0, y: 0 });
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  // Sidebar content toggles (mirrored from users/{username}/settings.json via
  // FileSystemProvider on login). User can flip them in Settings → Sidebar.
  const showTasks = useAppStore((s) => s.sidebarShowTasks);
  const showEvents = useAppStore((s) => s.sidebarShowCalendarEvents);
  const horizonDays = useAppStore((s) => s.sidebarEventsHorizonDays);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });

  const activeProjects = useMemo(() => 
    projects.filter((p) => !p.is_archived),
    [projects]
  );

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasks,
  });

  useEffect(() => {
    console.log("[DailyTasksSidebar] Data loaded:", {
      currentUser,
      projectsCount: projects.length,
      tasksCount: allTasks.length,
      activeProjectsCount: activeProjects.length,
    });
  }, [projects, allTasks, activeProjects, currentUser]);

  const activeTasks = useMemo(() => {
    if (projects.length === 0) {
      console.log("[DailyTasksSidebar] Projects not loaded yet, returning all tasks");
      return allTasks;
    }
    
    const filtered = allTasks.filter((t) => {
      const project = projects.find(
        (p) => p.id === t.project_id && p.owner === t.owner,
      );
      return project && !project.is_archived;
    });
    
    console.log("[DailyTasksSidebar] Active tasks filtered:", {
      allTasksCount: allTasks.length,
      projectsCount: projects.length,
      activeTasksCount: filtered.length,
    });
    
    return filtered;
  }, [allTasks, projects]);

  const today = new Date().toISOString().split("T")[0];

  // Categorize tasks
  const { todaysTasks, overdueTasks, futureTasks } = useMemo(() => {
    const todayTasks = activeTasks.filter(
      (t) => t.start_date <= today && t.end_date >= today && !t.is_complete
    );
    const overdue = activeTasks.filter(
      (t) => t.end_date < today && !t.is_complete
    );
    const future = activeTasks.filter(
      (t) => t.start_date > today && !t.is_complete
    );
    return { todaysTasks: todayTasks, overdueTasks: overdue, futureTasks: future };
  }, [activeTasks, today]);

  // Group tasks by project.
  // TODO(id-collision): keyed by raw project_id, so tasks from alex's project
  // 1 and morgan's project 1 land in the same bucket. The render reads back
  // with `groups[project.id]` which means each side-project will display the
  // union. Full fix is to key by composite `${owner}:${id}` and read with
  // the same key — left for a follow-up sweep so this PR stays scoped.
  const groupByProject = (tasks: Task[]): Record<number, Task[]> => {
    const groups: Record<number, Task[]> = {};
    for (const task of tasks) {
      if (!groups[task.project_id]) {
        groups[task.project_id] = [];
      }
      groups[task.project_id].push(task);
    }
    return groups;
  };

  const todaysTasksByProject = useMemo(() => groupByProject(todaysTasks), [todaysTasks]);
  const futureTasksByProject = useMemo(() => groupByProject(futureTasks), [futureTasks]);

  const selectedProject = selectedTask
    ? projects.find(
        (p) => p.id === selectedTask.project_id && p.owner === selectedTask.owner,
      )
    : undefined;

  const quickPopupProject = quickPopupTask
    ? projects.find(
        (p) =>
          p.id === quickPopupTask.project_id && p.owner === quickPopupTask.owner,
      )
    : undefined;

  // Get project color by composite (owner, id). Per-user ID spaces mean
  // alex's project 1 and morgan's project 1 are different projects — a
  // numeric-id-only lookup picks whichever happens to be first in the array.
  // Callers pass `{ owner, id }`; for tasks that's `{ owner, id: project_id }`.
  const getProjectColor = (
    ref: { owner: string; id: number },
  ): string => {
    const project = projects.find(
      (p) => p.id === ref.id && p.owner === ref.owner,
    );
    return project?.color || "#3b82f6";
  };

  // Handle task click - show quick popup
  const handleTaskClick = useCallback((task: Task, event: React.MouseEvent) => {
    setQuickPopupTask(task);
    setQuickPopupPosition({ x: event.clientX, y: event.clientY });
  }, []);

  // Handle expand from quick popup
  const handleExpandToDetail = useCallback(() => {
    if (quickPopupTask) {
      setSelectedTask(quickPopupTask);
      setQuickPopupTask(null);
    }
  }, [quickPopupTask]);

  return (
    <>
      <aside className="relative w-64 border-r border-gray-200 bg-white overflow-y-auto flex-shrink-0">
        {/* Floating gear in the top-right of the sidebar. Opens a small
            popup with the same content toggles available in Settings ->
            Sidebar, so users can flip them inline without leaving the
            current page. */}
        <Tooltip label="What shows in this sidebar" placement="left">
        <button
          ref={gearRef}
          onClick={() => setSettingsOpen((v) => !v)}
          className="absolute top-2 right-2 z-20 p-1 text-gray-300 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-transform duration-300 group-hover:rotate-90"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        </Tooltip>
        {settingsOpen && (
          <SidebarContentsPopup
            onClose={() => setSettingsOpen(false)}
            anchorRef={gearRef}
          />
        )}

        {!showTasks && !showEvents && (
          <div className="p-6 text-center text-xs text-gray-400">
            <p className="mb-2">Sidebar is empty.</p>
            <p>
              Enable Tasks or Calendar events in{" "}
              <a href="/settings" className="text-blue-600 hover:underline">
                Settings → Sidebar
              </a>
              .
            </p>
          </div>
        )}

        {showTasks && (
          <>
            {/* Overdue tasks - shown first if any exist */}
            {overdueTasks.length > 0 && (
              <>
                <div className="p-4 border-b border-gray-100">
                  <h2 className="text-xs font-bold text-red-400 uppercase tracking-widest">
                    Overdue ({overdueTasks.length})
                  </h2>
                </div>
                <div className="p-3">
                  {overdueTasks.map((t) => (
                    <TaskItem
                      key={t.id}
                      task={t}
                      projectColor={getProjectColor({ owner: t.owner, id: t.project_id })}
                      overdue
                      onClick={handleTaskClick}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Today's tasks by project */}
            <div className={overdueTasks.length > 0 ? "px-4 py-2 border-t border-gray-100" : "p-4 border-b border-gray-100"}>
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                Today
              </h2>
            </div>
            <div className="p-3">
              {todaysTasks.length === 0 ? (
                <p className="text-xs text-gray-300 italic px-1">
                  No tasks for today
                </p>
              ) : (
                activeProjects.map((project) => {
                  const projectTasks = todaysTasksByProject[project.id] || [];
                  if (projectTasks.length === 0) return null;
                  return (
                    <div key={project.id} className="mb-3">
                      <div className="flex items-center gap-1.5 mb-1 px-1">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: getProjectColor({ owner: project.owner, id: project.id }) }}
                        />
                        <span className="text-xs font-medium text-gray-500">
                          {project.name}
                        </span>
                      </div>
                      {projectTasks.map((t) => (
                        <TaskItem
                          key={t.id}
                          task={t}
                          projectColor={getProjectColor({ owner: t.owner, id: t.project_id })}
                          onClick={handleTaskClick}
                        />
                      ))}
                    </div>
                  );
                })
              )}
            </div>

            {/* Future tasks by project */}
            {futureTasks.length > 0 && (
              <>
                <div className="px-4 py-2 border-t border-gray-100">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                    Upcoming ({futureTasks.length})
                  </h3>
                </div>
                <div className="p-3">
                  {activeProjects.map((project) => {
                    const projectTasks = futureTasksByProject[project.id] || [];
                    if (projectTasks.length === 0) return null;
                    // Sort by start date
                    projectTasks.sort((a, b) => a.start_date.localeCompare(b.start_date));
                    // Show max 3 per project
                    const displayTasks = projectTasks.slice(0, 3);
                    const hasMore = projectTasks.length > 3;
                    return (
                      <div key={project.id} className="mb-3">
                        <div className="flex items-center gap-1.5 mb-1 px-1">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: getProjectColor({ owner: project.owner, id: project.id }) }}
                          />
                          <span className="text-xs font-medium text-gray-500">
                            {project.name}
                          </span>
                          {hasMore && (
                            <span className="text-xs text-gray-400">
                              +{projectTasks.length - 3} more
                            </span>
                          )}
                        </div>
                        {displayTasks.map((t) => (
                          <TaskItem
                            key={t.id}
                            task={t}
                            projectColor={getProjectColor({ owner: t.owner, id: t.project_id })}
                            future
                            onClick={handleTaskClick}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {showEvents && (
          <CalendarEventsSection
            withDivider={showTasks}
            horizonDays={horizonDays}
          />
        )}
      </aside>

      {/* Task Quick Popup */}
      {quickPopupTask && (
        <TaskQuickPopup
          task={quickPopupTask}
          project={quickPopupProject}
          position={quickPopupPosition}
          onClose={() => setQuickPopupTask(null)}
          onExpand={handleExpandToDetail}
        />
      )}

      {/* Task Detail Popup */}
      {selectedTask && (
        <TaskDetailPopup
          task={selectedTask}
          project={selectedProject}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </>
  );
}

// ── Calendar events sub-section ──────────────────────────────────────────────

function CalendarEventsSection({
  withDivider,
  horizonDays,
}: {
  withDivider: boolean;
  horizonDays: number;
}) {
  const router = useRouter();
  const jumpTo = useCalendarNavStore((s) => s.jumpTo);

  const { data: events = [] } = useQuery({
    queryKey: ["events"],
    queryFn: eventsApi.list,
  });
  const { events: externalEvents } = useExternalEvents();

  const todayStr = toLocalDateString(new Date());
  const horizonStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + horizonDays);
    return toLocalDateString(d);
  }, [horizonDays]);

  const { todayItems, upcomingByDate } = useMemo(() => {
    type Item =
      | { kind: "native"; event: Event; sortKey: string }
      | { kind: "external"; event: ExternalEvent; sortKey: string };
    const all: Item[] = [];
    for (const e of events) {
      const end = e.end_date || e.start_date;
      if (end < todayStr || e.start_date > horizonStr) continue;
      const anchor = e.start_date < todayStr ? todayStr : e.start_date;
      all.push({
        kind: "native",
        event: e,
        sortKey: `${anchor}T${e.start_time ?? "00:00"}`,
      });
    }
    for (const e of externalEvents) {
      const end = e.end_date || e.start_date;
      if (end < todayStr || e.start_date > horizonStr) continue;
      const anchor = e.start_date < todayStr ? todayStr : e.start_date;
      all.push({
        kind: "external",
        event: e,
        sortKey: `${anchor}T${e.start_time ?? "00:00"}`,
      });
    }
    all.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    const today: Item[] = [];
    const upcoming = new Map<string, Item[]>();
    for (const it of all) {
      const date = it.sortKey.slice(0, 10);
      if (date === todayStr) today.push(it);
      else {
        if (!upcoming.has(date)) upcoming.set(date, []);
        upcoming.get(date)!.push(it);
      }
    }
    return { todayItems: today, upcomingByDate: upcoming };
  }, [events, externalEvents, todayStr, horizonStr]);

  const handleClickEvent = (dateStr: string) => {
    jumpTo("day", dateStr);
    router.push("/calendar");
  };

  return (
    <>
      <div
        className={`px-4 py-2 ${withDivider ? "border-t" : "p-4 border-b"} border-gray-100`}
      >
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
          Today&apos;s Events
        </h2>
      </div>
      <div className="p-3">
        {todayItems.length === 0 ? (
          <p className="text-xs text-gray-300 italic px-1">No events today</p>
        ) : (
          <ul className="space-y-1">
            {todayItems.map((item) => (
              <EventRow
                key={item.kind === "native" ? `n-${item.event.id}` : `x-${item.event.id}`}
                item={item}
                onClick={() => handleClickEvent(todayStr)}
              />
            ))}
          </ul>
        )}
      </div>

      {horizonDays > 0 && upcomingByDate.size > 0 && (
        <>
          <div className="px-4 py-2 border-t border-gray-100">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              Next {horizonDays} day{horizonDays === 1 ? "" : "s"}
            </h3>
          </div>
          <div className="p-3 space-y-3">
            {Array.from(upcomingByDate.entries()).map(([dateStr, items]) => (
              <UpcomingDayGroup
                key={dateStr}
                dateStr={dateStr}
                items={items}
                onClick={handleClickEvent}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function EventRow({
  item,
  onClick,
}: {
  item:
    | { kind: "native"; event: Event }
    | { kind: "external"; event: ExternalEvent };
  onClick: () => void;
}) {
  const color =
    item.kind === "native"
      ? item.event.color || EVENT_TYPE_COLORS[item.event.event_type]
      : item.event.color;
  const timeLabel = item.event.start_time ? formatTime(item.event.start_time) : null;
  return (
    <li>
      <button
        onClick={onClick}
        title="Jump to this day in calendar"
        className="w-full text-left flex items-start gap-2 px-1.5 py-1 rounded hover:bg-gray-50"
      >
        <span
          className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-800 truncate flex items-center gap-1">
            {item.kind === "external" && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color }}
                className="flex-shrink-0"
              >
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            )}
            <span className="truncate">{item.event.title}</span>
          </p>
          <p className="text-[10px] text-gray-400">
            {timeLabel ?? "All-day"}
          </p>
        </div>
      </button>
    </li>
  );
}

function UpcomingDayGroup({
  dateStr,
  items,
  onClick,
}: {
  dateStr: string;
  items: Array<
    | { kind: "native"; event: Event }
    | { kind: "external"; event: ExternalEvent }
  >;
  onClick: (dateStr: string) => void;
}) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const tomorrow = (() => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return toLocalDateString(t);
  })();
  const header =
    dateStr === tomorrow
      ? "Tomorrow"
      : date.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });

  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 px-1">
        {header}
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <EventRow
            key={item.kind === "native" ? `n-${item.event.id}` : `x-${item.event.id}`}
            item={item}
            onClick={() => onClick(dateStr)}
          />
        ))}
      </ul>
    </div>
  );
}

function TaskItem({
  task,
  overdue,
  future,
  onClick,
}: {
  task: Task;
  projectColor: string;
  overdue?: boolean;
  future?: boolean;
  onClick: (task: Task, event: React.MouseEvent) => void;
}) {
  const isExperiment = task.task_type === "experiment";
  
  const handleClick = (e: React.MouseEvent) => {
    onClick(task, e);
  };
  
  return (
    <div
      onClick={handleClick}
      className={`relative px-2 py-1.5 rounded-md text-sm mb-1 cursor-pointer transition-colors ${
        overdue
          ? "text-red-600 bg-red-50 hover:bg-red-100"
          : future
          ? "text-gray-500 bg-gray-50 hover:bg-gray-100"
          : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      {/* Accent line for experiments */}
      {isExperiment && (
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-md"
          style={{ backgroundColor: "#8b5cf6" }}
        />
      )}
      <p className="truncate font-medium pl-1">
        {task.name}
      </p>
      <p className="text-xs text-gray-400 pl-1">
        {task.duration_days}d · {task.start_date}
      </p>
    </div>
  );
}
