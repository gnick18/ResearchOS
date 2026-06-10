"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  clearDemoMode,
  getDemoMode,
} from "@/lib/file-system/wiki-capture-mock";
import { restorePreDemoStateOrClear } from "@/lib/file-system/indexeddb-store";
import {
  storePreDemoRoute,
  consumePreDemoRoute,
} from "@/lib/file-system/pre-demo-route";
import Tooltip from "./Tooltip";

/**
 * Dev-only one-click demo-mode toggle. Skips the disconnect → folder-picker
 * dance: clicking when out-of-demo navigates to `/demo` (the existing
 * fixture-install path runs via `FileSystemProvider`); clicking when in-demo
 * runs the same `restorePreDemoStateOrClear` + `clearDemoMode` + hard reload
 * that `<LeaveDemoModal>` does on its "Leave demo" branch.
 *
 * Hard-gated on `process.env.NODE_ENV === "development"` so the body becomes
 * dead code in production builds (same pattern as `DevTestNotificationButton`).
 */
const IS_DEV = process.env.NODE_ENV === "development";

export default function DevDemoToggleButton() {
  const pathname = usePathname();
  const [inDemo, setInDemo] = useState(false);
  const [busy, setBusy] = useState(false);

  // Re-read the sessionStorage demo flag on every route change so the icon /
  // label stay in sync (same pathname-tied resync `DemoLabBanner` uses).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot resync of external sessionStorage flag on route change
    setInDemo(getDemoMode());
  }, [pathname]);

  if (!IS_DEV) return null;

  const handleClick = async () => {
    if (busy) return;
    if (inDemo) {
      setBusy(true);
      let restored = false;
      try {
        restored = await restorePreDemoStateOrClear();
      } catch {
        // best-effort; reload still gives a way out via the folder picker
      }
      clearDemoMode();
      // Full reload so the patched singleton `fileService` is dropped and the
      // real file-service remounts from the restored IDB handle (mirrors the
      // LeaveDemoModal "Leave demo" path). Return to the page we jumped in from.
      const back = (restored && consumePreDemoRoute()) || "/";
      window.location.replace(back);
    } else {
      // Hard navigation so `FileSystemProvider` remounts and its
      // `initialize()` effect re-runs — that's the only caller of
      // `installWikiCaptureFixture()`, which in turn calls
      // `backupRealHandleForDemo()` to stash the real folder onto pre-demo
      // keys. A soft `router.push("/demo")` skipped the remount, left the
      // backup keys empty, and made the next exit hit the no-backup branch
      // in `restorePreDemoStateOrClear` — wiping the real folder. Mirrors
      // the exit branch above, which is also a hard reload.
      storePreDemoRoute(window.location.pathname + window.location.search);
      window.location.assign("/demo");
    }
  };

  const label = inDemo ? "Exit demo mode (dev)" : "Enter demo mode (dev)";

  return (
    <Tooltip label={label} placement="top">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-label={label}
        className="pointer-events-auto w-12 h-12 rounded-full bg-white border-2 border-violet-300 hover:border-violet-500 hover:bg-violet-50 text-violet-600 hover:text-violet-700 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center disabled:opacity-50"
      >
        {inDemo ? (
          // Exit icon — arrow leaving a box.
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
        ) : (
          // Enter icon — a beaker/flask hinting at the demo lab fixture.
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 3h6m-5 0v6.5L4.5 18a2 2 0 001.74 3h11.52a2 2 0 001.74-3L14 9.5V3"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 14h10"
            />
          </svg>
        )}
      </button>
    </Tooltip>
  );
}
