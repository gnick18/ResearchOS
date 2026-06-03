/**
 * §6.7d Method attachment ATTACH sub-step (FINAL restructure
 * 2026-05-27; hand-walk USER_ACTION pivot 2026-05-27; spotlight +
 * cursor REMOVED 2026-06-03).
 *
 * Pure narration + onEnter-staged surface. `onEnter` re-opens the
 * experiment popup on the Methods tab (and idempotently ensures an
 * experiment + a method exist), then hands full control to the user:
 * they click the + button to open the method picker and click Attach
 * on the markdown method themselves. The speech tells them exactly
 * what to do.
 *
 * NO targetSelector / NO cursorScript (attach-step-unblock bot
 * 2026-06-03, Grant live-walk): "it won't let me click anything, the
 * blue hover shouldn't be here" + "he tried to click something on this
 * step, remove that."
 *   - The old `targetSelector` spotlighted the + button. When the user
 *     clicked + and the method-picker modal opened OVER that button,
 *     the spotlight's dimming backdrop (InputLockOverlay) sat on top of
 *     the picker and BLOCKED the Attach click, while the blue glow
 *     mis-rendered onto the picker's METHODS header + card. Dropping
 *     the targetSelector removes the backdrop and the stray glow, so
 *     the picker is fully clickable. (TourController only paints the
 *     spotlight + lock overlay when a step has a targetSelector.)
 *   - The old `cursorScript` re-clicked the experiment row + Methods
 *     tab, which `onEnter` already does. The redundant BeakerBot cursor
 *     demo was the "he tried to click something" the user flagged.
 *
 * Navigation hook shape:
 *   1. `expectedRoute: "/workbench"` — TourController auto-pushes the
 *      browser back to /workbench on step entry. The home → /methods
 *      detour during the methods cluster is undone here.
 *   2. `onEnter` re-opens the TaskDetailPopup on the Methods tab so the
 *      Attach affordance is mounted and the user lands on the right
 *      surface (not Lab Notes, the default).
 *   3. The user clicks the + Attach Method button and picks the
 *      markdown method themselves. No spotlight, no cursor.
 *
 * Completion: manual ("Got it, next"). The user advances when they're
 * done attaching. No event-driven completion because the user may
 * also want to read or experiment with the attached method before
 * clicking next.
 *
 * Classification: USER_ACTION narration (onEnter stages, user attaches).
 *
 * Pose: `pointing` (click-affordance pose, no cursor demo).
 */
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS } from "./lib/targets";
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
  // NO targetSelector (attach-step-unblock bot 2026-06-03): a spotlight
  // here anchors to the + button; the moment the user clicks + and the
  // method-picker modal opens over it, the spotlight's dimming backdrop
  // sits on top of the picker and blocks the Attach click, and the blue
  // glow mis-paints onto the picker. TourController only renders the
  // spotlight + InputLockOverlay when a step has a targetSelector, so
  // dropping it makes the picker fully clickable with no stray glow.
  //
  // Tour robustification 2026-05-27 (tour robustification manager):
  // ensure BOTH an experiment AND a method exist before the surface is
  // staged. A seed-jump past §6.5 + §6.7c (methods-create) leaves the
  // user with nothing to attach. Both ensure helpers are idempotent —
  // the canonical flow hits the no-op branch.
  // tour-popup-resilience bot 2026-06-03: reopen the experiment popup AND
  // activate the Methods tab if a mid-tour refresh closed it (portal state,
  // not a route) BEFORE the existing experiment/method ensures run. The
  // + Attach button this beat points at lives on the popup's Methods tab,
  // which the popup does not show by default after a reopen. Reopening in
  // onEnter lands the user on the right surface with no cursor demo. No-op
  // on the canonical path where the popup is already open.
  onEnter: async () => {
    await ensureExperimentPopupOpen(TOUR_TARGETS.experimentMethodsTab);
    await ensureFirstExperimentExists();
    await ensureFirstMethodExists();
  },
  // NO cursorScript (attach-step-unblock bot 2026-06-03): onEnter already
  // reopens the popup + activates the Methods tab, so the redundant
  // row-click + Methods-tab cursor demo (the "he tried to click something"
  // the user flagged) is gone. This is a plain narration step — the user
  // clicks + and Attach themselves.
  //
  // Universal pacing (Grant 2026-05-22): the step waits for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
  // FINAL reorder manager 2026-05-27: keep expectedRoute on /workbench
  // even though the user just left /methods. The TourController's
  // auto-nav effect will push back to /workbench on step entry; the
  // cursor script's row-click then re-opens the popup. Without this,
  // the row anchor wouldn't be on-page and the cursor sequence would
  // silently no-op.
  expectedRoute: "/workbench",
});
