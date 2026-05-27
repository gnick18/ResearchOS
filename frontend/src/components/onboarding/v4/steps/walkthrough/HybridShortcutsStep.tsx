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
    // Wave 2C speech rewrite (v4 tour speech manager — C, 2026-05-27):
    // applies Grant's two-paragraph copy. Cmd+B / Ctrl+B render as
    // <code> per the existing precedent.
    <>
      <p className="mb-2">
        Your turn. Standard keyboard shortcuts work here too.
      </p>
      <p>
        Try pressing{" "}
        <code className="font-mono mx-0.5 px-1 bg-gray-100 rounded">
          Cmd+B
        </code>{" "}
        (or{" "}
        <code className="font-mono mx-0.5 px-1 bg-gray-100 rounded">
          Ctrl+B
        </code>{" "}
        on Windows) to type some bold text. You can also skip this
        step if shortcuts aren&apos;t your thing.
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
    pillLabel:
      "Try a shortcut. The Got it, next button is in the chat bubble when you're done.",
  },
});
