// VCP R1 trash MVP notes (2026-05-26): the trash-READER + restore +
// permanent-delete + cleanup pass.
//
// The reader is THIN — it just consults the index and (for restore /
// permanent-delete) the on-disk file. The index is rebuildable from
// the directory listing; see `trash-index.ts`.
//
// Three public flows surface here:
//   - listTrash(username, type?)     → trash UI render path.
//   - restoreEntity(...)             → Restore button.
//   - permanentlyDelete(...)         → Permanent delete button.
//   - runAutoCleanupPass(username)   → wired into folder-connect.
//
// Each flow swallows per-entry errors so a single corrupted file does
// not abort the whole sweep.

import { fileService } from "@/lib/file-system/file-service";
import {
  trashFilePath,
  trashTypeDirPath,
  liveRecordPath,
  sequenceGenbankPathFor,
} from "./trash-paths";
import { SEQUENCE_GENBANK_FIELD } from "./trash-writer";
import {
  readOrRebuildTrashIndex,
  readTrashIndex,
  removeIndexEntry,
  writeTrashIndex,
} from "./trash-index";
import type {
  TrashEntityType,
  TrashIndex,
  TrashIndexEntry,
  TrashedEntity,
} from "./trash-types";

/** Result of the auto-cleanup pass. Returned so the caller can log a
 *  summary line. */
export interface CleanupSummary {
  scanned: number;
  expired: number;
  hardDeleted: number;
  errors: number;
  ranAt: string;
}

/** Read the index (rebuilding if stale) and return the entries,
 *  optionally filtered to a single entity type. */
export async function listTrash(
  username: string,
  entityType?: TrashEntityType,
): Promise<TrashIndexEntry[]> {
  const index = await readOrRebuildTrashIndex(username);
  return entityType
    ? index.entries.filter((e) => e.entity_type === entityType)
    : index.entries;
}

/** Read one trashed entity by id. Walks the index to find the file
 *  path so the slug suffix doesn't need to be known by the caller. */
export async function readTrashedEntity<T>(
  username: string,
  entityType: TrashEntityType,
  id: string | number,
): Promise<TrashedEntity<T> | null> {
  const index = await readOrRebuildTrashIndex(username);
  const entry = index.entries.find(
    (e) => e.entity_type === entityType && e.id === id,
  );
  if (!entry) return null;
  return await fileService.readJson<TrashedEntity<T>>(
    `users/${username}/${entry.trash_path}`,
  );
}

/** Restore a trashed entity back to its original path. Strips the
 *  `_trash` block, removes the trash file + index entry. Returns the
 *  restored record (or null if the trash entry was missing). */
export async function restoreEntity<T extends { id: string | number }>(
  username: string,
  entityType: TrashEntityType,
  id: string | number,
): Promise<T | null> {
  // seq delete trash bot: sequences split back into a two-file pair on
  // restore, so route them through the sequence-aware path.
  if (entityType === "sequence") {
    return (await restoreSequenceFromTrash(username, id)) as T | null;
  }
  const index = await readOrRebuildTrashIndex(username);
  const entry = index.entries.find(
    (e) => e.entity_type === entityType && e.id === id,
  );
  if (!entry) return null;
  const trashFullPath = `users/${username}/${entry.trash_path}`;
  const trashed = await fileService.readJson<TrashedEntity<T>>(trashFullPath);
  if (!trashed) {
    // Index points to a missing file — clean up the stale index entry.
    await removeIndexEntry(username, entityType, id);
    return null;
  }

  // Strip `_trash` before writing back to live path.
  const liveRecord = stripTrashBlock<T>(trashed);
  const originalPath = entry.original_path;
  // Ensure parent dir exists; the originalPath always lives under
  // `users/<owner>/<type-dir>/` which the writer is expected to know
  // about. We derive it by removing the filename.
  const parentDir = originalPath.slice(0, originalPath.lastIndexOf("/"));
  await fileService.ensureDir(parentDir);
  try {
    await fileService.writeJson(originalPath, liveRecord);
  } catch (err) {
    console.warn("[trash-reader] restoreEntity: writing live file failed", err);
    return null;
  }
  // Best-effort removals — the live restore is the load-bearing step.
  await fileService.deleteFile(trashFullPath).catch(() => false);
  await removeIndexEntry(username, entityType, id);
  return liveRecord;
}

/** seq delete trash bot (2026-06-04): restore a trashed SEQUENCE back to its
 *  two-file pair. Mirrors `restoreEntity` but splits the embedded GenBank
 *  back into `{id}.gb` and the stripped sidecar back into `{id}.meta.json`.
 *
 *  Zero data loss: the GenBank is written verbatim (the exact string that was
 *  read on trash), and every sidecar field round-trips untouched. The
 *  `_sequence_genbank` + `_trash` blocks are the ONLY added fields, both
 *  stripped here before the sidecar is written back.
 *
 *  Returns the restored sidecar record (so the caller can re-register it in
 *  the live list), or null when the trash entry / file is missing. */
