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
  "Test the hypothesis that BeakerBot scales linearly.";

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
  // Typing cadence was bumped from 95ms to 48ms per character in commit
  // 95de59e2. Auto-advance timer needs to track that or it overshoots
  // typing-finished by several seconds and feels stuck. ~1s glide-in +
  // 52 chars at 48ms = ~3.5s, plus 1s breath = 4.5s total. The
  // breath is intentionally short because Grant observed the long
  // post-typing pause read as "nothing's happening".
  completion: autoAdvanceAfter(
    1000 + Math.ceil(PLACEHOLDER_HYPOTHESIS.length * 48) + 1000,
  ),
  // Prefix match handles the dynamic `/workbench/projects/<id>` route.
  // The TourController auto-nav skips when `current.startsWith(expected)`.
  expectedRoute: "/workbench/projects",
});
