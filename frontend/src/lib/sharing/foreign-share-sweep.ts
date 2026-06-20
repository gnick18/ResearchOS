// Account-centric folder identity, the foreign-share SWEEP (Phase B, D6).
//
// When a different account takes over a folder (D2 warn-then-allow), the local
// copies of documents that were SHARED INTO this folder by someone else must be
// removed, the new owner has no permission to view them. "Shared in" means a
// record carrying received_from_fingerprint that is present AND not equal to the
// connecting (new owner) account. The ABSENCE of received_from_fingerprint is the
// exclusion guard, it marks the account's OWN authored content, which is never
// swept.
//
// Removal is recoverable (D6), each flagged file is MOVED to the folder trash via
// trashFile(path, takeoverEventId), and a per-event manifest records the exact set
// so "Revert ownership" can restore precisely that set and no more.
//
// EVERYTHING here is consumed only behind MULTI_FOLDER_ENABLED. The inner
// predicate isForeignShare is pure and unit-tested directly.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { fileService } from "../file-system/file-service";
import { restoreTrashedFile, trashFile } from "../migrations/trash";

/**
 * The record directories under users/<user>/ that can carry a foreign-share
 * stamp (received_from_fingerprint). Mirrors the per-type record layout the
 * transfer import path writes into (see import/apply.ts, note-transfer.ts).
 * Sequences store a `.meta.json` per record rather than `<id>.json`, but the
 * enumeration below reads every *.json file in the dir, so both shapes are
 * covered without special-casing.
 */
export const FOREIGN_SHARE_RECORD_DIRS = [
  "notes",
  "projects",
  "methods",
  "experiments",
  "tasks",
  "sequences",
] as const;

/**
 * A record carrying the cross-boundary provenance stamp. Only the one field
 * matters for the sweep decision, everything else is opaque.
 */
interface MaybeForeignRecord {
  received_from_fingerprint?: string;
}

/** A flagged record, its on-disk path plus its id (the file basename sans .json). */
export interface ForeignShareRef {
  path: string;
  id: string;
}

// Per-event manifest of swept original paths, written alongside the trashed
// copies so revert restores EXACTLY the set that was swept under one event id.
function sweepManifestPath(takeoverEventId: string): string {
  return `_trash/migrations/${takeoverEventId}/_swept_shares.json`;
}

interface SweepManifest {
  version: 1;
  event_id: string;
  swept_paths: string[];
}

/**
 * PURE predicate, whether a record was shared INTO this folder by someone other
 * than the connecting account. True only when received_from_fingerprint is
 * present and differs from myFingerprint. Absent stamp => own content => false
 * (the exclusion guard that preserves the account's authored records).
 */
export function isForeignShare(
  record: MaybeForeignRecord | null | undefined,
  myFingerprint: string,
): boolean {
  if (!record) return false;
  const from = record.received_from_fingerprint;
  return typeof from === "string" && from.length > 0 && from !== myFingerprint;
}

// Reads every *.json record under users/<user>/<dir>/ and returns the flagged
// foreign-share refs. Sequence `.meta.json` files end in `.json`, so listFiles
// returns them too, and the basename id keeps the `.meta` suffix which is fine,
// it is only a display label here.
async function detectForeignSharesInDir(
  user: string,
  dir: string,
  myFingerprint: string,
): Promise<ForeignShareRef[]> {
  const dirPath = `users/${user}/${dir}`;
  const names = await fileService.listFiles(dirPath);
  const refs: ForeignShareRef[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = `${dirPath}/${name}`;
    const record = await fileService.readJson<MaybeForeignRecord>(path);
    if (isForeignShare(record, myFingerprint)) {
      refs.push({ path, id: name.replace(/\.json$/, "") });
    }
  }
  return refs;
}

