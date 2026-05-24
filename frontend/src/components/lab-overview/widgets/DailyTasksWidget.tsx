"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAllTasks,
  fetchAllProjectsIncludingShared,
} from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import DailyTasksSidebar from "@/components/DailyTasksSidebar";
import SidebarStatTile from "./snapshot/SidebarStatTile";
import type {
  ExpandedViewProps,
  SidebarTileProps,
  SnapshotTileProps,
} from "./types";
import type { Project, Task } from "@/lib/types";

/**
 * Customizable PI sidebar (#146 customizable PI sidebar manager,
 * 2026-05-23): packages the existing `<DailyTasksSidebar>` component
 * as a pinnable widget so lab heads can mount it inside their
 * `<CustomizableSidebar>`.
 *
 * The original `<DailyTasksSidebar>` is unchanged — members still use
 * it directly as their (non-customizable) AppShell sidebar. This file
 * just exposes it under the widget catalog's three-view contract:
 *   - `ExpandedView`: the full `<DailyTasksSidebar>` body — opens in
 *     the popup when a tile is clicked.
 *   - `SnapshotTile`: a square-card summary of today's task counts
 *     (canvas variant).
 *   - `SidebarTile`: a slim horizontal row with the same headline
 *     ("today + overdue") — for the customizable sidebar surface.
 *
 * Registry `memberVisible: true` because members CAN pin it (they
 * just won't see the customizable rail unless they're a lab_head; a
 * lab_head naturally will). `defaultLocation: "sidebar"` is captured
 * via the catalog entry's `surface: "sidebar"` field — there's no
 * separate `defaultLocation` field on `WidgetDefinition`, the surface
 * value plays that role.
 */

// Shared data hook — mirrors the count logic the body uses so the two
// surfaces stay in lock-step. Reads from the same React Query keys
// `<DailyTasksSidebar>` reads, so the cache is warm both directions.
function useTaskCounts() {
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });

  const { data: allTasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasks,
  });

  return useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    // Active = not in an archived project (mirror the body's filter).
    const active = projects.length === 0
      ? allTasks
      : allTasks.filter((t) => {
          const project = projects.find(
            (p) => p.id === t.project_id && p.owner === t.owner,
          );
          return project && !project.is_archived;
        });

    let overdue = 0;
    let todays = 0;
    let upcoming = 0;
    let completedToday = 0;
    const todaysList: Task[] = [];
    const overdueList: Task[] = [];
    for (const t of active) {
      if (t.is_complete) {
        // Approximate "done today" — tasks whose end_date is today and
        // are marked complete. There's no per-completion timestamp on
        // Task today, so this is the closest signal.
        if (t.end_date === today) completedToday++;
        continue;
      }
      if (t.end_date < today) {
        overdue++;
        overdueList.push(t);
      } else if (t.start_date <= today && t.end_date >= today) {
        todays++;
        todaysList.push(t);
      } else if (t.start_date > today) upcoming++;
    }
    todaysList.sort((a, b) => {
      if (a.end_date !== b.end_date) return a.end_date.localeCompare(b.end_date);
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
    overdueList.sort((a, b) => a.end_date.localeCompare(b.end_date));
    return {
      overdue,
      todays,
      upcoming,
      todaysList,
      overdueList,
      completedToday,
      isLoading,
    };
  }, [allTasks, projects, isLoading]);
}

