/**
 * Tiny pubsub for task-completion transitions (twirl-milestones bot).
 *
 * Emitted from the single canonical task-update chokepoint in
 * `local-api.ts` (the `updateTask` path, right where the
 * `task_completed` project-activity record already fires) whenever a
 * task flips from incomplete to complete. UI-flavor consumers subscribe
 * here instead of hooking the dozens of surfaces that can toggle a task
 * complete (TaskDetailPopup, ListTaskRow, WorkbenchListsPanel, the
 * weekly-goals widget, ...). Mirrors the `fileEvents` EventTarget bus.
 *
 * Crucially this carries:
 *   - `taskType`: so the first-experiment-complete milestone can ignore
 *     purchases / plain list items and fire only for experiments.
 *   - `projectFullyComplete`: pre-computed at the emission site (it has
 *     cheap access to the owner's task list for that project), so the
 *     first-project-done milestone does not need to re-read the file
 *     system from the UI thread.
 *
 * Detection-only: this bus does not persist anything and does not gate
 * on the user's animation preference. The milestone hook owns dedup +
 * the opt-out. A missed event (e.g. an offline mark-complete that never
 * went through this path) just means the milestone fires on the next
 * qualifying completion, which is acceptable for a flavor easter-egg.
 */

export interface TaskCompletedDetail {
  /** The active user who performed the mark-complete (current_user). */
  username: string;
  /** The owner of the project the task belongs to. */
  projectOwner: string;
  /** The project the completed task belongs to. 0 means "no project". */
  projectId: number;
  /** Task domain: experiments vs purchases vs plain list items. */
  taskType: "experiment" | "purchase" | "list";
  /** True when, AFTER this completion, every non-trashed task in the
   *  project is complete (and the project has at least one task). */
  projectFullyComplete: boolean;
}

const target = new EventTarget();

export const taskCompletionEvents = {
  emitCompleted(detail: TaskCompletedDetail): void {
    target.dispatchEvent(new CustomEvent("task-completed", { detail }));
  },
  onCompleted(handler: (detail: TaskCompletedDetail) => void): () => void {
    const listener = (ev: Event) =>
      handler((ev as CustomEvent<TaskCompletedDetail>).detail);
    target.addEventListener("task-completed", listener);
    return () => target.removeEventListener("task-completed", listener);
  },
};
