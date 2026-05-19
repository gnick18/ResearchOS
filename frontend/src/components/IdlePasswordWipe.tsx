"use client";

// SENSITIVE: drives security-manager constraint #2(a) — the 15-minute
// idle wipe of the in-memory password cache used by the encrypted-backup
// recovery flow.
//
// Lifecycle:
//   - When the tab transitions to hidden, start a 15-minute timer.
//   - On `visibilitychange → visible`, cancel the pending timer.
//   - On timer fire (15 min elapsed with the tab still hidden),
//     clearCachedPassword() unconditionally. The next encrypted-backup
//     decrypt prompt will re-ask the user.
//
// The component renders nothing. It is mounted once at the AppShell
// root so it lives for the duration of any signed-in session and gets
// torn down on logout / folder switch alongside the rest of the shell.

import { useEffect } from "react";
import { clearCachedPassword } from "@/lib/auth/cached-password";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export default function IdlePasswordWipe() {
  useEffect(() => {
    if (typeof document === "undefined") return;

    let timerId: ReturnType<typeof setTimeout> | null = null;

    const cancelTimer = () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        cancelTimer();
        timerId = setTimeout(() => {
          clearCachedPassword();
          timerId = null;
        }, IDLE_TIMEOUT_MS);
      } else {
        cancelTimer();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    // Honor the current state on mount in case the tab was already
    // hidden when the user signed in (rare, but possible after a
    // background sign-in flow).
    onVisibilityChange();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      cancelTimer();
    };
  }, []);

  return null;
}
