"use client";

import { useMemo, useState } from "react";
import LabExperimentsPanel from "@/components/LabExperimentsPanel";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import { useLabData } from "@/hooks/useLabData";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { canRead } from "@/lib/sharing/unified";
import type { LabTask } from "@/lib/local-api";
import type { Task } from "@/lib/types";

/**
 * Lab Mode retirement R3 (R3 widget catalog manager, 2026-05-23):
 * canvas-surface port of `LabExperimentsPanel`. Surfaces every
 * experiment across the lab (subject to the unified-sharing canRead
 * gate) inside the standard Widget frame.
 *
 * Implementation note: the existing `LabExperimentsPanel` already
 * encapsulates the outcome-gallery / compare layout + freshness
 * sectioning + per-card image probing. R3 reuses it directly rather
 * than re-implementing the gallery — we feed it the set of usernames
 * the viewer is allowed to see, and wrap each card-click in a local
 * `TaskDetailPopup` so the existing /lab page's popup behavior carries
 * over (popup keeps the widget context, doesn't navigate away).
 *
 * canRead filter: lab heads see every member's experiments; non-PIs
 * see their own + experiments shared with them or to the whole lab
 * via "*". The panel itself filters by `selectedUsernames`, which is
 * the natural place to inject the canRead-narrowed set.
 */
export default function LabExperimentsWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { users, tasks } = useLabData();
  const [selectedTask, setSelectedTask] = useState<LabTask | null>(null);

  // canRead applied at the task level — but `LabExperimentsPanel`
  // already does its own per-task filtering by `selectedUsernames` AND
  // expects a Set of usernames as input. We narrow at the username
  // layer: for PIs, every user is visible; for members, we keep any
  // username whose tasks the viewer can read at least one of.
  //
  // Cheaper alternative: just hand the panel ALL usernames when the
  // viewer is a PI, and the {self} ∪ {usernames who shared an
  // experiment with me} set otherwise. We use the cheaper variant
  // because LabExperimentsPanel ALSO consults `canRead` indirectly
  // (every task it shows is shared-with-everyone in lab mode today).
  const visibleUsernames = useMemo(() => {
    if (!currentUser) return new Set<string>();
    if (accountType === "lab_head") {
      return new Set(users.map((u) => u.username));
    }
    const allowed = new Set<string>([currentUser]);
    const viewer = {
      username: currentUser,
      account_type: "lab" as const,
    };
    for (const t of tasks) {
      if (t.task_type !== "experiment") continue;
      if (allowed.has(t.username)) continue;
      // LabTask doesn't carry shared_with directly; default to []
      // (the labTaskFrom transform strips it). For Phase R3, treat
      // any task surfaced by the cross-lab API as "shared with the
      // whole lab" — that's how the legacy /lab page behaved. R1's
      // unified-sharing migration will give us the per-task shared
      // list on LabTask; once that's in place, we can refine here.
      const shareable = { owner: t.username, shared_with: [] };
      if (canRead(shareable, viewer)) {
        allowed.add(t.username);
      }
    }
    return allowed;
  }, [users, tasks, currentUser, accountType]);

  return (
    <div className="space-y-3 -m-1">
      <LabExperimentsPanel
        selectedUsernames={visibleUsernames}
        onExperimentClick={setSelectedTask}
      />
      {selectedTask && (
        <TaskDetailPopup
          task={labTaskToTask(selectedTask)}
          onClose={() => setSelectedTask(null)}
          readOnly={selectedTask.username !== currentUser}
          username={
            selectedTask.username !== currentUser
              ? selectedTask.username
              : undefined
          }
        />
      )}
    </div>
  );
}

/**
 * Mirror of the LabTask → Task adapter used by `/lab/page.tsx` and
 * `MetricsWidget`. Kept local so this widget can mount in isolation
 * without dragging the page-level helper down.
 */
