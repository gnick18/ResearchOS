// Check-ins revamp Phase 2 (checkins-phase2 bot, 2026-06-12). See
// docs/proposals/checkins-revamp.md "Phase 2 build spec", decision D4.
//
// The D4 sync engine. A check-in action item that has BOTH an `assignee` AND a
// `due_date` materializes a REAL Task (not a read-only overlay) so the to-do
// surfaces in the assignee's Lists view, exactly the way a PI-assigned task
// does today. This module is the SINGLE place that keeps the action item and
// its synced Task in lockstep, so the back-links never drift.
//
// Why injected ops (TaskSyncOps) instead of importing tasksApi directly:
//   - The action-item -> Task write must land in the SPACE OWNER's folder
//     (owner === the check-in creator), NOT the current user's folder. A
//     non-owner member adding an assigned item must not create the task in
//     their own namespace. `tasksApi.create` always writes to the current user,
//     so the local-api wiring builds the owner-scoped ops with
//     `tasksStore.{createForUser,updateForUser,deleteForUser}`.
//   - Injecting the ops makes the transition logic (create / edit / complete /
//     delete / detach) trivially unit-testable with a mock store, with zero
//     file-system or current-user plumbing. Mirrors the one-on-one test style.
//
// The task shape (D4-locked):
//   task_type: "list", project_id: 0 (STANDALONE, the proven falsy-project path
//   in WorkbenchListsPanel), name = the item text, start_date = end_date = the
//   due date (duration 1 day), owner = the space owner, assignee = the member,
//   shared_with includes the assignee at "edit". `source` back-links to the
//   item; the item's `synced_task_id` back-links to the task. This is the exact
//   shape a PI-assigned task carries, so it lands in the member's view with NO
//   cross-user write and no new ownership invariant.

import type { OneOnOneActionItem, SharedUser, Task } from "../types";

/** A synced item is one that currently has BOTH an assignee and a due date. */
export function shouldHaveSyncedTask(item: {
  assignee?: string | null;
  due_date?: string | null;
}): boolean {
  return !!item.assignee && !!item.due_date;
}

/**
 * The owner-scoped task operations the sync needs. All three address a task in
 * the GIVEN owner's namespace (the check-in space owner), never the current
 * user's. The local-api wiring supplies concrete implementations backed by the
 * per-user `tasksStore`; tests supply a small in-memory mock.
 */
export interface TaskSyncOps {
  /** Create a task in `owner`'s folder. Returns the created task (with its
   *  numeric id assigned in that owner's namespace). */
  createTask(owner: string, data: SyncedTaskDraft): Promise<Task>;
  /** Patch a task in `owner`'s folder. Returns the updated task or null. */
  updateTask(
    owner: string,
    id: number,
    patch: Partial<Task>,
  ): Promise<Task | null>;
  /** Delete a task in `owner`'s folder. */
  deleteTask(owner: string, id: number): Promise<void>;
  /** Read a task in `owner`'s folder. Used to reconcile completion on read. */
  getTask(owner: string, id: number): Promise<Task | null>;
}

/** The fields the sync sets on a freshly-created synced task. The wiring fills
 *  in the rest of the Task record (defaults + the numeric id). */
export interface SyncedTaskDraft {
  name: string;
  start_date: string;
  /** The assignee member. */
  assignee: string;
  /** The space owner — owns the task. */
  owner: string;
  shared_with: SharedUser[];
  is_complete: boolean;
  source: {
    kind: "checkin_action_item";
    one_on_one_id: string;
    action_item_id: string;
  };
}

/** Build the share list for a synced task: the assignee at "edit". The space
 *  owner owns the task so does not need a share row (they read it as owner). */
export function syncedTaskShareList(assignee: string): SharedUser[] {
  return [{ username: assignee, level: "edit" }];
}

/**
 * Reconcile a single action item's synced Task after a CREATE or an EDIT of the
 * item (text / assignee / due_date). Returns the patch to persist on the action
 * item (its `synced_task_id`, possibly cleared). The caller persists that patch
 * through the action-items store.
 *
 * Transition table (D4):
 *   - was unsynced, now has both fields      -> CREATE task, set synced_task_id
 *   - was synced, still has both fields       -> UPDATE task name/dates/assignee
 *   - was synced, assignee OR due_date gone   -> DELETE task, clear synced_task_id
 *   - was unsynced, still missing a field     -> no-op
 *
 * `prev` is the item state BEFORE the edit (so we know the old synced id);
 * `next` is the item state AFTER (the new text/assignee/due_date). When called
 * for a fresh CREATE, pass `prev === next` (no prior synced id).
 */
