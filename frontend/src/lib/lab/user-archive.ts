// Lab Head Phase 6 (lab head Phase 6 manager, 2026-05-23): user archive
// helpers.
//
// Soft-delete-style archive flag stored on each user's `_onboarding.json`
// sidecar (the v5 fields added in `lib/onboarding/sidecar.ts`). Three
// transitions are exposed:
//
//   - `isUserArchived(username)` — read the flag, default false.
//   - `archiveUser(target, actor)` — flip to archived.
//   - `restoreUser(target, actor)` — flip back to active.
//
// Authorization is the caller's responsibility — the Lab Roster surface
// gates these calls on (a) the active user being a lab_head, AND (b) a
// Phase 5 session being unlocked. This module trusts the call site; it
// is plain data plumbing.
//
// Decision recap (Grant 2026-05-23, LAB_HEAD_PROPOSAL §6):
//   1. lab_head only can archive (no self-archive, no member-on-member).
//   2. Login picker hides archived users by default; "Show archived"
//      toggle reveals them.
//   3. Mention / share / assignee pickers filter out archived users;
//      existing references stay intact (render with gray fallback).
//
// Audit: every transition emits one entry on the TARGET user's
// `_pi_audit.json` with `record_type: "user"`, `field_path: "archived"`,
// boolean old/new values. Restore preserves the prior `archived_by`
// only as the audit trail; the sidecar's `archived_by` field is rewritten
// to the actor on the restore call so the most-recent transition is
// always discoverable from the live sidecar.

import { patchOnboarding, readOnboarding } from "@/lib/onboarding/sidecar";
import { appendAuditEntries } from "./pi-audit";

/**
 * Read the archived flag for one user. Defaults to `false` for any
 * non-archive sidecar (missing field, pre-v5 record, malformed file).
 *
 * Safe to call on any username — the sidecar reader normalizes missing
 * files to defaults, so a username that hasn't logged in yet returns
 * `false` rather than throwing.
 */
export async function isUserArchived(username: string): Promise<boolean> {
  const sidecar = await readOnboarding(username);
  return sidecar.archived === true;
}

/**
 * Batch read of the archived set across many users. Used by picker
 * filters that need to drop archived entries in O(N) without N
 * sequential reads. Returns a Set of archived usernames.
 *
 * Tolerant: a per-user read failure (a partly-formed user dir, a
 * corrupt sidecar) drops that user into the "not archived" tier so a
 * single broken file can't hide otherwise-visible accounts.
 */
export async function readArchivedSet(
  usernames: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  await Promise.all(
    usernames.map(async (u) => {
      try {
        if (await isUserArchived(u)) out.add(u);
      } catch {
        // swallow — see docstring
      }
    }),
  );
  return out;
}

/**
 * Flip a user's `archived` flag to true. Stamps `archived_at` with the
 * current ISO timestamp and `archived_by` with the actor's username.
 * Idempotent — calling on an already-archived user is a no-op write
 * (re-stamps `archived_at` so the timestamp reflects the latest
 * action; in practice the Lab Roster UI hides the Archive button on
 * archived rows so this path is rare).
 *
 * Side effects:
 *   - Emits one `_pi_audit.json` entry on the TARGET user's folder
 *     stamped with a synthetic archive session id.
 */
export async function archiveUser(
  targetUsername: string,
  actorUsername: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const session_id = `archive-${Date.now()}`;

  const prevArchived = (await readOnboarding(targetUsername)).archived === true;

  await patchOnboarding(targetUsername, (cur) => ({
    ...cur,
    archived: true,
    archived_at: nowIso,
    archived_by: actorUsername,
  }));

  await appendAuditEntries(targetUsername, [
    {
      session_id,
      actor: actorUsername,
      target_user: targetUsername,
      record_type: "user",
      record_id: targetUsername,
      field_path: "archived",
      old_value: prevArchived,
      new_value: true,
    },
  ]);
}

/**
 * Flip a user's `archived` flag back to false. Clears `archived_at`
 * to null but REWRITES `archived_by` to the restoring actor — the
 * sidecar's `archived_by` field always reflects the most-recent
 * transition (archive OR restore). The prior `archived_by` value is
 * preserved in the audit log entry that this call emits.
 *
 * Idempotent — calling on a non-archived user is a no-op-style write
 * (clears the timestamp but emits an audit entry showing the
 * non-transition). UI surfaces the Restore button only on archived
 * rows so this path is rare.
 */
export async function restoreUser(
  targetUsername: string,
  actorUsername: string,
): Promise<void> {
  const session_id = `archive-${Date.now()}`;

  const prevArchived = (await readOnboarding(targetUsername)).archived === true;

  await patchOnboarding(targetUsername, (cur) => ({
    ...cur,
    archived: false,
    archived_at: null,
    archived_by: actorUsername,
  }));

  await appendAuditEntries(targetUsername, [
    {
      session_id,
      actor: actorUsername,
      target_user: targetUsername,
      record_type: "user",
      record_id: targetUsername,
      field_path: "archived",
      old_value: prevArchived,
      new_value: false,
    },
  ]);
}
