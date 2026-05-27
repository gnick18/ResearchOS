/**
 * §6.6 Method attachment TAB sub-step (FINAL restructure 2026-05-27,
 * 2 of 2 in the §6.6 framing; the original attach + notes beats moved
 * to §6.7d after the methods cluster).
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
 * FINAL reorder manager 2026-05-27: the speech now closes by promising
 * we'll come back later (after the methods cluster) to actually attach
 * a method. The attach + notes beats moved to §6.7d so the user has
 * built a method first.
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
  // FINAL reorder manager 2026-05-27: two-paragraph speech per the
  // FINAL script's §6.6 entry. First paragraph frames the Methods tab;
  // second paragraph defers the actual attach to §6.7d (after methods
  // cluster). Future tense ("where you'll pin") matches the FINAL doc
  // exactly.
  speech: (
    <>
      <p className="mb-2">
        The <strong>Methods</strong> tab is where you&apos;ll pin the
        protocol you actually followed for this run. Six months from now,
        when you&apos;re trying to figure out why one experiment worked
        and another didn&apos;t, this is what tells you exactly what
        you did.
      </p>
      <p>
        We&apos;ll come back here to actually attach a method later,
        after you&apos;ve built one. For now just know it exists.
      </p>
    </>
  ),
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
