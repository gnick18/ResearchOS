// VCP R1 trash MVP notes (2026-05-26): one-time migration from the
// legacy `<type>_trash/` layouts to the new `_trash/<type>/` layout.
//
// R1 shipped just the Notes migration. R2 extends the same mechanical
// pass to every other entity type that COULD have grown a legacy
// `<type>_trash/` directory ahead of R1 (in practice only `notes_trash/`
// exists in user folders today — the others are defensive coverage so
// the migration stays correct if a future feature adds a sibling).
//
// The migration is IDEMPOTENT — safe on every folder-connect, on multiple
// devices, after partial failures. Idempotency mechanism:
//   1. If `_trash/<type>/` already has files AND `<legacy>/` is empty,
//      skip the whole pass for that type (the migration already
//      completed here).
//   2. For each file in `<legacy>/<id>.json`:
//      - Skip when a `_trash/<type>/<id>-<slug>.json` for the same id
//        already exists (we matched a prior copy of this entry).
//      - Otherwise write the new shape (with the `_trash` block back-
//        filled from the legacy `deleted_at` stamp), update the index,
//        and remove the legacy file ONLY when the new file landed
//        cleanly.
//   3. The legacy `<type>_trash/` directory marker is preserved for one
//      release as a tombstone safety net (we do NOT `rm -rf` it). After
//      every file moves, the directory sits empty so we can reverse-
//      migrate if a regression surfaces.
//
// Migration runs on `finishConnect` — wrapped in try/catch and failures
// don't block the folder open.

import { fileService } from "@/lib/file-system/file-service";
import {
  trashFilePath,
  trashTypeDirPath,
  liveRecordPath,
} from "./trash-paths";
import { appendIndexEntry, readOrRebuildTrashIndex } from "./trash-index";
import {
  DEFAULT_CLEANUP_DAYS,
  type TrashEntityType,
  type TrashFieldBlock,
  type TrashedEntity,
} from "./trash-types";
import { computeAutoExpiresAt } from "./trash-writer";

/** Map of entity type → legacy `<type>_trash/` directory name. Only
 *  Notes had one in pre-R1 builds; the others are listed defensively
 *  for forward compat in case anyone hand-creates the directories. */
const LEGACY_DIRS: Array<{ type: TrashEntityType; dirName: string }> = [
  { type: "note", dirName: "notes_trash" },
  { type: "task", dirName: "tasks_trash" },
  { type: "method", dirName: "methods_trash" },
  { type: "project", dirName: "projects_trash" },
  { type: "purchase_item", dirName: "purchase_items_trash" },
  { type: "high_level_goal", dirName: "goals_trash" },
  { type: "lab_link", dirName: "lab_links_trash" },
  { type: "mass_spec_protocol", dirName: "mass_spec_methods_trash" },
];

interface LegacyTrashedRecord {
  id: number;
  title?: string;
  name?: string;
  username?: string;
  owner?: string;
  deleted_at?: string;
  [key: string]: unknown;
}

