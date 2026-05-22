/**
 * §6.10 Settings — AI Helper size-diff demo (Settings manager 2026-05-22).
 *
 * First of three beats that replace the prior single
 * `ai-helper-deep-explain` step. Conditional on
 * `feature_picks.ai_helper` ∈ {full, medium, minimal}.
 *
 * Cursor scrolls to the AI Helper section, then clicks Full → PAUSE
 * 800ms → Medium → PAUSE 800ms → Minimal. Each pause is a read-then-
 * watch beat: the user sees the preview pane update for each size
 * before the cursor moves on to the next one. The minimal tab is the
 * last one clicked, so the subsequent `ai-helper-use-case-paste`
 * beat's Copy click writes the minimal prompt to the clipboard.
 *
 * Speech: "This is the AI Helper. Three prompt sizes: Full, Medium,
 * Minimal. Big context for big models like Claude, ChatGPT, or
 * Gemini. I'll cycle through so you can see the size difference."
 *
 * Classification: BEAKERBOT DEMO. Cursor performs the size cycle;
 * user clicks Got-it to advance.
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

const STEP_ID = "ai-helper-size-diff";

/** Read-then-watch pause between size clicks. 800ms gives the user
 *  time to register the preview-pane update before the cursor moves
 *  on. Exported so tests can probe the exact pause duration. */
export const SIZE_DIFF_PAUSE_MS = 800;

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

export const settingsAiHelperSizeDiffStep = buildWalkthroughStep({
  id: STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        This is the AI Helper. Three prompt sizes: Full, Medium,
        Minimal. Big context for big models like Claude, ChatGPT, or
        Gemini.
      </p>
      <p>I&apos;ll cycle through so you can see the size difference.</p>
    </>
  ),
  pose: "thinking",
  targetSelector: targetSelector(TOUR_TARGETS.settingsAiHelperSection),
  cursorScript: cursorScript(async () => {
    // Scroll the AI Helper section into view (waitForElement triggers
    // the spotlight's IntersectionObserver, which scrolls
    // automatically). Then click each size tab in sequence with a
    // read-then-watch pause between clicks.
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
    // resolves AFTER the previous click has visibly landed. Build-
    // order vs. playback-order is the same lesson learned from
    // §6.16's lab-permission-practice (HR 2026-05-22): a setTimeout
    // outside callbackAction would fire during script assembly and
    // mistime the pauses.
    return compactScript([
      full,
      callbackAction(() => pause(SIZE_DIFF_PAUSE_MS)),
      medium,
      callbackAction(() => pause(SIZE_DIFF_PAUSE_MS)),
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
