/**
 * §6.6 Method attachment ATTACH sub-step (3 of 4).
 *
 * BeakerBot's cursor clicks the "Attach Method" button inside the
 * popup's Methods tab. The method picker opens; the cursor then clicks
 * the first listed method (the funny markdown protocol from §6.4d).
 *
 * Completion: auto-advance after a fixed budget (matches the cursor's
 * click cadence). No clean event fires for "attachment landed"; the
 * follow-up `experiment-attach-method-notes` step's cursor will simply
 * find the variation-notes field already rendered once the attachment
 * lands, so a fixed auto-advance is sufficient.
 *
 * Classification: BEAKERBOT DEMO. Speech is "I'll pin our funny markdown
 * method to this experiment so it's tracked".
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
import { autoAdvanceAfter, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const methodAttachmentAttachStep = buildWalkthroughStep({
  id: "experiment-attach-method-attach",
  speech:
    "I'll pin our funny markdown method to this experiment so it's tracked.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.experimentAttachMethod),
  cursorScript: cursorScript(async () => {
    // 1. Click "Attach Method". The picker mounts.
    const attachClick = await safeClickAction(
      targetSelector(TOUR_TARGETS.experimentAttachMethod),
      3000,
    );
    // 2. Click the first method tile in the picker. The methods-create
    //    step (§6.4d) just authored the funny markdown protocol, and the
    //    methods list shows newest-first in the picker, so the first
    //    tile is the funny method. Falls back gracefully if the
    //    picker-tile anchor isn't wired yet (sub-bot a97cdccfcd914de7b
    //    owns the popup's product-surface attr wiring).
    const firstMethodClick = await safeClickAction(
      "[data-tour-target='experiment-attach-method-picker-first-method']",
      3000,
    );
    return compactScript([attachClick, firstMethodClick]);
  }),
  // Cursor budget: ~1.5s glide+click for the attach button, ~0.5s for
  // the picker to mount, ~1.5s glide+click for the first method tile,
  // ~1s breath. Tight enough to feel responsive, loose enough to let
  // the picker mount animation finish.
  completion: autoAdvanceAfter(4500),
  expectedRoute: "/workbench",
});
