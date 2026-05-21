/**
 * §6.7 Hybrid editor — resize demo + notes/results storage mental
 * model. Final of four hybrid-editor sub-steps.
 *
 * Cursor hovers the embedded image; the resize handle appears. Cursor
 * drags the corner to resize.
 *
 * Multi-paragraph speech bubble (mental model):
 *   "You can resize images inline, useful when a gel image is huge.
 *
 *    One more thing: notes-tab images and results-tab images are
 *    stored separately even though they're both linked to the same
 *    experiment. Notes are your working scratch; results are the
 *    published output."
 *
 * Per §6.7 completion is manual "Got it, next" — the resize is a
 * one-shot demo with no clean API event to wait for.
 *
 * Artifact:
 *   { type: "notes_content", id: "<taskId>", cleanup_default: "discard" }
 *
 * Cleanup default discard — the notes content was BeakerBot's typing,
 * not the user's research.
 *
 * Classification: BEAKERBOT DEMO (per Grant's design correction
 * 2026-05-21). Speech describes the inline-resize behavior; the cursor
 * demos it by dragging the resize handle. The speech doesn't direct
 * the user ("Drag the handle to resize"): it explains a capability,
 * and the cursor demonstrates. Cursor keeps the drag.
 */
import {
  cursorScript,
  safeDragAction,
  compactScript,
  waitForElement,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const hybridEditorResizeStep = buildWalkthroughStep({
  id: "hybrid-editor-resize",
  speech: (
    <>
      <p className="mb-2">
        You can resize images inline, useful when a gel image is huge.
      </p>
      <p>
        One more thing: notes-tab images and results-tab images are
        stored separately even though they&apos;re both linked to the same
        experiment. Notes are your working scratch; results are the
        published output.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorResizeHandle),
  cursorScript: cursorScript(async () => {
    const handle = await waitForElement(
      targetSelector(TOUR_TARGETS.hybridEditorResizeHandle),
    );
    if (!handle) return [];
    // Drag handle ~80px right + down to resize. We pick the handle
    // itself as both source and dest for the drag; the destination
    // delta is applied via the synthetic mousemove sequence in
    // BeakerBotCursor. A future polish (P13) can let the drag
    // primitive take explicit (dx, dy) offsets rather than two
    // elements.
    const drag = await safeDragAction(
      targetSelector(TOUR_TARGETS.hybridEditorResizeHandle),
      targetSelector(TOUR_TARGETS.hybridEditorResizeHandle),
    );
    return compactScript([drag]);
  }),
  completion: manualAdvance("Got it, next"),
});
