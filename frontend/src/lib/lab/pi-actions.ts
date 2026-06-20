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

import { tasksApi as rawTasksApi, notesApi as rawNotesApi, purchasesApi as rawPurchasesApi, buildCurrentViewer } from "@/lib/local-api";
import { fileService } from "../file-system/file-service";
import { appendAuditEntries } from "./pi-audit";
import { readArchivedSet } from "./user-archive";
import { PURCHASE_LORO_ENABLED } from "@/lib/loro/config";
import { writePurchaseUpdateThroughLoro } from "@/lib/loro/purchase-write-through";
import type { PurchaseItem, PurchaseItemUpdate } from "@/lib/types";
import { notificationCategory } from "@/lib/notifications/preferences";
import { readSharingIdentity } from "@/lib/sharing/identity/sidecar";
import { loadUserCaptureKeys } from "@/lib/mobile-relay/keys";
import { notifyRecipient } from "@/lib/mobile-relay/client";
import { CLASS_MODE_ENABLED } from "./class-mode-config";
import {
  planAssignmentFanout,
  type AssignmentChecklistItem,
  type AssignmentVisibility,
} from "./class-assignment";
import { publishAssignmentRecord } from "./class-assignment-store";
import type { LabMember } from "./lab-membership";

// Purchase items on Loro (docs/proposals/PURCHASE_LORO.md) chunk 3 = WRITE
// routing for the lab-head approval / decline / flag writes. The pre-read +
// permission flow above each call stays AUTHORITATIVE and runs BEFORE this
// helper; only the persistence mechanism changes. When PURCHASE_LORO_ENABLED
// the update lands in the item's Loro doc (persisting the .loro sidecar AND the
// .json mirror + relay fan-out); the mirror keeps the approval-queue / audit
// readers correct. Flag off, it falls through to rawPurchasesApi.update EXACTLY
// as before.
async function writePurchaseUpdate(
  owner: string,
  id: number,
  patch: PurchaseItemUpdate,
): Promise<PurchaseItem | null> {
  if (PURCHASE_LORO_ENABLED) {
    return writePurchaseUpdateThroughLoro(owner, id, patch);
  }
  return rawPurchasesApi.update(id, patch, owner);
}

