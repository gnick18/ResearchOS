/**
 * §6.2 Project page roll-up sections (Wave 2A speech wire-up,
 * 2026-05-27).
 *
 * Sits between `project-overview-prose` and
 * `project-overview-typing-demo`. Pure NARRATION pointing the user at
 * the Results / Methods / Activity sections below the Overview textarea
 * so they understand the page roll-up before BeakerBot's typing demo
 * fires on the next step.
 *
 * Voice classification per Grant's 2026-05-27 script: NARRATION
 * Spotlight: `projectOverviewRollupSections` (targets.ts, stamped on the
 *   wrapper div around Results / Methods / Activity in ProjectRoute.tsx)
 * Completion: manual ("Got it, next")
 * ExpectedRoute: dynamic `/workbench/projects/<id>` — left unset because
 *   the project id isn't resolvable at module load; the earlier
 *   `project-overview-nav` cursor click already navigated us here.
 *
 * v4 tour speech manager — A
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const projectOverviewRollupStep = buildWalkthroughStep({
  id: "project-overview-rollup",
  speech: (
    <>
      <p className="mb-2">
        Below the Overview box, <strong>Results</strong>,{" "}
        <strong>Methods</strong>, and <strong>Activity</strong> fill
        themselves in automatically as you work. Drop an image in any
        experiment&apos;s Results tab and it shows up here. Attach a
        method to an experiment and it lands here too.
      </p>
      <p>
        You never curate this page manually. It&apos;s a live roll-up of
        everything happening across the project.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.projectOverviewRollupSections),
  completion: manualAdvance("Got it, next"),
});
