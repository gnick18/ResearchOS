// The migration runner. Reads the per-user marker, runs the pending migrations
// in registry order with per-migration isolation, writes the marker, and returns
// a summary. A migration that throws is logged and skipped (not marked applied)
// so it retries on the next connect; it never blocks the rest.

import { MIGRATIONS } from "./registry";
import { readMarker, writeMarker } from "./marker";
import type { MigrationRunSummary } from "./types";

export async function runPendingMigrations(
  username: string,
): Promise<MigrationRunSummary> {
  const marker = await readMarker(username);
  const applied = new Set(marker.applied);
  const summary: MigrationRunSummary = {
    ran: [],
    totalChanged: 0,
    failures: [],
  };
  const newlyApplied: string[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    try {
      const report = await migration.run({ username });
      summary.ran.push(migration.id);
      summary.totalChanged += report.changed;
      // Mark applied even when it changed 0: it scanned and found nothing to do,
      // so there is no reason to re-walk on every future connect.
      newlyApplied.push(migration.id);
      if (report.changed > 0 || report.failed > 0) {
        console.info(
          `[migrations] ${migration.id}: changed ${report.changed}, scanned ${report.scanned}, failed ${report.failed}`,
        );
      }
    } catch (error) {
      console.warn(`[migrations] ${migration.id} failed, will retry`, error);
      summary.failures.push({ id: migration.id, error });
    }
  }

  if (newlyApplied.length > 0) {
    try {
      await writeMarker(username, [...marker.applied, ...newlyApplied]);
    } catch (error) {
      // The marker write failing is non-fatal: the migrations still ran (and are
      // idempotent), they will just re-run next connect.
      console.warn("[migrations] marker write failed", error);
    }
  }

  return summary;
}
