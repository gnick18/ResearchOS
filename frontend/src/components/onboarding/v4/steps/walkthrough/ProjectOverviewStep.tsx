/**
 * §6.2 Project route Overview prose (PROSE sub-step).
 *
 * Second of §6.2 sub-steps (NAV -> PROSE -> ROLLUP -> TYPING-DEMO ->
 * CONTEXT -> EXIT). After the NAV sub-step navigates to
 * `/workbench/projects/<id>`, BeakerBot teaches the four-section
 * structure of the project page and explains what the Overview box at
 * the top is FOR (the project's anchor: hypothesis, motivation, why it
 * exists). Manual advance hands off to project-overview-rollup, which
 * spotlights the Results / Methods / Activity roll-up sections below.
 *
 * Wave 2A rewrite (v4 tour speech manager — A, 2026-05-27): per Grant's
 * BEAKERBOT_TOUR_SCRIPT_REWRITE_2026-05-27.md §6.2, the BEAKERBOT_DEMO
 * typing portion that used to live at the end of this step (the cursor
 * focus + type-placeholder-hypothesis script) was split out into its own
 * new step `project-overview-typing-demo`. This step is now pure
 * narration about the page structure and the Overview box, no cursor
 * script. PLACEHOLDER_HYPOTHESIS moved with the cursor script to the new
 * step file.
 *
 * Classification: NARRATION. Speech explains the page; no cursor demo,
 * no user action expected. Manual advance per universal pacing rule.
 *
 * No artifact tracking on this step (the hypothesis text is typed by
 * the typing-demo step, which inherits the discard cleanup default).
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const projectOverviewStep = buildWalkthroughStep({
  id: "project-overview-prose",
  speech: (
    <>
      <p className="mb-2">The project page has four sections.</p>
      <p>
        The <strong>Overview</strong> box at the top is yours to fill in:
        the hypothesis, the motivation, why this project exists. It&apos;s
        the anchor you come back to when you&apos;re deep in the weeds and
        need to remember the point.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.projectOverviewTextarea),
  // No cursorScript: the typing demo moved to
  // project-overview-typing-demo (Wave 2A, 2026-05-27). This step is
  // now pure narration, no cursor needed.
  completion: manualAdvance("Got it, next"),
  // No expectedRoute: the NAV sub-step landed us here. See the prior
  // discussion in the original file header for the bare
  // `/workbench/projects` 404 reason.
});