/** Migrate a single entity type's legacy trash directory for one user. */
async function migrateOneLegacyDir(
  username: string,
  entityType: TrashEntityType,
  legacyDirName: string,
): Promise<{ scanned: number; migrated: number; skipped: number; errors: number }> {
  const summary = { scanned: 0, migrated: 0, skipped: 0, errors: 0 };
  const legacyDir = `users/${username}/${legacyDirName}`;
  const newDir = trashTypeDirPath(username, entityType);

  const [legacyFiles, newFiles] = await Promise.all([
    fileService.listFiles(legacyDir),
    fileService.listFiles(newDir),
  ]);
  const legacyJsons = legacyFiles.filter((f) => f.endsWith(".json"));
  if (legacyJsons.length === 0) return summary;

  summary.scanned = legacyJsons.length;
  await fileService.ensureDir(newDir);

  const existingIds = new Set<string>();
  for (const fname of newFiles) {
    const dash = fname.indexOf("-");
    const idPart = dash > 0 ? fname.slice(0, dash) : fname.replace(/\.json$/, "");
    existingIds.add(idPart);
  }

  for (const filename of legacyJsons) {
    const idStr = filename.replace(/\.json$/, "");
    if (existingIds.has(idStr)) {
      try {
        await fileService.deleteFile(`${legacyDir}/${filename}`);
      } catch (err) {
        console.warn(
          `[trash-migrate] failed to delete legacy duplicate ${entityType}/${filename}`,
          err,
        );
      }
      summary.skipped++;
      continue;
    }

    try {
      const legacy = await fileService.readJson<LegacyTrashedRecord>(
        `${legacyDir}/${filename}`,
      );
      if (!legacy || typeof legacy.id !== "number") {
        summary.errors++;
        console.warn(
          `[trash-migrate] unreadable legacy file: ${entityType}/${filename} (skipping)`,
        );
        continue;
      }
      const id = legacy.id;
      const deletedAt = legacy.deleted_at ?? new Date().toISOString();
      const trashBlock: TrashFieldBlock = {
        deleted_at: deletedAt,
        deleted_by: legacy.username ?? legacy.owner ?? username,
        auto_expires_at: computeAutoExpiresAt(deletedAt, DEFAULT_CLEANUP_DAYS),
        original_path: liveRecordPath(username, entityType, id),
      };
      const { deleted_at: _legacyDeletedAt, ...rest } = legacy;
      void _legacyDeletedAt;
      const trashed: TrashedEntity<typeof rest & { id: number }> = {
        ...(rest as typeof rest & { id: number }),
        _trash: trashBlock,
      };
      const nameForSlug =
        typeof legacy.title === "string"
          ? legacy.title
          : typeof legacy.name === "string"
            ? legacy.name
            : null;
      const newPath = trashFilePath(username, entityType, id, nameForSlug);
      await fileService.writeJson(newPath, trashed);

      try {
        await appendIndexEntry(username, {
          id,
          entity_type: entityType,
          trash_path: newPath.replace(`users/${username}/`, ""),
          original_path: trashBlock.original_path,
          deleted_at: trashBlock.deleted_at,
          deleted_by: trashBlock.deleted_by,
          auto_expires_at: trashBlock.auto_expires_at,
        });
      } catch (err) {
        console.warn(
          `[trash-migrate] index append failed for ${entityType} ${id} (recoverable)`,
          err,
        );
      }

      try {
        await fileService.deleteFile(`${legacyDir}/${filename}`);
      } catch (err) {
        console.warn(
          `[trash-migrate] failed to remove legacy file ${entityType}/${filename}`,
          err,
        );
      }
      summary.migrated++;
    } catch (err) {
      summary.errors++;
      console.warn(
        `[trash-migrate] unexpected failure migrating ${entityType}/${filename}`,
        err,
      );
    }
  }

  return summary;
}

/** Migrate every legacy `<type>_trash/` directory for a single user. */
export async function migrateLegacyNotesTrashForUser(
  username: string,
): Promise<{ scanned: number; migrated: number; skipped: number; errors: number }> {
  const total = { scanned: 0, migrated: 0, skipped: 0, errors: 0 };
  for (const { type, dirName } of LEGACY_DIRS) {
    try {
      const s = await migrateOneLegacyDir(username, type, dirName);
      total.scanned += s.scanned;
      total.migrated += s.migrated;
      total.skipped += s.skipped;
      total.errors += s.errors;
    } catch (err) {
      total.errors++;
      console.warn(
        `[trash-migrate] aborted for ${username}/${dirName}`,
        err,
      );
    }
  }

  // Force an index rebuild check so the file/index counts realign.
  try {
    await readOrRebuildTrashIndex(username);
  } catch {
    // Best-effort.
  }

  return total;
}

/** Migrate every user in the folder. Called from `finishConnect`. The
 *  function name keeps `Notes` for backward compat with R1 call sites;
 *  R2 widened the scope to all eight entity types in one pass. */
export async function migrateLegacyNotesTrashAllUsers(
  usernames: string[],
): Promise<void> {
  for (const username of usernames) {
    try {
      const summary = await migrateLegacyNotesTrashForUser(username);
      if (summary.scanned > 0) {
        console.info(
          `[trash-migrate] ${username}: scanned=${summary.scanned} migrated=${summary.migrated} skipped=${summary.skipped} errors=${summary.errors}`,
        );
      }
    } catch (err) {
      console.warn(`[trash-migrate] aborted for ${username}`, err);
    }
  }
}
