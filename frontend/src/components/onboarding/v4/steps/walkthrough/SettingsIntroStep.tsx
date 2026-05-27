/**
 * §6.9 Settings phase intro (Wave 1 skeleton, 2026-05-27).
 *
 * NEW step introduced by Grant's 2026-05-27 tour script rewrite. Sits
 * between `gantt-goals-overview` and `personalization-animations`.
 * Pure narration that frames the whole Settings phase ("appearance,
 * visible tabs, integrations, AI Helper, re-run") before the cursor
 * starts walking through individual sections.
 *
 * Replaces the prior `settings-page-intro` page-transition beat with a
 * different id so a stale resume_state record can't pin the controller
 * to the dropped step.
 *
 * Wave 1 ships the skeleton (correct id + voice + manual completion +
 * expectedRoute). Wave 2 will fill in the real speech.
 *
 * Voice classification per the new script: NARRATION
 * Spotlight: none (framing-only beat)
 * Completion: manual ("Got it, next")
 * ExpectedRoute: "/settings"
 *
 * v4 tour structural manager
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

export const settingsIntroStep = buildWalkthroughStep({
  id: "settings-intro",
  speech: "TODO(wave2): settings-intro",
  pose: "pointing",
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/settings",
});
