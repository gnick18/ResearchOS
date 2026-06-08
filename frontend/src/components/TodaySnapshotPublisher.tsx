"use client";

// Mobile DOWNLOAD path, the laptop publisher (piece C).
//
// The mirror image of CaptureInboxPoller. When a folder is connected AND the
// user's identity is unlocked, this seals a small "today" snapshot of the
// folder's tasks to each paired phone and publishes it to the relay (on mount,
// on window focus, and on an interval). The relay only ever holds sealed bytes,
// so each phone can decrypt only its own snapshot. Headless, mounted once in the
// signed-in tree, a no-op when no identity is on hand.
//
// The actual seal + publish logic lives in lib/mobile-relay/today-snapshot.ts
// (publishTodayToAllDevices). See relay/scripts/smoke-snapshot.mjs for the full
// round-trip contract.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef } from "react";

import { useFileSystem } from "@/lib/file-system/file-system-context";
import { loadUserCaptureKeys } from "@/lib/mobile-relay/keys";
import { publishTodayToAllDevices } from "@/lib/mobile-relay/today-snapshot";

const PUBLISH_INTERVAL_MS = 60_000;
// Throttle so a focus event landing on top of the interval (or vice versa) does
// not double-publish within this window.
const MIN_GAP_MS = 30_000;

export default function TodaySnapshotPublisher() {
  const { currentUser, isConnected } = useFileSystem();

  // A run-lock so overlapping triggers (interval + focus) don't double-publish.
  const runningRef = useRef(false);
  const lastRunRef = useRef(0);

  useEffect(() => {
    if (!isConnected || !currentUser) return;

    let cancelled = false;

    const runOnce = async () => {
      if (cancelled || runningRef.current) return;
      const now = Date.now();
      if (now - lastRunRef.current < MIN_GAP_MS) return;
      runningRef.current = true;
      lastRunRef.current = now;
      try {
        const keys = await loadUserCaptureKeys();
        // No unlocked identity on hand here (needs-restore state): stay dark.
        if (!keys || cancelled) return;
        const { published, skipped } = await publishTodayToAllDevices(keys);
        if (published > 0 || skipped > 0) {
          console.info(
            `[today-publisher] published to ${published} device(s), skipped ${skipped}`,
          );
        }
      } catch (err) {
        console.warn("[today-publisher] publish failed (will retry)", err);
      } finally {
        runningRef.current = false;
      }
    };

    void runOnce();
    const timer = setInterval(() => void runOnce(), PUBLISH_INTERVAL_MS);

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
