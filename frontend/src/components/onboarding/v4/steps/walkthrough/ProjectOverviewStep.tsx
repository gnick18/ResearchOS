/**
 * §6.2 Project route Overview prose demo (PROSE sub-step).
 *
 * Second of two §6.2 sub-steps. The NAV sub-step
 * (`project-overview-nav`) has just clicked the project card on home and
 * the browser is now on `/workbench/projects/<id>`. BeakerBot glides the
 * cursor onto the Overview textarea, focuses it, and types a placeholder
 * hypothesis sentence at the standard 95ms cadence. Auto-advances 1.5
 * seconds after the typing finishes (matches §6.2's
 * `autoAdvanceAfterMs: 1500` note in the proposal).
 *
 * Split rationale (Grant 2026-05-21): the original §6.2 step tried to
 * click the project card AND type into the textarea in a single cursor
 * script. The route change unmounted the overlay mid-script, recreated
 * the cursor ref, and the cursor-script useEffect's `cancelled` cleanup
 * fired, so the type action never ran. Splitting into NAV + PROSE
 * mirrors §6.1's trigger / fill split: each cursor script runs against
 * a stable overlay mount.
 *
 * Classification: BEAKERBOT DEMO. Speech is "Watch, I'll type a
 * hypothesis sentence into the Overview", an explicit BeakerBot-led
 * promise to type. The cursor performs the typing as advertised.
 *
 * Cleanup default discard: this is throwaway placeholder prose, not a
 * real hypothesis. The cleanup grid (P8) reads `cleanup_default:
 * "discard"` and pre-unchecks the keep box.
 *
 *   { type: "overview_prose", id: "<projectId>", cleanup_default: "discard" }
 *
 * `expectedRoute` is `/workbench/projects`, a prefix match that handles
 * the dynamic project id. The TourController's auto-nav skips on prefix
 * match, so refreshing on the project page during this step doesn't
 * bounce the user home.
 */
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  compactScript,
} from "./lib/cursor-script";
import { autoAdvanceAfter, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const PLACEHOLDER_HYPOTHESIS =
  "You are smart, confident, and capable of anything you put your mind to. - BeakerBot";

export const projectOverviewStep = buildWalkthroughStep({
  id: "project-overview-prose",
  speech: "Watch, I'll type a hypothesis sentence into the Overview.",
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.projectOverviewTextarea),
  cursorScript: cursorScript(async () => {
    // Click the Overview textarea to focus it, then type the placeholder
    // hypothesis. Both actions resolve against the same anchor; the
    // browser is already on the project route because the NAV sub-step
    // landed us here.
    const focusClick = await safeClickAction(
      targetSelector(TOUR_TARGETS.projectOverviewTextarea),
      5000,
    );
    const typeAction = await safeTypeAction(
      targetSelector(TOUR_TARGETS.projectOverviewTextarea),
      PLACEHOLDER_HYPOTHESIS,
    );
    return compactScript([focusClick, typeAction]);
  }),
  // Auto-advance budget: ~1s glide-in + chars*48ms typing + 3000ms
  // post-typing breath so the user can READ the affirmation before
  // BeakerBot launches into the next step. Grant flagged the prior
  // 1s breath as feeling like an instant snap to §6.3.
  completion: autoAdvanceAfter(
    1000 + Math.ceil(PLACEHOLDER_HYPOTHESIS.length * 48) + 3000,
  ),
  // Prefix match handles the dynamic `/workbench/projects/<id>` route.
  // The TourController auto-nav skips when `current.startsWith(expected)`.
  expectedRoute: "/workbench/projects",
});
