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
//
// Mira-Skeptic P0 fix pass (Mira-Skeptic P0 fix manager, 2026-05-23):
//   - Audit-write failures previously swallowed by `console.warn`. Now
//     each action returns a `PiActionResult<T>` discriminated union so
//     callers can distinguish "data write succeeded but audit failed"
//     from "data write failed outright." Audit failures no longer
//     vanish; the data IS written (the audit append is the last step),
//     but the caller is told to surface a non-blocking warning.
//   - `clearFlagAsOwner` previously emitted no audit entry, leaving
//     flag-clear events invisible. It now emits a "flagged: <flag> ->
//     null" entry with `actor === owner` so the forensic log is
//     symmetric with the set path.
//   - Each action now cross-checks the live edit session via
//     `getEditSession()` before any write. If the session isn't
//     unlocked for the same actor + sessionId, the action throws
//     before either the data write or the audit write fires. This is
//     the second-line defence under the Distracted chip's
//     resetEditSession() user-switch wipe.
//   - `clearFlagAsOwner` does NOT go through the edit-session gate
//     (the owner clears their own flag — no PI unlock needed) and
//     therefore takes no `sessionId`. Its audit entry stamps the
//     owner-clear via `session_id: "owner-clear"` and `actor: owner`.

import { tasksApi as rawTasksApi, notesApi as rawNotesApi, purchasesApi as rawPurchasesApi } from "@/lib/local-api";
import { fileService } from "../file-system/file-service";
import { appendAuditEntries } from "./pi-audit";
import { getEditSession } from "./edit-session";
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

/**
 * Result envelope for every Phase 3 PI action.
 *
 * Three terminal shapes:
 *   - `{ ok: true, value }` — data write AND audit write both landed.
 *   - `{ ok: false, reason: "data-write", error }` — the record never
 *     changed. Callers should surface a blocking error to the user.
 *   - `{ ok: false, reason: "audit", error, value }` — the data write
 *     LANDED but the audit append failed. Callers should surface a
 *     non-blocking warning toast ("Your change was saved but wasn't
 *     logged"). `value` is the same shape the success path returns.
 *
 * Session-gate failures and pre-read failures classify as `"data-write"`
 * because the data record was never touched.
 */
export type PiActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "data-write"; error: unknown }
  | { ok: false; reason: "audit"; error: unknown; value: T };

