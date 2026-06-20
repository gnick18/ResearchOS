"use client";

// Account-centric folder identity (Phase B, D6). The "Revert ownership" banner.
//
// After a deliberate takeover, the folder owner record carries the previous owner
// and the takeover events. This banner appears on a folder that HAS been taken
// over (takeover_events present) and offers to hand ownership back to the previous
// owner, restoring exactly the shared files that were swept to trash under that
// event. Cancelable, the user can dismiss the banner for the session without
// reverting (no-soft-locks, both paths are visible).
//
// Mounted at providers level (inside FileSystemProvider) so it can read context
// and render above every route, alongside the other connect-state banners. Inert
// (renders nothing) when MULTI_FOLDER is off, not connected, or the active folder
// has no recorded takeover.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { MULTI_FOLDER_ENABLED } from "@/lib/file-system/multi-folder-config";
import {
  lastTakeover,
  readFolderOwner,
  type TakeoverEvent,
} from "@/lib/file-system/folder-owner";

export default function FolderTakeoverBanner() {
  const { isConnected, directoryName, revertOwnership } = useFileSystem();
  const [event, setEvent] = useState<TakeoverEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Read the owner record on connect / folder change. Re-keys on directoryName so
  // a folder switch re-checks. Inert when the flag is off.
  useEffect(() => {
    let cancelled = false;
    if (!MULTI_FOLDER_ENABLED || !isConnected) {
      setEvent(null);
      return;
    }
    setDismissed(false);
    (async () => {
      try {
        const rec = await readFolderOwner();
        const last = lastTakeover(rec);
        if (!cancelled) setEvent(last);
      } catch {
        if (!cancelled) setEvent(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isConnected, directoryName]);

  const handleRevert = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await revertOwnership();
      if (ok) setEvent(null);
    } finally {
      setBusy(false);
    }
  }, [busy, revertOwnership]);

  if (!MULTI_FOLDER_ENABLED || !isConnected || !event || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[90] flex justify-center px-4 pt-4"
    >
      <div className="flex w-full max-w-2xl items-start gap-3 rounded-xl border border-border bg-surface px-5 py-4 shadow-xl">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-foreground-muted">
          <Icon name="undo" className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <p className="text-body font-semibold text-foreground">
            You took over this folder
          </p>
          <p className="mt-1 text-meta text-foreground-muted">
            Ownership was transferred to your account. You can hand it back to the
            previous owner, which restores the shared files that were removed.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleRevert()}
              className="ros-btn-raise rounded-lg bg-brand-action px-3 py-1.5 text-body font-medium text-white disabled:opacity-60"
            >
              {busy ? "Reverting..." : "Revert ownership"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDismissed(true)}
              className="rounded-lg border border-border px-3 py-1.5 text-body font-medium text-foreground-muted disabled:opacity-60"
            >
              Keep ownership
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
