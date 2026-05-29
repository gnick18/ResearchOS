/**
 * Writing Focus Mode enter beat (FOCUS_WRITING_MODE_DESIGN.md §9,
 * focus-writing-mode build bot 2026-05-29).
 *
 * Sits between `hybrid-editor-scope` and `hybrid-markdown-intro` in
 * TOUR_STEP_ORDER. A universal (ungated) BEAKERBOT_DEMO beat modeled on
 * HybridEditorScopeStep: the cursor glides to the new Focus Mode toolbar
 * button (data-tour-target="hybrid-editor-focus-toggle") and clicks it so
 * the calm full-viewport writing surface pops. Brief pause so the user sees
 * the transition, then a manual "Got it, next".
 *
 * Buffer safety (FOCUS_WRITING_MODE_DESIGN.md §7): entering focus mode does
 * NOT remount the editor (the wrapper portals the same subtree through a
 * stable container), so the markdown typing beats that follow keep their
 * in-flight content. The guarded Escape the markdown beats fire to commit
 * blocks (dispatchTourSyntheticEscape) early-returns in the focus-mode
 * Escape listener, so those in-cluster Escapes never bounce the user out of
 * focus mode mid-demo.
 *
 * Voice classification: BEAKERBOT_DEMO
 * Spotlight: the Focus Mode enter button
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

export const hybridFocusEnterStep = buildWalkthroughStep({
  id: "hybrid-focus-enter",
  speech: (
    <>
      <p className="mb-2">
        One more trick before the markdown tour: focus mode. Let us clear
        away everything but the page.
      </p>
      <p className="mb-2">
        I will click the focus icon here. The toolbar, tabs, and side panels
        slide away, leaving a calm, centered writing column.
      </p>
      <p>
        You can do this any time with the focus button, or Cmd / Ctrl plus
        Shift plus F. Esc or the exit button up top brings the full view back.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorFocusToggle),
  cursorScript: cursorScript(async () => {
    // Glide to the focus-mode enter button and click it so the calm
    // full-viewport surface pops. Pause briefly so the user registers the
    // transition before BeakerBot's speech continues into the markdown
    // intro. The overlay stays up for the rest of the §6.7 cluster; the
    // exit beat (hybrid-focus-exit) peels it back after hybrid-save-concept.
    const clickFocus = await safeClickAction(
      targetSelector(TOUR_TARGETS.hybridEditorFocusToggle),
      3000,
    );
    const settle = pause(450);
    return compactScript([clickFocus, settle]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});
