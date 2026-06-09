"use client";

// A quiet "sync paused" pill, shown when the collab relay reports that durable
// persistence is paused (cost breaker tripped, the per-doc write throttle was
// hit, or the doc is at its size cap). Live editing keeps working and every edit
// stays safe in the local Loro doc, so the copy reassures rather than alarms.
// Auto-clears via the sync-status store. Mounted once globally.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useSyncStatus, syncPausedLabel } from "@/lib/collab/sync-status";

export default function SyncPausedIndicator() {
  const reason = useSyncStatus((s) => s.pausedReason);
  if (!reason) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[200] -translate-x-1/2 flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 shadow-md dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
      {syncPausedLabel(reason)}. Your edits are safe on your device.
    </div>
  );
}
