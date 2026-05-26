// VCP R1 trash MVP notes (2026-05-26): the trash-WRITER. Generic entry
// point for moving any entity's live JSON into `users/<u>/_trash/<type>/`.
//
// R1 wires only the `note` entity type via `notes/notes-trash.ts`'s
// deprecation shim; R2 will plug each remaining entity through the same
// `trashEntity(...)` helper.
//
// Failure model (mirrors the legacy `notes-trash.ts`):
//   1. Read live record. Missing → return null.
//   2. Write trash file with `_trash` block. Fails → bail without
//      touching live.
//   3. Append index entry. Fails → log + continue (best-effort).
//   4. Delete live file. Fails → log + return (live + trash co-exist
//      briefly; the next legitimate delete overwrites the trash copy).

import { fileService } from "@/lib/file-system/file-service";
import {
  readUserSettings,
  type UserSettings,
} from "@/lib/settings/user-settings";
import {
  liveRecordPath,
  trashFilePath,
  trashTypeDirPath,
} from "./trash-paths";
import { appendIndexEntry } from "./trash-index";
import {
  DEFAULT_CLEANUP_DAYS,
  NEVER_EXPIRES_SENTINEL,
  type TrashEntityType,
  type TrashedEntity,
  type TrashFieldBlock,
  type TrashRestoreMetadata,
} from "./trash-types";
import {
  getUserTrashCleanupDays,
  type UserSettingsWithTrash,
} from "./trash-settings";

/** Args for trashing an entity. */
export interface TrashWriteArgs<T extends { id: string | number }> {
  /** The user whose folder owns this record (where the trash file lands). */
  owner: string;
  /** Entity type — drives the on-disk subdirectory + index entry shape. */
  entityType: TrashEntityType;
  /** The entity id. Drives the live-disk path AND the trash filename. */
  id: T["id"];
  /** Optional human-readable name used to build the trash filename slug.
   *  Purely cosmetic; only the `<id>` prefix is load-bearing. */
  nameForSlug?: string | null;
  /** Username of the actor issuing the delete. Owner self-delete: equal
   *  to `owner`. PI cross-owner delete: the lab head username. */
  deletedBy: string;
  /** When the delete happens during a Phase 5 unlock, the session id
   *  from `lib/lab/edit-session.ts`. Persisted on `_trash.deleted_during_session`. */
  sessionId?: string | null;
  /** Optional parent reference, recorded so cascading-restore prompts
   *  can fire in R2. R1 sets `parent_id` to the note's `project_id`. */
  parent?: TrashRestoreMetadata;
}

/** Compute the auto-expires timestamp from cleanup-days. Caller already
 *  resolved the user's preference; this helper exists so tests can
 *  parametrize without going through `readUserSettings`. */
export function computeAutoExpiresAt(
  deletedAtIso: string,
  cleanupDays: number | null,
): string {
  if (cleanupDays === null) return NEVER_EXPIRES_SENTINEL;
  const ms = Date.parse(deletedAtIso) + cleanupDays * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

/** Resolve the deleting user's cleanup-window setting. Falls back to
 *  the proposal default (30 days) when read fails or the field is
 *  absent. Owner-driven (the owner's setting governs THEIR trash); PIs
 *  deleting another user's record still write into the owner's trash
 *  so we read the owner's setting. */
async function resolveCleanupDays(owner: string): Promise<number | null> {
  try {
    const settings = (await readUserSettings(owner)) as UserSettings &
      UserSettingsWithTrash;
    return getUserTrashCleanupDays(settings);
  } catch {
    return DEFAULT_CLEANUP_DAYS;
  }
}

/** Move an entity into trash. Returns the trashed-record shape on
 *  success, or null when the live record was missing (caller treats
 *  both error paths as "nothing to undo"). */
export async function trashEntity<T extends { id: string | number }>(
  args: TrashWriteArgs<T>,
): Promise<TrashedEntity<T> | null> {
  const { owner, entityType, id, nameForSlug, deletedBy, sessionId, parent } =
    args;

  const originalPath = liveRecordPath(owner, entityType, id);
  const live = await fileService.readJson<T>(originalPath);
  if (!live) return null;

  const deletedAt = new Date().toISOString();
  const cleanupDays = await resolveCleanupDays(owner);
  const autoExpiresAt = computeAutoExpiresAt(deletedAt, cleanupDays);

  const trashBlock: TrashFieldBlock = {
    deleted_at: deletedAt,
    deleted_by: deletedBy,
    auto_expires_at: autoExpiresAt,
    original_path: originalPath,
    ...(sessionId ? { deleted_during_session: sessionId } : {}),
    ...(parent ? { restore_metadata: parent } : {}),
  };

  const trashed: TrashedEntity<T> = {
    ...(live as T),
    _trash: trashBlock,
  };

  await fileService.ensureDir(trashTypeDirPath(owner, entityType));
  // Pull a slug-source field from the live record when the caller
  // didn't pass one — every entity type the proposal lists carries
  // either a `title` (notes / tasks / methods / experiments) or a
  // `name` (purchases / projects). Pure cosmetic; fallback to "untitled".
  const slugSource =
    nameForSlug ??
    (() => {
      const rec = live as unknown as Record<string, unknown>;
      const title = typeof rec.title === "string" ? rec.title : null;
      const name = typeof rec.name === "string" ? rec.name : null;
      return title ?? name ?? null;
    })();
  const onDiskPath = trashFilePath(owner, entityType, id, slugSource);
  try {
    await fileService.writeJson(onDiskPath, trashed);
  } catch (err) {
    console.warn("[trash-writer] failed to write trash file", err);
    return null;
  }

  // Index update is best-effort — the on-disk file is the ground
  // truth and the rebuild pass will pick up missing entries.
  try {
    await appendIndexEntry(owner, {
      id,
      entity_type: entityType,
      trash_path: onDiskPath.replace(`users/${owner}/`, ""),
      original_path: originalPath,
      deleted_at: deletedAt,
      deleted_by: deletedBy,
      auto_expires_at: autoExpiresAt,
      ...(parent?.parent_id !== undefined ? { parent_id: parent.parent_id } : {}),
      ...(parent?.parent_entity_type
        ? { parent_entity_type: parent.parent_entity_type }
        : {}),
      ...(parent?.parent_trash_path
        ? { parent_trash_path: parent.parent_trash_path }
        : {}),
    });
  } catch (err) {
    console.warn("[trash-writer] appendIndexEntry failed (non-fatal)", err);
  }

  const removed = await fileService.deleteFile(originalPath);
  if (!removed) {
    console.warn(
      "[trash-writer] trash file written but live file delete failed; live copy still visible",
    );
  }
  return trashed;
}
