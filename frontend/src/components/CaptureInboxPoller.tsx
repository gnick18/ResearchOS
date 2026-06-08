"use client";

// Mobile capture relay, the inbox poller (piece D).
//
// The laptop side of the make-it-real backbone. When a folder is connected AND
// the user's identity is unlocked, this polls the capture relay on an interval
// (and on window focus) and lands each pending capture in the connected folder,
// then acks it so the relay deletes the blob. Mirrors SharedFolderAutoRefresh,
// a headless component mounted once in the signed-in tree.
//
// The actual single-poll logic lives in lib/mobile-relay/poll.ts
// (runCaptureInboxPoll) so the interval/focus path here and the manual "Check
// for new captures" button in Settings share identical behavior. See that file
// for the image vs text vs unknown routing and the [capture-poller] logging.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef } from "react";

import { useFileSystem } from "@/lib/file-system/file-system-context";
import { runCaptureInboxPoll } from "@/lib/mobile-relay/poll";
import { loadUserCaptureKeys } from "@/lib/mobile-relay/keys";

const POLL_INTERVAL_MS = 20_000;

export default function CaptureInboxPoller() {
  const { currentUser, isConnected } = useFileSystem();

  // A run-lock so overlapping triggers (interval + focus) don't double-pull.
  const runningRef = useRef(false);

  useEffect(() => {
    if (!isConnected || !currentUser) return;

    let cancelled = false;

    const runOnce = async () => {
      if (cancelled || runningRef.current) return;
      runningRef.current = true;
      try {
        const keys = await loadUserCaptureKeys();
        // No unlocked identity on hand here (needs-restore state): stay dark.
        if (!keys || cancelled) return;
        await runCaptureInboxPoll(keys, currentUser);
      } catch {
        // Relay unreachable / transient. runCaptureInboxPoll already logged the
        // reason; the background path just retries next tick.
      } finally {
        runningRef.current = false;
      }
    };

    void runOnce();
    const timer = setInterval(() => void runOnce(), POLL_INTERVAL_MS);

    const onFocus = () => void runOnce();
    const onVisible = () => {
      if (document.visibilityState === "visible") void runOnce();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [currentUser, isConnected]);

  return null;
}
