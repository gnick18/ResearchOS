/**
 * §6.7d Method attachment ATTACH sub-step (FINAL restructure
 * 2026-05-27).
 *
 * BeakerBot's cursor returns the user to the experiment popup
 * (re-opening it if necessary), clicks the Methods tab, clicks
 * "Attach Method", then picks the markdown method the user just
 * built in the methods cluster (§6.7c).
 *
 * FINAL reorder manager 2026-05-27: this step previously sat at §6.6c
 * right after `experiment-attach-method-tab`, where the popup was
 * already open on the Methods tab. After the FINAL restructure the
 * step now runs AFTER the methods cluster (§6.7c) — so by the time
 * we land here the user has been on `/methods` for many beats, the
 * workbench popup is closed, and we need to re-stage the experiment +
 * Methods tab before the original attach script can run.
 *
 * Navigation hook shape:
 *   1. `expectedRoute: "/workbench"` — TourController auto-pushes the
 *      browser back to /workbench on step entry. Same prefix-match
 *      contract as the §6.6 framing beats; the home → /methods
 *      detour during the methods cluster is undone here.
 *   2. Cursor script first clicks the experiment row to re-open the
 *      TaskDetailPopup (`safeClickAction` waits for the row to mount
 *      after the route change settles).
 *   3. Cursor then clicks the Methods tab so the Attach affordance
 *      mounts.
 *   4. Original two-click attach sequence runs (Attach button → first
 *      method tile).
 *
 * Completion: manual (universal pacing rule, Grant 2026-05-22). No
 * clean event fires for "attachment landed"; the follow-up
 * `experiment-attach-method-notes` step's cursor finds the variation-
 * notes field already rendered once the attachment lands.
 *
 * Classification: BEAKERBOT DEMO.
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
  // FINAL reorder manager 2026-05-27: speech matches the FINAL script's
  // §6.7d entry verbatim. The "Back to your experiment" opening
  // narrates the return navigation (the expectedRoute push + the
  // cursor's row-click that re-opens the popup) so the user
  // understands the page transition.
  speech:
    "Back to your experiment. Now that you've got a method, let's pin it. I'll attach the markdown method you just built so this experiment has an exact record of the protocol followed.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.experimentAttachMethod),
  cursorScript: cursorScript(async () => {
    // FINAL reorder manager 2026-05-27: this step now runs after the
    // methods cluster (§6.7c), so the workbench popup is closed by the
    // time we land here. Re-stage the popup + Methods tab before
    // running the original attach sequence.
    //
    // 1. Click the experiment row to re-open the popup. The
    //    `expectedRoute: "/workbench"` push has already returned the
    //    browser to /workbench by the time this script runs, so the
    //    row anchor is on-page (matches the original
    //    `experiment-attach-method-open` selector). The `^=` attribute
    //    selector matches any workbench-experiment-row-* (typically
    //    one row visible because §6.5 only created one experiment).
    const reopenRowClick = await safeClickAction(
      "[data-tour-target^='workbench-experiment-row-']",
      3000,
    );
    // 2. Click the Methods tab inside the freshly-opened popup. Same
    //    anchor + dispatched event (`tour:experiment-methods-tab-active`)
    //    as the original §6.6b tab beat. Idempotent if the tab is
    //    already active — the click just re-selects "method".
    const methodsTabClick = await safeClickAction(
      targetSelector(TOUR_TARGETS.experimentMethodsTab),
      3000,
    );
    // 3. Click "Attach Method". The picker mounts.
    const attachClick = await safeClickAction(
      targetSelector(TOUR_TARGETS.experimentAttachMethod),
      3000,
    );
    // 4. Click the first method tile in the picker. The methods-create
    //    step (§6.7c-3) just authored the funny markdown protocol, and
    //    the methods list shows newest-first in the picker, so the
    //    first tile is the funny method.
    const firstMethodClick = await safeClickAction(
      "[data-tour-target='experiment-attach-method-picker-first-method']",
      3000,
    );
    return compactScript([
      reopenRowClick,
      methodsTabClick,
      attachClick,
      firstMethodClick,
    ]);
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