/**
 * Detect every record shared INTO this folder by an account other than the
 * connecting one, across users/<currentUser>/{notes,projects,methods,
 * experiments,tasks,sequences}/*.json. Returns the flagged refs.
 *
 * currentUser is the connecting account's canonical user directory, the same
 * directory whose records the new owner will keep. (Other users/ dirs stay as
 * visible co-members, D4, and are out of scope for this sweep, only the active
 * account's own folder is reconciled on takeover.)
 */
export async function detectForeignShares(
  currentUser: string,
  myFingerprint: string,
): Promise<ForeignShareRef[]> {
  const perDir = await Promise.all(
    FOREIGN_SHARE_RECORD_DIRS.map((dir) =>
      detectForeignSharesInDir(currentUser, dir, myFingerprint),
    ),
  );
  return perDir.flat();
}

/**
 * Count of foreign shares for the warning copy ("There are X shared files...").
 */
export async function countForeignShares(
  currentUser: string,
  myFingerprint: string,
): Promise<number> {
  const refs = await detectForeignShares(currentUser, myFingerprint);
  return refs.length;
}

/**
 * Sweep the flagged foreign-share records to the folder trash, tagged with the
 * takeover event id (D6 recoverable removal). Writes a per-event manifest of the
 * swept paths so restoreSweptShares can restore exactly this set. Best-effort
 * prunes dangling users/<u>/_shared_with_me.json entries that pointed at swept
 * records. Returns the list of swept original paths.
 */
export async function sweepForeignShares(
  currentUser: string,
  myFingerprint: string,
  takeoverEventId: string,
): Promise<string[]> {
  const refs = await detectForeignShares(currentUser, myFingerprint);
  const swept: string[] = [];
  for (const ref of refs) {
    const moved = await trashFile(ref.path, takeoverEventId);
    if (moved) swept.push(ref.path);
  }

  // Write the manifest so revert restores exactly this set.
  const manifest: SweepManifest = {
    version: 1,
    event_id: takeoverEventId,
    swept_paths: swept,
  };
  await fileService.writeJson(sweepManifestPath(takeoverEventId), manifest);

  // Best-effort prune of dangling _shared_with_me.json references that point at
  // swept records. Intra-lab references are otherwise out of scope, we only drop
  // entries whose target was just removed so the inbox does not dangle.
  await pruneSharedWithMe(currentUser, swept);

  return swept;
}

/**
 * Restore exactly the set of shared records that were swept under one takeover
 * event id (D6 revert). Reads the per-event manifest, restores each path from
 * trash, then removes the manifest. Returns the list of restored paths.
 */
export async function restoreSweptShares(
  takeoverEventId: string,
): Promise<string[]> {
  const manifest = await fileService.readJson<SweepManifest>(
    sweepManifestPath(takeoverEventId),
  );
  if (!manifest) return [];

  const restored: string[] = [];
  for (const path of manifest.swept_paths) {
    const ok = await restoreTrashedFile(path, takeoverEventId);
    if (ok) restored.push(path);
  }

  // Manifest has served its purpose, drop it so a second revert is a no-op.
  await fileService.deleteFile(sweepManifestPath(takeoverEventId));
  return restored;
}

// Best-effort, drop entries in users/<currentUser>/_shared_with_me.json that
// reference any of the swept paths. The inbox file shape is opaque here (an array
// of entries each carrying some path/ref), so we filter conservatively, only an
// entry that stringifies to include a swept path is dropped. A miss leaves a
// harmless dangling entry, never removes a live reference.
async function pruneSharedWithMe(
  currentUser: string,
  sweptPaths: string[],
): Promise<void> {
  if (sweptPaths.length === 0) return;
  const inboxPath = `users/${currentUser}/_shared_with_me.json`;
  const inbox = await fileService.readJson<unknown>(inboxPath);
  if (!Array.isArray(inbox)) return;

  const next = inbox.filter((entry) => {
    const blob = JSON.stringify(entry);
    return !sweptPaths.some((p) => blob.includes(p));
  });
  if (next.length !== inbox.length) {
    await fileService.writeJson(inboxPath, next);
  }
}
