/**
 * §6.11 Search — universal walkthrough.
 *
 * 2026-06-03 (HR / tour-simplification): cursor downgrade. The beat used
 * to have BeakerBot click the Search button to demo a no-filter search.
 * The Search button is self-evident, so the cursor was dropped. The beat,
 * its speech, the spotlight on the Search button, and the manual advance
 * all stay; the user clicks Search themselves if they want to try it. Also
 * dropped the mid-sentence colon from the speech.
 *
 * Classification: awareness beat (spotlight + speech, no cursor).
 */
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

/**
 * Placeholder experiment name shared with §6.5. Re-export so the
 * `cursor-script.test.tsx` regression suite can keep asserting on a
 * single source of truth. Kept here even after the search-demo cursor
 * stopped typing it because callers downstream still import the
 * constant.
 */
export const PLACEHOLDER_EXPERIMENT_NAME = "Demo Experiment One";

export const searchStep = buildWalkthroughStep({
  id: "search-demo",
  speech:
    "Search runs across everything in your account at once, experiments, methods, tasks, notes, and results. Search by a reagent or keyword and it finds the match without you needing to know which project it lives in.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.searchSubmit),
  // 2026-06-03 (HR / tour-simplification): cursor dropped. The Search
  // button is self-evident; the spotlight + speech carry the awareness and
  // the user clicks Search themselves if they want to try it.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/search",
});
