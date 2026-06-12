"use client";

// Markdown embed hybrid, Phase 4. The shared "Referenced in" panel.
//
// Lists every note, experiment, and method that references a given object (a
// mention or an embed), via the on-demand system-wide scanner
// (lib/object-backlinks.ts). Drop it into any object detail surface. Hides
// itself when there are no references, unless `showEmpty` is set.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { scanBacklinks, type BacklinkEntry } from "@/lib/object-backlinks";
import type { ObjectRefType } from "@/lib/references";

export default function ObjectBacklinks({
  type,
  id,
  className,
  showEmpty = false,
}: {
  type: ObjectRefType;
  id: string;
  className?: string;
  /** When true, render a calm "Not referenced anywhere yet" instead of nothing. */
  showEmpty?: boolean;
}) {
  const [entries, setEntries] = useState<BacklinkEntry[] | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    scanBacklinks(type, id)
      .then((r) => {
        if (!cancelled) setEntries(r);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  // While scanning, render nothing (avoids a flash on surfaces with no refs).
  if (entries === null) return null;
  if (entries.length === 0 && !showEmpty) return null;

  return (
    <div className={className}>
      <h4 className="mb-2 text-[11px] uppercase tracking-wide text-foreground-muted">
        Referenced in
      </h4>
      {entries.length === 0 ? (
        <p className="text-meta text-foreground-muted">Not referenced anywhere yet.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {entries.map((entry) => (
            <button
              key={`${entry.type}-${entry.id}`}
              type="button"
              onClick={() => router.push(entry.href)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-body text-foreground transition-colors hover:bg-accent-soft"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-action" />
              <span className="shrink-0 text-meta capitalize text-foreground-muted">
                {entry.type}
              </span>
              <span className="truncate font-medium">{entry.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
