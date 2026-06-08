"use client";

// PI capability revamp Phase 2 (sharing + collaboration manager, 2026-06-07):
// the consumer hook that powers the right-click PI menu on member-owned record
// rows. It pairs the PURE builder (lib/lab/pi-record-menu.ts) with the live
// side effects. It runs each pi-action, invalidates the right caches, and
// surfaces success / failure through the SAME alert pattern the existing
// AssignTaskButton / FlagForReviewButton surfaces use. The project has no
// global toast bus, so those surfaces alert on failure and silently invalidate
// on success, and we match that exactly rather than invent a new notice channel.
//
// Reuse contract:
//   const piMenu = usePiRecordMenu();
//   <div onContextMenu={(e) => piMenu.handleContextMenu(e, {
//     recordType: "task", record, onEditAsPi: () => onOpen(),
//   })} />
//   {piMenu.modals}   // render once near the panel root
//
// The hook owns a small Assign modal (tasks) so a row can offer "Assign to
// member..." without the parent having to mount AssignTaskButton; the modal
// reuses the same member dropdown + note field + assignTask call. Phase 4 Pass
// B: the hook ALSO owns the read-only AuditTrailViewer so the "View audit trail"
// item works from every caller with no extra per-caller wiring beyond the record
// it already passes (the record carries owner + id). The viewer opens with
// targetUser = record.owner and a recordFilter mapped through auditRecordTypeFor.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "./useCurrentUser";
import { useIsLabHead } from "./useIsLabHead";
import { useLabData } from "./useLabData";
import { useLabUserProfileMap } from "./useLabUserProfiles";
import { useArchivedUsers } from "./useArchivedUsers";
import { useOptionalContextMenu } from "@/components/context-menu/ContextMenuProvider";
import LivingPopup from "@/components/ui/LivingPopup";
import {
  setFlagForReview,
  clearFlagAsOwner,
  setPurchaseApproval,
  declinePurchase,
  assignTask,
  type PiActionResult,
} from "@/lib/lab/pi-actions";
import {
  buildPiRecordMenuItems,
  auditRecordTypeFor,
  type PiMenuRecord,
  type PiMenuRecordType,
} from "@/lib/lab/pi-record-menu";
import AuditTrailViewer, {
  type AuditRecordFilter,
} from "@/components/lab-head/AuditTrailViewer";
import type { EditMenuItem } from "@/components/sequences/SequenceEditMenu";
import type { PiFlag } from "@/lib/types";

/** Per-record-type cache invalidation. Mirrors FlagForReviewButton's
 *  invalidateForRecord so a list re-renders after a PI action. */
async function invalidateForType(
  queryClient: ReturnType<typeof useQueryClient>,
  recordType: PiMenuRecordType,
): Promise<void> {
  if (recordType === "task") {
    await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    await queryClient.invalidateQueries({ queryKey: ["task"] });
    await queryClient.invalidateQueries({ queryKey: ["lab", "tasks"] });
  } else if (recordType === "note") {
    await queryClient.invalidateQueries({ queryKey: ["notes"] });
    await queryClient.invalidateQueries({ queryKey: ["lab", "notes-shared"] });
  } else if (recordType === "inventory_item") {
    await queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
    await queryClient.invalidateQueries({ queryKey: ["inventory-stocks"] });
  } else {
    await queryClient.invalidateQueries({ queryKey: ["purchases"] });
    await queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
  }
}

/** Shared PiActionResult handler. Returns true when the data write landed
 *  (so the caller should invalidate), false when it failed outright. The
 *  audit-only failure path lands the data AND warns, matching the existing
 *  surfaces. `verb` phrases the alerts ("assign", "flag", ...). */
function settleResult<T>(result: PiActionResult<T>, verb: string): boolean {
  if (!result.ok && result.reason === "data-write") {
    console.error(`[pi-record-menu] ${verb} data write failed`, result.error);
    const msg =
      result.error instanceof Error
        ? result.error.message
        : `Failed to ${verb} this record. See console for details.`;
    alert(msg);
    return false;
  }
  if (!result.ok && result.reason === "audit") {
    console.warn(`[pi-record-menu] ${verb} audit write failed`, result.error);
    alert(
      `The change was saved, but the audit log entry could not be written. ` +
        `The record reflects the change, but it will not appear in the audit history.`,
    );
  }
  return true;
}

