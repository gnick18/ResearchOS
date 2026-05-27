/**
 * §6.9 Settings phase intro (Wave 2E speech, 2026-05-27).
 *
 * NEW step introduced by Grant's 2026-05-27 tour script rewrite. Sits
 * between `gantt-goals-overview` and `personalization-animations`.
 * Pure narration that frames the whole Settings phase ("how the app
 * looks, which tabs are visible, your integrations, your AI Helper
 * prompt, and the option to re-run this tour later") before the cursor
 * starts walking through individual sections.
 *
 * Replaces the prior `settings-page-intro` page-transition beat with a
 * different id so a stale resume_state record can't pin the controller
 * to the dropped step.
 *
 * Wave 2E (v4 tour speech manager — E, 2026-05-27): speech filled in per
 * the new script. Two paragraphs: first frames the Settings scope, second
 * sets expectation that we won't click through every section.
 *
 * Voice classification per the new script: NARRATION
 * Spotlight: none (framing-only beat)
 * Completion: manual ("Got it, next")
 * ExpectedRoute: "/settings"
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

export const settingsIntroStep = buildWalkthroughStep({
  id: "settings-intro",
  speech: (
    <>
      <p className="mb-2">
        Last stop: Settings. This is where everything about your
        account lives: how the app looks, which tabs are visible, your
        integrations, your AI Helper prompt, and the option to re-run
        this tour later.
      </p>
      <p>
        We won&apos;t click through every section. We&apos;ll hit the
        ones worth knowing about so you can find the rest on your own.
      </p>
    </>
  ),
  pose: "pointing",
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/settings",
});
