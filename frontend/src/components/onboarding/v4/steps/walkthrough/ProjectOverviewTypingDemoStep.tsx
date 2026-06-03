/**
 * §6.2 Project page Overview-textarea typing demo (Wave 2A speech +
 * cursor wire-up, 2026-05-27).
 *
 * Split off the BEAKERBOT_DEMO portion that previously lived at the end
 * of `project-overview-prose`. Sits between `project-overview-prose`
 * and `project-overview-context`. Cursor focuses the Overview textarea
 * and types a placeholder hypothesis at the standard typing cadence so
 * the user sees what shape of prose belongs on the Overview page.
 *
 * Classification: BEAKERBOT_DEMO. Speech announces "I'll type a
 * placeholder hypothesis"; the cursor performs the typing as advertised.
 *
 * Cleanup default discard: throwaway placeholder prose, not a real
 * hypothesis. The cleanup grid (P8) reads `cleanup_default: "discard"`
 * and pre-unchecks the keep box.
 *
 *   { type: "overview_prose", id: "<projectId>", cleanup_default: "discard" }
 *
 * `expectedRoute` is intentionally undefined: the project id isn't
 * resolvable at module load. The earlier NAV sub-step already navigated
 * the user onto `/workbench/projects/<id>`; refresh recovery is handled
 * by the P12 Resume modal + the Resume-404 mitigation, not by a hard
 * push here.
 *
 * Easter-egg (kept in source, not user-visible): "You are smart,
 * confident, and capable of anything you put your mind to. - BeakerBot"
 */
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

/**
 * Real-shaped hypothesis placeholder. Exported for testability: the
 * registry test pins the exact string so a future copy edit surfaces via
 * test failure rather than silent drift.
 *
 * Easter-egg (kept in source, not user-visible): "You are smart,
 * confident, and capable of anything you put your mind to. - BeakerBot"
 */
export const PLACEHOLDER_HYPOTHESIS =
  "Goal: figure out the optimal annealing temperature for our PCR primer set. Hypothesis: 58°C will outperform the 56°C default.";

export const projectOverviewTypingDemoStep = buildWalkthroughStep({
  id: "project-overview-typing-demo",
  speech:
    "I'll type a placeholder hypothesis into the Overview box now so you can see how it feels.",
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.projectOverviewTextarea),
  cursorScript: cursorScript(async () => {
    // Click the Overview textarea to focus it, then type the placeholder
    // hypothesis. Both actions resolve against the same anchor; the
    // browser is already on the project route because the earlier NAV
    // sub-step landed us here.
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
  // Manual advance per universal pacing (Grant 2026-05-22): BeakerBot
  // demos no longer auto-advance. User reads the typed hypothesis,
  // clicks Got it, next to move on to project-overview-context.
  completion: manualAdvance("Got it, next"),
});
