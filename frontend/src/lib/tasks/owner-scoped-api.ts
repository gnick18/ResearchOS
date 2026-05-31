// Owner-scoped wrapper around `tasksApi` mutations. When the current viewer
// is a receiver of a shared task with edit permission, every mutation needs
// to write back to the OWNER's directory (`users/Kritika/tasks/1.json`),
// not the current user's. Plain own tasks (or read-only views) pass
// undefined and the writes go to the current user's directory.
//
// Lives here (not inside TaskDetailPopup) so MethodTabs / VariationNotesPanel /
// any future popup-internal component can import without creating a circular
// dep on TaskDetailPopup. Pattern: every popup-internal component does
// `useMemo(() => ownerScopedTasksApi(task), [task])` and uses the resulting
// `tasksApi` for mutations.

import { tasksApi as rawTasksApi } from "@/lib/local-api";
import type { TaskUpdate, TaskMoveRequest } from "@/lib/local-api";
import type { Task } from "@/lib/types";
import type { HistoryEditKind } from "@/lib/history";

function effectiveOwnerOf(task: Task): string | undefined {
  return task.is_shared_with_me && task.shared_permission === "edit"
    ? task.owner
    : undefined;
}

export function ownerScopedTasksApi(task: Task) {
  const owner = effectiveOwnerOf(task);
  return {
    ...rawTasksApi,
    get: (id: number) => rawTasksApi.get(id, owner),
    // VC Phase 3 (FLAG-5, Task): forward the optional `historyMeta` stamp so the
    // restore / undo-restore flows can mark the resulting history row a
    // "revert" / "undo-revert" kind. Defaults to {kind:"update"} inside
    // rawTasksApi.update, so existing 2-arg callers are byte-for-byte unchanged.
    update: (
      id: number,
      data: TaskUpdate,
      historyMeta?: { kind: HistoryEditKind; revert_target_version?: number },
    ) => rawTasksApi.update(id, data, owner, historyMeta),
    move: (id: number, data: TaskMoveRequest) => rawTasksApi.move(id, data, owner),
    convertType: (id: number, type: "experiment" | "purchase" | "list") =>
      rawTasksApi.convertType(id, type, owner),
    resetPcr: (id: number, methodId?: number) => rawTasksApi.resetPcr(id, methodId, owner),
    resetLc: (id: number, methodId?: number) => rawTasksApi.resetLc(id, methodId, owner),
    resetPlate: (id: number, methodId?: number) => rawTasksApi.resetPlate(id, methodId, owner),
    addMethod: (taskId: number, methodId: number, methodOwner?: string | null) =>
      rawTasksApi.addMethod(taskId, methodId, methodOwner, owner),
    removeMethod: (taskId: number, methodId: number) =>
      rawTasksApi.removeMethod(taskId, methodId, owner),
    updateMethodPcr: (
      taskId: number,
      methodId: number,
      data: { pcr_gradient?: string; pcr_ingredients?: string }
    ) => rawTasksApi.updateMethodPcr(taskId, methodId, data, owner),
    updateMethodLc: (
      taskId: number,
      methodId: number,
      data: { lc_gradient?: string }
    ) => rawTasksApi.updateMethodLc(taskId, methodId, data, owner),
    updateMethodMarkdownOverride: (taskId: number, methodId: number, body: string) =>
      rawTasksApi.updateMethodMarkdownOverride(taskId, methodId, body, owner),
    resetMarkdownOverride: (taskId: number, methodId: number) =>
      rawTasksApi.resetMarkdownOverride(taskId, methodId, owner),
    updateMethodPlate: (
      taskId: number,
      methodId: number,
      data: { plate_annotation?: string }
    ) => rawTasksApi.updateMethodPlate(taskId, methodId, data, owner),
    updateMethodCellCulture: (
      taskId: number,
      methodId: number,
      data: { cell_culture_schedule?: string }
    ) => rawTasksApi.updateMethodCellCulture(taskId, methodId, data, owner),
    saveVariationNote: (taskId: number, methodId: number, notes: string) =>
      rawTasksApi.saveVariationNote(taskId, methodId, notes, owner),
    // Lab-mode comment thread. Like every other mutating call, receiver-edits
    // route to the OWNER's task file so the comment is visible to everyone.
    // Read-only shared views never reach here — CommentsThread hides the
    // input when `readOnly` is set.
    //
    // Lab Head Phase 2: forward the optional `options` arg (parent_id +
    // mentions) so reply threads + @-mention dispatch route through the
    // owner-scoped path the same way new top-level comments do.
    addComment: (
      taskId: number,
      text: string,
      author: string,
      options?: { parent_id?: string | null; mentions?: string[] },
    ) => rawTasksApi.addComment(taskId, text, author, owner, options),
    deleteComment: (taskId: number, commentId: string) =>
      rawTasksApi.deleteComment(taskId, commentId, owner),
    // `delete` intentionally not owner-routed: only the original owner
    // should be able to destroy the file.
  };
}
