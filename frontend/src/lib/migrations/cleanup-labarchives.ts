// Destructive-but-recoverable migration: remove the orphaned LabArchives
// credential sidecars left on disk after the institutional LabArchives API was
// removed. Nothing reads or writes these anymore, and the deployer file holds an
// institutional access password in PLAINTEXT, so it is a standing security
// liability. We trash (not delete) them so a mistaken removal is recoverable.
//
//   _labarchives-deployer.json   at the folder ROOT (plaintext access password)
//   users/<u>/_labarchives.json  per user (connection state)

import { fileService } from "@/lib/file-system/file-service";
import { trashFile } from "./trash";
import type { MigrationReport } from "./types";

export const LABARCHIVES_CLEANUP_ID = "labarchives-orphan-cleanup-v1";

const DEPLOYER_SIDECAR = "_labarchives-deployer.json";
const USER_SIDECAR = "_labarchives.json";

export async function cleanupOrphanLabArchives(): Promise<MigrationReport> {
  const candidates: string[] = [DEPLOYER_SIDECAR];
  let users: string[] = [];
  try {
    users = await fileService.listDirectories("users");
  } catch {
    /* no users dir, only the root deployer file is a candidate */
  }
  for (const u of users) candidates.push(`users/${u}/${USER_SIDECAR}`);

  let scanned = 0;
  let changed = 0;
  let failed = 0;
  for (const path of candidates) {
    scanned += 1;
    try {
      if (await trashFile(path, LABARCHIVES_CLEANUP_ID)) changed += 1;
    } catch (err) {
      console.warn(`[migrations] LabArchives cleanup failed for ${path}`, err);
      failed += 1;
    }
  }
  return { changed, scanned, failed };
}
