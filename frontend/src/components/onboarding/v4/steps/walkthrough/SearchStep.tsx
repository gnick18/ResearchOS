/**
 * §6.11 Search — universal walkthrough.
 *
 * Hand-walk simplification 2026-05-27 (Grant): the prior cursor demo
 * typed a partial-match query ("Demo Experiment") into the Keywords
 * input. That dragged out the demo and didn't add much narrative value
 * for a fresh user with only one experiment on file. New cursor:
 * BeakerBot just clicks the Search button with no filters set, which
 * returns every experiment in the account (one for a fresh user).
 * Speech still explains what Search is for; the cursor just shows the
 * mechanic.
 *
 * Classification: BEAKERBOT DEMO. Cursor performs a single click;
 * user clicks Got it, next when they've seen enough.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
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
    "Search runs across everything in your account at once: experiments, methods, tasks, notes, and results. Search by a reagent or keyword and it finds the match without you needing to know which project it lives in.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.searchSubmit),
  cursorScript: cursorScript(async () => {
    // Click Search with no filters set. The empty query returns every
    // experiment in the account, which for a fresh user is just the
    // First experiment created in step 6.5. Drops the keyword-typing
    // demo per Grant's hand-walk request to simplify.
    const click = await safeClickAction(
      targetSelector(TOUR_TARGETS.searchSubmit),
    );
    return compactScript([click]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/search",
});
