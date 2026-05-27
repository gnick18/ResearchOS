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
  compactScript,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

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
    //    popup opens to the Lab Notes tab by default, so we always
    //    click the Methods tab to land the user on the correct
    //    surface for the attach action they're about to do. Idempotent
    //    if the tab is already active.
    const methodsTabClick = await safeClickAction(
      targetSelector(TOUR_TARGETS.experimentMethodsTab),
      3000,
    );
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
