"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { methodsApi } from "@/lib/local-api";
import type { Method, Task } from "@/lib/types";
import { ownerScopedTasksApi } from "@/lib/tasks/owner-scoped-api";
import Tooltip from "@/components/Tooltip";

/**
 * Shared "+ Add component (extend into kit)" affordance shown alongside
 * every non-compound method viewer. Clicking it wraps the current method
 * into a freshly-created compound (the original becomes the first child),
 * then either:
 *
 *  - swaps the task's `method_attachments` entry from the source method to
 *    the new compound (task-attached mode, called from `MethodTabs.tsx`),
 *    and sets the active tab to the new compound; or
 *  - hands the new compound back to the parent so it can close the current
 *    page-level viewer modal and open the compound builder in edit mode
 *    (called from `app/methods/page.tsx`'s `ViewMethodModal`).
 *
 * Hidden when the source method is shared-with-me — wrapping requires
 * creating a Method row in the user's own namespace, and Q-V1 locks
 * compounds to private-only in v2 so cross-user composition is not on
 * offer until v2.1.
 */
export function WrapAsCompoundAction({
  method,
  task,
  onWrapped,
  className,
  piActor,
}: {
  method: Method;
  /** Task-attached mode: when provided, the task's attachment is swapped
   *  to the new compound id after creation. Omit for the page-level case. */
  task?: Task;
  /** Fired after the wrap completes (and, when `task` is set, after the
   *  attachment swap). The parent uses this to navigate — either by setting
   *  its active tab id (MethodTabs) or by opening the compound builder
   *  modal (ViewMethodModal). */
  onWrapped?: (compound: Method) => void;
  className?: string;
  /** PI capability revamp: lab head username when editing a member's task on the role, so writes route to the owner + audit. */
  piActor?: string;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  // Shared methods can't be wrapped: the new compound would have to live in
  // the receiver's namespace while referencing a foreign-owned source, and
  // that cross-user pattern isn't unlocked until v2.1 (Q-V1 lock).
  if (method.is_shared_with_me) return null;
  if (method.method_type === "compound") return null;

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const compound = await methodsApi.wrapAsCompound(method.id);
      if (task) {
        const tasksApi = ownerScopedTasksApi(task, piActor ? { actor: piActor } : undefined);
        // Drop the old attachment first, then attach the compound. Doing
        // both via the existing addMethod/removeMethod helpers keeps the
        // `method_ids` ↔ `method_attachments` invariant intact instead of
        // hand-rolling a `tasksApi.update({ method_attachments })` patch.
        await tasksApi.removeMethod(task.id, method.id);
        await tasksApi.addMethod(task.id, compound.id, compound.owner ?? null);
      }
      await queryClient.refetchQueries({ queryKey: ["methods"] });
      if (task) {
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      }
      onWrapped?.(compound);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to extend into a kit.";
      alert(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tooltip
      label="Wrap this method into a kit to add more component methods alongside it."
      placement="bottom"
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={
          className ??
          "inline-flex items-center gap-1.5 px-2.5 py-1 text-meta text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-brand-action/10 hover:bg-indigo-100 dark:hover:bg-brand-action/20 border border-indigo-200 rounded-lg disabled:opacity-50"
        }
      >
        <span aria-hidden="true">+</span>
        <span>{busy ? "Extending..." : "Add component (extend into kit)"}</span>
      </button>
    </Tooltip>
  );
}