export async function restoreSequenceFromTrash(
  username: string,
  id: string | number,
): Promise<Record<string, unknown> | null> {
  const index = await readOrRebuildTrashIndex(username);
  const entry = index.entries.find(
    (e) => e.entity_type === "sequence" && e.id === id,
  );
  if (!entry) return null;
  const trashFullPath = `users/${username}/${entry.trash_path}`;
  const trashed = await fileService.readJson<Record<string, unknown>>(
    trashFullPath,
  );
  if (!trashed) {
    await removeIndexEntry(username, "sequence", id);
    return null;
  }

  // The `.meta.json` path is the index `original_path`; the `.gb` companion
  // is derived from it. Both live under `users/<owner>/sequences/`.
  const metaPath = entry.original_path;
  const gbPath = sequenceGenbankPathFor(metaPath);

  // Pull the embedded GenBank out, then strip both the embed + the `_trash`
  // block so what lands in `.meta.json` is the original sidecar exactly.
  const genbank =
    typeof trashed[SEQUENCE_GENBANK_FIELD] === "string"
      ? (trashed[SEQUENCE_GENBANK_FIELD] as string)
      : "";
  const sidecar = { ...trashed };
  delete sidecar[SEQUENCE_GENBANK_FIELD];
  delete sidecar._trash;

  const parentDir = metaPath.slice(0, metaPath.lastIndexOf("/"));
  await fileService.ensureDir(parentDir);
  try {
    // Write the GenBank source FIRST (matches sequenceStore.create's ordering
    // so a torn restore never surfaces a sidecar without its `.gb`).
    await fileService.writeText(gbPath, genbank);
    await fileService.writeJson(metaPath, sidecar);
  } catch (err) {
    console.warn(
      "[trash-reader] restoreSequenceFromTrash: writing live pair failed",
      err,
    );
    return null;
  }
  await fileService.deleteFile(trashFullPath).catch(() => false);
  await removeIndexEntry(username, "sequence", id);
  return sidecar;
}

/** Permanently delete a trashed entity. Removes the trash file + index
 *  entry. No-op when the entry isn't present. */
export async function permanentlyDelete(
  username: string,
  entityType: TrashEntityType,
  id: string | number,
): Promise<boolean> {
  const index = await readOrRebuildTrashIndex(username);
  const entry = index.entries.find(
    (e) => e.entity_type === entityType && e.id === id,
  );
  if (!entry) return false;
  const trashFullPath = `users/${username}/${entry.trash_path}`;
  await fileService.deleteFile(trashFullPath).catch(() => false);
  await removeIndexEntry(username, entityType, id);
  return true;
}

/** Run the auto-cleanup pass. Hard-deletes every trash entry whose
 *  `auto_expires_at` is at or before `now`. Best-effort per-entry: one
 *  failed delete doesn't abort the sweep. Updates `last_cleanup_at` on
 *  the index when finished. */
export async function runAutoCleanupPass(
  username: string,
  now: Date = new Date(),
): Promise<CleanupSummary> {
  const ranAt = now.toISOString();
  const summary: CleanupSummary = {
    scanned: 0,
    expired: 0,
    hardDeleted: 0,
    errors: 0,
    ranAt,
  };

  let index: TrashIndex;
  try {
    index = await readOrRebuildTrashIndex(username);
  } catch (err) {
    console.warn("[trash-reader] cleanup: reading index failed", err);
    return summary;
  }
  summary.scanned = index.entries.length;

  const survivors: TrashIndexEntry[] = [];
  for (const entry of index.entries) {
    let isExpired = false;
    try {
      isExpired = Date.parse(entry.auto_expires_at) <= now.getTime();
    } catch {
      isExpired = false;
    }
    if (!isExpired) {
      survivors.push(entry);
      continue;
    }
    summary.expired++;
    try {
      const removed = await fileService.deleteFile(
        `users/${username}/${entry.trash_path}`,
      );
      if (removed) summary.hardDeleted++;
    } catch (err) {
      summary.errors++;
      console.warn(
        `[trash-reader] cleanup: failed to delete ${entry.trash_path}`,
        err,
      );
      // Keep the entry on a per-file failure so the next sweep retries.
      survivors.push(entry);
    }
  }

  try {
    await writeTrashIndex(username, {
      version: 1,
      entries: survivors,
      last_cleanup_at: ranAt,
    });
  } catch (err) {
    console.warn("[trash-reader] cleanup: index write failed", err);
    summary.errors++;
  }

  return summary;
}

/** Sort helpers for the trash UI. */
export type TrashSort = "newest" | "oldest" | "expiring";

export function sortTrashEntries(
  entries: TrashIndexEntry[],
  sort: TrashSort,
): TrashIndexEntry[] {
  const sorted = [...entries];
  switch (sort) {
    case "newest":
      sorted.sort(
        (a, b) => Date.parse(b.deleted_at) - Date.parse(a.deleted_at),
      );
      break;
    case "oldest":
      sorted.sort(
        (a, b) => Date.parse(a.deleted_at) - Date.parse(b.deleted_at),
      );
      break;
    case "expiring":
      sorted.sort(
        (a, b) =>
          Date.parse(a.auto_expires_at) - Date.parse(b.auto_expires_at),
      );
      break;
  }
  return sorted;
}

/** Drop the `_trash` block from a trashed record so it can be written
 *  back to its live path. */
function stripTrashBlock<T>(trashed: TrashedEntity<T>): T {
  // The block is the only added field; everything else is the original.
  // Use destructuring to drop it.
  const { _trash, ...rest } = trashed as TrashedEntity<T> & Record<string, unknown>;
  void _trash;
  return rest as unknown as T;
}

// Re-export so call sites only need to import from this one module.
export { trashFilePath, trashTypeDirPath, liveRecordPath };
export type { TrashedEntity, TrashIndex, TrashIndexEntry } from "./trash-types";

/** Re-export so the test file can pull all reader entry-points from
 *  one location alongside `readTrashIndex` for assertions. */
export { readTrashIndex };