// PI edit-mode / edit-session removal (remove-edit-mode bot, 2026-06-07):
// lab-head actions (assign / approve / decline / flag) no longer require a
// timed edit session. The on-disk audit entries these actions still emit are
// stamped with this synthetic id where a session id used to live.
const LAB_HEAD_ACTION_SESSION = "lab-head-action";
import type {
  Notification,
  LabAnnouncementNotification,
  LabTaskAssignmentNotification,
  LabPurchaseApprovalNotification,
  LabFlagForReviewNotification,
  LabClassAssignmentNotification,
  LabClassReturnedNotification,
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

/**
 * ACL hardening (2026-06-08): every lab-head action below writes cross-owner
 * (into a target member's folder) and emits an audit entry attributed to an
 * `actor` arg supplied by the caller. Before this gate the `actor` was taken on
 * trust — nothing verified the PROCESS current user was actually a lab head, so
 * any caller could pass `actor: "<some-pi>"` and perform a privileged write
 * into another member's folder. This check builds the live viewer and refuses
 * the action unless the current user genuinely holds the `lab_head` role,
 * BEFORE any data write or audit append fires.
 *
 * Returns a `data-write` failure to short-circuit when the gate fails (the
 * record was never touched), or `null` to proceed. A failure reading the
 * viewer (e.g. settings.json unreadable) is also treated as a refusal — fail
 * closed for a privileged cross-owner write.
 */
async function assertLabHeadActor(
  apiTag: string,
): Promise<PiActionResult<never> | null> {
  try {
    const viewer = await buildCurrentViewer();
    if (viewer.account_type !== "lab_head") {
      return dataWriteFailure(
        new Error(
          `[${apiTag}] refused: ${viewer.username || "anonymous"} is not a lab head`,
        ),
      );
    }
    return null;
  } catch (err) {
    return dataWriteFailure(err);
  }
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

// Mira Batch 1 polish (2026-05-23): per-user serial queue for the
// notifications file. The previous implementation was a raw
// read-modify-write on `users/<receiver>/_notifications.json`. If two
// async writers landed at the same moment (e.g. a PI dispatching an
// announcement fan-out while a comment-mention notification also lands)
// the second writer would clobber the first's append. The queue chains
// concurrent writes to the same user behind one in-flight promise so
// the file converges. Map identity is keyed by the receiver username so
// writes against different users still parallelize.
const notificationWriteQueue = new Map<string, Promise<unknown>>();

function enqueueNotificationWrite<T>(
  receiver: string,
  job: () => Promise<T>,
): Promise<T> {
  const previous = notificationWriteQueue.get(receiver) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(job);
  // Stash the chained promise so subsequent writers wait on it.
  notificationWriteQueue.set(receiver, next);
  // Best-effort cleanup once the chain drains, keeps the map from
  // growing unboundedly across long-running sessions. Compare identity
  // so a later-arriving write that already extended the chain doesn't
  // get evicted.
  void next.finally(() => {
    if (notificationWriteQueue.get(receiver) === next) {
      notificationWriteQueue.delete(receiver);
    }
  });
  return next;
}

/**
 * Best-effort phone push P2 for an in-folder lab action. Resolves the folder
 * co-member's Ed25519 identity key from their sharing-identity sidecar
 * (users/<username>/_sharing_identity.json) and asks the relay to buzz their
 * phone, fire-and-forget. The relay gates on the recipient's OWN per-category
 * phone toggle + quiet hours, so a category they muted never buzzes; a recipient
 * with no account (no sidecar) or no paired phone simply never buzzes. The
 * category is derived from the notification type so it matches the recipient's
 * routing matrix exactly. Never throws; a missed buzz must not break the action.
 */
async function buzzRecipientPhone(
  recipientUsername: string,
  notifType: string,
): Promise<void> {
  try {
    const senderKeys = await loadUserCaptureKeys();
    if (!senderKeys) return;
    const sidecar = await readSharingIdentity(recipientUsername);
    if (!sidecar?.ed25519PublicKey) return;
    await notifyRecipient(
      senderKeys,
      sidecar.ed25519PublicKey,
      notificationCategory(notifType),
    );
  } catch {
    // Best-effort. A failed resolve/send is never surfaced.
  }
}

async function appendNotification(
  receiver: string,
  notif: Notification,
): Promise<void> {
  await enqueueNotificationWrite(receiver, async () => {
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
  });
}

/**
 * Mira Batch 1 polish (2026-05-23): mutate every entry in one user's
 * `_notifications.json` via a single RMW. Used by announcement
 * delete/edit so the bell rows stay aligned with the source-of-truth
 * announcements file. Goes through the same per-user serial queue as
 * `appendNotification` so concurrent appends and edits can't clobber
 * each other.
 *
 * The transform receives the current notifications array and returns
 * the next one. Returning the same array (===) skips the disk write.
 */
async function mutateNotifications(
  receiver: string,
  transform: (current: Notification[]) => Notification[],
): Promise<void> {
  await enqueueNotificationWrite(receiver, async () => {
    try {
      const path = notificationsPath(receiver);
      const existing = await fileService.readJson<Partial<NotificationFile>>(path);
      const current = existing?.notifications ?? [];
      const next = transform(current);
      if (next === current) return;
      const merged: NotificationFile = {
        version: 1,
        notifications: next,
      };
      await fileService.writeJson(path, merged);
    } catch (err) {
      console.warn("[pi-actions] notification mutate failed", err);
    }
  });
}

/**
 * Mira Batch 1 polish (2026-05-23): scrub every receiver's bell rows
 * that reference a deleted lab-wide announcement. Called from
 * `deleteAnnouncement` so the bell counter and the announcements list
 * stay aligned (previously the announcement file row was removed but
 * the per-user `_notifications.json` entries stuck around — clicking
 * one led to a dead "Not found" lookup).
 */
export async function purgeAnnouncementNotifications(args: {
  excludeAuthor?: string;
  announcementId: string;
}): Promise<void> {
  const recipients = await listAllMemberUsernames();
  await Promise.all(
    recipients
      .filter((u) => !args.excludeAuthor || u !== args.excludeAuthor)
      .map((receiver) =>
        mutateNotifications(receiver, (current) => {
          const filtered = current.filter((n) => {
            if (n.type !== "lab_announcement") return true;
            const lan = n as LabAnnouncementNotification;
            return lan.announcement_id !== args.announcementId;
          });
          return filtered.length === current.length ? current : filtered;
        }),
      ),
  );
}

/**
 * Mira Batch 1 polish (2026-05-23): refresh every receiver's bell-row
 * preview text after an announcement edit so the inline preview matches
 * the live announcement body.
 */
export async function refreshAnnouncementNotifications(args: {
  excludeAuthor?: string;
  announcementId: string;
  text: string;
}): Promise<void> {
  const preview = args.text.length > 120 ? args.text.slice(0, 117) + "…" : args.text;
  const recipients = await listAllMemberUsernames();
  await Promise.all(
    recipients
      .filter((u) => !args.excludeAuthor || u !== args.excludeAuthor)
      .map((receiver) =>
        mutateNotifications(receiver, (current) => {
          let changed = false;
          const next = current.map((n) => {
            if (n.type !== "lab_announcement") return n;
            const lan = n as LabAnnouncementNotification;
            if (lan.announcement_id !== args.announcementId) return n;
            if (lan.preview === preview) return n;
            changed = true;
            return { ...lan, preview };
          });
          return changed ? next : current;
        }),
      ),
  );
}

// ── Lab-wide announcement fan-out ───────────────────────────────────────
//
// Posted to every lab member (sans the PI) via per-user notification
// writes. Member discovery walks `users/` via the existing fileService
// listing.

async function listAllMemberUsernames(): Promise<string[]> {
  try {
    // Lab members are subdirectories of `users/`. Skip the lab-scoped
    // namespace (`users/lab`), the public methods folder (`users/public`),
    // and any hidden / system folder.
    const dirs = await fileService.listDirectories("users");
    return dirs.filter((name) => {
      if (!name || name.startsWith("_") || name === "lab" || name === "public") {
        return false;
      }
      return true;
    });
  } catch {
    return [];
  }
}

async function listMemberUsernames(excluding?: string): Promise<string[]> {
  const dirs = await listAllMemberUsernames();
  // Mira Batch 1 polish (2026-05-23): drop archived members so the
  // announcement fan-out doesn't write bell rows nobody can see. The
  // archive set read is best-effort; on failure we fall through to the
  // unfiltered list so a transient FS hiccup doesn't silently swallow
  // notifications for active members.
  let archived: Set<string>;
  try {
    archived = await readArchivedSet(dirs);
  } catch {
    archived = new Set<string>();
  }
  return dirs.filter((name) => {
    if (excluding && name === excluding) return false;
    if (archived.has(name)) return false;
    return true;
  });
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
      void buzzRecipientPhone(receiver, "lab_announcement");
    }),
  );
}

