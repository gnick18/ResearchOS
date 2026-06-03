/**
 * Writing Focus Mode exit beat (FOCUS_WRITING_MODE_DESIGN.md §9,
 * focus-writing-mode build bot 2026-05-29).
 *
 * Sits between `hybrid-save-concept` and `workbench-notes-intro` in
 * TOUR_STEP_ORDER. A universal (ungated) BEAKERBOT_DEMO beat: the cursor
 * clicks the always-visible Exit focus control
 * (data-tour-target="hybrid-editor-focus-exit") so the overlay peels back to
 * reveal the still-expanded popup underneath (focus mode is independent of
 * the popup's own Fullscreen state, so exiting returns the user to exactly
 * the popup size they had). Brief pause, then a manual "Got it, next".
 *
 * Voice classification: BEAKERBOT_DEMO
 * Spotlight: the Exit focus control
 * Completion: manual ("Got it, next")
 * ExpectedRoute: "/workbench"
 */
import {
  cursorScript,
  safeClickAction,
  pause,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { ensureExperimentPopupOpen } from "./lib/on-enter-helpers";

export const hybridFocusExitStep = buildWalkthroughStep({
  id: "hybrid-focus-exit",
  speech: (
    <>
      <p className="mb-2">
        That is focus mode. When you are done in the calm view, click exit up
        here. And back to the full view.
      </p>
      <p>
        Everything you wrote is right where you left it: focus mode is just a
        view, it never changes or saves your work on its own.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorFocusExit),
  // tour-popup-resilience bot 2026-06-03: reopen the experiment popup if a
  // mid-tour refresh closed it (portal state, not a route), so this beat's
  // narration shows over the popup rather than an empty workbench. The Exit
  // focus control only exists while focus mode is active; a refresh drops
  // focus mode, but the cursor's safeClickAction then gracefully no-ops and
  // the manual "Got it, next" still advances. No-op on the canonical path.
  onEnter: () => ensureExperimentPopupOpen(),
  cursorScript: cursorScript(async () => {
    // Click the always-visible Exit focus control so the overlay peels back
    // to reveal the popup underneath. Pause briefly so the user registers
    // the transition before the §6.7b Notes / Lists cluster opens.
    const clickExit = await safeClickAction(
      targetSelector(TOUR_TARGETS.hybridEditorFocusExit),
      3000,
    );
    const settle = pause(450);
    return compactScript([clickExit, settle]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});
