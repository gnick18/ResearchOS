/**
 * §6.11 Search — universal walkthrough.
 *
 * Cursor navigates to /search, types a query matching the experiment
 * created in §6.5 (`PLACEHOLDER_EXPERIMENT_NAME` from
 * WorkbenchCreateExperimentStep.tsx — re-imported so the search query
 * always lines up with the demo experiment).
 *
 * Speech acknowledges the empty-results case gracefully:
 *   "Your account's pretty empty so the demo's small, try this again
 *    after you've got real experiments."
 *
 * Auto-advance after the typing completes + a beat to read the
 * results. No artifact (search is transient).
 *
 * Classification: BEAKERBOT DEMO (per Grant's design correction
 * 2026-05-21). Speech is descriptive ("Search across everything...");
 * the cursor types a query so the user sees the search behavior with
 * a known input. Brief explicitly classifies search as demo. Cursor
 * keeps the type action.
 */
import {
  cursorScript,
  safeTypeAction,
  compactScript,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { PLACEHOLDER_EXPERIMENT_NAME } from "./WorkbenchCreateExperimentStep";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

// We type just the first two words so the search input shows partial
// matching behavior. "Demo Experiment" matches "Demo Experiment One"
// from §6.5.
const SEARCH_QUERY = PLACEHOLDER_EXPERIMENT_NAME.split(" ").slice(0, 2).join(
  " ",
);

export const searchStep = buildWalkthroughStep({
  id: "search-demo",
  speech: (
    <>
      <p className="mb-2">
        Quick one. Search across everything: experiments, methods,
        tasks, results.
      </p>
      <p>
        Your account&apos;s pretty empty so the demo&apos;s small, try
        this again after you&apos;ve got real experiments.
      </p>
    </>
  ),
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.searchInput),
  cursorScript: cursorScript(async () => {
    const type = await safeTypeAction(
      targetSelector(TOUR_TARGETS.searchInput),
      SEARCH_QUERY,
    );
    return compactScript([type]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/search",
});
