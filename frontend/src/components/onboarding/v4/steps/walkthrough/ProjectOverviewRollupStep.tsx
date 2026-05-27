/**
 * §6.2 Project page roll-up sections (Wave 1 skeleton, 2026-05-27).
 *
 * NEW step introduced by Grant's 2026-05-27 tour script rewrite. Sits
 * between `project-overview-prose` and `project-overview-typing-demo`.
 * Pure NARRATION pointing the user at the Results / Methods / Activity
 * sections below the Overview textarea so they understand the page
 * roll-up before BeakerBot's typing demo fires.
 *
 * Wave 1 ships the skeleton (correct id + voice + spotlight + manual
 * completion + expectedRoute). Wave 2 will fill in the real speech +
 * any onEnter side-effects.
 *
 * Voice classification per the new script: NARRATION
 * Spotlight: `projectOverviewRollupSections` (targets.ts, stamped on
 *   the wrapper div around Results/Methods/Activity in ProjectRoute.tsx)
 * Completion: manual ("Got it, next")
 * ExpectedRoute: dynamic `/workbench/projects/<id>` — left unset because
 *   the project id isn't resolvable at module load; the prior step
 *   (`project-overview-prose`) already navigated the user here.
 *
 * v4 tour structural manager
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const projectOverviewRollupStep = buildWalkthroughStep({
  id: "project-overview-rollup",
  speech: "TODO(wave2): project-overview-rollup",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.projectOverviewRollupSections),
  completion: manualAdvance("Got it, next"),
});
