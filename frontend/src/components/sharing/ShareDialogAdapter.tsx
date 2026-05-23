"use client";

// Lab Mode retirement R1 (R1 unified sharing manager, 2026-05-23): an
// adapter that wraps `ShareDialog` with a "drop-in for SharePopup"
// interface. SharePopup's contract was:
//
//     <SharePopup
//       itemType="task" | "method" | "project"
//       itemId={N}
//       itemName="…"
//       currentOwner={owner}
//       currentSharedWith={[...SharedUser]}
//       isPublic={bool}
//       onShared={() => refetch()}
//     />
//
// The new ShareDialog takes a single `onSave(next, opts)` callback. To
// minimize callsite churn during the R1 migration window, this adapter
// computes the diff between the previous `shared_with` and the
// dialog-saved list, then calls the matching `sharingApi.X` / `unshareX`
// helpers under the hood. Callers wire `onShared` to their own refetch
// the same way they did with SharePopup.

import { useCallback } from "react";
import { sharingApi, tasksApi } from "@/lib/local-api";
import type { SharedUser, Task } from "@/lib/types";
import ShareDialog, { type ShareDialogRecordType } from "./ShareDialog";
import { normalizeSharedWith } from "@/lib/sharing/unified";

export interface ShareDialogAdapterProps {
  isOpen: boolean;
  onClose: () => void;
  /** Same record types as SharePopup, plus the new ones the unified
   *  primitive adds: "note" | "link" | "goal" | "mass_spec_protocol". */
  recordType: ShareDialogRecordType;
  recordId: number;
  recordName: string;
  ownerUsername: string;
  currentSharedWith: SharedUser[];
  /** Called after the save completes (any case — partial failures still
   *  fire this so the caller refetches). */
  onShared: () => void;
}

