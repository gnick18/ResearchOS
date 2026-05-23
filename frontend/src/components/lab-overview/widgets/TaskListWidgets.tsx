"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  fetchAllTasks,
  fetchAllProjectsIncludingShared,
} from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Task, Project } from "@/lib/types";

/**
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
 * sidebar-only task widgets — Overdue / Today / Upcoming. These wrap
 * the existing DailyTasksSidebar's task-filter logic into widget-shape
 * so the customizable sidebar can mount them through the same catalog
 * primitive (proposal §3g).
 *
 * R2 ships compact list bodies (name + due date). R3 can layer the
 * richer per-project grouping + quick-popup behavior the
 * DailyTasksSidebar already has if Grant wants the full feature
 * surface in the widget rail.
 */

function useActiveTasks() {
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });

  const { data: allTasks = [] } = useQuery<Task[]>({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasks,
  });

  return useMemo(() => {
    if (projects.length === 0) return allTasks;
    return allTasks.filter((t) => {
      const project = projects.find(
        (p) => p.id === t.project_id && p.owner === t.owner,
      );
      return project && !project.is_archived;
    });
  }, [allTasks, projects]);
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function TaskRow({ task }: { task: Task }) {
  const router = useRouter();
  return (
    <li
      className="flex items-center justify-between gap-2 py-1 text-xs text-gray-700 hover:bg-gray-50 rounded px-1 cursor-pointer"
      onClick={() => router.push(`/gantt?task=${task.id}`)}
    >
      <span className="truncate flex-1">{task.name}</span>
      <span className="text-gray-400 text-[10px] shrink-0">
        {task.end_date}
      </span>
    </li>
  );
}

type WidgetBodyProps = { isEditing?: boolean; surface?: "canvas" | "sidebar" };

export function OverdueTasksWidget(_props?: WidgetBodyProps) {
  const tasks = useActiveTasks();
  const today = todayISO();
  const overdue = tasks
    .filter((t) => t.end_date < today && !t.is_complete)
    .sort((a, b) => a.end_date.localeCompare(b.end_date));

  if (overdue.length === 0) {
    return <p className="text-xs text-gray-400 italic">Nothing overdue.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {overdue.slice(0, 8).map((t) => (
        <TaskRow key={`${t.owner}:${t.id}`} task={t} />
      ))}
    </ul>
  );
}

export function TodaysTasksWidget(_props?: WidgetBodyProps) {
  const tasks = useActiveTasks();
  const today = todayISO();
  const todays = tasks.filter(
    (t) => t.start_date <= today && t.end_date >= today && !t.is_complete,
  );
  if (todays.length === 0) {
    return <p className="text-xs text-gray-400 italic">No tasks for today.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {todays.slice(0, 8).map((t) => (
        <TaskRow key={`${t.owner}:${t.id}`} task={t} />
      ))}
    </ul>
  );
}

export function UpcomingTasksWidget(_props?: WidgetBodyProps) {
  const tasks = useActiveTasks();
  const today = todayISO();
  const upcoming = tasks
    .filter((t) => t.start_date > today && !t.is_complete)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (upcoming.length === 0) {
    return <p className="text-xs text-gray-400 italic">No upcoming tasks.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {upcoming.slice(0, 8).map((t) => (
        <TaskRow key={`${t.owner}:${t.id}`} task={t} />
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase A snapshot + expanded contract (Phase A redispatch manager, 2026-05-23)
// ─────────────────────────────────────────────────────────────────────────────
// Three widgets in one file → three SnapshotTile + ExpandedView pairs.
// Each snapshot reuses the same `useActiveTasks` hook the body uses
// so React Query dedupes the fetch.
import StatTile from "./snapshot/StatTile";
import type { SnapshotTileProps } from "./types";

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

export function OverdueTasksSnapshot(_props: SnapshotTileProps) {
  const tasks = useActiveTasks();
  const today = todayISO();
  const count = tasks.filter((t) => t.end_date < today && !t.is_complete).length;
  return (
    <StatTile
      icon={TASK_ICON}
      iconClassName="text-red-500"
      label="Overdue"
      stat={count}
      sub={count === 0 ? "Nothing overdue" : "task" + (count === 1 ? "" : "s")}
    />
  );
}

export function TodaysTasksSnapshot(_props: SnapshotTileProps) {
  const tasks = useActiveTasks();
  const today = todayISO();
  const count = tasks.filter(
    (t) => t.start_date <= today && t.end_date >= today && !t.is_complete,
  ).length;
  return (
    <StatTile
      icon={TASK_ICON}
      iconClassName="text-blue-500"
      label="Today"
      stat={count}
      sub={count === 0 ? "Nothing scheduled" : "task" + (count === 1 ? "" : "s") + " today"}
    />
  );
}

export function UpcomingTasksSnapshot(_props: SnapshotTileProps) {
  const tasks = useActiveTasks();
  const today = todayISO();
  const count = tasks.filter((t) => t.start_date > today && !t.is_complete).length;
  return (
    <StatTile
      icon={TASK_ICON}
      iconClassName="text-emerald-500"
      label="Upcoming"
      stat={count}
      sub={count === 0 ? "Nothing queued" : "task" + (count === 1 ? "" : "s") + " ahead"}
    />
  );
}

// ExpandedView aliases — the existing widget bodies ARE the expanded
// views, exposed under the Phase A name so the registry can wire them
// in via the `ExpandedView` field.
export const OverdueTasksExpanded = OverdueTasksWidget;
export const TodaysTasksExpanded = TodaysTasksWidget;
export const UpcomingTasksExpanded = UpcomingTasksWidget;
