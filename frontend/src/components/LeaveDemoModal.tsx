"use client";

import { useCallback, useEffect, useState } from "react";
import LivingPopup from "@/components/ui/LivingPopup";
import { restorePreDemoStateOrClear } from "@/lib/file-system/indexeddb-store";
import { consumePreDemoRoute } from "@/lib/file-system/pre-demo-route";
import {
  clearAllStickyDemoFlags,
  isTutorialMode,
} from "@/lib/file-system/wiki-capture-mock";
import { clearTourProgress } from "@/lib/onboarding/tour-progress";
import { clearTourResume } from "@/lib/onboarding/tour-demo-session";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal shown when the visitor confirms exit from the public `/demo`
 * route. The trigger surface is `<FloatingLeaveDemoButton>` (the
 * always-visible muted pill in the bottom-right that follows the user
 * across every route while the sticky demo flag is set). The legacy
 * `<DemoLabBanner>` referenced in older comments was removed; there is
 * no top-of-page banner today.
 *
 * After the V3 rip (Phase B 2026-05-22) the `/demo` route is fixture-mode
 * browsing only: no tour overlay, no tutorial query params. The legacy
 * `?tutorial=1` (V3 full tour) and `?tutorial=telegram` (standalone
 * Telegram walkthrough) entry points are gone. `isTutorialMode()` now
 * returns a permanent false; the tutorial branch below is dead code
 * kept short-term for copy continuity and to be cleaned up in a
 * follow-up.
 *
 * Exit path (public-demo): visitor came in via `/demo` from somewhere.
 * Two sub-cases handled by `restorePreDemoStateOrClear`:
 *   a. Real folder pre-existed (user navigated to /demo from inside
 *      their connected app, or opened it in another same-origin tab):
 *      `installWikiCaptureFixture` saved the real handle + users into
 *      pre-demo backup keys before overwriting IDB with the fixture's
 *      fake handle. Restore those keys onto the main keys, clear the
 *      backup, reload, `/` then silent-reconnects to the real folder.
 *   b. True public visitor (no real folder ever connected): no backup
 *      exists; clear the main keys (which hold only the fake fixture
 *      handle + "alex"), reload to the folder picker.
 */
export default function LeaveDemoModal({ isOpen, onClose }: Props) {
  // Read once on mount so the same value drives both copy and behavior.
  // isTutorialMode() is hard-wired to false after the V3 rip (Phase B
  // 2026-05-22); the state + branch below remain short-term so the
  // component shape stays unchanged for any in-flight callers.
  const [tutorial, setTutorial] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of the URL flag once mounted on the client
    setTutorial(isTutorialMode());
  }, []);

  const goHome = useCallback(async () => {
    // Defense-in-depth for the demo trap (2026-06-19): the onboarding tutor's
    // durable progress lives in localStorage and survives a tab close, so a
    // half-finished `playing` run used to re-seed demo on the next boot. The
    // no-warp redesign already stops the tutor from entering demo, but leaving the
    // demo is an explicit "get me out" action, so also drop any tour progress +
    // resume marker here. A legit no-warp tour never enters demo, so it can never
    // surface the Leave-demo control, which means this can only ever clear the
    // stuck legacy state and never kills an in-flight tour.
    clearTourProgress();
    clearTourResume();

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

    let restored = false;
    try {
      restored = await restorePreDemoStateOrClear();
    } catch {
      // Best-effort cleanup; even if IndexedDB throws, the reload below
      // gives the user a way out via the folder picker.
    }
    // Public-demo Leave: clear every sticky sessionStorage flag (demo-
    // mode plus any future preview / fixture stickies) so a user who
    // confirmed leaving isn't still locked into fixture or preview mode
    // when the post-reload page renders.
    clearAllStickyDemoFlags();
    // When a real folder was restored AND the user jumped in from inside the
    // app, return them to the exact page they left. Otherwise fall back home.
    const back = (restored && consumePreDemoRoute()) || "/";
    window.location.replace(back);
  }, []);

  const title = tutorial ? "End the tour?" : "Leave the demo?";
  const body = tutorial
    ? "Your real folder is still connected and safe in the original tab — leaving the tour just closes this practice tab. Nothing in your real research is touched."
    : "Your demo edits live in this browser tab only. Leaving will reset everything and return you to the folder picker.";
  const confirmLabel = tutorial ? "Back to my folder" : "Leave demo";
  const cancelLabel = tutorial ? "Keep walking through" : "Keep exploring the demo";

  return (
    <LivingPopup
      open={isOpen}
      onClose={onClose}
      label="Leave the demo"
      widthClassName="max-w-md"
      card={false}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-demo-title"
        className="relative w-full max-w-md rounded-2xl bg-surface-raised border border-border ros-popup-card-shadow p-6"
      >
        <h2
          id="leave-demo-title"
          className="text-heading font-bold text-foreground mb-2"
        >
          {title}
        </h2>
        <p className="text-body text-foreground-muted mb-5">{body}</p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={goHome}
            className="ros-btn-raise w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-white text-body font-medium rounded-lg transition-colors"
          >
            {confirmLabel}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-meta text-foreground-muted hover:text-foreground transition-colors"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}