// Calendar icon (Phase B redesign): one shared 14px size — the
// SnapshotTile redesign no longer uses a hero 16px icon (it's a list
// view now), and the SidebarTile already used the 14px variant.
const CALENDAR_ICON_14 = (
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
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

/**
 * Format a task end_date as a short due label for the snapshot row
 * subline. "today" → "due today"; near future ISO date → "due Tue";
 * further out → "due <Mar 5>". DailyTasksWidget tasks don't carry a
 * time-of-day (the calendar widget does), so this is a date-only
 * formatter. Overdue dates are handled by the caller, which paints
 * an explicit "Overdue Nd" tag instead.
 */
function formatDue(endDateIso: string | undefined): string {
  if (!endDateIso) return "no due date";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  if (endDateIso === todayIso) return "due today";
  const d = new Date(`${endDateIso}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return "due soon";
  // ≤6 days out → "due Tue"; further out → "due Mar 5".
  const diffDays = Math.round(
    (d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays >= 0 && diffDays < 7) {
    return `due ${d.toLocaleDateString(undefined, { weekday: "short" })}`;
  }
  return `due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

const CHECKBOX_SVG = (
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
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
  </svg>
);

const TINY_CHECK_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="text-emerald-500"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/**
 * SnapshotTile: list of tasks due today (up to 5). Each row has a
 * checkbox glyph, the task name, and a due / overdue hint. Tasks the
 * user has already finished today render as a small "X done today"
 * pill in the top-right. Empty state shows a green checkmark +
 * "Nothing due today" muted gray.
 */
export function SnapshotTile(_props: SnapshotTileProps) {
  const { todaysList, overdue, overdueList, completedToday, isLoading } =
    useTaskCounts();
  // Show today's tasks; if today's bucket is empty AND there is
  // overdue work, show that instead so the tile never reads empty
  // when there's actionable backlog.
  const showList = todaysList.length > 0 ? todaysList : overdueList;
  const isOverdueFallback = todaysList.length === 0 && overdueList.length > 0;
  const visible = showList.slice(0, 5);
  const moreCount = Math.max(0, showList.length - visible.length);
  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 text-gray-500">
        <span aria-hidden="true" className="text-blue-500 flex-shrink-0">
          {CALENDAR_ICON_14}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-medium">
          Today
        </span>
      </div>
      {completedToday > 0 && (
        <span className="absolute top-0 right-0 text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full font-medium">
          {completedToday} done today
        </span>
      )}
      <div className="mt-2 flex-1 min-h-0 flex flex-col gap-1.5">
        {isLoading ? (
          <p className="text-xs text-gray-400 italic m-auto">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="m-auto flex items-center gap-1.5 text-xs text-gray-400">
            {TINY_CHECK_SVG}
            <span>Nothing due today</span>
          </div>
        ) : (
          <>
            {isOverdueFallback && (
              <p className="text-[10px] text-amber-600 italic">
                {overdue} overdue (no work due today)
              </p>
            )}
            {visible.map((task) => {
              const overdueDay =
                task.end_date < today
                  ? Math.round(
                      (Date.parse(today) - Date.parse(task.end_date)) /
                        (24 * 60 * 60 * 1000),
                    )
                  : null;
              const dueLabel =
                overdueDay !== null
                  ? `Overdue ${overdueDay}d`
                  : formatDue(task.end_date);
              const dueClass =
                overdueDay !== null ? "text-amber-600" : "text-gray-500";
              return (
                <div
                  key={`${task.owner}:${task.id}`}
                  className="flex items-start gap-2 min-w-0"
                >
                  <span
                    aria-hidden="true"
                    className="text-gray-300 flex-shrink-0 mt-0.5"
                  >
                    {CHECKBOX_SVG}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 truncate">
                      {task.name}
                    </p>
                    <p className={`text-[10px] truncate ${dueClass}`}>
                      {dueLabel}
                    </p>
                  </div>
                </div>
              );
            })}
            {moreCount > 0 && (
              <p className="text-[10px] text-gray-400 italic">
                +{moreCount} more
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { overdue, todays, isLoading } = useTaskCounts();
  return (
    <SidebarStatTile
      icon={CALENDAR_ICON_14}
      iconClassName={overdue > 0 ? "text-red-500" : "text-blue-500"}
      label="Today"
      stat={isLoading ? "—" : `${todays} task${todays === 1 ? "" : "s"}`}
      sub={overdue > 0 ? `${overdue} overdue` : undefined}
      onClick={onClick}
    />
  );
}

// ExpandedView = the full DailyTasksSidebar body, opened in the popup.
// Phase B Batch B3 (Phase B Batch B3 manager, 2026-05-23): the
// component renders its own `<aside class="w-64 border-r flex-shrink-0">`
// which, dropped raw into the popup body, paints as "a 256px column
// with a right border" inside a 1024px popup — the Restart persona
// flagged it as "looks like a sidebar wedged into a popup".
//
// Wrap in a div that:
//   - sets a fixed-height column so the inner `<aside>` honors its
//     own `overflow-y-auto` cleanly
//   - widens the inner aside via a CSS override (`>* { width:100% }`
//     would be too aggressive; we lean on Tailwind arbitrary
//     selectors to target the direct aside child specifically and
//     strip the right border + force 100% width)
export function ExpandedView(_props: ExpandedViewProps) {
  // DailyTasksSidebar returns a fragment whose first child is the
  // `<aside class="w-64 border-r ...">`. With a div wrapper, the
  // aside becomes a direct child — the arbitrary `[&>aside]:` Tailwind
  // selector strips the right border and widens it to fill the popup.
  // The popup/quick popup overlays the component also renders inside
  // the fragment land outside this width override, which is what we
  // want (they portal-style at fixed positions).
  return (
    <div className="h-full w-full overflow-hidden [&>aside]:w-full [&>aside]:border-r-0">
      <DailyTasksSidebar />
    </div>
  );
}

// Re-export the body so consumers (e.g. tests) can import the widget
// module without reaching into the components/ root. Mirrors the
// other widget files' `default export = body` convention.
export default ExpandedView;
