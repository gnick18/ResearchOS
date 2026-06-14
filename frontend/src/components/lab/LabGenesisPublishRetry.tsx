"use client";

// Lab tier: background retry + banner for a lab whose relay genesis publish has
// not yet landed.
//
// When a PI creates a lab we promote them to lab_head and persist the genesis
// artifacts LOCALLY first, then fire the relay publish (see LabCreateResume).
// If that publish fails (the relay is unreachable, the user is offline), the PI
// is still a full lab head locally. This component is the catch-up worker. It
// watches for a persisted lab_pending_genesis and retries the publish on mount,
// when the browser comes back online, when settings change, and on a bounded
// interval, clearing the pending genesis (the helper does this) on success.
//
// While a publish is still pending it shows a small unobtrusive banner so the PI
// knows the lab is live locally and the server sync is still finishing.
//
// Self-gates on LAB_TIER_ENABLED + a connected currentUser. Mounted once
// globally in AppShell next to LabCreateResume.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useEffect, useRef, useState } from "react";
import { LAB_TIER_ENABLED } from "@/lib/lab/config";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { isSessionUnlocked } from "@/lib/sharing/identity/session-key";
import {
  publishPendingGenesis,
  readPendingGenesis,
} from "@/lib/lab/lab-genesis-pending";
import { onUserSettingsWritten } from "@/lib/settings/user-settings";
import { appQueryClient } from "@/lib/query-client";

// How often to re-attempt the publish while a genesis is still pending.
const RETRY_INTERVAL_MS = 15_000;

export default function LabGenesisPublishRetry() {
  const { currentUser } = useFileSystem();
  // True while a genesis publish is still outstanding (drives the banner).
  const [pending, setPending] = useState(false);
  // Guards against overlapping publish attempts.
  const inFlight = useRef(false);

  // One attempt: re-read the persisted pending genesis, and if one exists and
  // the identity is unlocked, try to publish it. The helper clears the pending
  // genesis on success and leaves it in place on failure.
  const attempt = useCallback(async (): Promise<void> => {
    if (!LAB_TIER_ENABLED || !currentUser) return;
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const queued = await readPendingGenesis(currentUser);
      if (!queued) {
        setPending(false);
        return;
      }
      setPending(true);
      // The publish ships only public, sealed artifacts, so an unlocked
      // identity is not strictly required; but we only attempt while the
      // session is live so we are not racing a half-booted app.
      if (!isSessionUnlocked()) return;
      const ok = await publishPendingGenesis(currentUser, queued);
      if (ok) {
        setPending(false);
        appQueryClient.invalidateQueries();
      }
    } finally {
      inFlight.current = false;
    }
  }, [currentUser]);

  // Drive attempts on mount, on reconnect, on settings writes for this user,
  // and on a bounded interval while still pending. When the tier is off or no
  // user is connected we wire up nothing; `pending` stays false (its default)
  // so the banner never renders, no synchronous setState needed here.
  useEffect(() => {
    if (!LAB_TIER_ENABLED || !currentUser) return;

    void attempt();

    const onOnline = () => void attempt();
    window.addEventListener("online", onOnline);

    const unsub = onUserSettingsWritten((event) => {
      if (event.username !== currentUser) return;
      setPending(Boolean(event.next.lab_pending_genesis));
      void attempt();
    });

    const interval = window.setInterval(() => {
      void attempt();
    }, RETRY_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", onOnline);
      unsub();
      window.clearInterval(interval);
    };
  }, [currentUser, attempt]);

  if (!pending) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[200] -translate-x-1/2 flex items-center gap-3 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 shadow-md dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
      </span>
      <span>
        Lab sync pending. Your lab is active locally; finishing sync to the
        server.
      </span>
      <button
        type="button"
        onClick={() => void attempt()}
        className="rounded-full border border-sky-300 px-2.5 py-0.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 dark:border-sky-500/40 dark:text-sky-200 dark:hover:bg-sky-500/20"
      >
        Retry now
      </button>
    </div>
  );
}
