/**
 * §6.7 HE-9 — drag the attached image into the editor body (USER action).
 *
 * Grant feedback 2026-05-26: previously this step had BeakerBot's cursor
 * perform the drag itself. Grant: "let's change it to get the user to
 * drag and drop the image into the markdown file as opposed to having
 * feature bot do it for them. I think this would teach them better."
 *
 * Wave 2C speech rewrite (v4 tour speech manager — C, 2026-05-27):
 * applies Grant's BEAKERBOT_TOUR_SCRIPT_REWRITE_2026-05-27.md copy —
 * one tight sentence about dragging the just-attached image into the
 * notes so it renders exactly where the user wants it.
 *
 * New shape: pure narration step that tells the user what to try, with
 * the spotlight on the image strip so they know where to drag FROM.
 * Manual advance on "Got it, next" — the user does the drop, then
 * clicks the pill when they're satisfied with where it landed.
 *
 * No cursorScript. No page-lock. No fallback snippet writer (the user's
 * own drag triggers the editor's real drop handler, which writes the
 * markdown snippet through the production code path).
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const hybridImageDragInStep = buildWalkthroughStep({
  id: "hybrid-image-drag-in",
  speech: (
    <p>
      Once an image is attached, you can drag it directly into your
      notes so it renders exactly where you want it in your writeup.
    </p>
  ),
  pose: "pointing",
  // Spotlight the image strip so the user knows where to drag FROM.
  // Without a cursor demo this is the only visual cue.
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorImageStrip),
  // No cursorScript: the user performs the drag themselves. The editor's
  // production drop handler writes the markdown snippet through the
  // normal code path (no tour-specific fallback needed).
  completion: manualAdvance("Got it, next"),
});
