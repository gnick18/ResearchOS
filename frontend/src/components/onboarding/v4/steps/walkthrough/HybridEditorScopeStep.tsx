/**
 * §6.7 Hybrid editor scope intro (Wave 2C speech rewrite, 2026-05-27).
 *
 * Sits between `hybrid-notes-vs-results` (HE-0) and `hybrid-markdown-intro`
 * (HE-1). Frames the editor as a single shared surface used everywhere
 * in ResearchOS (project overviews, standalone notes, method write-ups)
 * so the upcoming markdown deep-dive reads as a one-time investment.
 *
 * 2026-05-27 (hybrid editor demo fix manager) — Grant hand-walk:
 * promoted from NARRATION to BEAKERBOT_DEMO so BeakerBot can demo the
 * popup's fullscreen affordance and actually expand it for the upcoming
 * markdown demos (more screen real estate for the bold / italic / h1
 * / h2 / h3 demos that follow). Cursor clicks the fullscreen toggle
 * (TaskDetailPopup's "Fullscreen" tooltip button stamped with
 * `data-tour-target="task-popup-fullscreen"`) and leaves the popup
 * expanded for the rest of the §6.7 cluster.
 *
 * Voice classification: BEAKERBOT_DEMO
 * Spotlight: fullscreen toggle button
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

export const hybridEditorScopeStep = buildWalkthroughStep({
  id: "hybrid-editor-scope",
  speech: (
    <>
      <p className="mb-2">
        About the editor itself: we&apos;re about to spend a few minutes
        on it. It&apos;s the same one used everywhere in ResearchOS, so
        once you know it here, you know it for project overviews,
        standalone notes, and method writeups too.
      </p>
      <p className="mb-2">
        Want more room? Click the fullscreen icon here. Esc or the
        shrink button up top brings you back. I&apos;ll expand it now
        so we have more space to work with.
      </p>
      <p>
        I&apos;ll cover markdown basics first, then how to drop in
        images and other files.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.taskPopupFullscreen),
  cursorScript: cursorScript(async () => {
    // Glide to the fullscreen toggle, click it so the experiment popup
    // expands to fill the viewport. Pause briefly so the user sees the
    // expansion animation before BeakerBot's speech continues into the
    // markdown intro. The popup stays expanded for the rest of §6.7;
    // it auto-collapses when the popup itself closes at the §6.7
    // terminal beat (hybrid-file-attach).
    const clickFullscreen = await safeClickAction(
      targetSelector(TOUR_TARGETS.taskPopupFullscreen),
      3000,
    );
    const settle = pause(450);
    return compactScript([clickFullscreen, settle]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});
