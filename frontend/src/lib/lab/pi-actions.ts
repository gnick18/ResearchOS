// Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): orchestration
// layer for the PI soft-write quartet — task assignment, purchase
// approval, flag-for-review (across task/note/purchase_item), and the
// notification fan-out that goes with each.
//
// Why a separate module?
//   - Each action needs two writes: the record update (owner-routed
//     via the Phase 5 R1 wrappers) AND a bell notification to the
//     receiver. Calling sites (popups + editors) shouldn't have to know
//     about both halves.
//   - All four actions emit per-field audit entries via the same
//     `pi-audit` writer. Centralizing means the audit shape stays
//     consistent across the four UI surfaces.
//   - Demo-data seeding (`generate-demo-data` follow-up) can call these
//     same writers without needing to drive the popup flow.
//
// Read paths (list announcements, see flag state, etc.) live in the
// individual `lib/lab/announcements.ts` + the existing tasks/notes/
// purchases APIs. This module is mutation-only.

import { tasksApi as rawTasksApi, notesApi as rawNotesApi, purchasesApi as rawPurchasesApi } from "@/lib/local-api";
import { fileService } from "../file-system/file-service";
import { appendAuditEntries } from "./pi-audit";
import type {
  Notification,
  LabAnnouncementNotification,
  LabTaskAssignmentNotification,
  LabPurchaseApprovalNotification,
  LabFlagForReviewNotification,
  PiFlag,
} from "../types";

interface NotificationFile {
  version: number;
  notifications: Notification[];
}

