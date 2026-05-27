/**
 * §6.10 AI Helper size-options demo (Wave 1 skeleton, 2026-05-27).
 *
 * NEW step introduced by Grant's 2026-05-27 tour script rewrite. Split
 * off the cursor-cycles-through-Full-Medium-Minimal-tabs portion of
 * `ai-helper-size-diff`. Sits between `ai-helper-size-diff` (which now
 * carries the narration about token cost) and `ai-helper-use-case-paste`.
 *
 * Wave 1 ships the skeleton (correct id + voice + spotlight + manual
 * completion + expectedRoute + same conditional gate the other AI
 * Helper beats use). Wave 2 will fill in the real speech and the
 * cursor script that cycles through the three tabs.
 *
 * Voice classification per the new script: BEAKERBOT_DEMO
 * Spotlight: `settingsAiHelperSection` (already exists in targets.ts)
 * Completion: manual ("Got it, next")
 * ExpectedRoute: "/settings"
 *
 * Gate: inherits the AI Helper trio's `picks.ai_helper` ∈ {full, medium,
 * minimal} gate from step-machine.ts isStepGatedOut. Step-machine
 * lists this id in the same predicate branch as the existing trio so
 * declining AI Helper (no / maybe) skips this step alongside the others.
 *
 * v4 tour structural manager
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const aiHelperSizeOptionsStep = buildWalkthroughStep({
  id: "ai-helper-size-options",
  speech: "TODO(wave2): ai-helper-size-options",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.settingsAiHelperSection),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/settings",
});
