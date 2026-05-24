"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAllTasks,
  fetchAllProjectsIncludingShared,
} from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import DailyTasksSidebar from "@/components/DailyTasksSidebar";
import HeroNumberTile from "./snapshot/HeroNumberTile";
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
    const todaysList: Task[] = [];
    for (const t of active) {
      if (t.is_complete) continue;
      if (t.end_date < today) overdue++;
      else if (t.start_date <= today && t.end_date >= today) {
        todays++;
        todaysList.push(t);
      } else if (t.start_date > today) upcoming++;
    }
    // Phase B Batch B3: pick the "most imminent" task — the one
    // ending soonest among today's bucket (or, if today's bucket
    // has none, the oldest overdue task). Used by SnapshotTile to
    // surface a task name alongside the count.
    todaysList.sort((a, b) => {
      if (a.end_date !== b.end_date) return a.end_date.localeCompare(b.end_date);
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
    const imminent = todaysList[0] ?? null;
    return {
      overdue,
      todays,
      upcoming,
      imminent,
      isLoading,
    };
  }, [allTasks, projects, isLoading]);
}

// Calendar icon (Phase B Batch B3): replaces the checkbox icon Phase
// A used. Calendar reads as "what's on today" more clearly than a
// generic checkbox — and the checkbox icon overlapped semantically
// with the OverdueTasks / TodaysTasks list widgets.
const CALENDAR_ICON_16 = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
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
 * Format the imminent task's end date for the snapshot subline.
 * "today" → "due today"; future ISO date → "due Tue"; past ISO →
 * "due <Mon Mar 5>". DailyTasksWidget doesn't carry an explicit
 * time-of-day on tasks (the calendar widget does), so this is a
 * date-only formatter.
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

export function SnapshotTile(_props: SnapshotTileProps) {
  const { overdue, todays, imminent, isLoading } = useTaskCounts();
  // 2-row hero: big "due today" count + imminent task name + due
  // hint underneath. Overdue tints the icon red as a glanceable
  // urgency cue (the sub line spells it out too).
  const urgent = overdue > 0;
  return (
    <HeroNumberTile
      icon={CALENDAR_ICON_16}
      accent={urgent ? "rose" : todays > 0 ? "blue" : "calm"}
      label="Today"
      primary={isLoading ? "—" : `${todays} due`}
      secondary={
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="truncate">
            {imminent
              ? imminent.name.length > 24
                ? `${imminent.name.slice(0, 23)}…`
                : imminent.name
              : urgent
                ? `${overdue} overdue`
                : "Nothing on deck"}
          </span>
          {imminent && (
            <span className="text-[10px] text-gray-400 truncate">
              {formatDue(imminent.end_date)}
            </span>
          )}
        </div>
      }
    />
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
