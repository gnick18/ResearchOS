"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { assignTask } from "@/lib/lab/pi-actions";
import { useLabData } from "@/hooks/useLabData";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { useArchivedUsers } from "@/hooks/useArchivedUsers";
import Tooltip from "@/components/Tooltip";
import { taskKey } from "@/lib/types";
import type { Task } from "@/lib/types";

interface AssignTaskButtonProps {
  task: Task;
  /** PI's username (audit actor). Caller verifies the active user is a
   *  lab head + the session is unlocked. */
  actor: string;
  /** Active Phase 5 session id. */
  sessionId: string;
  /** Fires after the assignment lands so the parent popup can refresh
   *  any cached task state. */
  onAssigned?: () => void;
}

/**
 * Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): "Assign to…"
 * button inside TaskDetailPopup. Visible only when the popup wrapper has
 * already confirmed the PI is in an unlocked edit session AND the task
 * is owned by someone other than the PI (the typical lab-mode shape).
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
  sessionId,
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

  const handleAssign = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await assignTask({
        actor,
        sessionId,
        targetOwner: task.owner,
        taskId: task.id,
        assignee: selected,
        note: note.trim() || null,
        taskName: task.name,
      });
      // Invalidate the task queries so the popup re-reads the new assignee.
      await queryClient.invalidateQueries({ queryKey: ["task", taskKey(task)] });
      await queryClient.invalidateQueries({ queryKey: ["lab", "tasks"] });
      setOpen(false);
      setNote("");
      onAssigned?.();
    } catch (err) {
      console.error("[assign-task] failed", err);
      alert("Failed to assign task. See console for details.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip
        label={
          task.assignee
            ? `Currently assigned to ${task.assignee}. Click to reassign.`
            : "Assign this task to a lab member"
        }
        placement="bottom"
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
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

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h3 className="text-base font-semibold text-gray-900">
                Assign task
              </h3>
              <p className="text-xs text-gray-500 mt-0.5 break-words">
                {task.name} — owned by {task.owner}
              </p>
            </header>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Assignee
              </label>
              <select
                value={selected ?? ""}
                onChange={(e) => setSelected(e.target.value || null)}
                disabled={busy}
                className="w-full text-sm rounded-md border border-gray-300 px-2 py-1.5 bg-white focus:ring-2 focus:ring-emerald-500"
                data-testid="lab-head-assign-task-select"
              >
                <option value="">— Pick a lab member —</option>
                {users
                  .filter((u) => !archivedSet.has(u.username))
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
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Note (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
                placeholder="e.g. Please pick this up this week — sequencing primers are in the freezer."
                className="w-full min-h-[60px] text-sm rounded-md border border-gray-300 px-2 py-1.5 focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="px-3 py-1.5 rounded-md text-xs text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAssign}
                disabled={busy || !selected}
                className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:bg-gray-300"
                data-testid="lab-head-assign-task-confirm"
              >
                {busy ? "Assigning…" : "Assign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
