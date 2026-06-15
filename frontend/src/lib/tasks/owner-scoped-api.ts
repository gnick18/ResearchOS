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
import type { Task, MethodGatheredChecks } from "@/lib/types";
import type { HistoryEditKind } from "@/lib/history";
import { appendAuditEntries, buildFieldDiffEntries } from "@/lib/lab/pi-audit";

/** Synthetic audit grouping label for role-based PI content edits. */
const LAB_HEAD_EDIT_SESSION = "lab-head-edit";

function effectiveOwnerOf(task: Task): string | undefined {
  return task.is_shared_with_me && task.shared_permission === "edit"
    ? task.owner
    : undefined;
}

/**
 * Owner-scoped tasks API. `piEdit` (PI capability revamp, 2026-06-07) is set when
 * a lab head is editing a member's task on the role (after the once-per-session
 * confirm). It routes every mutation to the member-owner's folder AND emits a
 * per-field audit entry on the primary `update`. No password, no session.
 */
export function ownerScopedTasksApi(task: Task, piEdit?: { actor: string }) {
  // PI role-based edit routes to the task owner's folder; otherwise the existing
  // shared-edit receiver routing (own tasks fall through to undefined).
  const owner = piEdit ? task.owner || undefined : effectiveOwnerOf(task);
  const auditActor = piEdit?.actor;
  return {
    ...rawTasksApi,
    get: (id: number) => rawTasksApi.get(id, owner),
    // VC Phase 3 (FLAG-5, Task): forward the optional `historyMeta` stamp so the
    // restore / undo-restore flows can mark the resulting history row a
    // "revert" / "undo-revert" kind. Defaults to {kind:"update"} inside
    // rawTasksApi.update, so existing 2-arg callers are byte-for-byte unchanged.
    update: async (
      id: number,
      data: TaskUpdate,
      historyMeta?: { kind: HistoryEditKind; revert_target_version?: number },
    ) => {
      // PI edit: diff the touched fields and append audit entries to the owner.
      if (auditActor && owner) {
        const before = await rawTasksApi.get(id, owner);
        const updated = await rawTasksApi.update(id, data, owner, historyMeta);
        if (before && updated) {
          const entries = buildFieldDiffEntries({
            actor: auditActor,
            session_id: LAB_HEAD_EDIT_SESSION,
            target_user: owner,
            record_type: "task",
            record_id: id,
            oldRecord: before as unknown as Record<string, unknown>,
            newRecord: updated as unknown as Record<string, unknown>,
            fieldPaths: Object.keys(data).filter((k) => k !== "updated_at"),
          });
          try {
            await appendAuditEntries(owner, entries);
          } catch (err) {
            console.warn("[ownerScopedTasksApi] appendAuditEntries failed", err);
          }
        }
        return updated;
      }
      return rawTasksApi.update(id, data, owner, historyMeta);
    },
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
    saveGatheredChecks: (
      taskId: number,
      methodId: number,
      gathered: MethodGatheredChecks
    ) => rawTasksApi.saveGatheredChecks(taskId, methodId, gathered, owner),
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