export default function ShareDialogAdapter({
  isOpen,
  onClose,
  recordType,
  recordId,
  recordName,
  ownerUsername,
  currentSharedWith,
  onShared,
}: ShareDialogAdapterProps) {
  const handleSave = useCallback(
    async (
      next: SharedUser[],
      options?: { cascadeToTasks?: boolean },
    ) => {
      const before = normalizeSharedWith(currentSharedWith);
      const after = normalizeSharedWith(next);

      const beforeMap = new Map(before.map((s) => [s.username, s.level]));
      const afterMap = new Map(after.map((s) => [s.username, s.level]));

      // 1. Compute additions / removals / level changes.
      const toAdd: SharedUser[] = [];
      const toRemove: string[] = [];

      for (const [u, lvl] of afterMap) {
        const prev = beforeMap.get(u);
        if (prev !== lvl) toAdd.push({ username: u, level: lvl });
      }
      for (const [u] of beforeMap) {
        if (!afterMap.has(u)) toRemove.push(u);
      }

      // 2. Dispatch to the right API per record type.
      //
      //   - task / method / project: per-recipient share/unshare calls
      //     (existing pattern; each call updates the receiver-side
      //     `_shared_with_me.json` + bell notification).
      //   - note / link / goal: R1b adds batched `shareX(id, recipients[])`
      //     that replaces the whole `shared_with` list in one write
      //     (no receiver-side manifest; discovery is canRead-driven).
      //   - mass_spec_protocol: not yet wired — falls through to a
      //     console.warn. Surfaces as the next R1c chip if needed.
      if (
        recordType === "task" ||
        recordType === "method" ||
        recordType === "project"
      ) {
        for (const entry of toAdd) {
          const data = {
            username: entry.username,
            level: entry.level,
          };
          if (recordType === "task") {
            await sharingApi.shareTask(recordId, data);
          } else if (recordType === "method") {
            await sharingApi.shareMethod(recordId, data);
          } else {
            await sharingApi.shareProject(recordId, data);
          }
        }
        for (const username of toRemove) {
          if (recordType === "task") {
            await sharingApi.unshareTask(recordId, username);
          } else if (recordType === "method") {
            await sharingApi.unshareMethod(recordId, username);
          } else {
            await sharingApi.unshareProject(recordId, username);
          }
        }
      } else if (
        recordType === "note" ||
        recordType === "link" ||
        recordType === "goal"
      ) {
        // Batched replacement: take the full `after` list as the new
        // truth. The new sharingApi.shareX helpers persist the whole
        // array in one disk write.
        const recipients = after.map((s) => ({
          username: s.username,
          level: s.level,
        }));
        if (recordType === "note") {
          await sharingApi.shareNote(recordId, recipients);
        } else if (recordType === "link") {
          await sharingApi.shareLink(recordId, recipients);
        } else {
          await sharingApi.shareGoal(recordId, recipients);
        }
      } else {
        console.warn(
          `[ShareDialogAdapter] record type "${recordType}" not yet wired ` +
            `into the per-type sharingApi. Pending R1c follow-up.`,
        );
      }

      // Lab Mode retirement R1d (R1d shared_with API manager,
      // 2026-05-23): the method `is_public` legacy mirror block was
      // removed. The dialog now writes to `shared_with` exclusively
      // via `sharingApi.shareMethod` / `unshareMethod`; the on-disk
      // `is_public` field is no longer maintained from the share
      // surface. Any remaining receiver-side read that still checks
      // the boolean is reading stale data, by design, for one
      // release of back-compat. The unified `canRead` /
      // `isWholeLabShared` helpers are the source of truth.

      // 4. Project cascade: when sharing a project AND the user opted
      // into the "Also share all tasks" checkbox, propagate the same
      // `shared_with` list to every task whose `project_id === recordId`.
      //
      // Per-task semantics: compute the diff between each task's own
      // current `shared_with` and the project's `after` list, then
      // dispatch shareTask / unshareTask per recipient delta. This
      // matches the per-recipient API contract (each call updates the
      // receiver-side `_shared_with_me.json` + bell notification) and
      // avoids a destructive "replace task.shared_with wholesale" write
      // which would also wipe per-task individual sharers.
      //
      // Failure policy (Mira-Explorer P0 fix manager, 2026-05-23): a
      // single per-task write failure must NOT abort the cascade. We
      // collect failures, keep cascading, then throw an aggregated
      // error at the very end so the dialog's existing error-surface
      // path (`ShareDialog.handleSave`'s catch block) renders the
      // partial-failure message. Tasks that succeeded stay shared;
      // tasks that failed surface to the user for retry.
      let cascadeError: Error | null = null;
      if (
        recordType === "project" &&
        options?.cascadeToTasks === true
      ) {
        const failed: Array<{ taskId: number; taskName: string; reason: string }> = [];
        let tasks: Task[] = [];
        try {
          tasks = await tasksApi.listByProject(recordId);
        } catch (err) {
          tasks = [];
          failed.push({
            taskId: -1,
            taskName: "(task list)",
            reason:
              (err as { message?: string })?.message ??
              "Failed to load tasks for cascade.",
          });
        }
        for (const task of tasks) {
          try {
            const taskBefore = normalizeSharedWith(task.shared_with ?? []);
            const taskBeforeMap = new Map(
              taskBefore.map((s) => [s.username, s.level]),
            );
            const taskToAdd: SharedUser[] = [];
            const taskToRemove: string[] = [];
            for (const [u, lvl] of afterMap) {
              if (taskBeforeMap.get(u) !== lvl) {
                taskToAdd.push({ username: u, level: lvl });
              }
            }
            for (const [u] of taskBeforeMap) {
              if (!afterMap.has(u)) taskToRemove.push(u);
            }
            for (const entry of taskToAdd) {
              await sharingApi.shareTask(task.id, {
                username: entry.username,
                level: entry.level,
              });
            }
            for (const username of taskToRemove) {
              await sharingApi.unshareTask(task.id, username);
            }
          } catch (err) {
            failed.push({
              taskId: task.id,
              taskName: task.name,
              reason:
                (err as { message?: string })?.message ??
                "Unknown error.",
            });
          }
        }
        if (failed.length > 0) {
          const summary = failed
            .map((f) =>
              f.taskId === -1
                ? f.reason
                : `task "${f.taskName}" (#${f.taskId}): ${f.reason}`,
            )
            .join("; ");
          cascadeError = new Error(
            `Project shared, but cascade to tasks had ${failed.length} failure(s): ${summary}`,
          );
        }
      }

      onShared();

      // Throw AFTER onShared() so the caller still refetches (any
      // tasks that succeeded should appear shared in the UI). The
      // dialog's catch block then renders the aggregated message.
      if (cascadeError) throw cascadeError;
    },
    [recordType, recordId, currentSharedWith, onShared],
  );

  return (
    <ShareDialog
      isOpen={isOpen}
      onClose={onClose}
      recordType={recordType}
      recordId={recordId}
      recordName={recordName}
      ownerUsername={ownerUsername}
      currentSharedWith={currentSharedWith}
      onSave={handleSave}
    />
  );
}
