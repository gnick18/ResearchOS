/**
 * §6.6 Method attachment OPEN sub-step (1 of 4).
 *
 * BeakerBot's cursor clicks the most-recently created experiment row in
 * the workbench list to open the TaskDetailPopup. Advances on the
 * `tour:experiment-popup-opened` window event (dispatched by
 * `TaskDetailPopup.tsx` on mount when the task is an experiment).
 *
 * Split rationale (Grant 2026-05-21): the original single-id
 * `experiment-attach-method` step tried to click the methods tab,
 * click attach, and type a variation note in one cursor script that
 * SPANNED the popup-mount boundary. The popup is portal-mounted on
 * /workbench rather than a route change, but it's the same class of
 * bug as §6.2's project-route-entered: the cursor script's targets
 * don't exist until the popup mounts, so the in-flight `safeClickAction`
 * either times out or fires on a stale DOM. Splitting into four
 * sub-steps mirrors §6.2's NAV / PROSE split.
 *
 * Classification: BEAKERBOT DEMO. Speech is "Now let me open the
 * experiment we just made", an explicit BeakerBot-led promise.
 *
 * Pose: `pointing` (click-affordance pose, matches §6.2 NAV).
 *
 * expectedRoute: "/workbench" — the popup is a portal over /workbench,
 * no route change happens here.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { advanceOnEvent, buildWalkthroughStep } from "./lib/step-helpers";
import { watchExperimentPopupOpened } from "./lib/tour-events";

export const methodAttachmentOpenStep = buildWalkthroughStep({
  id: "experiment-attach-method-open",
  speech: "Now let me open the experiment we just made.",
  pose: "pointing",
  // No targetSelector: the cursor click on the workbench card is the
  // visual cue. Mirrors the §6.2 NAV pattern — a spotlight on the card
  // would dim /workbench and steal focus from the click animation.
  cursorScript: cursorScript(async () => {
    // Click the most-recently-created experiment row. The `^=`
    // attribute selector matches any workbench-experiment-row-* (fine
    // on a fresh tour because §6.5 has just created the user's first
    // experiment, so there's typically one row visible). If the row
    // never mounts (e.g. the experiment create failed), the safe helper
    // returns null and `compactScript` filters it out so the step
    // gracefully no-ops and the popup-mount fallback in
    // `watchExperimentPopupOpened` covers a manual-open case.
    const cardClick = await safeClickAction(
      "[data-tour-target^='workbench-experiment-row-']",
      3000,
    );
    return compactScript([cardClick]);
  }),
  completion: advanceOnEvent(watchExperimentPopupOpened),
  expectedRoute: "/workbench",
});