function labTaskToTask(labTask: LabTask): Task {
  return {
    id: labTask.id,
    project_id: labTask.project_id,
    name: labTask.name,
    start_date: labTask.start_date,
    duration_days: labTask.duration_days,
    end_date: labTask.end_date,
    is_high_level: false,
    is_complete: labTask.is_complete,
    task_type: labTask.task_type as "experiment" | "purchase" | "list",
    weekend_override: null,
    method_ids: labTask.method_ids || [],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: labTask.experiment_color,
    sub_tasks: null,
    method_attachments: (labTask.method_ids || []).map((methodId) => ({
      method_id: methodId,
      owner: null,
      pcr_gradient: null,
      pcr_ingredients: null,
      lc_gradient: null,
      body_override: null,
      plate_annotation: null,
      cell_culture_schedule: null,
      variation_notes: null,
      compound_snapshots: null,
      qpcr_analysis: null,
    })),
    owner: labTask.username,
    shared_with: [],
    inherited_from_project: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase B redesign (Phase B redesign manager, 2026-05-23): content-rich
// SnapshotTile that lists the 3 most-recently-started running
// experiments with status pills. Drops the HeroNumberTile shape; the
// experiment names + their status ARE the signal. SidebarTile keeps
// the Batch B3 slim "X running" row.
// ─────────────────────────────────────────────────────────────────────────────
import SidebarStatTile from "./snapshot/SidebarStatTile";
import type { SnapshotTileProps, SidebarTileProps } from "./types";

const BEAKER_ICON_14 = (
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
    <path d="M10 2v7.31" />
    <path d="M14 9.3V2" />
    <path d="M8.5 2h7" />
    <path d="M14 9.3a6.5 6.5 0 1 1-4 0" />
  </svg>
);

type ExperimentStatus = "running" | "awaiting_writeup" | "blocked";
type ExperimentRow = {
  task: LabTask;
  status: ExperimentStatus;
  daysSinceStart: number | null;
  daysUntilEnd: number | null;
};

/**
 * Experiment buckets used by both SnapshotTile (top-3 list) and
 * SidebarTile (running-count).
 *   - running: open, not complete, NOT past its end_date
 *   - awaiting_writeup: end_date in the past but not complete (proxy
 *     for "experiment ran but no writeup yet" — no explicit field)
 *   - blocked: not yet implemented — there's no "blocker dep" signal
 *     on LabTask today; the slot stays in the union so future data
 *     can fill it without a re-typing.
 */
function useExperimentData() {
  const { tasks } = useLabData();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const todayIso = today.toISOString().slice(0, 10);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoIso = weekAgo.toISOString().slice(0, 10);

  let running = 0;
  let awaitingWriteup = 0;
  let completedThisWeek = 0;
  const rows: ExperimentRow[] = [];
  for (const t of tasks) {
    if (t.task_type !== "experiment") continue;
    if (t.is_complete) {
      if (t.end_date && t.end_date >= weekAgoIso) completedThisWeek++;
      continue;
    }
    let status: ExperimentStatus;
    if (t.end_date && t.end_date < todayIso) {
      status = "awaiting_writeup";
      awaitingWriteup++;
    } else {
      status = "running";
      running++;
    }
    const startMs = t.start_date
      ? new Date(`${t.start_date}T00:00:00`).getTime()
      : NaN;
    const endMs = t.end_date
      ? new Date(`${t.end_date}T00:00:00`).getTime()
      : NaN;
    rows.push({
      task: t,
      status,
      daysSinceStart: Number.isFinite(startMs)
        ? Math.max(0, Math.round((todayMs - startMs) / (24 * 60 * 60 * 1000)))
        : null,
      daysUntilEnd: Number.isFinite(endMs)
        ? Math.round((endMs - todayMs) / (24 * 60 * 60 * 1000))
        : null,
    });
  }
  // Most-recently-started first.
  rows.sort((a, b) => (b.task.start_date ?? "").localeCompare(a.task.start_date ?? ""));
  return { running, awaitingWriteup, completedThisWeek, rows };
}

/**
 * SnapshotTile: top 3 running (or awaiting-writeup) experiments. Each
 * row shows the experiment name with a status pill on the right and a
 * "started X days ago" / "due in Y days" tag underneath. Empty state
 * reads "No experiments running" in muted gray.
 */
export function SnapshotTile(_props: SnapshotTileProps) {
  const { rows } = useExperimentData();
  const top3 = rows.slice(0, 3);

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 text-gray-500">
        <span aria-hidden="true" className="text-purple-500 flex-shrink-0">
          {BEAKER_ICON_14}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-medium">
          Experiments
        </span>
      </div>
      <div className="mt-2 flex-1 min-h-0 flex flex-col gap-1.5">
        {top3.length === 0 ? (
          <p className="text-xs text-gray-400 italic m-auto">
            No experiments running
          </p>
        ) : (
          top3.map((row) => {
            const pillClass =
              row.status === "running"
                ? "text-blue-700 bg-blue-50"
                : row.status === "awaiting_writeup"
                  ? "text-amber-700 bg-amber-50"
                  : "text-red-700 bg-red-50";
            const pillLabel =
              row.status === "running"
                ? "RUNNING"
                : row.status === "awaiting_writeup"
                  ? "AWAITING WRITEUP"
                  : "BLOCKED";
            let sub: string;
            if (row.status === "awaiting_writeup" && row.daysUntilEnd !== null) {
              const overdue = Math.abs(row.daysUntilEnd);
              sub =
                overdue === 0
                  ? "ended today"
                  : `ended ${overdue} day${overdue === 1 ? "" : "s"} ago`;
            } else if (
              row.daysUntilEnd !== null &&
              row.daysUntilEnd >= 0 &&
              row.daysUntilEnd <= 7
            ) {
              sub =
                row.daysUntilEnd === 0
                  ? "due today"
                  : `due in ${row.daysUntilEnd} day${row.daysUntilEnd === 1 ? "" : "s"}`;
            } else if (row.daysSinceStart !== null) {
              sub =
                row.daysSinceStart === 0
                  ? "started today"
                  : `started ${row.daysSinceStart} day${row.daysSinceStart === 1 ? "" : "s"} ago`;
            } else {
              sub = "no schedule";
            }
            return (
              <div
                key={`${row.task.username}:${row.task.id}`}
                className="min-w-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <p className="flex-1 min-w-0 text-xs font-medium text-gray-800 truncate">
                    {row.task.name}
                  </p>
                  <span
                    className={`flex-shrink-0 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full font-medium ${pillClass}`}
                  >
                    {pillLabel}
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 truncate">{sub}</p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export const ExpandedView = LabExperimentsWidget;

/**
 * Lab overview PI tooltips (Chip B, 2026-05-25): help-badge copy for
 * the Lab experiments gallery.
 */
export const HELP_TEXT =
  "An outcome gallery across every lab member's experiments. Running, completed, and failed runs together so you can see what worked and what didn't.";

// ─────────────────────────────────────────────────────────────────────────────
// SidebarTile — slim row showing "X running".
// ─────────────────────────────────────────────────────────────────────────────

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { running } = useExperimentData();
  return (
    <SidebarStatTile
      icon={BEAKER_ICON_14}
      iconClassName="text-purple-500"
      label="Experiments"
      stat={`${running} running`}
      onClick={onClick}
    />
  );
}
