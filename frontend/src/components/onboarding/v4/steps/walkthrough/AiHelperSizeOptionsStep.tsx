/**
 * §6.10 AI Helper size-options demo (Wave 2E rewrite, 2026-05-27).
 *
 * NEW step introduced by Grant's 2026-05-27 tour script rewrite. Sits
 * between `ai-helper-size-diff` (which now carries the NARRATION about
 * token cost) and `ai-helper-use-case-paste`.
 *
 * Wave 2E (v4 tour speech manager — E, 2026-05-27): cursor-cycling logic
 * moved here FROM the prior `ai-helper-size-diff` body. Cursor clicks
 * Full → PAUSE → Medium → PAUSE → Minimal so the user sees each prompt
 * size's preview pane in turn. Minimal is the last tab selected, so the
 * subsequent `ai-helper-use-case-paste` Copy click writes the minimal
 * prompt to the clipboard (matching the prior behavior).
 *
 * Speech is Grant's exact two-paragraph copy from the 2026-05-27 script:
 * one paragraph describing the three tabs (**Full**, **Minimal**,
 * **Medium**), one paragraph framing the cost / quality tradeoff.
 *
 * Classification: BEAKERBOT_DEMO
 * Spotlight: `settingsAiHelperSection` (the inline tab cluster)
 * Completion: manual ("Got it, next")
 * ExpectedRoute: "/settings"
 *
 * Gate: inherits the AI Helper trio's `picks.ai_helper` ∈ {full, medium,
 * minimal} gate from step-machine.ts isStepGatedOut.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
  callbackAction,
  waitForElement,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

const STEP_ID = "ai-helper-size-options";

/** Read-then-watch pause between size clicks. 800ms gives the user
 *  time to register the preview-pane update before the cursor moves
 *  on. Exported so tests can probe the exact pause duration. */
export const SIZE_OPTIONS_PAUSE_MS = 800;

/** Sleep helper for the callbackAction pause. setTimeout returns a
 *  cleanup handle we don't need; the wrapper just resolves on tick. */
async function pause(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof window !== "undefined") {
      window.setTimeout(resolve, ms);
    } else {
      setTimeout(resolve, ms);
    }
  });
}

export const aiHelperSizeOptionsStep = buildWalkthroughStep({
  id: STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        Three sizes to pick from. <strong>Full</strong> gives the
        model everything it could possibly want to know.{" "}
        <strong>Minimal</strong> strips it down to the essentials.{" "}
        <strong>Lean</strong> sits in between.
      </p>
      <p>
        Higher detail means better answers but more tokens per prompt.
        Pick based on what your usage budget can handle.
      </p>
    </>
  ),
  pose: "thinking",
  targetSelector: targetSelector(TOUR_TARGETS.settingsAiHelperSection),
  cursorScript: cursorScript(async () => {
    // Scroll the AI Helper section into view (waitForElement triggers
    // the spotlight's IntersectionObserver, which scrolls
    // automatically). Then click each size tab in sequence with a
    // read-then-watch pause between clicks. Cycle ends on Minimal so
    // the downstream `ai-helper-use-case-paste` Copy click writes the
    // minimal prompt (consistent with the pre-Wave-2E flow).
    await waitForElement(
      targetSelector(TOUR_TARGETS.settingsAiHelperSection),
    );
    const full = await safeClickAction(
      targetSelector(TOUR_TARGETS.settingsAiHelperTabFull),
    );
    const medium = await safeClickAction(
      targetSelector(TOUR_TARGETS.settingsAiHelperTabMedium),
    );
    const minimal = await safeClickAction(
      targetSelector(TOUR_TARGETS.settingsAiHelperTabMinimal),
    );
    // Interleave callbackAction pauses between the clicks. The
    // callback runs at PLAYBACK time (not build time), so each pause
    // resolves AFTER the previous click has visibly landed.
    return compactScript([
      full,
      callbackAction(() => pause(SIZE_OPTIONS_PAUSE_MS)),
      medium,
      callbackAction(() => pause(SIZE_OPTIONS_PAUSE_MS)),
      minimal,
    ]);
  }),
  completion: manualAdvance("Got it, next"),
  // Gate: matches step-machine.ts `isStepGatedOut` — ai_helper ∈
  // {full, medium, minimal}.
  conditionalOn: (picks) => {
    const v = picks?.ai_helper;
    return v === "full" || v === "medium" || v === "minimal";
  },
  expectedRoute: "/settings",
});
