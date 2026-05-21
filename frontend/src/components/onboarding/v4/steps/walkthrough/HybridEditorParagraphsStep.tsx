/**
 * §6.7 Hybrid editor — paragraph chunks demo.
 *
 * Second of four hybrid-editor sub-steps. Per Grant's voice-to-text:
 *
 *   "These paragraph chunks are unique to ResearchOS, each one is a
 *    separate editable block."
 *
 * The cursor hits Enter twice in the editor to start a new paragraph
 * chunk, then types a short sentence into it.
 *
 * No new artifact — the content lands inside the same notes-content
 * artifact tracked at §6.7's last sub-step.
 */
import {
  cursorScript,
  safeTypeAction,
  compactScript,
} from "./lib/cursor-script";
import { autoAdvanceAfter, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

// "\n\n" — start a new paragraph chunk. Then a short sentence in the
// new chunk.
const PARAGRAPH_DEMO =
  "\n\nNew paragraph chunk: each block is independently editable.";

export const hybridEditorParagraphsStep = buildWalkthroughStep({
  id: "hybrid-editor-paragraphs",
  speech:
    "These paragraph chunks are unique to ResearchOS, each one is a separate editable block.",
  pose: "typing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorTextarea),
  cursorScript: cursorScript(async () => {
    const typeParagraph = await safeTypeAction(
      targetSelector(TOUR_TARGETS.hybridEditorTextarea),
      PARAGRAPH_DEMO,
      25,
    );
    return compactScript([typeParagraph]);
  }),
  completion: autoAdvanceAfter(
    Math.ceil(PARAGRAPH_DEMO.length * 25) + 1500,
  ),
});
