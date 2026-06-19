// VCP R1 trash MVP notes (2026-05-26): the `_trash/_index.json` sidecar.
//
// The index is a READ-TIME OPTIMIZATION, not the source of truth. The
// directory listing of `_trash/<type>/*.json` is authoritative; the index
// just caches the metadata we need to render the trash UI + run the
// auto-cleanup pass without re-reading every file.
//
// Two rebuild triggers:
//   1. The index file is missing on disk.
//   2. The file-count diverges from the index entry-count by >5%
//      (e.g. OneDrive sync conflict, manual file deletion, partial
//      crash mid-write). The 5% threshold tolerates the racy case
//      where a fresh write hasn't reached the index yet.
//
// Rebuilds are best-effort: a file we can't parse is skipped (warned)
// rather than failing the whole pass.

import { fileService } from "@/lib/file-system/file-service";
import {
  trashIndexPath,
  trashTypeDirName,
  trashTypeDirPath,
  trashRootPath,
} from "./trash-paths";
import type {
  TrashEntityType,
  TrashedEntity,
  TrashIndex,
  TrashIndexEntry,
} from "./trash-types";

const REBUILD_THRESHOLD = 0.05;

/** All entity types we walk when rebuilding from disk. The walker tolerates
 *  missing directories (a type's `_trash/<type>/` folder may not exist yet).
 *
 *  This doubles as the canonical runtime enumeration of `TrashEntityType` —
 *  the type is compile-time only, so anything that needs to iterate every
 *  trashable type at runtime (e.g. the /trash page's section-coverage guard)
 *  reads this list. Keep it exhaustive: an omission here silently drops that
 *  type's entries on an index rebuild. */
export const ALL_ENTITY_TYPES: TrashEntityType[] = [
  "note",
  "task",
  "method",
  "project",
  "purchase_item",
  "high_level_goal",
  "lab_link",
  "mass_spec_protocol",
  // seq delete trash bot (2026-06-04): sequences land in `_trash/sequences/`
  // as a single embedded `.json` record (GenBank inside), so the generic
  // index scan / rebuild / divergence-count below treats them like any other
  // single-file type. Omitting this caused the divergence check to see 0
  // sequence files vs N index entries and rebuild the index WITHOUT the
  // sequence rows — a silent loss of the trashed-sequence index entries.
  "sequence",
  // chem-trash bot (2026-06-11): molecules land in `_trash/molecules/` as a
  // single embedded `.json` record (Molfile inside), same as sequences above.
  "molecule",
  // inventory/storage rebuild fix (2026-06-15): inventory items, stocks, and
  // the StorageNode location tree are standard single-JSON trash records, but
  // were never added to this rebuild walker — so a from-disk index rebuild
  // (divergence > threshold) silently DROPPED their entries, the same loss the
  // sequence note above warns about. They are appended to the index on delete,
  // so they only vanish on a rebuild; listing them here closes that gap.
  "inventory_item",
  "inventory_stock",
  "storage_node",
];

/** Read the index from disk. Returns an empty index when the file is
 *  missing (caller decides whether to rebuild). */
export async function readTrashIndex(username: string): Promise<TrashIndex> {
  const raw = await fileService.readJson<TrashIndex>(trashIndexPath(username));
  if (!raw || !Array.isArray(raw.entries)) {
    return { version: 1, entries: [], last_cleanup_at: null };
  }
  return {
    version: 1,
    entries: raw.entries,
    last_cleanup_at: raw.last_cleanup_at ?? null,
  };
}

/** Write the index back to disk. */
export async function writeTrashIndex(
  username: string,
  index: TrashIndex,
): Promise<void> {
  await fileService.ensureDir(trashRootPath(username));
  await fileService.writeJson(trashIndexPath(username), index);
}

/** Walk the on-disk `_trash/<type>/` directories and build a fresh
 *  index. Used both for the initial-build and the divergence-rebuild
 *  paths. */
