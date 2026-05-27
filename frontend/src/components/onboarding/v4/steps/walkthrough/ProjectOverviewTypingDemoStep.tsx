/**
 * §6.2 Project page Overview-textarea typing demo (Wave 1 skeleton,
 * 2026-05-27).
 *
 * NEW step introduced by Grant's 2026-05-27 tour script rewrite. Split
 * off the BEAKERBOT_DEMO portion that previously lived at the end of
 * `project-overview-prose`. Sits between `project-overview-rollup` and
 * `project-overview-context`. Cursor types a placeholder hypothesis
 * into the Overview textarea.
 *
 * Wave 1 ships the skeleton (correct id + voice + spotlight + manual
 * completion). Wave 2 will fill in the real speech and the cursor
 * script that drives the typing demo (existing
 * `ProjectOverviewStep.tsx` has the cursor-script reference shape).
 *
 * Voice classification per the new script: BEAKERBOT_DEMO
 * Spotlight: `projectOverviewTextarea` (already exists in targets.ts)
 * Completion: manual ("Got it, next")
 * ExpectedRoute: dynamic `/workbench/projects/<id>` — left unset for
 *   the same reason as `project-overview-rollup`.
 *
 * v4 tour structural manager
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const projectOverviewTypingDemoStep = buildWalkthroughStep({
  id: "project-overview-typing-demo",
  speech: "TODO(wave2): project-overview-typing-demo",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.projectOverviewTextarea),
  completion: manualAdvance("Got it, next"),
});
