// Live collab sync status, for a quiet "sync paused" indicator.
//
// The collab Durable Object sends MSG_SYNC_BLOCKED when durable persistence is
// paused server-side (cost breaker tripped, the per-doc write throttle was hit,
// or the doc is at its size cap). Live fan-out continues and every edit stays
// safe in the local Loro doc, so this is a soft, transient state. The relay
// provider calls notifySyncBlocked() and a global indicator surfaces it, then it
// auto-clears (the DO does not signal a resume; the next successful sync simply
// stops sending blocked frames).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { create } from "zustand";

/** How long the indicator lingers after the last blocked frame before clearing. */
const CLEAR_AFTER_MS = 6000;

interface SyncStatusState {
  /** Human reason the durable sync is paused, or null when syncing normally. */
  pausedReason: string | null;
  notifyBlocked: (reason: string) => void;
  clear: () => void;
}

let clearTimer: ReturnType<typeof setTimeout> | null = null;

export const useSyncStatus = create<SyncStatusState>((set) => ({
  pausedReason: null,
  notifyBlocked: (reason: string) => {
    set({ pausedReason: reason });
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => set({ pausedReason: null }), CLEAR_AFTER_MS);
  },
  clear: () => {
    if (clearTimer) clearTimeout(clearTimer);
    set({ pausedReason: null });
  },
}));

/** Vanilla entry point so the (non-React) relay provider can report a block. */
export function notifySyncBlocked(reason: string): void {
  useSyncStatus.getState().notifyBlocked(reason);
}

/** Maps the DO reason code to a short human phrase for the indicator. */
export function syncPausedLabel(reason: string | null): string {
  switch (reason) {
    case "paused":
      return "Cloud sync paused";
    case "throttled":
      return "Syncing slowly";
    case "full":
      return "This document is full";
    default:
      return "Cloud sync paused";
  }
}