function notificationsPath(username: string): string {
  return `users/${username}/_notifications.json`;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function appendNotification(
  receiver: string,
  notif: Notification,
): Promise<void> {
  try {
    const path = notificationsPath(receiver);
    const existing = await fileService.readJson<Partial<NotificationFile>>(path);
    const merged: NotificationFile = {
      version: 1,
      notifications: [...(existing?.notifications ?? []), notif],
    };
    await fileService.writeJson(path, merged);
  } catch (err) {
    // One failed notification write must not block the underlying
    // record write — log + continue. Mirrors `dispatchCommentNotifications`.
    console.warn("[pi-actions] notification write failed", err);
  }
}

// ── Lab-wide announcement fan-out ───────────────────────────────────────
//
// Posted to every lab member (sans the PI) via per-user notification
// writes. Member discovery walks `users/` via the existing fileService
// listing.

async function listMemberUsernames(excluding?: string): Promise<string[]> {
  try {
    // Lab members are subdirectories of `users/`. Skip the lab-scoped
    // namespace (`users/lab`), the public methods folder (`users/public`),
    // and any hidden / system folder.
    const dirs = await fileService.listDirectories("users");
    return dirs.filter((name) => {
      if (!name || name.startsWith("_") || name === "lab" || name === "public") {
        return false;
      }
      return !excluding || name !== excluding;
    });
  } catch {
    return [];
  }
}

/**
 * Fan out a `lab_announcement` notification to every lab member except
 * the author. Use after `postAnnouncement` lands the file write.
 */
export async function dispatchAnnouncementNotifications(args: {
  author: string;
  announcementId: string;
  text: string;
}): Promise<void> {
  const preview = args.text.length > 120 ? args.text.slice(0, 117) + "…" : args.text;
  const now = new Date().toISOString();
  const recipients = await listMemberUsernames(args.author);
  await Promise.all(
    recipients.map(async (receiver) => {
      const notif: LabAnnouncementNotification = {
        id: newId(),
        type: "lab_announcement",
        from_user: args.author,
        announcement_id: args.announcementId,
        preview,
        created_at: now,
        read: false,
      };
      await appendNotification(receiver, notif);
    }),
  );
}

// ── Task assignment ────────────────────────────────────────────────────
//
// Assignee is a string on the task; we route the write through the
// Phase 5 R1 audit-emitting pattern so the entry lands in the target's
// folder + their _pi_audit.json.

export interface AssignTaskArgs {
  /** The PI's username (audit actor). */
  actor: string;
  /** Phase 5 session id. */
  sessionId: string;
  /** Target task owner — the user whose folder hosts the task file. */
  targetOwner: string;
  /** Numeric task id in the target owner's namespace. */
  taskId: number;
  /** Username being assigned the task. */
  assignee: string;
  /** Optional note from the PI — sent with the bell notification. */
  note?: string | null;
  /** Denormalized task name for the bell row. Reader can supply it from
   *  the popup's existing state (saves a re-read). */
  taskName?: string;
}

export async function assignTask(args: AssignTaskArgs): Promise<void> {
  // 1. Pre-read for the audit diff.
  const before = await rawTasksApi.get(args.taskId, args.targetOwner);
  if (!before) {
    throw new Error(`assignTask: task ${args.taskId} not found in ${args.targetOwner}'s folder`);
  }
  // 2. Owner-routed write — Phase 5 R1's `tasksApi.update` already
  //    supports the owner arg and persists `assignee` via the spread
  //    in the update body.
  const updated = await rawTasksApi.update(
    args.taskId,
    { assignee: args.assignee },
    args.targetOwner,
  );
  if (!updated) {
    throw new Error("assignTask: tasksApi.update returned null");
  }
  // 3. Audit entry.
  try {
    await appendAuditEntries(args.targetOwner, [
      {
        session_id: args.sessionId,
        actor: args.actor,
        target_user: args.targetOwner,
        record_type: "task",
        record_id: args.taskId,
        field_path: "assignee",
        old_value: before.assignee ?? null,
        new_value: args.assignee,
      },
    ]);
  } catch (err) {
    console.warn("[assignTask] audit write failed", err);
  }
  // 4. Notify the assignee.
  const notif: LabTaskAssignmentNotification = {
    id: newId(),
    type: "lab_task_assignment",
    from_user: args.actor,
    owner_username: args.targetOwner,
    task_id: args.taskId,
    task_name: args.taskName ?? updated.name,
    note: args.note ?? null,
    created_at: new Date().toISOString(),
    read: false,
  };
  // Skip self-notify (PI assigning their own task to themselves).
  if (args.assignee !== args.actor) {
    await appendNotification(args.assignee, notif);
  }
}

// ── Purchase approval ──────────────────────────────────────────────────

export interface ApprovePurchaseArgs {
  actor: string;
  sessionId: string;
  /** Username of the purchase item's owner — its parent task's owner. */
  targetOwner: string;
  /** Numeric purchase_item id in the owner's namespace. */
  purchaseItemId: number;
  /** When true (default) flips approved to true + stamps approver. When
   *  false, clears approval back to pending. */
  approved?: boolean;
  /** Denormalized item name for the bell row. */
  itemName?: string;
}

export async function setPurchaseApproval(args: ApprovePurchaseArgs): Promise<void> {
  const approved = args.approved ?? true;
  const now = new Date().toISOString();
  const before = await fileService.readJson<{ approved?: boolean; item_name?: string }>(
    `users/${args.targetOwner}/purchase_items/${args.purchaseItemId}.json`,
  );
  if (!before) {
    throw new Error(
      `setPurchaseApproval: item ${args.purchaseItemId} not found in ${args.targetOwner}'s folder`,
    );
  }
  const updated = await rawPurchasesApi.update(
    args.purchaseItemId,
    {
      approved,
      approved_by: approved ? args.actor : null,
      approved_at: approved ? now : null,
    },
    args.targetOwner,
  );
  if (!updated) {
    throw new Error("setPurchaseApproval: purchasesApi.update returned null");
  }
  try {
    await appendAuditEntries(args.targetOwner, [
      {
        session_id: args.sessionId,
        actor: args.actor,
        target_user: args.targetOwner,
        record_type: "purchase_item",
        record_id: args.purchaseItemId,
        field_path: "approved",
        old_value: !!before.approved,
        new_value: approved,
      },
    ]);
  } catch (err) {
    console.warn("[setPurchaseApproval] audit write failed", err);
  }
  // Notify owner — but only when flipping to approved (the brief
  // describes the positive case; clearing is a silent revert).
  if (approved && args.targetOwner !== args.actor) {
    const notif: LabPurchaseApprovalNotification = {
      id: newId(),
      type: "lab_purchase_approval",
      from_user: args.actor,
      owner_username: args.targetOwner,
      purchase_item_id: args.purchaseItemId,
      item_name: args.itemName ?? updated.item_name,
      created_at: now,
      read: false,
    };
    await appendNotification(args.targetOwner, notif);
  }
}

// ── Flag for review ────────────────────────────────────────────────────
//
// Works on tasks, notes, and purchase items. The shape of `flagged` is
// identical across all three; the writer dispatches based on
// `recordType`.

export interface FlagRecordArgs {
  actor: string;
  sessionId: string;
  targetOwner: string;
  recordType: "task" | "note" | "purchase_item";
  recordId: number;
  /** When null, the flag is CLEARED. When an object, the flag is SET. */
  flag: PiFlag | null;
  /** Denormalized record name for the bell row. */
  recordName?: string;
}

export async function setFlagForReview(args: FlagRecordArgs): Promise<void> {
  let beforeFlag: PiFlag | null | undefined;
  let displayName: string | undefined;

  if (args.recordType === "task") {
    const before = await rawTasksApi.get(args.recordId, args.targetOwner);
    if (!before) {
      throw new Error(`setFlagForReview: task ${args.recordId} not found in ${args.targetOwner}'s folder`);
    }
    beforeFlag = before.flagged ?? null;
    displayName = before.name;
    await rawTasksApi.update(args.recordId, { flagged: args.flag }, args.targetOwner);
  } else if (args.recordType === "note") {
    const before = await rawNotesApi.get(args.recordId, args.targetOwner);
    if (!before) {
      throw new Error(`setFlagForReview: note ${args.recordId} not found in ${args.targetOwner}'s folder`);
    }
    beforeFlag = before.flagged ?? null;
    displayName = before.title;
    await rawNotesApi.update(args.recordId, { flagged: args.flag }, args.targetOwner);
  } else {
    const before = await fileService.readJson<{ flagged?: PiFlag | null; item_name?: string }>(
      `users/${args.targetOwner}/purchase_items/${args.recordId}.json`,
    );
    if (!before) {
      throw new Error(
        `setFlagForReview: purchase_item ${args.recordId} not found in ${args.targetOwner}'s folder`,
      );
    }
    beforeFlag = before.flagged ?? null;
    displayName = before.item_name;
    await rawPurchasesApi.update(args.recordId, { flagged: args.flag }, args.targetOwner);
  }

  try {
    await appendAuditEntries(args.targetOwner, [
      {
        session_id: args.sessionId,
        actor: args.actor,
        target_user: args.targetOwner,
        record_type: args.recordType,
        record_id: args.recordId,
        field_path: "flagged",
        old_value: beforeFlag ?? null,
        new_value: args.flag,
      },
    ]);
  } catch (err) {
    console.warn("[setFlagForReview] audit write failed", err);
  }

  // Only notify on flag SET, not clear.
  if (args.flag && args.targetOwner !== args.actor) {
    const notif: LabFlagForReviewNotification = {
      id: newId(),
      type: "lab_flag_for_review",
      from_user: args.actor,
      owner_username: args.targetOwner,
      record_type: args.recordType,
      record_id: args.recordId,
      record_name: args.recordName ?? displayName ?? `${args.recordType} ${args.recordId}`,
      reason: args.flag.reason ?? null,
      created_at: args.flag.at,
      read: false,
    };
    await appendNotification(args.targetOwner, notif);
  }
}

/**
 * Convenience for the owner-side "Clear flag" button — bypasses the
 * lab-head session gate. The owner can always clear their own flags
 * without unlocking edit mode. Doesn't emit an audit entry (the original
 * flag-set entry is the historical record).
 */
export async function clearFlagAsOwner(args: {
  owner: string;
  recordType: "task" | "note" | "purchase_item";
  recordId: number;
}): Promise<void> {
  if (args.recordType === "task") {
    await rawTasksApi.update(args.recordId, { flagged: null }, args.owner);
  } else if (args.recordType === "note") {
    await rawNotesApi.update(args.recordId, { flagged: null }, args.owner);
  } else {
    await rawPurchasesApi.update(args.recordId, { flagged: null }, args.owner);
  }
}
