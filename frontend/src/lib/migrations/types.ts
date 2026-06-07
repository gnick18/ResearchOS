// Automatic on-disk data migrations (see docs/proposals/AUTO_DATA_MIGRATIONS.md).
//
// The local-first equivalent of DB migrations on startup: idempotent format
// upgrades that run on folder connect, in the background, once per user folder.

export interface MigrationReport {
  /** Records/files this run actually modified. Drives the "Updated N" toast. */
  changed: number;
  /** Total records/files inspected. */
  scanned: number;
  /** Records that could not be repaired (reported, not fatal). */
  failed: number;
}

export interface Migration {
  /** Stable id recorded in the marker, e.g. "method-source-paths-v1". Never
   *  reuse an id for a different migration. */
  id: string;
  /** Human label for logs / the support panel. */
  title: string;
  /** When true, the migration removes data and MUST move-to-trash rather than
   *  hard-delete (the no-data-loss contract). Phase 1 has none. */
  destructive?: boolean;
  run(): Promise<MigrationReport>;
}

export interface MigrationRunSummary {
  /** Migration ids that ran (completed without throwing) this pass. */
  ran: string[];
  /** Sum of `changed` across the migrations that ran. */
  totalChanged: number;
  /** Migrations that threw; they are NOT marked applied and retry next connect. */
  failures: { id: string; error: unknown }[];
}
