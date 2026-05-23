"use client";

import { useCallback, useEffect, useState } from "react";
import { restorePreDemoStateOrClear } from "@/lib/file-system/indexeddb-store";
import {
  clearAllStickyDemoFlags,
  isTutorialMode,
} from "@/lib/file-system/wiki-capture-mock";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal shown when the visitor clicks "Leave Demo" in `<DemoLabBanner>` or
 * `<FloatingLeaveDemoButton>` — either from the public `/demo` route or from
 * the Phase-4 guided tutorial tab (`/demo?tutorial=1`, opened via
 * `window.open` from the welcome modal).
 *
 * Two exit paths, branched on `isTutorialMode()`:
 *
 * 1. Tutorial path — the parent tab still has the user's REAL folder
 *    connected; IndexedDB is shared across same-origin tabs, so clearing
 *    `directoryHandle` / `currentUser` / `mainUser` here would yank the
 *    rug out from under the parent tab. We leave IndexedDB alone, clear
 *    only the sticky sessionStorage demo flag, and try `window.close()`
 *    first (the welcome modal opened this tab via `window.open`, so the
 *    browser will honor the close). If `window.close()` is refused, the
 *    timeout below falls back to `location.replace("/")` — the post-reload
 *    `/` detects the existing IndexedDB handle and reconnects to the
 *    user's real folder.
 *
 * 2. Public-demo path — visitor came in via `/demo` from somewhere. Two
 *    sub-cases handled by `restorePreDemoStateOrClear`:
 *    a. Real folder pre-existed (user navigated to /demo from inside their
 *       connected app, or opened it in another same-origin tab):
 *       `installWikiCaptureFixture` saved the real handle + users into
 *       pre-demo backup keys before overwriting IDB with the fixture's
 *       fake handle. Restore those keys onto the main keys, clear the
 *       backup, reload — `/` then silent-reconnects to the real folder.
 *    b. True public visitor (no real folder ever connected): no backup
 *       exists; clear the main keys (which hold only the fake fixture
 *       handle + "alex"), reload to the folder picker.
 */
export default function LeaveDemoModal({ isOpen, onClose }: Props) {
  // Read once on mount so the same value drives both copy and behavior.
  // The URL still carries `?tutorial=1` until we navigate, so reading on
  // mount (not at module load) is correct and SSR-safe.
  const [tutorial, setTutorial] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of the URL flag once mounted on the client
    setTutorial(isTutorialMode());
  }, []);

  const goHome = useCallback(async () => {
    if (isTutorialMode()) {
      // Tutorial: don't touch IndexedDB — the parent tab needs it.
      // Clear EVERY sticky sessionStorage flag (demo-mode plus any
      // future wiki-capture / preview stickies) so a confirmed exit
      // can't leave this tab silently locked in fixture or preview
      // mode after `window.close()` is refused and the fallback
      // location.replace runs.
      clearAllStickyDemoFlags();
      try {
        window.close();
      } catch {
        // Some browsers throw rather than silently no-op.
      }
      // Fallback for tabs the browser refuses to close (no reliable sync
      // way to detect refusal). If `window.close()` did succeed, this
      // tab is mid-teardown and the replace is moot.
      window.setTimeout(() => {
        window.location.replace("/");
      }, 150);
      return;
    }

    try {
      await restorePreDemoStateOrClear();
    } catch {
      // Best-effort cleanup; even if IndexedDB throws, the reload below
      // gives the user a way out via the folder picker.
    }
    // Public-demo Leave: clear every sticky sessionStorage flag (demo-
    // mode plus any future preview / fixture stickies) so a user who
    // confirmed leaving isn't still locked into fixture or preview mode
    // when the post-reload `/` renders.
    clearAllStickyDemoFlags();
    window.location.replace("/");
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const title = tutorial ? "End the tour?" : "Leave the demo?";
  const body = tutorial
    ? "Your real folder is still connected and safe in the original tab — leaving the tour just closes this practice tab. Nothing in your real research is touched."
    : "Your demo edits live in this browser tab only. Leaving will reset everything and return you to the folder picker.";
  const confirmLabel = tutorial ? "Back to my folder" : "Leave demo";
  const cancelLabel = tutorial ? "Keep walking through" : "Keep exploring the demo";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-demo-title"
        className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-white/10 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="leave-demo-title"
          className="text-xl font-bold text-white mb-2"
        >
          {title}
        </h2>
        <p className="text-sm text-slate-300 mb-5">{body}</p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={goHome}
            className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {confirmLabel}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-xs text-slate-400 hover:text-white transition-colors"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