export async function buildTrashIndexFromDisk(
  username: string,
): Promise<TrashIndex> {
  const entries: TrashIndexEntry[] = [];

  for (const entityType of ALL_ENTITY_TYPES) {
    const dirPath = trashTypeDirPath(username, entityType);
    const files = await fileService.listFiles(dirPath);
    for (const filename of files) {
      if (!filename.endsWith(".json")) continue;
      const trashPathRel = `_trash/${trashTypeDirName(entityType)}/${filename}`;
      const fullPath = `users/${username}/${trashPathRel}`;
      try {
        const record = await fileService.readJson<TrashedEntity<{ id: string | number }>>(
          fullPath,
        );
        if (!record || !record._trash) continue;
        entries.push({
          id: record.id,
          entity_type: entityType,
          trash_path: trashPathRel,
          original_path: record._trash.original_path,
          deleted_at: record._trash.deleted_at,
          deleted_by: record._trash.deleted_by,
          auto_expires_at: record._trash.auto_expires_at,
          parent_id: record._trash.restore_metadata?.parent_id,
          parent_entity_type:
            record._trash.restore_metadata?.parent_entity_type,
          parent_trash_path: record._trash.restore_metadata?.parent_trash_path,
        });
      } catch (err) {
        console.warn(
          `[trash-index] skipping unreadable trash file ${fullPath}:`,
          err,
        );
      }
    }
  }

  return { version: 1, entries, last_cleanup_at: null };
}

/** Count files across all known entity-type subdirectories. Used by
 *  the divergence check. */
async function countTrashFilesOnDisk(username: string): Promise<number> {
  let total = 0;
  for (const entityType of ALL_ENTITY_TYPES) {
    const dirPath = trashTypeDirPath(username, entityType);
    const files = await fileService.listFiles(dirPath);
    total += files.filter((f) => f.endsWith(".json")).length;
  }
  return total;
}

/** Sanity check: compare file count against index entry count. Returns
 *  true when the index needs a full rebuild. */
function isDivergent(fileCount: number, indexCount: number): boolean {
  const denom = Math.max(fileCount, indexCount);
  if (denom === 0) return false;
  const diff = Math.abs(fileCount - indexCount) / denom;
  return diff > REBUILD_THRESHOLD;
}

/** Read the index, rebuilding from disk when the file is missing OR
 *  when the file-count diverges by >5%. The rebuilt index is written
 *  back. */
export async function readOrRebuildTrashIndex(
  username: string,
): Promise<TrashIndex> {
  const indexExists = await fileService.fileExists(trashIndexPath(username));
  if (!indexExists) {
    const fresh = await buildTrashIndexFromDisk(username);
    await writeTrashIndex(username, fresh);
    return fresh;
  }
  const existing = await readTrashIndex(username);
  const fileCount = await countTrashFilesOnDisk(username);
  if (isDivergent(fileCount, existing.entries.length)) {
    console.warn(
      `[trash-index] rebuilding: file count ${fileCount} diverges from index ${existing.entries.length}`,
    );
    const rebuilt = await buildTrashIndexFromDisk(username);
    rebuilt.last_cleanup_at = existing.last_cleanup_at;
    await writeTrashIndex(username, rebuilt);
    return rebuilt;
  }
  return existing;
}

/** Append a single entry to the index. Idempotent on the (entity_type,
 *  id) key — a second write with the same key replaces the existing
 *  entry rather than producing a duplicate. */
export async function appendIndexEntry(
  username: string,
  entry: TrashIndexEntry,
): Promise<void> {
  const index = await readTrashIndex(username);
  const next = index.entries.filter(
    (e) => !(e.id === entry.id && e.entity_type === entry.entity_type),
  );
  next.push(entry);
  await writeTrashIndex(username, {
    version: 1,
    entries: next,
    last_cleanup_at: index.last_cleanup_at,
  });
}

/** Remove a single (entity_type, id) entry from the index. No-op when
 *  the entry isn't present. */
export async function removeIndexEntry(
  username: string,
  entityType: TrashEntityType,
  id: string | number,
): Promise<void> {
  const index = await readTrashIndex(username);
  const next = index.entries.filter(
    (e) => !(e.id === id && e.entity_type === entityType),
  );
  if (next.length === index.entries.length) return;
  await writeTrashIndex(username, {
    version: 1,
    entries: next,
    last_cleanup_at: index.last_cleanup_at,
  });
}

/** Stamp the index with the latest cleanup-pass timestamp. */
export async function setLastCleanupAt(
  username: string,
  ts: string,
): Promise<void> {
  const index = await readTrashIndex(username);
  await writeTrashIndex(username, { ...index, last_cleanup_at: ts });
}
