"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { assignTask } from "@/lib/lab/pi-actions";
import { useLabData } from "@/hooks/useLabData";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { useArchivedUsers } from "@/hooks/useArchivedUsers";
import Tooltip from "@/components/Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";
import { taskKey } from "@/lib/types";
import type { Task } from "@/lib/types";

interface AssignTaskButtonProps {
  task: Task;
  /** Lab head's username (audit actor). Caller verifies the active user is a
   *  lab head viewing a member's task. */
  actor: string;
  /** Fires after the assignment lands so the parent popup can refresh
   *  any cached task state. */
  onAssigned?: () => void;
}

/**
 * Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): "Assign to…"
 * button inside TaskDetailPopup. Visible only when the popup wrapper has
 * confirmed the active user is a lab head viewing a task owned by someone
 * else (the typical lab-mode shape). Assigning is a lab-head role privilege;
 * the old PI edit-session unlock requirement was removed.
 *
 * The picker is a small dropdown of lab members (from useLabData) with
 * an optional note field. Clicking Assign writes via
 * `pi-actions.assignTask` which:
 *   - routes the write through the owner-scoped tasksApi
 *   - appends an audit entry to the owner's `_pi_audit.json`
 *   - posts a `lab_task_assignment` notification to the assignee
 */
export default function AssignTaskButton({
  task,
  actor,
  onAssigned,
}: AssignTaskButtonProps) {
  const queryClient = useQueryClient();
  const { users } = useLabData();
  const profileMap = useLabUserProfileMap();
  // Lab Head Phase 6: filter archived members out of the assignee
  // dropdown. Existing assignments on archived users stay intact (the
  // task record carries `assignee: "<username>"` as a string; nothing
  // here mutates that path). New assignments can only target active
  // members.
  const archivedSet = useArchivedUsers();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(task.assignee ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Escape / scrim close route through LivingPopup, suspended while a write is
  // in flight (busy) so a mid-assign click cannot dismiss the modal.
  const closeIfIdle = () => {
    if (!busy) setOpen(false);
  };

  // PiActionResult handling: data-write failures show a blocking alert;
  // audit-only failures show a separate non-blocking alert (the data DID
  // land); cache invalidation runs even on audit failure.
  const handleAssign = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await assignTask({
        actor,
        targetOwner: task.owner,
        taskId: task.id,
        assignee: selected,
        note: note.trim() || null,
        taskName: task.name,
      });

      if (!result.ok && result.reason === "data-write") {
        console.error("[assign-task] data write failed", result.error);
        const msg =
          result.error instanceof Error
            ? result.error.message
            : "Failed to assign task. See console for details.";
        alert(msg);
        return;
      }

      // Either ok or audit-only failure — the data write LANDED, so
      // we should invalidate and close.
      await queryClient.invalidateQueries({ queryKey: ["task", taskKey(task)] });
      await queryClient.invalidateQueries({ queryKey: ["lab", "tasks"] });
      setOpen(false);
      setNote("");
      onAssigned?.();

      if (!result.ok && result.reason === "audit") {
        console.warn("[assign-task] audit write failed", result.error);
        alert(
          "Task was assigned, but the audit log entry could not be written. " +
            "The record reflects the new assignee, but this change won't appear in the audit history. " +
            "Check the file system permissions and try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  // Mira Batch 1 polish (2026-05-23): surface "(archived)" in the
  // tooltip when the current assignee has been archived since the
  // assignment, so the PI knows why the bell never landed.
  const assigneeIsArchived =
    !!task.assignee && archivedSet.has(task.assignee);

  return (
    <>
      <Tooltip
        label={
          task.assignee
            ? assigneeIsArchived
              ? `Currently assigned to ${task.assignee} (archived). Click to reassign.`
              : `Currently assigned to ${task.assignee}. Click to reassign.`
            : "Assign this task to a lab member"
        }
        placement="bottom"
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-meta font-medium border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
          data-testid="lab-head-assign-task-button"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" />
            <line x1="22" y1="11" x2="16" y2="11" />
          </svg>
          {task.assignee ? "Reassign" : "Assign to…"}
        </button>
      </Tooltip>

      <LivingPopup
        open={open}
        onClose={closeIfIdle}
        label="Assign task"
        card={false}
        widthClassName="max-w-md"
        closeOnScrimClick={!busy}
      >
          <div
            className="pointer-events-auto bg-surface-raised rounded-xl ros-popup-card-shadow w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h3 className="text-title font-semibold text-foreground">
                Assign task
              </h3>
              <p className="text-meta text-foreground-muted mt-0.5 break-words">
                {task.name} — owned by {task.owner}
              </p>
            </header>

            <div>
              <label className="block text-meta font-medium text-foreground mb-1">
                Assignee
              </label>
              <select
                value={selected ?? ""}
                onChange={(e) => setSelected(e.target.value || null)}
                disabled={busy}
                className="w-full text-body rounded-md border border-border px-2 py-1.5 bg-surface-raised focus:ring-2 focus:ring-emerald-500"
                data-testid="lab-head-assign-task-select"
              >
                <option value="">Pick a lab member…</option>
                {users
                  .filter((u) => !archivedSet.has(u.username))
                  // Mira Batch 1 polish (2026-05-23): the PI shouldn't
                  // be in their own assignee dropdown — a self-assign
                  // is a no-op that just emits an audit row, and the
                  // notification fan-out is skipped anyway. Filter the
                  // actor out so the picker only lists candidates.
                  .filter((u) => u.username !== actor)
                  .map((u) => {
                    const label =
                      profileMap[u.username]?.displayName?.trim() ?? u.username;
                    return (
                      <option key={u.username} value={u.username}>
                        {label} ({u.username})
                      </option>
                    );
                  })}
              </select>
            </div>

            <div>
              <label className="block text-meta font-medium text-foreground mb-1">
                Note (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
                placeholder="e.g. Please pick this up this week. Sequencing primers are in the freezer."
                className="w-full min-h-[60px] text-body rounded-md border border-border px-2 py-1.5 focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="px-3 py-1.5 rounded-md text-meta text-foreground-muted hover:bg-surface-sunken"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAssign}
                disabled={busy || !selected}
                className="ros-btn-raise px-3 py-1.5 rounded-md bg-emerald-600 text-white text-meta font-medium hover:bg-emerald-700 disabled:bg-gray-300"
                data-testid="lab-head-assign-task-confirm"
              >
                {busy ? "Assigning…" : "Assign"}
              </button>
            </div>
          </div>
      </LivingPopup>
    </>
  );
}
