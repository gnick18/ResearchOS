// Lab-tier Phase 7a: live wiring for the multiuser -> solo migration.
//
// Binds the pure planner + executor to the running app: discoverUsers() for the
// user list, the live fileService for per-user record counts (the preview
// numbers), and the FSA-backed MigrationFs for the actual move. The UI calls
// planMigrationToSoloLive() to render the preview, then executeMigrationToSoloLive()
// once the user confirms.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";
import { discoverUsers } from "@/lib/file-system/user-discovery";
import { planMigrationToSolo, type MigrationPlan } from "./migrate-to-solo";
import { executeMigrationToSolo, type MigrationExecResult } from "./migrate-to-solo-executor";
import { createFsaMigrationFs } from "./migration-fs-fsa";

/**
 * Count a user's records per top-level subdirectory by listing *.json files
 * through the live fileService. These are display numbers for the preview; the
 * executor itself copies the whole tree regardless of type, so an approximate
 * per-folder count is exactly what the UI wants.
 */
async function countRecordsLive(username: string): Promise<Record<string, number>> {
  const base = `users/${username}`;
  const subdirs = await fileService.listDirectories(base);
  const counts: Record<string, number> = {};
  await Promise.all(
    subdirs.map(async (sub) => {
      const files = await fileService.listFiles(`${base}/${sub}`);
      const n = files.filter((f) => f.endsWith(".json")).length;
      if (n > 0) counts[sub] = n;
    }),
  );
  return counts;
}

/**
 * Build the migration plan for the connected (primary) user against the live
 * folder. The plan lists every OTHER user that would be moved out, with record
 * counts, and is shown in the confirm preview before anything is touched.
 */
export async function planMigrationToSoloLive(primaryUser: string): Promise<MigrationPlan> {
  const allUsers = await discoverUsers();
  return planMigrationToSolo({ allUsers, primaryUser, countRecords: countRecordsLive });
}

/**
 * Execute a confirmed plan over the real folder via the FSA adapter. Returns the
 * bundle + trash paths and the share-strip record for the result screen. The
 * executor is crash-safe and recoverable (bundle is verified before any delete,
 * originals go to trash, not hard-deleted).
 */
export async function executeMigrationToSoloLive(plan: MigrationPlan): Promise<MigrationExecResult> {
  return executeMigrationToSolo({ fs: createFsaMigrationFs(), plan });
}
