/**
 * §6.7 HE-4 — hybrid editor mechanic (universal, narration only).
 *
 * Hybrid editor manager 2026-05-22. Two things to know about this
 * editor:
 *   - While editing a paragraph, the user sees raw markdown.
 *   - The moment they click out, the paragraph renders.
 *
 * Universal step: every HE-2 branch converges here. No cursor demo,
 * spotlights the editor body so the user knows where the mechanic
 * happens.
 *
 * Completion: manual ("Got it, next").
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const hybridEditorMechanicStep = buildWalkthroughStep({
  id: "hybrid-editor-mechanic",
  speech: (
    // Wave 2C speech rewrite (v4 tour speech manager — C, 2026-05-27):
    // tightens to the two-paragraph "raw while editing, renders on
    // click-out" framing from Grant's new script.
    <>
      <p className="mb-2">
        The key thing to know about this editor is how it handles
        formatting.
      </p>
      <p>
        While you&apos;re actively typing inside a block of text,
        you&apos;ll see the raw symbols. The moment you click outside
        of that block, it renders cleanly into formatted text.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorTextarea),
  completion: manualAdvance("Got it, next"),
});
