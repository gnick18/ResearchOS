/**
 * §6.6 Method attachment TAB sub-step (2 of 4).
 *
 * BeakerBot's cursor clicks the Methods tab inside the now-open
 * TaskDetailPopup. Advances on `tour:experiment-methods-tab-active`
 * (dispatched by `TaskDetailPopup.tsx`'s `selectTab` callback when the
 * new tab is `"method"`).
 *
 * The popup-mount sub-step (`experiment-attach-method-open`) has just
 * landed us here; the popup DOM is now present and the methods-tab
 * anchor is resolvable.
 *
 * Classification: BEAKERBOT DEMO.
 *
 * Pose: `pointing` (click-affordance pose).
 *
 * expectedRoute: "/workbench" — popup-portaled, no route change.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const methodAttachmentTabStep = buildWalkthroughStep({
  id: "experiment-attach-method-tab",
  speech:
    "The Methods tab is where you pin the protocol you actually followed for this run. Six months from now, when you're trying to figure out why one experiment worked and another didn't, this is what tells you exactly what you did.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.experimentMethodsTab),
  cursorScript: cursorScript(async () => {
    const tabClick = await safeClickAction(
      targetSelector(TOUR_TARGETS.experimentMethodsTab),
      3000,
    );
    return compactScript([tabClick]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});
