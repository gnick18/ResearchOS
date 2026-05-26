// VCP R1 trash MVP notes (2026-05-26): one-time migration from the
// legacy `notes_trash/` layout to the new `_trash/notes/` layout.
//
// The migration is IDEMPOTENT — it can safely re-run on every folder-
// connect, on multiple devices, after partial failures. Idempotency
// mechanism:
//   1. If `_trash/notes/` already has files AND `notes_trash/` is empty,
//      skip the whole pass (the migration already completed here).
//   2. For each file in `notes_trash/<id>.json`:
//      - Skip when a `_trash/notes/<id>-<slug>.json` for the same id
//        already exists (we matched a prior copy of this entry).
//      - Otherwise write the new shape (with the `_trash` block back-
//        filled from the legacy `deleted_at` stamp), update the index,
//        and remove the legacy file ONLY when the new file landed
//        cleanly.
//   3. The legacy `notes_trash/` directory marker is preserved for one
//      release as a safety net (we do not `rm -rf` it). After every
//      file moves, the directory sits empty as a tombstone so we can
//      reverse-migrate if a regression surfaces.
//
// Migration runs on `finishConnect` — it's wrapped in try/catch and
// failures don't block the folder open.

import { fileService } from "@/lib/file-system/file-service";
import {
  trashFilePath,
  trashTypeDirPath,
  liveRecordPath,
} from "./trash-paths";
import { appendIndexEntry, readOrRebuildTrashIndex } from "./trash-index";
import {
  DEFAULT_CLEANUP_DAYS,
  type TrashFieldBlock,
  type TrashedEntity,
} from "./trash-types";
import { computeAutoExpiresAt } from "./trash-writer";

const LEGACY_TRASH_DIRNAME = "notes_trash";

interface LegacyTrashedNote {
  id: number;
  title?: string;
  username?: string;
  deleted_at?: string;
  // ... rest of Note fields kept as-is in `extra`
  [key: string]: unknown;
}

/** Migrate a single user's `notes_trash/` directory. Best-effort:
 *  per-file failures log + continue, never throw. Returns a summary so
 *  the connect path can log a single line. */
export async function migrateLegacyNotesTrashForUser(
  username: string,
): Promise<{ scanned: number; migrated: number; skipped: number; errors: number }> {
  const summary = { scanned: 0, migrated: 0, skipped: 0, errors: 0 };
  const legacyDir = `users/${username}/${LEGACY_TRASH_DIRNAME}`;
  const newDir = trashTypeDirPath(username, "note");

  // Idempotency short-circuit: if the legacy dir is empty AND the new
  // dir already has trash files, nothing to do.
  const [legacyFiles, newFiles] = await Promise.all([
    fileService.listFiles(legacyDir),
    fileService.listFiles(newDir),
  ]);
  const legacyJsons = legacyFiles.filter((f) => f.endsWith(".json"));
  if (legacyJsons.length === 0) return summary;

  summary.scanned = legacyJsons.length;
  await fileService.ensureDir(newDir);

  // Pre-scan the new dir for "<id>-..." prefixes so we can skip files
  // whose id already migrated.
  const existingIds = new Set<string>();
  for (const fname of newFiles) {
    const dash = fname.indexOf("-");
    const idPart = dash > 0 ? fname.slice(0, dash) : fname.replace(/\.json$/, "");
    existingIds.add(idPart);
  }

  for (const filename of legacyJsons) {
    const idStr = filename.replace(/\.json$/, "");
    if (existingIds.has(idStr)) {
      // Already migrated under a prior pass. Remove the legacy stub.
      try {
        await fileService.deleteFile(`${legacyDir}/${filename}`);
      } catch (err) {
        console.warn(
          `[trash-migrate] failed to delete legacy duplicate ${filename}`,
          err,
        );
      }
      summary.skipped++;
      continue;
    }

    try {
      const legacy = await fileService.readJson<LegacyTrashedNote>(
        `${legacyDir}/${filename}`,
      );
      if (!legacy || typeof legacy.id !== "number") {
        summary.errors++;
        console.warn(
          `[trash-migrate] unreadable legacy file: ${filename} (skipping)`,
        );
        continue;
      }
      const id = legacy.id;
      const deletedAt = legacy.deleted_at ?? new Date().toISOString();
      const trashBlock: TrashFieldBlock = {
        deleted_at: deletedAt,
        // Best-effort attribution: the legacy file only carried the
        // owner username. Backfill `deleted_by` to the note's owner —
        // they're the only actor we know about in the legacy shape.
        deleted_by: legacy.username ?? username,
        auto_expires_at: computeAutoExpiresAt(deletedAt, DEFAULT_CLEANUP_DAYS),
        original_path: liveRecordPath(username, "note", id),
      };
      // Strip the legacy-only `deleted_at` field — the new shape stores
      // it inside `_trash`. Everything else carries forward.
      const { deleted_at: _legacyDeletedAt, ...rest } = legacy;
      void _legacyDeletedAt;
      const trashed: TrashedEntity<typeof rest & { id: number }> = {
        ...(rest as typeof rest & { id: number }),
        _trash: trashBlock,
      };
      const nameForSlug =
        typeof legacy.title === "string" ? legacy.title : null;
      const newPath = trashFilePath(username, "note", id, nameForSlug);
      await fileService.writeJson(newPath, trashed);

      try {
        await appendIndexEntry(username, {
          id,
          entity_type: "note",
          trash_path: newPath.replace(`users/${username}/`, ""),
          original_path: trashBlock.original_path,
          deleted_at: trashBlock.deleted_at,
          deleted_by: trashBlock.deleted_by,
          auto_expires_at: trashBlock.auto_expires_at,
        });
      } catch (err) {
        console.warn(
          `[trash-migrate] index append failed for note ${id} (recoverable)`,
          err,
        );
      }

      try {
        await fileService.deleteFile(`${legacyDir}/${filename}`);
      } catch (err) {
        console.warn(
          `[trash-migrate] failed to remove legacy file ${filename}`,
          err,
        );
      }
      summary.migrated++;
    } catch (err) {
      summary.errors++;
      console.warn(
        `[trash-migrate] unexpected failure migrating ${filename}`,
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

  return summary;
}

/** Migrate every user in the folder. Called from `finishConnect`. */
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
