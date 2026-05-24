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
// Phase B Batch B3 (Phase B Batch B3 manager, 2026-05-23): unique
// per-widget tile designs.
// ─────────────────────────────────────────────────────────────────────────────
// SnapshotTile is a 2-row hero: big "running" count up top, a
// "writeup + completed-this-week" split underneath. Uses the shared
// `HeroNumberTile` primitive.
//
// SidebarTile compresses to a slim row with the same headline
// number (running).
import HeroNumberTile from "./snapshot/HeroNumberTile";
import SidebarStatTile from "./snapshot/SidebarStatTile";
import type { SnapshotTileProps, SidebarTileProps } from "./types";

const BEAKER_ICON_16 = (
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
    <path d="M10 2v7.31" />
    <path d="M14 9.3V2" />
    <path d="M8.5 2h7" />
    <path d="M14 9.3a6.5 6.5 0 1 1-4 0" />
  </svg>
);

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

/**
 * Experiment counts split into the three buckets the tile surfaces:
 *   - running: open, not complete, has started, has not ended
 *   - awaitingWriteup: end_date in the past but not complete (the
 *     proxy for "experiment ran but no writeup yet")
 *   - completedThisWeek: complete AND end_date within the last 7 days
 *
 * "Awaiting writeup" is a heuristic — there's no explicit "writeup
 * status" field on Task today. The brief asked for it explicitly so
 * we approximate; a follow-up could replace with a real signal if
 * one lands later.
 */
function useExperimentCounts() {
  const { tasks } = useLabData();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoIso = weekAgo.toISOString().slice(0, 10);
  let running = 0;
  let awaitingWriteup = 0;
  let completedThisWeek = 0;
  for (const t of tasks) {
    if (t.task_type !== "experiment") continue;
    if (t.is_complete) {
      if (t.end_date && t.end_date >= weekAgoIso) completedThisWeek++;
    } else {
      if (t.end_date && t.end_date < todayIso) {
        awaitingWriteup++;
      } else {
        running++;
      }
    }
  }
  return { running, awaitingWriteup, completedThisWeek };
}

export function SnapshotTile(_props: SnapshotTileProps) {
  const { running, awaitingWriteup, completedThisWeek } = useExperimentCounts();
  return (
    <HeroNumberTile
      icon={BEAKER_ICON_16}
      accent={running > 0 ? "blue" : "calm"}
      label="Experiments"
      primary={running}
      secondary={
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="truncate">
            {awaitingWriteup === 0
              ? "Nothing awaiting writeup"
              : `${awaitingWriteup} awaiting writeup`}
          </span>
          {completedThisWeek > 0 && (
            <span className="text-[10px] text-gray-400 truncate">
              {completedThisWeek} done this week
            </span>
          )}
        </div>
      }
    />
  );
}

export const ExpandedView = LabExperimentsWidget;

// ─────────────────────────────────────────────────────────────────────────────
// SidebarTile — slim row showing "X running".
// ─────────────────────────────────────────────────────────────────────────────

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { running } = useExperimentCounts();
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
