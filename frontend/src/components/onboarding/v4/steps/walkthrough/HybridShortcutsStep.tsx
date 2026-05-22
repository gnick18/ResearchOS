/**
 * §6.7 HE-7 — keyboard shortcuts (USER-ACTION with allow-listed lock).
 *
 * Hybrid editor manager 2026-05-22. Flipped from the old BeakerBot-demo
 * shortcuts step. The new universal "read THEN watch" rule meant we
 * had to either split the demo into bite-sized typing beats (overkill
 * for shortcuts) or hand the keyboard to the user and let them feel
 * it. Grant's call: user-action.
 *
 * Page lock: ON with the editor in the allow-list. The user can click
 * into a paragraph and type; the rest of the page stays inert. Manual
 * advance — no correctness check, user self-judges.
 *
 * No nag if the user clicks Got-it-next without trying anything; the
 * speech bubble keeps the button live the whole step.
 *
 * No cursor demo for this step. The cursor stays put.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const hybridShortcutsStep = buildWalkthroughStep({
  id: "hybrid-shortcuts",
  speech: (
    <>
      <p className="mb-2">
        Most Word shortcuts work here too. Try this: click into a new
        paragraph, then press <strong>Cmd+B</strong> (or Ctrl+B on
        Windows), and type some bold text.
      </p>
      <p>
        When you&apos;re done, hit <strong>Got it, next</strong>.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorTextarea),
  // No cursorScript: BeakerBot directs, the user does.
  completion: manualAdvance("Got it, next"),
  // Allow-list lock: the user can click into the editor (textarea
  // anchor + any descendant — the helper panel input + the inline
  // contenteditable both live inside this subtree). The hybrid editor
  // mounts its inline textareas as children of the
  // `hybrid-editor-textarea` container, so a single selector covers
  // both the click-into-block AND the active-edit textarea.
  pageLock: {
    allowList: [
      targetSelector(TOUR_TARGETS.hybridEditorTextarea),
      targetSelector(TOUR_TARGETS.hybridEditorShortcutBar),
    ],
    pillLabel: "Try a shortcut, then click Got it, next.",
  },
});
