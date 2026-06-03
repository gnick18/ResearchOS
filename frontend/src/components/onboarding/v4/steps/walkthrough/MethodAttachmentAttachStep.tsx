/**
 * §6.7d Method attachment ATTACH sub-step (FINAL restructure
 * 2026-05-27; hand-walk USER_ACTION pivot 2026-05-27).
 *
 * Hand-walk pivot 2026-05-27 (Grant): "prompt the user to try
 * attaching it. This should simplify things." BeakerBot now sets up
 * the surface (re-opens the experiment popup + activates the Methods
 * tab), then hands control to the user to click + and pick the method
 * themselves. Reduces the "cursor flicker through 4 things" feel of
 * the prior auto-demo and gives the user a sense of authorship.
 *
 * Navigation hook shape:
 *   1. `expectedRoute: "/workbench"` — TourController auto-pushes the
 *      browser back to /workbench on step entry. The home → /methods
 *      detour during the methods cluster is undone here.
 *   2. Cursor script clicks the experiment row to re-open the
 *      TaskDetailPopup.
 *   3. Cursor clicks the Methods tab so the Attach affordance mounts
 *      and the user lands on the right surface (not Lab Notes, which
 *      is the default).
 *   4. Cursor stops. The user clicks the + Attach Method button and
 *      picks the markdown method themselves.
 *
 * Completion: manual ("Got it, next"). The user advances when they're
 * done attaching. No event-driven completion because the user may
 * also want to read or experiment with the attached method before
 * clicking next.
 *
 * Classification: BEAKERBOT SETUP + USER_ACTION (BeakerBot navigates,
 * user attaches).
 *
 * Pose: `pointing` (click-affordance pose).
 */
import {
  cursorScript,
  safeClickAction,
  callbackAction,
  compactScript,
  waitForElement,
  tourClickWithLockBypass,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import {
  ensureFirstExperimentExists,
  ensureFirstMethodExists,
} from "./lib/ensure-helpers";
import { ensureExperimentPopupOpen } from "./lib/on-enter-helpers";

export const methodAttachmentAttachStep = buildWalkthroughStep({
  id: "experiment-attach-method-attach",
  // Hand-walk pivot 2026-05-27: speech now prompts the user to do the
  // attach themselves. BeakerBot still narrates the return navigation
  // (the expectedRoute push + the popup re-open) so the page
  // transition is explained.
  speech: (
    <>
      <p className="mb-2">
        Back to your experiment, on the Methods tab. Now that you have
        a method, let&apos;s pin it.
      </p>
      <p>
        Click the <strong>+</strong> button above to open the method
        picker, then pick the markdown method you just built. This
        experiment will then have an exact record of the protocol you
        followed.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.experimentAttachMethod),
  // Tour robustification 2026-05-27 (tour robustification manager):
  // ensure BOTH an experiment AND a method exist before this step's
  // cursor re-stages the surface. A seed-jump past §6.5 + §6.7c
  // (methods-create) leaves the user with nothing to attach. Both
  // ensure helpers are idempotent — canonical flow hits the no-op
  // branch.
  // tour-popup-resilience bot 2026-06-03: reopen the experiment popup AND
  // activate the Methods tab if a mid-tour refresh closed it (portal state,
  // not a route) BEFORE the existing experiment/method ensures run. The
  // + Attach button this beat spotlights lives on the popup's Methods tab,
  // which the popup does not show by default after a reopen. The cursor
  // script below also re-stages the surface (row-click + Methods tab) as a
  // belt-and-suspenders fallback, but reopening in onEnter lets the
  // spotlight land without waiting on the cursor. No-op on the canonical
  // path where the popup is already open.
  onEnter: async () => {
    await ensureExperimentPopupOpen(TOUR_TARGETS.experimentMethodsTab);
    await ensureFirstExperimentExists();
    await ensureFirstMethodExists();
  },
  cursorScript: cursorScript(async () => {
    // Hand-walk pivot 2026-05-27: cursor only re-stages the surface
    // (reopen popup + activate Methods tab). The user then clicks
    // Attach + picks the method themselves.
    //
    // 1. Click the experiment row to re-open the popup. The
    //    expectedRoute /workbench push has already returned the
    //    browser to /workbench by the time this script runs.
    const reopenRowClick = await safeClickAction(
      "[data-tour-target^='workbench-experiment-row-']",
      3000,
    );
    // 2. Click the Methods tab inside the freshly-opened popup. The
    //    popup opens to Details by default (hand-walk fix 2026-05-27),
    //    so we always click the Methods tab to land the user on the
    //    correct surface for the attach action they're about to do.
    //
    //    Defer-to-playback (third pattern application, same root-cause
    //    class as workbench-create-experiment-open / list-create-shell
    //    / methods-create): the Methods tab is INSIDE the popup, and
    //    the popup hasn't been re-opened yet at BUILD time. Calling
    //    safeClickAction at build resolves nothing (popup unmounted),
    //    waitForElement times out, action becomes null → tab click
    //    silently drops. Wrap in callbackAction so the selector
    //    resolves AFTER reopenRowClick plays.
    //
    //    tourClickWithLockBypass is needed in case any tour pageLock
    //    is active (downstream variants of this step may add one).
    const methodsTabClick = callbackAction(async () => {
      if (typeof document === "undefined") return;
      const tab = await waitForElement(
        targetSelector(TOUR_TARGETS.experimentMethodsTab),
        3000,
      );
      if (!(tab instanceof HTMLElement)) return;
      tourClickWithLockBypass(tab);
    });
    return compactScript([reopenRowClick, methodsTabClick]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
  // FINAL reorder manager 2026-05-27: keep expectedRoute on /workbench
  // even though the user just left /methods. The TourController's
  // auto-nav effect will push back to /workbench on step entry; the
  // cursor script's row-click then re-opens the popup. Without this,
  // the row anchor wouldn't be on-page and the cursor sequence would
  // silently no-op.
  expectedRoute: "/workbench",
});
