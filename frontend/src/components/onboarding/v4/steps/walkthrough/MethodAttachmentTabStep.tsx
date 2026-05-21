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
import { advanceOnEvent, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchExperimentMethodsTabActive } from "./lib/tour-events";

export const methodAttachmentTabStep = buildWalkthroughStep({
  id: "experiment-attach-method-tab",
  speech:
    "Methods tab. The handle on the experiment that links what method you ran.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.experimentMethodsTab),
  cursorScript: cursorScript(async () => {
    const tabClick = await safeClickAction(
      targetSelector(TOUR_TARGETS.experimentMethodsTab),
      3000,
    );
    return compactScript([tabClick]);
  }),
  completion: advanceOnEvent(watchExperimentMethodsTabActive),
  expectedRoute: "/workbench",
});