export async function reconcileSyncedTask(
  ops: TaskSyncOps,
  spaceOwner: string,
  prev: Pick<
    OneOnOneActionItem,
    "synced_task_id" | "one_on_one_id" | "id"
  >,
  next: Pick<
    OneOnOneActionItem,
    "text" | "assignee" | "due_date" | "is_done" | "one_on_one_id" | "id"
  >,
): Promise<{ synced_task_id: number | null }> {
  const hadTask =
    typeof prev.synced_task_id === "number" && prev.synced_task_id !== null;
  const wantsTask = shouldHaveSyncedTask(next);

  // Detach: previously synced, no longer qualifies. Delete the task and clear
  // the link so the item reverts to in-space-only.
  if (hadTask && !wantsTask) {
    await ops.deleteTask(spaceOwner, prev.synced_task_id as number);
    return { synced_task_id: null };
  }

  // No task needed and none exists.
  if (!wantsTask) {
    return { synced_task_id: prev.synced_task_id ?? null };
  }

  // From here `wantsTask` is true, so assignee + due_date are non-null.
  const assignee = next.assignee as string;
  const dueDate = next.due_date as string;

  // Update the existing synced task in place (text / date / assignee).
  if (hadTask) {
    await ops.updateTask(spaceOwner, prev.synced_task_id as number, {
      name: next.text,
      start_date: dueDate,
      duration_days: 1,
      assignee,
      shared_with: syncedTaskShareList(assignee),
      is_complete: next.is_done,
    });
    return { synced_task_id: prev.synced_task_id as number };
  }

  // Create a fresh synced task and link it.
  const created = await ops.createTask(spaceOwner, {
    name: next.text,
    start_date: dueDate,
    assignee,
    owner: spaceOwner,
    shared_with: syncedTaskShareList(assignee),
    is_complete: next.is_done,
    source: {
      kind: "checkin_action_item",
      one_on_one_id: next.one_on_one_id,
      action_item_id: next.id,
    },
  });
  return { synced_task_id: created.id };
}

/**
 * Mirror a DONE-toggle of the action item onto its synced task. Called from the
 * toggle path so checking the item off in the check-in space also completes the
 * member's to-do (and vice versa via `reconcileCompletionFromTask` on read).
 * No-op when the item has no synced task.
 */
export async function pushCompletionToTask(
  ops: TaskSyncOps,
  spaceOwner: string,
  item: Pick<OneOnOneActionItem, "synced_task_id" | "is_done">,
): Promise<void> {
  if (typeof item.synced_task_id !== "number" || item.synced_task_id === null) {
    return;
  }
  await ops.updateTask(spaceOwner, item.synced_task_id, {
    is_complete: item.is_done,
  });
}

/**
 * The lighter-weight TASK -> ITEM completion direction. On a READ of action
 * items, if the synced task's `is_complete` differs from the item's `is_done`,
 * the task wins (the member checked the to-do off in their Lists view). Returns
 * the reconciled `is_done` plus whether the item record needs a write-back.
 *
 * We chose this read-time reconcile for the task -> item direction (rather than
 * a cross-store write triggered from the Lists panel) because the action item
 * lives in the space owner's folder and a member completing the task in their
 * own view must not perform a cross-owner write. The next read of the check-in
 * space resolves the difference and the owner's folder is updated in place.
 */
export async function reconcileCompletionFromTask(
  ops: TaskSyncOps,
  spaceOwner: string,
  item: Pick<OneOnOneActionItem, "synced_task_id" | "is_done">,
): Promise<{ is_done: boolean; changed: boolean }> {
  if (typeof item.synced_task_id !== "number" || item.synced_task_id === null) {
    return { is_done: item.is_done, changed: false };
  }
  const task = await ops.getTask(spaceOwner, item.synced_task_id);
  if (!task) {
    // The task was deleted out from under the item (e.g. directly in Lists).
    // Leave the item's state as-is; a follow-up edit will re-sync.
    return { is_done: item.is_done, changed: false };
  }
  if (task.is_complete !== item.is_done) {
    return { is_done: task.is_complete, changed: true };
  }
  return { is_done: item.is_done, changed: false };
}
