"use client";

import { useEffect, useState } from "react";
import { subscribeMigrationsApplied } from "@/lib/migrations/migration-toast-bus";
import { Icon } from "@/components/icons";

/**
 * The quiet "Updated N files to the latest format" toast for the background data
 * migration runner. Only ever appears when a pass actually changed something; it
 * is informational (no action) and auto-dismisses. Mounted globally in providers.
 */
export default function MigrationToast() {
  const [changed, setChanged] = useState<number | null>(null);

  useEffect(() => {
    return subscribeMigrationsApplied(({ changed }) => {
      setChanged(changed);
    });
  }, []);

  useEffect(() => {
    if (changed === null) return;
    const id = window.setTimeout(() => setChanged(null), 6000);
    return () => window.clearTimeout(id);
  }, [changed]);

  if (changed === null) return null;

  return (
    <div className="fixed bottom-6 left-6 z-[115] max-w-sm pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-xl border border-border bg-surface-raised px-3.5 py-2.5 shadow-lg">
        <span aria-hidden className="text-emerald-600 dark:text-emerald-400">
          <Icon name="check" className="h-4 w-4" />
        </span>
        <p className="text-meta text-foreground">
          Updated {changed} {changed === 1 ? "file" : "files"} to the latest
          format.
        </p>
        <button
          type="button"
          onClick={() => setChanged(null)}
          aria-label="Dismiss"
          className="ml-1 text-foreground-muted hover:text-foreground text-meta leading-none"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
