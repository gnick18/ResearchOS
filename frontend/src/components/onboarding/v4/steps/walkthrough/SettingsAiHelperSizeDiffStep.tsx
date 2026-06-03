/**
 * §6.10 Settings — AI Helper size-diff narration (Wave 2E rewrite, 2026-05-27).
 *
 * Conditional on `feature_picks.ai_helper` ∈ {full, medium, minimal}.
 *
 * Wave 2E split (v4 tour speech manager — E, 2026-05-27): this beat is
 * now PURE NARRATION explaining WHY token-size matters before the
 * follow-up `ai-helper-size-options` beat demos the three size tabs.
 * The cursor-cycling Full → Medium → Minimal sequence that used to
 * live here moved to `ai-helper-size-options` (see that file for the
 * sequence). Speech text is Grant's exact two-paragraph copy from the
 * 2026-05-27 script.
 *
 * Classification: NARRATION. No cursor, no spotlight on tab elements;
 * the surrounding AI Helper section is already in view from
 * `settings-tour-rerun` / `personalization-color` upstream beats. User
 * clicks Got-it to advance to `ai-helper-size-options`.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

const STEP_ID = "ai-helper-size-diff";

export const settingsAiHelperSizeDiffStep = buildWalkthroughStep({
  id: STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        External AI tools like Claude, ChatGPT, and Gemini charge by
        tokens. The more context you hand them about your lab
        notebook, the more each conversation costs you.
      </p>
      <p>
        That&apos;s why the AI Helper exists. It generates a system
        prompt about how your notebook is structured, sized to fit how
        much you&apos;re willing to spend per chat.
      </p>
    </>
  ),
  pose: "thinking",
  targetSelector: targetSelector(TOUR_TARGETS.settingsAiHelperSection),
  completion: manualAdvance("Got it, next"),
  // Gate: matches step-machine.ts `isStepGatedOut` — ai_helper ∈
  // {full, medium, minimal}.
  conditionalOn: (picks) => {
    const v = picks?.ai_helper;
    return v === "full" || v === "medium" || v === "minimal";
  },
  expectedRoute: "/settings",
});
