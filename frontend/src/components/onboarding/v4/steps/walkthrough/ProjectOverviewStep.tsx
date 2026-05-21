/**
 * §6.2 Project route Overview prose demo — universal walkthrough.
 *
 * After the project lands (§6.1), BeakerBot navigates to the project
 * detail route, glides the cursor to the Overview textarea, focuses
 * it, and types a placeholder hypothesis sentence at the standard
 * 95ms cadence. Auto-advances 1.5 seconds after the typing finishes
 * (matches §6.2's `autoAdvanceAfterMs: 1500` note in the proposal).
 *
 * Classification: BEAKERBOT DEMO + NAVIGATION (per Grant's design
 * correction 2026-05-21). Speech is "I'm taking us into your project.
 * Watch, I'll type a hypothesis sentence into the Overview." Both
 * "I'm taking us" (navigation) and "Watch, I'll type" (demo) are
 * explicit BeakerBot-led promises. Cursor performs the project-card
 * navigation click + the typing as advertised.
 *
 * Cleanup default discard: this is throwaway placeholder prose, not a
 * real hypothesis. The cleanup grid (P8) reads `cleanup_default:
 * "discard"` and pre-unchecks the keep box.
 *
 *   { type: "overview_prose", id: "<projectId>", cleanup_default: "discard" }
 *
 * Navigation: §6.2 says "auto-nav via cursor click on the project card
 * on home page." Out of scope for the body itself — the cursor script
 * scopes to clicking the project card if visible, then waiting for the
 * Overview textarea to mount. If the navigation doesn't happen (eg.
 * project card never rendered), the cursor script gracefully no-ops
 * via `compactScript(...)` filtering nulls.
 */
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  compactScript,
} from "./lib/cursor-script";
import { autoAdvanceAfter, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

const PLACEHOLDER_HYPOTHESIS =
  "Hypothesis placeholder. BeakerBot wrote this so you can see how Overview works.";

export const projectOverviewStep = buildWalkthroughStep({
  id: "project-overview-prose",
  speech:
    "I'm taking us into your project. Watch, I'll type a hypothesis sentence into the Overview.",
  pose: "typing",
  targetSelector: targetSelector(TOUR_TARGETS.projectOverviewTextarea),
  cursorScript: cursorScript(async () => {
    // Click the most recently created project card if present (best
    // effort; the user may already be on the project route from §6.1
    // depending on how the create modal closes).
    const cardClick = await safeClickAction("[data-tour-target^='home-project-card-']", 2000);
    const typeAction = await safeTypeAction(
      targetSelector(TOUR_TARGETS.projectOverviewTextarea),
      PLACEHOLDER_HYPOTHESIS,
    );
    return compactScript([cardClick, typeAction]);
  }),
  // ~30 chars at 95ms ≈ 3s typing + 1.5s breath = ~4.5s total before
  // auto-advance. The proposal's 1500ms is "after typing finishes"; we
  // bake the typing budget into the auto delay so the controller's
  // single-timer model works.
  completion: autoAdvanceAfter(
    Math.ceil(PLACEHOLDER_HYPOTHESIS.length * 95) + 1500,
  ),
});