interface AssignState {
  owner: string;
  taskId: number;
}

export interface PiRecordMenuArgs {
  recordType: PiMenuRecordType;
  record: PiMenuRecord;
  /** Open the record's detail popup / editor exactly as a normal click would,
   *  so the Phase 1 once-per-session gate engages there. */
  onEditAsPi: () => void;
  /** Optional override for the assign flow (tasks). When omitted, the hook's
   *  built-in Assign modal is used. */
  onAssign?: () => void;
  /** Optional override for the View-audit item. When omitted, the hook's
   *  built-in read-only AuditTrailViewer opens, filtered to this record. */
  onViewAudit?: () => void;
  /** Whether to include the "Edit as lab head" row. Default true (Pass 1 list
   *  rows). The detail-popup header callers pass false, since the record is
   *  already open there, so the menu shows only the role actions. */
  includeEditAsPi?: boolean;
  /** inventory_item (Supplies v2 chunk 6) only: the universal inline-mirror
   *  actions the Supply row offers (reorder / edit / set status). The page wires
   *  these to its cart + item-form + detail-panel handlers. */
  onReorder?: () => void;
  onEditItem?: () => void;
  onSetStatus?: () => void;
}

export interface PiRecordMenuApi {
  /** Build the EditMenuItem list for one record. Returns [] for a non-PI
   *  viewer or a PI on their own record. Useful for tests / custom surfaces. */
  buildItems: (args: PiRecordMenuArgs) => EditMenuItem[];
  /** onContextMenu handler. Builds the items and opens the shared menu; an
   *  empty list falls through to the normal right-click glyph. */
  handleContextMenu: (
    event: React.MouseEvent,
    args: PiRecordMenuArgs,
  ) => void;
  /** Render once near the consumer's root so the Assign modal has a home. */
  modals: ReactNode;
}