function dataWriteFailure(error: unknown): PiActionResult<never> {
  return { ok: false, reason: "data-write", error };
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

/**
 * Cross-check the live edit session against the actor + sessionId the
 * caller passed in. Throws a descriptive error if the session is not
 * unlocked, the actor doesn't match, or the sessionId is stale.
 *
 * This catches the "popup captured sessionId at mount, but the session
 * expired before submit" failure mode where a stale id would otherwise
 * land in the audit row.
 *
 * Mira-Skeptic P0 #4.
 */
function assertLiveSession(actor: string, sessionId: string): void {
  const live = getEditSession();
  if (live.state !== "unlocked" || !live.active) {
    throw new Error(
      "Edit session expired or sessionId mismatch — relock and retry.",
    );
  }
  if (live.active.username !== actor) {
    throw new Error(
      "Edit session expired or sessionId mismatch — relock and retry.",
    );
  }
  if (live.active.id !== sessionId) {
    throw new Error(
      "Edit session expired or sessionId mismatch — relock and retry.",
    );
  }
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

export interface AssignTaskValue {
  taskId: number;
  assignee: string;
  /** Previous assignee — null if the task was unassigned before. */
  previousAssignee: string | null;
}

export async function assignTask(args: AssignTaskArgs): Promise<PiActionResult<AssignTaskValue>> {
  // 0. Session gate — throws via assertLiveSession on mismatch.
  try {
    assertLiveSession(args.actor, args.sessionId);
  } catch (err) {
    return dataWriteFailure(err);
  }

  // 1. Pre-read for the audit diff.
  let before;
  try {
    before = await rawTasksApi.get(args.taskId, args.targetOwner);
    if (!before) {
      throw new Error(`assignTask: task ${args.taskId} not found in ${args.targetOwner}'s folder`);
    }
  } catch (err) {
    return dataWriteFailure(err);
  }

  // 2. Owner-routed write — Phase 5 R1's `tasksApi.update` already
  //    supports the owner arg and persists `assignee` via the spread
  //    in the update body.
  let updated;
  try {
    updated = await rawTasksApi.update(
      args.taskId,
      { assignee: args.assignee },
      args.targetOwner,
    );
    if (!updated) {
      throw new Error("assignTask: tasksApi.update returned null");
    }
  } catch (err) {
    return dataWriteFailure(err);
  }

  // Data write landed — from here we have a partial-success path.
  const value: AssignTaskValue = {
    taskId: args.taskId,
    assignee: args.assignee,
    previousAssignee: before.assignee ?? null,
  };

  // 4. Notify the assignee. Done BEFORE audit emit so a failing audit
  //    write doesn't block the bell (notification writes already swallow
  //    their own errors via appendNotification).
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

  // 3. Audit entry. Failures propagate as a "audit" reason so the caller
  //    can surface "saved but not logged" without rolling back the data
  //    write.
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
    return { ok: false, reason: "audit", error: err, value };
  }

  return { ok: true, value };
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

export interface SetPurchaseApprovalValue {
  purchaseItemId: number;
  approved: boolean;
  previousApproved: boolean;
}

export async function setPurchaseApproval(
  args: ApprovePurchaseArgs,
): Promise<PiActionResult<SetPurchaseApprovalValue>> {
  // 0. Session gate.
  try {
    assertLiveSession(args.actor, args.sessionId);
  } catch (err) {
    return dataWriteFailure(err);
  }

  const approved = args.approved ?? true;
  const now = new Date().toISOString();

  let before;
  try {
    before = await fileService.readJson<{ approved?: boolean; item_name?: string }>(
      `users/${args.targetOwner}/purchase_items/${args.purchaseItemId}.json`,
    );
    if (!before) {
      throw new Error(
        `setPurchaseApproval: item ${args.purchaseItemId} not found in ${args.targetOwner}'s folder`,
      );
    }
  } catch (err) {
    return dataWriteFailure(err);
  }

  let updated;
  try {
    updated = await rawPurchasesApi.update(
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
  } catch (err) {
    return dataWriteFailure(err);
  }

  const value: SetPurchaseApprovalValue = {
    purchaseItemId: args.purchaseItemId,
    approved,
    previousApproved: !!before.approved,
  };

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
    return { ok: false, reason: "audit", error: err, value };
  }

  return { ok: true, value };
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

export interface SetFlagForReviewValue {
  recordType: "task" | "note" | "purchase_item";
  recordId: number;
  flag: PiFlag | null;
  previousFlag: PiFlag | null;
}

export async function setFlagForReview(
  args: FlagRecordArgs,
): Promise<PiActionResult<SetFlagForReviewValue>> {
  // 0. Session gate.
  try {
    assertLiveSession(args.actor, args.sessionId);
  } catch (err) {
    return dataWriteFailure(err);
  }

  let beforeFlag: PiFlag | null = null;
  let displayName: string | undefined;

  try {
    if (args.recordType === "task") {
      const before = await rawTasksApi.get(args.recordId, args.targetOwner);
      if (!before) {
        throw new Error(
          `setFlagForReview: task ${args.recordId} not found in ${args.targetOwner}'s folder`,
        );
      }
      beforeFlag = before.flagged ?? null;
      displayName = before.name;
      await rawTasksApi.update(args.recordId, { flagged: args.flag }, args.targetOwner);
    } else if (args.recordType === "note") {
      const before = await rawNotesApi.get(args.recordId, args.targetOwner);
      if (!before) {
        throw new Error(
          `setFlagForReview: note ${args.recordId} not found in ${args.targetOwner}'s folder`,
        );
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
  } catch (err) {
    return dataWriteFailure(err);
  }

  const value: SetFlagForReviewValue = {
    recordType: args.recordType,
    recordId: args.recordId,
    flag: args.flag,
    previousFlag: beforeFlag,
  };

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
    return { ok: false, reason: "audit", error: err, value };
  }

  return { ok: true, value };
}

/**
 * Convenience for the owner-side "Clear flag" button — bypasses the
 * lab-head session gate. The owner can always clear their own flags
 * without unlocking edit mode.
 *
 * Mira-Skeptic P0 #2: now emits an audit entry mirroring the set-flag
 * shape so the forensic log is symmetric. The original flag-set entry
 * + this clear entry together tell the full story: "flagged at T1 by
 * mira, cleared at T2 by alex." `session_id` is the literal string
 * "owner-clear" so an auditor can distinguish owner-clears from PI-
 * unlocks; `actor` is the owner who clicked the button.
 */
export async function clearFlagAsOwner(args: {
  owner: string;
  recordType: "task" | "note" | "purchase_item";
  recordId: number;
}): Promise<PiActionResult<SetFlagForReviewValue>> {
  // Pre-read so the audit entry can carry the old flag shape.
  let beforeFlag: PiFlag | null = null;

  try {
    if (args.recordType === "task") {
      const before = await rawTasksApi.get(args.recordId, args.owner);
      if (!before) {
        throw new Error(
          `clearFlagAsOwner: task ${args.recordId} not found in ${args.owner}'s folder`,
        );
      }
      beforeFlag = before.flagged ?? null;
      await rawTasksApi.update(args.recordId, { flagged: null }, args.owner);
    } else if (args.recordType === "note") {
      const before = await rawNotesApi.get(args.recordId, args.owner);
      if (!before) {
        throw new Error(
          `clearFlagAsOwner: note ${args.recordId} not found in ${args.owner}'s folder`,
        );
      }
      beforeFlag = before.flagged ?? null;
      await rawNotesApi.update(args.recordId, { flagged: null }, args.owner);
    } else {
      const before = await fileService.readJson<{ flagged?: PiFlag | null }>(
        `users/${args.owner}/purchase_items/${args.recordId}.json`,
      );
      if (!before) {
        throw new Error(
          `clearFlagAsOwner: purchase_item ${args.recordId} not found in ${args.owner}'s folder`,
        );
      }
      beforeFlag = before.flagged ?? null;
      await rawPurchasesApi.update(args.recordId, { flagged: null }, args.owner);
    }
  } catch (err) {
    return dataWriteFailure(err);
  }

  const value: SetFlagForReviewValue = {
    recordType: args.recordType,
    recordId: args.recordId,
    flag: null,
    previousFlag: beforeFlag,
  };

  // Audit emit. Owner-clears stamp session_id "owner-clear" + actor =
  // owner so a reader can distinguish them from PI-unlock-driven entries.
  try {
    await appendAuditEntries(args.owner, [
      {
        session_id: "owner-clear",
        actor: args.owner,
        target_user: args.owner,
        record_type: args.recordType,
        record_id: args.recordId,
        field_path: "flagged",
        old_value: beforeFlag ?? null,
        new_value: null,
      },
    ]);
  } catch (err) {
    return { ok: false, reason: "audit", error: err, value };
  }

  return { ok: true, value };
}
