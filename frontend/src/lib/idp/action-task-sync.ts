// Check-ins Phase 3 (checkins-phase3 bot, 2026-06-12). The IDP action-plan ->
// Task sync engine. A parallel of the Phase 2 D4 engine
// (lib/one-on-one/action-item-sync.ts), but SIMPLER because the trainee owns
// BOTH the IDP and the task: owner === current user === the IDP owner, so there
// is no cross-user write and the task -> row completion direction can write the
// row directly (no read-time reconcile needed across owners).
//
// The trigger is the trainee clicking "Add to tasks" on a DATED action-plan row
// (the mockup affordance). That materializes a REAL standalone Lists task in the
// trainee's namespace:
//   task_type: "list", project_id: 0 (the proven falsy-project path),
//   name = the objective, start_date = end_date = the target_date (duration 1),
//   source: { kind: "idp_action", idp_id, row_id }.
// The row's `synced_task_id` back-links to the task; `source` back-links to the
// row. Row status `done` <-> task `is_complete` are mirrored. Removing the date
// or deleting the row deletes the task.
//
// Why injected ops: makes the create / edit / complete / delete transitions
// trivially unit-testable with an in-memory mock, mirroring the Phase 2 style.

import type { IdpActionRow, IdpActionStatus, SharedUser, Task } from "../types";

/** The owner-scoped task operations the IDP sync needs. All address a task in
 *  the TRAINEE's namespace (the IDP owner). The local-api wiring supplies
 *  concrete implementations backed by the per-user `tasksStore`; tests supply a
 *  small in-memory mock. */
export interface IdpTaskSyncOps {
  createTask(owner: string, data: IdpSyncedTaskDraft): Promise<Task>;
  updateTask(owner: string, id: number, patch: Partial<Task>): Promise<Task | null>;
  deleteTask(owner: string, id: number): Promise<void>;
  getTask(owner: string, id: number): Promise<Task | null>;
}

/** The fields the sync sets on a freshly-created synced task. The wiring fills
 *  the rest of the Task record (defaults + the numeric id). */
export interface IdpSyncedTaskDraft {
  name: string;
  start_date: string;
  /** The trainee owns the task. */
  owner: string;
  shared_with: SharedUser[];
  is_complete: boolean;
  source: { kind: "idp_action"; idp_id: string; row_id: string };
}

/** True when a row currently qualifies for a synced task (it has a target
 *  date). The trainee owns it, so the only condition is a date. */
export function rowShouldHaveTask(row: { target_date: string | null }): boolean {
  return !!row.target_date;
}

/** Map an IDP action status to a task complete flag (only `done` completes). */
export function statusToComplete(status: IdpActionStatus): boolean {
  return status === "done";
}

/**
 * Materialize a synced Task for a DATED action-plan row when the trainee clicks
 * "Add to tasks". Returns the row patch to persist (its `synced_task_id`). A
 * no-op (returns the existing link) when the row already has a task or has no
 * date.
 *
 * `idpId` is the owning IDP's id; `owner` is the trainee (= IDP owner = current
 * user). The caller persists the returned patch on the row.
 */
export async function addRowToTasks(
  ops: IdpTaskSyncOps,
  owner: string,
  idpId: string,
  row: IdpActionRow,
): Promise<{ synced_task_id: number | null }> {
  // Already synced or not dated: nothing to do.
  if (typeof row.synced_task_id === "number" && row.synced_task_id !== null) {
    return { synced_task_id: row.synced_task_id };
  }
  if (!rowShouldHaveTask(row)) {
    return { synced_task_id: null };
  }
  const created = await ops.createTask(owner, {
    name: row.objective,
    start_date: row.target_date as string,
    owner,
    shared_with: [],
    is_complete: statusToComplete(row.status),
    source: { kind: "idp_action", idp_id: idpId, row_id: row.id },
  });
  return { synced_task_id: created.id };
}

/**
 * Reconcile a row's synced Task after an EDIT of the row (objective / date /
 * status). Returns the row patch to persist (its `synced_task_id`, possibly
 * cleared). Transition table:
 *   - synced, still dated      -> UPDATE task name/date/complete
 *   - synced, date removed     -> DELETE task, clear synced_task_id
 *   - not synced               -> no-op (the trainee re-adds via addRowToTasks)
 *
 * Note we do NOT auto-create a task on edit: a fresh row only gets a task when
 * the trainee explicitly clicks "Add to tasks". Editing a non-synced row leaves
 * it in-IDP-only.
 */
export async function reconcileRowTask(
  ops: IdpTaskSyncOps,
  owner: string,
  row: IdpActionRow,
): Promise<{ synced_task_id: number | null }> {
  const hadTask =
    typeof row.synced_task_id === "number" && row.synced_task_id !== null;
  if (!hadTask) {
    return { synced_task_id: row.synced_task_id ?? null };
  }
  const taskId = row.synced_task_id as number;

  // Date removed: detach + delete.
  if (!rowShouldHaveTask(row)) {
    await ops.deleteTask(owner, taskId);
    return { synced_task_id: null };
  }

  // Still dated: update name / date / completion in place.
  await ops.updateTask(owner, taskId, {
    name: row.objective,
    start_date: row.target_date as string,
    duration_days: 1,
    is_complete: statusToComplete(row.status),
  });
  return { synced_task_id: taskId };
}

/**
 * Delete a row's synced task (when the row itself is deleted). No-op when the
 * row has no task.
 */
export async function deleteRowTask(
  ops: IdpTaskSyncOps,
  owner: string,
  row: Pick<IdpActionRow, "synced_task_id">,
): Promise<void> {
  if (typeof row.synced_task_id !== "number" || row.synced_task_id === null) {
    return;
  }
  await ops.deleteTask(owner, row.synced_task_id);
}

/**
 * Reconcile the ROW status FROM its synced task on read (the trainee may have
 * checked the to-do off in their Lists view). Because the trainee owns both, we
 * read the task and, if its `is_complete` disagrees with the row's done state,
 * the task wins. Returns the reconciled status plus whether a write-back is
 * needed.
 *
 * Only the done <-> not-started/in-progress axis is reconciled: completing the
 * task sets the row to `done`; un-completing the task does not guess between
 * not-started and in-progress, so it reverts a previously-done row to
 * `in_progress` (the row is clearly underway since it had a task).
 */
export async function reconcileRowStatusFromTask(
  ops: IdpTaskSyncOps,
  owner: string,
  row: Pick<IdpActionRow, "synced_task_id" | "status">,
): Promise<{ status: IdpActionStatus; changed: boolean }> {
  if (typeof row.synced_task_id !== "number" || row.synced_task_id === null) {
    return { status: row.status, changed: false };
  }
  const task = await ops.getTask(owner, row.synced_task_id);
  if (!task) {
    return { status: row.status, changed: false };
  }
  const rowDone = row.status === "done";
  if (task.is_complete === rowDone) {
    return { status: row.status, changed: false };
  }
  const next: IdpActionStatus = task.is_complete ? "done" : "in_progress";
  return { status: next, changed: true };
}
