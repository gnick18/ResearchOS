/**
 * §6.7 HE-9 — drag the attached image into the editor body (BeakerBot demo).
 *
 * Hybrid editor manager 2026-05-22. Different beat from HE-8: HE-8
 * attached the image to the experiment; HE-9 demonstrates that the
 * same image can be DROPPED inline into a paragraph chunk inside the
 * editor.
 *
 * Cursor: drags from the image strip (the just-attached selfie) into a
 * new paragraph in the editor. The image then renders inline.
 *
 * Completion: manual ("Got it, next").
 */
import {
  cursorScript,
  safeDragAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const hybridImageDragInStep = buildWalkthroughStep({
  id: "hybrid-image-drag-in",
  speech: (
    <>
      <p className="mb-2">
        You can also drop images directly into the markdown, they show
        up inline wherever you drop them.
      </p>
      <p>Watch.</p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorTextarea),
  cursorScript: cursorScript(async () => {
    // Drag the first child of the image strip (the just-attached
    // selfie) into the editor body. Same pattern the retired
    // HybridEditorImageDropStep used; the actual receiver path
    // (image-drop into the editor) is wired in HybridMarkdownEditor.
    const drag = await safeDragAction(
      `${targetSelector(TOUR_TARGETS.hybridEditorImageStrip)} > *:first-child`,
      targetSelector(TOUR_TARGETS.hybridEditorTextarea),
    );
    return compactScript([drag]);
  }),
  completion: manualAdvance("Got it, next"),
});
