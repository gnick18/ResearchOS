"use client";

// Lab Mode retirement R1c (R1c methods canRead manager, 2026-05-23): the
// single hook every methods surface (the list page + per-type viewers)
// calls to resolve "can the current viewer read / write THIS method?".
//
// Replaces the legacy `!method.is_public || method.created_by === currentUser`
// dual-purpose check (which conflated visibility + write-permission) with the
// unified sharing primitives from `lib/sharing/unified.ts`:
//
//   - `canRead(method, viewer)` — owner / lab_head / explicit shared entry /
//      "*" sentinel.
//   - `canReadMethodViaTask(...)` — depth-1 auto-grant: viewer reads via a
//      shared task that references the method.
//   - `canWrite(method, viewer, editSession)` — owner / lab_head + unlocked
//      Phase 5 edit session / shared entry with level: "edit".
//
// When `canRead` is false but `canReadMethodViaTask` is true, we also
// fire-and-forget a `method-transient-read` audit entry against the method
// owner (OQ #4 from the R1 proposal).
//
// `viewerSharedTaskMethodIds` is built once per page-load from the tasks
// react-query cache: every method_id referenced by a task the viewer can
// `canRead` is included. We do this in the hook (not in `unified.ts`) so the
// core primitive stays I/O-free.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useEditSession } from "@/hooks/useEditSession";
import {
  canRead as canReadRecord,
  canWrite as canWriteRecord,
  canReadMethodViaTask,
  type EditSessionView,
  type Viewer,
} from "@/lib/sharing/unified";
import { emitMethodTransientReadAudit } from "@/lib/lab/pi-audit";
import { fetchAllTasksIncludingShared } from "@/lib/local-api";
import type { Method, Task } from "@/lib/types";

/**
 * Build the `Set<number>` of method ids the viewer can reach via a shared
 * task. Walks every task in the merged-view cache (own + receiver-shared +
 * cross-owner-hosted) and collects `method_ids` + `method_attachments[].method_id`
 * for tasks the viewer can read.
 *
 * `canRead` is implicit here: `fetchAllTasksIncludingShared` already filters
 * to "tasks the viewer can see," so we don't re-run `canRead(task, viewer)`
 * per row. This is identical to how the task list itself is gated.
 */
function buildViewerSharedTaskMethodIds(tasks: Task[]): Set<number> {
  const ids = new Set<number>();
  for (const task of tasks) {
    if (Array.isArray(task.method_ids)) {
      for (const mid of task.method_ids) {
        if (typeof mid === "number") ids.add(mid);
      }
    }
    if (Array.isArray(task.method_attachments)) {
      for (const att of task.method_attachments) {
        if (att && typeof att.method_id === "number") {
          ids.add(att.method_id);
        }
      }
    }
  }
  return ids;
}

/**
 * Methods-side permission helpers. Returns:
 *
 *   - `viewer`: the unified `Viewer` shape (or null while loading).
 *   - `editSession`: the `EditSessionView` adapter (always defined).
 *   - `canReadMethod(m)`: true if owner / lab_head / shared / "*" / via task.
 *      Fires the transient-read audit when the via-task path is the sole
 *      reason the read is granted.
 *   - `canModifyMethod(m)`: true if owner / lab_head + unlocked session /
 *      shared edit. Replaces the legacy
 *      `!is_public || created_by === currentUser` check.
 *   - `isReady`: false while the underlying queries / settings reads are in
 *      flight. Callers that gate critical UI should wait for true.
 */
export interface UseMethodPermissions {
  viewer: Viewer | null;
  editSession: EditSessionView;
  canReadMethod: (method: Method) => boolean;
  canModifyMethod: (method: Method) => boolean;
  isReady: boolean;
}

export function useMethodPermissions(): UseMethodPermissions {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const session = useEditSession();

  // We share the same query key the rest of the app uses so the cache
  // hits even when another page already fetched it (e.g. the Gantt).
  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: fetchAllTasksIncludingShared,
    // Methods page doesn't actually consume the tasks themselves, just
    // the derived method-id set. Keep the cache warm for downstream
    // navigation but don't refetch obsessively.
    staleTime: 30_000,
  });

  const viewerSharedTaskMethodIds = useMemo(
    () => buildViewerSharedTaskMethodIds(tasks),
    [tasks],
  );

  const viewer: Viewer | null = useMemo(() => {
    if (!currentUser) return null;
    // `AccountType` ("member" | "lab_head") → `Viewer.account_type`
    // ("solo" | "lab" | "lab_head"). On the methods page every user lives
    // inside the lab (the solo case has no cross-user sharing to gate),
    // so "member" maps to "lab" for the purposes of the unified read/write
    // helpers. `"solo"` would behave identically for canRead but the "lab"
    // mapping keeps the semantics honest: this viewer IS a lab member.
    const role: Viewer["account_type"] =
      accountType === "lab_head" ? "lab_head" : "lab";
    return { username: currentUser, account_type: role };
  }, [currentUser, accountType]);

  // Adapter around the module-scoped Phase 5 session. The unified
  // `canWrite` calls `isUnlockedFor(record.owner)` AFTER the owner-self
  // short-circuit, so this only fires for cross-owner writes. Phase 5
  // semantics: one unlocked session is "edit anywhere" for the unlocking
  // user, so we don't restrict by target owner; we just verify the
  // session belongs to the current viewer. `targetOwner` is accepted to
  // match the `EditSessionView` interface but intentionally unused.
  const editSession: EditSessionView = useMemo(
    () => ({
      isUnlockedFor: (_targetOwner: string) => {
        void _targetOwner;
        return (
          session.state === "unlocked" &&
          !!session.active &&
          session.active.username === currentUser
        );
      },
    }),
    [session, currentUser],
  );

  const canReadMethod = useMemo(() => {
    return (method: Method) => {
      if (!viewer) return false;
      if (canReadRecord(method, viewer)) return true;
      // Auto-grant via shared-task ref. Fire-and-forget audit; the read
      // is allowed regardless of whether the audit write succeeds.
      if (canReadMethodViaTask(method, viewer, viewerSharedTaskMethodIds)) {
        const mid =
          typeof (method as { id?: number }).id === "number"
            ? (method as { id: number }).id
            : null;
        if (mid !== null && method.owner && method.owner !== viewer.username) {
          emitMethodTransientReadAudit({
            methodOwner: method.owner,
            methodId: mid,
            viewer: viewer.username,
          });
        }
        return true;
      }
      return false;
    };
  }, [viewer, viewerSharedTaskMethodIds]);

  const canModifyMethod = useMemo(() => {
    return (method: Method) => {
      if (!viewer) return false;
      return canWriteRecord(method, viewer, editSession);
    };
  }, [viewer, editSession]);

  const isReady =
    !!currentUser && accountType !== undefined && !tasksLoading;

  return {
    viewer,
    editSession,
    canReadMethod,
    canModifyMethod,
    isReady,
  };
}
