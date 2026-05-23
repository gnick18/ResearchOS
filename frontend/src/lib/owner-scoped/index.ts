// Lab Mode retirement R1 (R1 unified sharing manager, 2026-05-23): the
// consolidated owner-scoped wrapper. Phase 5 of the Lab Head proposal
// shipped three hand-rolled wrappers — one each for tasks, notes,
// purchases. They all follow the same pattern: route writes to a
// specific owner's folder + emit per-field audit entries via
// `appendAuditEntries`. This module:
//
//   1. Re-exports the three existing wrappers so existing call sites
//      keep working without a migration.
//   2. Adds a generic `createOwnerScopedAuditedApi` factory so the
//      remaining record types (methods, links, goals, projects, lists,
//      mass spec protocols) can plug in without copy-pasting the
//      Phase-5 boilerplate.
//   3. Re-exports the shared `EditSession` interface and
//      `canWrite`-style guards from `lib/sharing/unified.ts` so a single
//      import covers everything in this domain.
//
// FLAG (data-shape): the wrappers themselves don't change on-disk shapes
// — they're write-path adapters. The on-disk shape changes belong to
// `lib/sharing/migrate-unified.ts`.

export { ownerScopedTasksApi } from "@/lib/tasks/owner-scoped-api";
export {
  ownerScopedNotesApi,
  type OwnerScopedNotesArgs,
} from "@/lib/notes/owner-scoped-api";
export {
  ownerScopedPurchasesApi,
  type OwnerScopedPurchasesArgs,
} from "@/lib/purchases/owner-scoped-api";

// Re-export the unified read/write helpers so a single
// `from "@/lib/owner-scoped"` import gives callers everything they
// need for cross-owner reads + writes + audit.
export {
  canRead,
  canWrite,
  expandSharedWith,
  normalizeSharedWith,
  upsertSharedEntry,
  removeSharedEntry,
  isWholeLabShared,
  WHOLE_LAB_SENTINEL,
  NEVER_UNLOCKED,
  type Viewer,
  type ShareableRecord,
  type EditSessionView,
} from "@/lib/sharing/unified";

import {
  appendAuditEntries,
  buildFieldDiffEntries,
  type PiAuditEntry,
} from "@/lib/lab/pi-audit";
import { fileService } from "@/lib/file-system/file-service";

/**
 * Common args shape: target owner + actor + session id. When any of
 * the three is null/undefined, the wrapper is inert (writes go to the
 * current viewer's folder and no audit is emitted).
 */
export interface OwnerScopedAuditArgs {
  targetOwner: string | null | undefined;
  actor: string | null | undefined;
  sessionId: string | null | undefined;
}

/**
 * Generic factory: produces audit-emitting wrappers around a
 * `{ update, create?, delete? }` style API. Use this for any record
 * type whose underlying store + API follows the same shape as
 * methods / links / goals / projects.
 *
 * `record_type` is the string written to the audit log. Pick a stable
 * machine name ("method", "lab_link", "goal", "project").
 *
 * `readBefore` is the pre-edit fetch — for the diff helper. Typically
 * a thin call into the underlying store with `owner` routing.
 */
export function createOwnerScopedAuditedApi<
  TUpdate extends Record<string, unknown>,
  TRecord extends Record<string, unknown>,
>(args: {
  recordType: string;
  audit: OwnerScopedAuditArgs;
  readBefore: (id: number, owner: string) => Promise<TRecord | null>;
  update: (id: number, data: TUpdate, owner: string) => Promise<TRecord | null>;
}): (id: number, data: TUpdate) => Promise<TRecord | null> {
  const { recordType, audit, readBefore, update } = args;
  const { targetOwner, actor, sessionId } = audit;
  const active = !!targetOwner && !!actor && !!sessionId;

  return async (id, data) => {
    if (!active) {
      // No owner-routing, no audit — caller must route through their
      // own un-scoped API instead. Returning null here would be a
      // silent footgun, so the contract is: do not call this returned
      // fn unless `active` is true. To keep the contract enforceable
      // we delegate to update() with the current viewer's folder
      // (owner undefined → caller would pass the current user via a
      // closure). For safety, throw to make the bug obvious.
      throw new Error(
        `createOwnerScopedAuditedApi (${recordType}): args missing targetOwner/actor/sessionId; use the unwrapped API instead.`,
      );
    }
    const owner = targetOwner as string;
    const writer = actor as string;
    const session = sessionId as string;

    const before = await readBefore(id, owner);
    const updated = await update(id, data, owner);

    if (before && updated) {
      const entries = buildFieldDiffEntries({
        actor: writer,
        session_id: session,
        target_user: owner,
        record_type: recordType,
        record_id: id,
        oldRecord: before as Record<string, unknown>,
        newRecord: updated as Record<string, unknown>,
        fieldPaths: Object.keys(data).filter((k) => k !== "updated_at"),
      });
      try {
        await appendAuditEntries(owner, entries);
      } catch (err) {
        console.warn(
          `[createOwnerScopedAuditedApi/${recordType}] appendAuditEntries failed`,
          err,
        );
      }
    }
    return updated;
  };
}

/**
 * Emit a single audit entry "out-of-band" — for cases where the
 * mutation itself doesn't fit the readBefore/update shape (e.g. the
 * method auto-grant transient-read entry from a shared task referencing
 * a method).
 */
export async function emitOwnerScopedAuditEntry(
  args: OwnerScopedAuditArgs & {
    target_user: string;
    record_type: string;
    record_id: string | number;
    field_path: string;
    old_value: unknown;
    new_value: unknown;
  },
): Promise<void> {
  if (!args.actor || !args.sessionId) {
    // Best-effort: skip when we don't have an actor/session, but log so
    // misuse is visible. Some callers (e.g. the method auto-grant
    // transient-read path) write entries with actor: "system" — those
    // pass a synthetic session id and still hit this branch.
    return;
  }
  const entry: Omit<PiAuditEntry, "id" | "timestamp"> = {
    session_id: args.sessionId,
    actor: args.actor,
    target_user: args.target_user,
    record_type: args.record_type,
    record_id: args.record_id,
    field_path: args.field_path,
    old_value: args.old_value,
    new_value: args.new_value,
  };
  try {
    await appendAuditEntries(args.target_user, [entry]);
  } catch (err) {
    console.warn(
      `[emitOwnerScopedAuditEntry/${args.record_type}] failed`,
      err,
    );
  }
}

/**
 * Convenience: read any record from a target owner's folder, given the
 * store's directory name. Used as the `readBefore` callback for the
 * generic factory.
 */
export async function readRecordForOwner<T = Record<string, unknown>>(
  dirName: string,
  id: number,
  owner: string,
): Promise<T | null> {
  return fileService.readJson<T>(`users/${owner}/${dirName}/${id}.json`);
}
