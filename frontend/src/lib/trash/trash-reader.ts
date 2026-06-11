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
  moleculeMolfilePathFor,
} from "./trash-paths";
import { SEQUENCE_GENBANK_FIELD, MOLECULE_MOLFILE_FIELD } from "./trash-writer";
import {
  readOrRebuildTrashIndex,
  readTrashIndex,
  removeIndexEntry,
  writeTrashIndex,
} from "./trash-index";
import {
  RESTORE_AUDIT_FIELD,
  displayNameFieldFor,
  type RestoreAudit,
  type TrashEntityType,
  type TrashIndex,
  type TrashIndexEntry,
  type TrashedEntity,
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
  restoredBy?: string,
): Promise<T | null> {
  // seq delete trash bot: sequences split back into a two-file pair on
  // restore, so route them through the sequence-aware path.
  if (entityType === "sequence") {
    return (await restoreSequenceFromTrash(username, id, restoredBy)) as T | null;
  }
  // chem-trash bot: molecules are also a two-file pair, route through the
  // molecule-aware path. Molecule ids are STRING — no coercion.
  if (entityType === "molecule") {
    return (await restoreMoleculeFromTrash(username, String(id), restoredBy)) as T | null;
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
  const stripped = stripTrashBlock<T>(trashed);
  // restore audit bot: disambiguate the display name if a LIVE record of the
  // same type already uses it, then stamp the deleted/restored audit. Both
  // mutate ONLY metadata — the record's id + content are untouched.
  const nameField = displayNameFieldFor(entityType);
  await disambiguateName(
    username,
    entityType,
    id,
    stripped as Record<string, unknown>,
    nameField,
  );
  const liveRecord = stampRestoreAudit(
    stripped as Record<string, unknown>,
    trashed._trash,
    restoredBy ?? username,
  ) as T;
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
  restoredBy?: string,
): Promise<Record<string, unknown> | null> {
  const index = await readOrRebuildTrashIndex(username);
  const entry = index.entries.find(
    (e) => e.entity_type === "sequence" && e.id === id,
  );
  if (!entry) return null;
  const trashFullPath = `users/${username}/${entry.trash_path}`;
  const trashed = await fileService.readJson<
    Record<string, unknown> & { _trash?: TrashedEntity<unknown>["_trash"] }
  >(trashFullPath);
  if (!trashed) {
    await removeIndexEntry(username, "sequence", id);
    return null;
  }
  const trashBlock = trashed._trash;

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

  // restore audit bot: rename the sequence's display_name on a live collision,
  // then stamp the deleted/restored audit into the sidecar. The `.gb` source is
  // never touched, so the GenBank stays byte-faithful.
  await disambiguateName(username, "sequence", id, sidecar, "display_name");
  if (trashBlock) {
    stampRestoreAudit(sidecar, trashBlock, restoredBy ?? username);
  }

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

/** chem-trash bot (2026-06-11): restore a trashed MOLECULE back to its
 *  two-file pair. Mirrors `restoreSequenceFromTrash` exactly, substituting
 *  the `.mol` Molfile for the `.gb` GenBank.
 *
 *  Zero data loss: the Molfile is written verbatim (the exact string that was
 *  read on trash), and every sidecar field round-trips untouched. The
 *  `_molecule_molfile` + `_trash` blocks are the ONLY added fields, both
 *  stripped here before the sidecar is written back.
 *
 *  Molecule ids are STRING — do not coerce to Number.
 *
 *  Returns the restored sidecar record (so the caller can re-register it in
 *  the live list), or null when the trash entry / file is missing. */
export async function restoreMoleculeFromTrash(
  username: string,
  id: string,
  restoredBy?: string,
): Promise<Record<string, unknown> | null> {
  const index = await readOrRebuildTrashIndex(username);
  const entry = index.entries.find(
    (e) => e.entity_type === "molecule" && e.id === id,
  );
  if (!entry) return null;
  const trashFullPath = `users/${username}/${entry.trash_path}`;
  const trashed = await fileService.readJson<
    Record<string, unknown> & { _trash?: TrashedEntity<unknown>["_trash"] }
  >(trashFullPath);
  if (!trashed) {
    await removeIndexEntry(username, "molecule", id);
    return null;
  }
  const trashBlock = trashed._trash;

  // The `.meta.json` path is the index `original_path`; the `.mol` companion
  // is derived from it. Both live under `users/<owner>/molecules/`.
  const metaPath = entry.original_path;
  const molPath = moleculeMolfilePathFor(metaPath);

  // Pull the embedded Molfile out, then strip both the embed + the `_trash`
  // block so what lands in `.meta.json` is the original sidecar exactly.
  const molfile =
    typeof trashed[MOLECULE_MOLFILE_FIELD] === "string"
      ? (trashed[MOLECULE_MOLFILE_FIELD] as string)
      : "";
  const sidecar = { ...trashed };
  delete sidecar[MOLECULE_MOLFILE_FIELD];
  delete sidecar._trash;

  // Rename the molecule's `name` on a live collision, then stamp the
  // deleted/restored audit into the sidecar. The `.mol` source is never
  // touched, so the Molfile stays byte-faithful.
  await disambiguateName(username, "molecule", id, sidecar, "name");
  if (trashBlock) {
    stampRestoreAudit(sidecar, trashBlock, restoredBy ?? username);
  }

  const parentDir = metaPath.slice(0, metaPath.lastIndexOf("/"));
  await fileService.ensureDir(parentDir);
  try {
    // Write the Molfile source FIRST (matches moleculeStore.create's ordering
    // so a torn restore never surfaces a sidecar without its `.mol`).
    await fileService.writeText(molPath, molfile);
    await fileService.writeJson(metaPath, sidecar);
  } catch (err) {
    console.warn(
      "[trash-reader] restoreMoleculeFromTrash: writing live pair failed",
      err,
    );
    return null;
  }
  await fileService.deleteFile(trashFullPath).catch(() => false);
  await removeIndexEntry(username, "molecule", id);
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

/** restore audit bot: stamp the deleted/restored audit blob onto a restored
 *  record. Mutates the record in place (and returns it) so the sequence path,
 *  which keeps a plain object reference, sees the change. Carries the delete
 *  attribution forward from the trash block and records who restored + when. */
function stampRestoreAudit(
  record: Record<string, unknown>,
  trashBlock: { deleted_at: string; deleted_by: string },
  restoredBy: string,
): Record<string, unknown> {
  const audit: RestoreAudit = {
    deleted_at: trashBlock.deleted_at,
    deleted_by: trashBlock.deleted_by,
    restored_at: new Date().toISOString(),
    restored_by: restoredBy,
  };
  record[RESTORE_AUDIT_FIELD] = audit;
  return record;
}

/** restore audit bot: read the display-name field off a live record, tolerant
 *  of the per-type field name. Returns "" when absent / non-string. */
function readDisplayName(
  record: Record<string, unknown>,
  field: string,
): string {
  const v = record[field];
  return typeof v === "string" ? v : "";
}

/** restore audit bot: the set of display names already in use by LIVE records
 *  of `entityType` (excluding the record being restored, matched by id). Scans
 *  the live directory the restored record will land in and reads each record's
 *  name field. Sequences read the `display_name` straight out of the sidecar;
 *  every other type reads the single `{id}.json`. Best-effort — a corrupt or
 *  unreadable sibling just doesn't contribute a name. */
async function collectLiveNames(
  username: string,
  entityType: TrashEntityType,
  selfId: string | number,
  nameField: string,
): Promise<Set<string>> {
  const liveDir = liveRecordPath(username, entityType, selfId).replace(
    /\/[^/]+$/,
    "",
  );
  const names = new Set<string>();
  let files: string[] = [];
  try {
    files = await fileService.listFiles(liveDir);
  } catch {
    return names;
  }
  const isTwoFilePair = entityType === "sequence" || entityType === "molecule";
  // For two-file-pair entities (sequence, molecule) the sidecar is
  // `{id}.meta.json`; for single-JSON entities it is `{id}.json`.
  const selfFile = isTwoFilePair ? `${selfId}.meta.json` : `${selfId}.json`;
  for (const file of files) {
    if (file === selfFile) continue;
    if (isTwoFilePair) {
      if (!file.endsWith(".meta.json")) continue;
    } else if (!file.endsWith(".json")) {
      continue;
    }
    try {
      const rec = await fileService.readJson<Record<string, unknown>>(
        `${liveDir}/${file}`,
      );
      if (!rec) continue;
      const name = readDisplayName(rec, nameField);
      if (name) names.add(name);
    } catch {
      // Skip an unreadable sibling.
    }
  }
  return names;
}

/** restore audit bot: if the restored record's display name collides with a
 *  LIVE record of the same type, append " (restored)" — and " (restored 2)",
 *  " (restored 3)", ... if THAT collides too — until the name is unique.
 *  Mutates the record's name field in place. No collision means the name is
 *  left exactly as it was. Only the name field changes; id + content stay put. */
async function disambiguateName(
  username: string,
  entityType: TrashEntityType,
  selfId: string | number,
  record: Record<string, unknown>,
  nameField: string,
): Promise<void> {
  const original = readDisplayName(record, nameField);
  if (!original) return; // Nothing to disambiguate against.
  const liveNames = await collectLiveNames(
    username,
    entityType,
    selfId,
    nameField,
  );
  if (!liveNames.has(original)) return; // No collision — keep the original name.

  let candidate = `${original} (restored)`;
  let n = 2;
  while (liveNames.has(candidate)) {
    candidate = `${original} (restored ${n})`;
    n += 1;
  }
  record[nameField] = candidate;
}

// Re-export so call sites only need to import from this one module.
export { trashFilePath, trashTypeDirPath, liveRecordPath };
export type { TrashedEntity, TrashIndex, TrashIndexEntry } from "./trash-types";

/** Re-export so the test file can pull all reader entry-points from
 *  one location alongside `readTrashIndex` for assertions. */
export { readTrashIndex };
