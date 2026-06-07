"use client";

import { useEffect, useRef } from "react";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { runPendingMigrations } from "@/lib/migrations/runner";
import { emitMigrationsApplied } from "@/lib/migrations/migration-toast-bus";

/**
 * Runs pending on-disk data migrations once per connected user folder, in the
 * background (see docs/proposals/AUTO_DATA_MIGRATIONS.md). Mounted globally in
 * providers. Defers to idle so it never blocks first paint, and relies on the
 * per-user `_schema_migrations.json` marker to skip work that already ran.
 */
export default function DataMigrationRunner() {
  const { isConnected, currentUser } = useFileSystem();
  // Guard against re-running for the same (folder + user) within a session. The
  // marker makes a repeat run cheap anyway, this just avoids the extra read.
  const ranForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !currentUser) return;
    if (ranForRef.current === currentUser) return;
    ranForRef.current = currentUser;

    let cancelled = false;
    const run = async () => {
      try {
        const summary = await runPendingMigrations(currentUser);
        if (!cancelled && summary.totalChanged > 0) {
          emitMigrationsApplied({ changed: summary.totalChanged });
        }
      } catch (err) {
        console.warn("[DataMigrationRunner] pass failed", err);
      }
    };

    // Defer to idle (with a setTimeout fallback) so migrations never jank the
    // initial render of a freshly connected folder.
    const ric = (
      window as typeof window & {
        requestIdleCallback?: (cb: () => void) => number;
        cancelIdleCallback?: (id: number) => void;
      }
    ).requestIdleCallback;
    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (typeof ric === "function") {
      idleId = ric(() => void run());
    } else {
      timeoutId = setTimeout(() => void run(), 1500);
    }

    return () => {
      cancelled = true;
      const cic = (
        window as typeof window & { cancelIdleCallback?: (id: number) => void }
      ).cancelIdleCallback;
      if (idleId !== null && typeof cic === "function") {
        try {
          cic(idleId);
        } catch {
          /* best-effort */
        }
      }
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [isConnected, currentUser]);

  return null;
}