export function usePiRecordMenu(): PiRecordMenuApi {
  // Optional so isolated unit renders that do not mount the app-wide provider
  // still work; in the running app the provider is always present.
  const contextMenu = useOptionalContextMenu();
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();
  const isLabHead = useIsLabHead(currentUser ?? null);

  // Assign modal state (tasks). null = closed.
  const [assign, setAssign] = useState<AssignState | null>(null);

  // Per-record audit-trail viewer state (Pass B). null = closed.
  const [audit, setAudit] = useState<{
    targetUser: string;
    recordFilter: AuditRecordFilter;
  } | null>(null);

  const runFlag = useCallback(
    async (
      recordType: Exclude<PiMenuRecordType, "inventory_item">,
      record: PiMenuRecord,
    ) => {
      if (!currentUser) return;
      const flag: PiFlag = {
        by: currentUser,
        at: new Date().toISOString(),
        reason: null,
      };
      const result = await setFlagForReview({
        actor: currentUser,
        targetOwner: record.owner,
        recordType: recordType === "purchase" ? "purchase_item" : recordType,
        recordId: record.id,
        flag,
      });
      if (settleResult(result, "flag")) await invalidateForType(queryClient, recordType);
    },
    [currentUser, queryClient],
  );

  const runClearFlag = useCallback(
    async (
      recordType: Exclude<PiMenuRecordType, "inventory_item">,
      record: PiMenuRecord,
    ) => {
      if (!currentUser) return;
      // The owner-clear path is the symmetric clear; for a PI clearing a
      // member's flag we route through setFlagForReview(flag: null) so the
      // entry is attributed to the PI (actor) rather than stamped owner-clear.
      const result = await setFlagForReview({
        actor: currentUser,
        targetOwner: record.owner,
        recordType: recordType === "purchase" ? "purchase_item" : recordType,
        recordId: record.id,
        flag: null,
      });
      if (settleResult(result, "clear flag"))
        await invalidateForType(queryClient, recordType);
    },
    [currentUser, queryClient],
  );

  const runApprove = useCallback(
    async (record: PiMenuRecord) => {
      if (!currentUser) return;
      const result = await setPurchaseApproval({
        actor: currentUser,
        targetOwner: record.owner,
        purchaseItemId: record.id,
        approved: true,
      });
      if (settleResult(result, "approve")) await invalidateForType(queryClient, "purchase");
    },
    [currentUser, queryClient],
  );

  const runDecline = useCallback(
    async (record: PiMenuRecord) => {
      if (!currentUser) return;
      const result = await declinePurchase({
        actor: currentUser,
        targetOwner: record.owner,
        purchaseItemId: record.id,
      });
      if (settleResult(result, "decline")) await invalidateForType(queryClient, "purchase");
    },
    [currentUser, queryClient],
  );

  const buildItems = useCallback(
    (args: PiRecordMenuArgs): EditMenuItem[] => {
      const {
        recordType,
        record,
        onEditAsPi,
        onAssign,
        onViewAudit,
        includeEditAsPi,
        onReorder,
        onEditItem,
        onSetStatus,
      } = args;

      // The View-audit default opens the hook-owned read-only viewer filtered to
      // this one record. For a supply the audit history is the backing item's.
      const onViewAuditResolved =
        onViewAudit ??
        (() =>
          setAudit({
            targetUser: record.owner,
            recordFilter: {
              recordType: auditRecordTypeFor(recordType),
              recordId: record.id,
            },
          }));

      // inventory_item (Supplies v2 chunk 6): the PI approve / decline / flag rows
      // act on the supply's LINKED open purchase line, not the inventory item. So
      // those callbacks run against a purchase-shaped record built from
      // record.linkedPurchase (recordType "purchase", so the flag stamps
      // purchase_item + the purchases caches invalidate). The universal reorder /
      // edit / set-status callbacks come from the page.
      if (recordType === "inventory_item") {
        const linked = record.linkedPurchase ?? null;
        const linkedRec: PiMenuRecord | null = linked
          ? { owner: linked.owner, id: linked.id, flagged: linked.flagged, approved: linked.approved }
          : null;
        // The PI flag / approve / decline / view-audit rows act on the linked
        // open purchase line. The builder only renders them when that line exists
        // and is member-owned (piOnLine), so the no-op fallbacks for the required
        // onFlag / onClearFlag fields are never actually invoked.
        const noop = () => {};
        const onViewAuditInv =
          onViewAudit ??
          (linked
            ? () =>
                setAudit({
                  targetUser: linked.owner,
                  recordFilter: { recordType: "purchase_item", recordId: linked.id },
                })
            : undefined);
        return buildPiRecordMenuItems({
          recordType,
          record,
          viewerUsername: currentUser,
          isLabHead,
          includeEditAsPi,
          callbacks: {
            onEditAsPi,
            onReorder,
            onEditItem,
            onSetStatus,
            onFlag: linkedRec ? () => void runFlag("purchase", linkedRec) : noop,
            onClearFlag: linkedRec
              ? () => void runClearFlag("purchase", linkedRec)
              : noop,
            onApprove: linkedRec ? () => void runApprove(linkedRec) : undefined,
            onDecline: linkedRec ? () => void runDecline(linkedRec) : undefined,
            onViewAudit: onViewAuditInv,
          },
        });
      }

      return buildPiRecordMenuItems({
        recordType,
        record,
        viewerUsername: currentUser,
        isLabHead,
        includeEditAsPi,
        callbacks: {
          onEditAsPi,
          onFlag: () => void runFlag(recordType, record),
          onClearFlag: () => void runClearFlag(recordType, record),
          onAssign:
            recordType === "task"
              ? onAssign ?? (() => setAssign({ owner: record.owner, taskId: record.id }))
              : undefined,
          onApprove:
            recordType === "purchase" ? () => void runApprove(record) : undefined,
          onDecline:
            recordType === "purchase" ? () => void runDecline(record) : undefined,
          // Default: open the hook-owned viewer filtered to this one record. The
          // caller can override (onViewAudit) but no caller needs to, since the
          // record already carries owner + id.
          onViewAudit: onViewAuditResolved,
        },
      });
    },
    [currentUser, isLabHead, runFlag, runClearFlag, runApprove, runDecline],
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, args: PiRecordMenuArgs) => {
      if (!contextMenu) return;
      const items = buildItems(args);
      // Empty list -> openMenu still preventDefaults but shows nothing, so the
      // click falls through to the global right-click glyph. Non-PI / own
      // record behavior is unchanged.
      contextMenu.openMenu(event, items);
    },
    [buildItems, contextMenu],
  );

  // Only MOUNT each modal when it is active. The assign modal's data hooks
  // (useLabData / useLabUserProfileMap / useArchivedUsers) reach for the
  // FileSystem + lab-data providers, and the viewer reads the audit log, so
  // keeping them unmounted while closed means a panel that never opens one
  // (plus isolated unit renders) does not pull those providers in.
  const modals = useMemo(
    () => (
      <>
        {assign ? (
          <PiAssignModal
            state={assign}
            actor={currentUser ?? ""}
            onClose={() => setAssign(null)}
            onAssigned={async () => {
              await invalidateForType(queryClient, "task");
              setAssign(null);
            }}
          />
        ) : null}
        {audit ? (
          <AuditTrailViewer
            open
            onClose={() => setAudit(null)}
            targetUser={audit.targetUser}
            recordFilter={audit.recordFilter}
          />
        ) : null}
      </>
    ),
    [assign, audit, currentUser, queryClient],
  );

  return { buildItems, handleContextMenu, modals };
}

