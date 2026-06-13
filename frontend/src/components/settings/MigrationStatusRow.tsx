"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { readMarker } from "@/lib/migrations/marker";
import { runAllMigrations, MIGRATION_COUNT } from "@/lib/migrations/runner";

/**
 * The Settings "Data maintenance" status row. Format upgrades now run
 * automatically on folder connect (docs/proposals/AUTO_DATA_MIGRATIONS.md), so
 * the row of per-repair buttons is gone. This shows the current state and offers
 * one manual "Re-run all checks" for support / power users (ignores the marker
 * and re-runs the whole idempotent registry).
 */
export default function MigrationStatusRow() {
  const { currentUser } = useCurrentUser();
  const [appliedCount, setAppliedCount] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [lastChanged, setLastChanged] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!currentUser) return;
    const marker = await readMarker(currentUser);
    setAppliedCount(marker.applied.length);
    setUpdatedAt(marker.updatedAt);
  }, [currentUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rerun = useCallback(async () => {
    if (!currentUser) return;
    setRunning(true);
    setLastChanged(null);
    try {
      const summary = await runAllMigrations(currentUser);
      setLastChanged(summary.totalChanged);
      await refresh();
    } finally {
      setRunning(false);
    }
  }, [currentUser, refresh]);

  const upToDate = appliedCount !== null && appliedCount >= MIGRATION_COUNT;
  const status =
    appliedCount === null
      ? "Checking..."
      : upToDate
        ? `All formats up to date (${MIGRATION_COUNT} checks).`
        : `${appliedCount} of ${MIGRATION_COUNT} checks applied; the rest run on the next folder connect.`;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-body text-foreground">Format upgrades</p>
        <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
          Old on-disk formats are upgraded automatically in the background when
          you connect your folder, with nothing to lose (removals go to a
          recoverable trash). {status}
          {updatedAt
            ? ` Last run ${new Date(updatedAt).toLocaleString()}.`
            : ""}
        </p>
        {lastChanged !== null && (
          <p className="text-meta text-foreground-muted mt-2">
            Re-ran every check:{" "}
            <strong>
              {lastChanged} {lastChanged === 1 ? "file" : "files"}
            </strong>{" "}
            updated.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void rerun()}
        disabled={running || !currentUser}
        className="px-3 py-2 text-body bg-brand-action hover:bg-brand-action/90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg whitespace-nowrap"
      >
        {running ? "Running..." : "Re-run all checks"}
      </button>
    </div>
  );
}
