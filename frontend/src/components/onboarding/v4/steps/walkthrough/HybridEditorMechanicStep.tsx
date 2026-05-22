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
    <>
      <p className="mb-2">Two things to know about this editor.</p>
      <p className="mb-2">
        <strong>While you&apos;re editing a paragraph</strong>, you&apos;ll
        see the raw markdown, the symbols and all.
      </p>
      <p className="mb-2">
        <strong>The moment you click out</strong> of a paragraph, it
        renders. Bold becomes bold, headers become headers.
      </p>
      <p>
        This way you always know what&apos;s actually being saved. No
        hidden formatting.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorTextarea),
  completion: manualAdvance("Got it, next"),
});
