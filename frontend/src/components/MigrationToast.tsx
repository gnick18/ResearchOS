"use client";

import { useEffect, useState } from "react";
import { subscribeMigrationsApplied } from "@/lib/migrations/migration-toast-bus";

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
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
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