/** The built-in Assign-to-member modal for task rows. Mirrors
 *  AssignTaskButton's picker (member dropdown + optional note) but is opened
 *  imperatively by the context menu rather than by a visible button. */
function PiAssignModal({
  state,
  actor,
  onClose,
  onAssigned,
}: {
  state: AssignState;
  actor: string;
  onClose: () => void;
  onAssigned: () => void | Promise<void>;
}) {
  const { users } = useLabData();
  const profileMap = useLabUserProfileMap();
  const archivedSet = useArchivedUsers();
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const handleAssign = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await assignTask({
        actor,
        targetOwner: state.owner,
        taskId: state.taskId,
        assignee: selected,
        note: note.trim() || null,
      });
      if (!result.ok && result.reason === "data-write") {
        console.error("[pi-record-menu] assign data write failed", result.error);
        alert(
          result.error instanceof Error
            ? result.error.message
            : "Failed to assign task. See console for details.",
        );
        return;
      }
      if (!result.ok && result.reason === "audit") {
        console.warn("[pi-record-menu] assign audit write failed", result.error);
        alert(
          "Task was assigned, but the audit log entry could not be written. " +
            "The record reflects the new assignee, but this change will not appear in the audit history.",
        );
      }
      setNote("");
      setSelected(null);
      await onAssigned();
    } finally {
      setBusy(false);
    }
  };

  return (
    <LivingPopup
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      label="Assign task"
      card={false}
      widthClassName="max-w-md"
      closeOnScrimClick={!busy}
    >
      <div
        className="pointer-events-auto bg-surface-raised rounded-xl shadow-2xl w-full p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h3 className="text-title font-semibold text-foreground">Assign task</h3>
          <p className="text-meta text-foreground-muted mt-0.5 break-words">
            Owned by {state.owner}
          </p>
        </header>

        <div>
          <label className="block text-meta font-medium text-foreground mb-1">
            Assignee
          </label>
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value || null)}
            disabled={busy}
            className="w-full text-body rounded-md border border-border px-2 py-1.5 bg-surface-raised focus:ring-2 focus:ring-emerald-500"
            data-testid="pi-menu-assign-select"
          >
            <option value="">Pick a lab member...</option>
            {users
              .filter((u) => !archivedSet.has(u.username))
              .filter((u) => u.username !== actor)
              .map((u) => {
                const label = profileMap[u.username]?.displayName?.trim() ?? u.username;
                return (
                  <option key={u.username} value={u.username}>
                    {label} ({u.username})
                  </option>
                );
              })}
          </select>
        </div>

        <div>
          <label className="block text-meta font-medium text-foreground mb-1">
            Note (optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            placeholder="e.g. Please pick this up this week."
            className="w-full min-h-[60px] text-body rounded-md border border-border px-2 py-1.5 focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-meta text-foreground-muted hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAssign}
            disabled={busy || !selected}
            className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-meta font-medium hover:bg-emerald-700 disabled:bg-gray-300"
            data-testid="pi-menu-assign-confirm"
          >
            {busy ? "Assigning..." : "Assign"}
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}
