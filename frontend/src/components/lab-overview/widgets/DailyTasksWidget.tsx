"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAllTasks,
  fetchAllProjectsIncludingShared,
} from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import DailyTasksSidebar from "@/components/DailyTasksSidebar";
import StatTile from "./snapshot/StatTile";
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
    for (const t of active) {
      if (t.is_complete) continue;
      if (t.end_date < today) overdue++;
      else if (t.start_date <= today && t.end_date >= today) todays++;
      else if (t.start_date > today) upcoming++;
    }
    return { overdue, todays, upcoming, isLoading };
  }, [allTasks, projects, isLoading]);
}

const TASK_ICON = (
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
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

const SIDEBAR_TASK_ICON = (
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
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

export function SnapshotTile(_props: SnapshotTileProps) {
  const { overdue, todays, isLoading } = useTaskCounts();
  return (
    <StatTile
      icon={TASK_ICON}
      iconClassName={overdue > 0 ? "text-red-500" : "text-blue-500"}
      label="Daily tasks"
      stat={isLoading ? "—" : todays}
      sub={
        overdue > 0
          ? `${overdue} overdue`
          : todays === 0
            ? "Nothing scheduled today"
            : "today"
      }
    />
  );
}

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { overdue, todays, isLoading } = useTaskCounts();
  return (
    <SidebarStatTile
      icon={SIDEBAR_TASK_ICON}
      iconClassName={overdue > 0 ? "text-red-500" : "text-blue-500"}
      label="Daily tasks"
      stat={isLoading ? "—" : todays}
      sub={overdue > 0 ? `${overdue} overdue` : undefined}
      onClick={onClick}
    />
  );
}

// ExpandedView = the full DailyTasksSidebar body, opened in the popup.
// The body is the same component the member-sidebar uses on every
// non-/calendar route; mounting it inside the popup gives lab heads
// the entire daily-tasks UI (per-project grouping, overdue/today/
// future buckets, click-to-quick-popup) without duplicating logic.
export function ExpandedView(_props: ExpandedViewProps) {
  // DailyTasksSidebar paints its own `<aside>` width/border chrome. The
  // popup shell is already sized + chromed; we wrap in a constrained
  // div so the inner aside fills the popup body instead of forcing its
  // own 256px column inside a 1024px popup.
  return (
    <div className="h-full w-full flex">
      <DailyTasksSidebar />
    </div>
  );
}

// Re-export the body so consumers (e.g. tests) can import the widget
// module without reaching into the components/ root. Mirrors the
// other widget files' `default export = body` convention.
export default ExpandedView;
