"use client";

import { useMemo, useState } from "react";
import LabSearchPanel from "@/components/LabSearchPanel";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import { useLabData } from "@/hooks/useLabData";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import type { LabTask } from "@/lib/local-api";
import type { Task } from "@/lib/types";

/**
 * Lab Mode retirement R3 (R3 widget catalog manager, 2026-05-23):
 * canvas-surface port of `LabSearchPanel`. Global search across every
 * lab-visible task / project / method.
 *
 * Implementation note: reuses the existing `LabSearchPanel` 1:1 —
 * the panel already handles the keyword + date + type + project +
 * method + completion filter matrix client-side off the cached lab
 * queries (the same caches the canvas + sidebar widgets read), so the
 * widget body is just a thin wrapper that hands it the visible
 * usernames and locally mounts the result-click popup.
 *
 * Visibility: lab heads see every user; members see their own + the
 * usernames whose work has been surfaced via the cross-lab queries.
 * (Same simplification as `LabExperimentsWidget`.)
 */
export default function LabSearchWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { users } = useLabData();
  const [selectedTask, setSelectedTask] = useState<LabTask | null>(null);

  const visibleUsernames = useMemo(() => {
    if (!currentUser) return new Set<string>();
    if (accountType === "lab_head") {
      return new Set(users.map((u) => u.username));
    }
    // For non-PIs, default to the full lab membership for now — the
    // LabSearchPanel filters its own results by what's already on the
    // user-shared lab caches. R1's unified-sharing migration is what
    // will let us pre-narrow this set per record; until then, members
    // see the same search scope they see on `/lab?tab=search` today.
    return new Set(users.map((u) => u.username));
  }, [users, currentUser, accountType]);

  return (
    <div className="space-y-3 -m-1">
      <LabSearchPanel
        selectedUsernames={visibleUsernames}
        onTaskClick={setSelectedTask}
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
// Phase A snapshot + expanded contract (Phase A redispatch manager, 2026-05-23)
// ─────────────────────────────────────────────────────────────────────────────
import StatTile from "./snapshot/StatTile";
import type { SnapshotTileProps } from "./types";

export function SnapshotTile(_props: SnapshotTileProps) {
  const { users, tasks } = useLabData();
  return (
    <StatTile
      icon={
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
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      }
      iconClassName="text-gray-500"
      label="Lab search"
      stat={tasks.length}
      sub={
        users.length === 0
          ? "No members yet"
          : `across ${users.length} member${users.length === 1 ? "" : "s"}`
      }
    />
  );
}

export const ExpandedView = LabSearchWidget;