// ── Task assignment ────────────────────────────────────────────────────
//
// Assignee is a string on the task; we route the write through the
// Phase 5 R1 audit-emitting pattern so the entry lands in the target's
// folder + their _pi_audit.json.

export interface AssignTaskArgs {
  /** The lab head's username (audit actor). */
  actor: string;
  /** Deprecated: retained for back-compat; no longer used (the PI
   *  edit-session was removed). */
  sessionId?: string;
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
  // 0. Role gate — only a lab head may assign a member's task.
  const gate = await assertLabHeadActor("assignTask");
  if (gate) return gate;

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
    void buzzRecipientPhone(args.assignee, "lab_task_assignment");
  }

  // 3. Audit entry. Failures propagate as a "audit" reason so the caller
  //    can surface "saved but not logged" without rolling back the data
  //    write.
  try {
    await appendAuditEntries(args.targetOwner, [
      {
        session_id: args.sessionId ?? LAB_HEAD_ACTION_SESSION,
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

// ── Class Mode: assign a method to a class (CT-2 live wiring) ────────────
//
// Models assignTask exactly (role-gate the instructor, write the record, fan a
// notification + an audit entry per student) but per the C2 invariant the fan-out
// is ONE INSTRUCTOR-OWNED shared assignment record (under the instructor's own
// owner-prefix, NEVER under a student) plus a per-student notification, NOT a
// write into each student's folder. The pure planner (class-assignment.ts) builds
// the descriptors; this is the live writer.
//
// Gated behind NEXT_PUBLIC_CLASS_MODE. Flag off, the action refuses cleanly
// (returns a data-write failure, no record written, no notification, no audit), so
// a stray caller in a flag-off build is a no-op exactly like today.

export interface AssignMethodToClassArgs {
  /** The instructor (head) username, the audit actor + the sole record owner. */
  actor: string;
  /** The class lab identifier (the relay namespace the record lands in). */
  labId: string;
  /** Stable assignment id (a portable string id, the link target for notebooks). */
  assignmentId: string;
  /** Display title shown to students. */
  title: string;
  /** Optional longer prompt / instructions. */
  description?: string;
  /** The method the protocol was authored as (copied by reference into notebooks). */
  templateMethodId?: number;
  /** Checklist steps seeded into each student notebook. */
  checklist: AssignmentChecklistItem[];
  /** private (subkey-sealed student work) or collaborative (team-key). */
  visibility: AssignmentVisibility;
  /**
   * The relay-roster students (non-head members). MUST come from
   * getLabRemote(labId).record.members filtered to non-head, NOT useLabData().users,
   * because the students live in their own folders and only the signed relay roster
   * names them. The caller passes that filtered list.
   */
  students: LabMember[];
  /** When true, share the record to "*" (whole class); otherwise per-student. */
  wholeClass?: boolean;
  /** The class team key (the assignment prompt is sealed under it, server-blind). */
  teamKey: Uint8Array;
  /** The instructor's lab signing keypair (the relay verifies the signer). */
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
}

export interface AssignMethodToClassValue {
  assignmentId: string;
  /** The instructor-owned record key segment (owner/recordType/recordId). */
  owner: string;
  /** Number of students notified. */
  notified: number;
}

export async function assignMethodToClass(
  args: AssignMethodToClassArgs,
): Promise<PiActionResult<AssignMethodToClassValue>> {
  // 0a. Flag gate. Class Mode does not half-ship. Flag off, refuse cleanly so no
  //     record, notification, or audit is ever authored (byte-identical to today).
  if (!CLASS_MODE_ENABLED) {
    return dataWriteFailure(
      new Error("assignMethodToClass: class mode is disabled (NEXT_PUBLIC_CLASS_MODE off)"),
    );
  }

  // 0b. Role gate. Only a lab head (the instructor) may assign to a class.
  const gate = await assertLabHeadActor("assignMethodToClass");
  if (gate) return gate;

  // 1. Plan the C2-correct fan-out. The planner throws on a malformed roster (the
  //    instructor listed as their own student, an empty instructor), so an invalid
  //    assignment never reaches the relay. Classify any planner throw as a
  //    data-write failure (nothing was written).
  let plan;
  try {
    plan = planAssignmentFanout({
      assignmentId: args.assignmentId,
      title: args.title,
      description: args.description,
      templateMethodId: args.templateMethodId,
      checklist: args.checklist,
      visibility: args.visibility,
      instructor: args.actor,
      students: args.students,
      assignedAt: new Date().toISOString(),
      wholeClass: args.wholeClass,
    });
  } catch (err) {
    return dataWriteFailure(err);
  }

  // 2. The single instructor-owned write. owner = the instructor (the planner
  //    stamped it); the team key seals the prompt; the relay verifies the signer.
  try {
    await publishAssignmentRecord({
      labId: args.labId,
      write: plan.instructorWrite,
      teamKey: args.teamKey,
      signerEd25519Priv: args.signerEd25519Priv,
      signerEd25519Pub: args.signerEd25519Pub,
    });
  } catch (err) {
    return dataWriteFailure(err);
  }

  // Record write landed. From here we are on the partial-success path.
  const value: AssignMethodToClassValue = {
    assignmentId: args.assignmentId,
    owner: plan.instructorWrite.owner,
    notified: plan.notifications.length,
  };

  // 3. Notify every student. Done BEFORE the audit emit so a failing audit append
  //    does not block the bells (notification writes swallow their own errors).
  const now = new Date().toISOString();
  await Promise.all(
    plan.notifications.map(async (n) => {
      const notif: LabClassAssignmentNotification = {
        id: newId(),
        type: "lab_class_assignment",
        from_user: args.actor,
        owner_username: args.actor,
        assignment_id: n.assignmentId,
        title: n.title,
        created_at: now,
        read: false,
      };
      await appendNotification(n.toUser, notif);
      void buzzRecipientPhone(n.toUser, "lab_class_assignment");
    }),
  );

  // 4. Audit one entry per student. The assignment is authored under the
  //    instructor's own prefix, but the forensic record is "instructor assigned X
  //    to student S", so we stamp one entry per target student. A failing audit
  //    append surfaces as the "audit" reason without rolling back the record.
  try {
    await Promise.all(
      plan.notifications.map((n) =>
        appendAuditEntries(n.toUser, [
          {
            session_id: LAB_HEAD_ACTION_SESSION,
            actor: args.actor,
            target_user: n.toUser,
            record_type: "task",
            record_id: args.assignmentId,
            field_path: "class_assignment",
            old_value: null,
            new_value: args.assignmentId,
          },
        ]),
      ),
    );
  } catch (err) {
    return { ok: false, reason: "audit", error: err, value };
  }

  return { ok: true, value };
}

// ── Purchase approval ──────────────────────────────────────────────────

export interface ApprovePurchaseArgs {
  actor: string;
  sessionId?: string;
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
  // 0. Role gate — only a lab head may approve/clear a member's purchase.
  const gate = await assertLabHeadActor("setPurchaseApproval");
  if (gate) return gate;

  const approved = args.approved ?? true;
  const now = new Date().toISOString();

  let before;
  try {
    before = await fileService.readJson<{
      approved?: boolean;
      item_name?: string;
      declined_at?: string | null;
      declined_by?: string | null;
    }>(
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

  // PiActions follow-up (PiActions follow-up manager, 2026-05-23):
  // approve always CLEARS any prior decline (the PI changed their mind),
  // restoring the state machine to "approved". This branch through the
  // same function keeps callers from having to choose between approve
  // and "re-approve after decline" — they're the same write.
  let updated;
  try {
    updated = await writePurchaseUpdate(
      args.targetOwner,
      args.purchaseItemId,
      {
        approved,
        approved_by: approved ? args.actor : null,
        approved_at: approved ? now : null,
        // Approve clears decline; un-approve (clear-to-pending) also
        // clears decline so the explicit "decline" path via
        // declinePurchase is the only way to land in the declined state.
        declined_at: null,
        declined_by: null,
      },
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
    void buzzRecipientPhone(args.targetOwner, "lab_purchase_approval");
  }

  try {
    await appendAuditEntries(args.targetOwner, [
      {
        session_id: args.sessionId ?? LAB_HEAD_ACTION_SESSION,
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

// ── Purchase decline (PiActions follow-up, 2026-05-23) ─────────────────
//
// Separate entry point from setPurchaseApproval because decline carries a
// distinct, persisted state (declined_at + declined_by). Approve clearing
// decline lives in setPurchaseApproval; this is the inverse: decline
// clears `approved` and stamps the decline fields. Re-approving a
// declined item goes back through setPurchaseApproval (which now wipes
// the decline fields), so callers don't need a separate "re-approve"
// entry point.

export interface DeclinePurchaseArgs {
  actor: string;
  sessionId?: string;
  targetOwner: string;
  purchaseItemId: number;
  /** Denormalized item name for the audit row context. */
  itemName?: string;
}

export interface DeclinePurchaseValue {
  purchaseItemId: number;
  declinedAt: string;
  declinedBy: string;
  previousApproved: boolean;
  previousDeclinedAt: string | null;
}

export async function declinePurchase(
  args: DeclinePurchaseArgs,
): Promise<PiActionResult<DeclinePurchaseValue>> {
  // 0. Role gate — only a lab head may decline a member's purchase.
  const gate = await assertLabHeadActor("declinePurchase");
  if (gate) return gate;

  const now = new Date().toISOString();

  let before;
  try {
    before = await fileService.readJson<{
      approved?: boolean;
      declined_at?: string | null;
      declined_by?: string | null;
    }>(
      `users/${args.targetOwner}/purchase_items/${args.purchaseItemId}.json`,
    );
    if (!before) {
      throw new Error(
        `declinePurchase: item ${args.purchaseItemId} not found in ${args.targetOwner}'s folder`,
      );
    }
  } catch (err) {
    return dataWriteFailure(err);
  }

  let updated;
  try {
    updated = await writePurchaseUpdate(
      args.targetOwner,
      args.purchaseItemId,
      {
        approved: false,
        approved_by: null,
        approved_at: null,
        declined_at: now,
        declined_by: args.actor,
      },
    );
    if (!updated) {
      throw new Error("declinePurchase: purchasesApi.update returned null");
    }
  } catch (err) {
    return dataWriteFailure(err);
  }

  const value: DeclinePurchaseValue = {
    purchaseItemId: args.purchaseItemId,
    declinedAt: now,
    declinedBy: args.actor,
    previousApproved: !!before.approved,
    previousDeclinedAt: before.declined_at ?? null,
  };

  // Decline is a silent revert from the owner's perspective (mirrors the
  // approve-clears-to-pending path which also doesn't notify). No bell
  // notification on decline — a future enhancement could add one if PIs
  // want to flag "I turned this down" to the requester.

  try {
    await appendAuditEntries(args.targetOwner, [
      {
        session_id: args.sessionId ?? LAB_HEAD_ACTION_SESSION,
        actor: args.actor,
        target_user: args.targetOwner,
        record_type: "purchase_item",
        record_id: args.purchaseItemId,
        field_path: "declined",
        old_value: before.declined_at ?? null,
        new_value: now,
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
  sessionId?: string;
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
  // 0. Role gate — only a lab head may flag a member's record for review.
  const gate = await assertLabHeadActor("setFlagForReview");
  if (gate) return gate;

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
      await writePurchaseUpdate(args.targetOwner, args.recordId, { flagged: args.flag });
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
    void buzzRecipientPhone(args.targetOwner, "lab_flag_for_review");
  }

  try {
    await appendAuditEntries(args.targetOwner, [
      {
        session_id: args.sessionId ?? LAB_HEAD_ACTION_SESSION,
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
      await writePurchaseUpdate(args.owner, args.recordId, { flagged: null });
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
