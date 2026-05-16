"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  methodsApi,
  fetchAllMethodsIncludingShared,
} from "@/lib/local-api";
import type { Method, Task } from "@/lib/types";
import { ownerScopedTasksApi } from "@/lib/tasks/owner-scoped-api";
import Tooltip from "@/components/Tooltip";

/**
 * "Convert back to single method" affordance shown on a compound viewer
 * when the compound has at most one component left. Deletes the compound
 * wrapper; when a child exists, the user is navigated to the child's viewer.
 *
 * Two callers wire this up:
 *
 *  - `CompoundMethodTabContent.tsx` (task-attached) — also swaps the task's
 *    attachment from the compound to the child (or removes the attachment
 *    entirely when N=0), then calls `onConverted(childMethodId | null)` so
 *    the parent (MethodTabs) flips the active tab.
 *  - The page-level `CompoundViewer` in `app/methods/page.tsx` — closes the
 *    current viewer modal and reopens on the child via the `onConverted`
 *    callback (no task swap needed in the standalone path).
 */
export function ConvertCompoundToSingleAction({
  compound,
  task,
  onConverted,
  disabled,
}: {
  compound: Method;
  /** Task-attached mode: also rewrites the task's `method_attachments`. */
  task?: Task;
  /** Fired after the compound is deleted (and, when `task` is set, after the
   *  attachment swap). The argument is the child's method id, or null when
   *  the compound was empty. Parents use this to navigate. */
  onConverted: (childMethodId: number | null) => void;
  /** Force-disable (e.g. when a sibling save is in progress). */
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: allMethods = [] } = useQuery({
    queryKey: ["methods"],
    queryFn: fetchAllMethodsIncludingShared,
  });

  const components = useMemo(
    () => [...(compound.components ?? [])].sort((a, b) => a.ordering - b.ordering),
    [compound.components],
  );
  const childRef = components[0];
  const child = useMemo(() => {
    if (!childRef) return null;
    const ownerCtx = childRef.owner ?? compound.owner;
    return (
      allMethods.find((m) => m.id === childRef.method_id && m.owner === ownerCtx) ??
      null
    );
  }, [allMethods, childRef, compound.owner]);

  // Component is only meaningful at N <= 1; the caller is responsible for
  // not rendering us otherwise, but we guard defensively too.
  if (components.length > 1) return null;

  const isEmpty = components.length === 0;
  const label = isEmpty ? "Delete empty compound" : "Convert back to single method";
  const childName = child?.name ?? `Method ${childRef?.method_id ?? "?"}`;
  const tooltip = isEmpty
    ? "This compound has no components. Delete the empty wrapper — any tasks attached to it will lose that attachment."
    : `Delete the compound wrapper and keep "${childName}" as a standalone method. Any tasks attached to this compound will lose that attachment.`;

  const confirmMessage = isEmpty
    ? "This will delete the empty compound. Any tasks attached to this compound will lose that attachment. Continue?"
    : `This will delete the compound wrapper and keep "${childName}" as a standalone method. Any tasks attached to this compound will lose that attachment. Continue?`;

  const handleClick = async () => {
    if (busy || disabled) return;
    if (!confirm(confirmMessage)) return;
    setBusy(true);
    try {
      // Swap the task attachment BEFORE deleting the compound so the
      // invariant (∀ a ∈ method_attachments: a.method_id ∈ method_ids) stays
      // intact at each step. removeMethod drops the compound entry; addMethod
      // attaches the child (when there is one).
      if (task) {
        const tasksApi = ownerScopedTasksApi(task);
        await tasksApi.removeMethod(task.id, compound.id);
        if (!isEmpty && child) {
          await tasksApi.addMethod(task.id, child.id, child.owner ?? null);
        }
      }
      await methodsApi.delete(compound.id);
      await queryClient.refetchQueries({ queryKey: ["methods"] });
      if (task) {
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      }
      onConverted(isEmpty ? null : (child?.id ?? null));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to convert compound.";
      alert(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tooltip label={tooltip} placement="bottom">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || disabled}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg disabled:opacity-50"
      >
        {busy ? "Converting..." : label}
      </button>
    </Tooltip>
  );
}
