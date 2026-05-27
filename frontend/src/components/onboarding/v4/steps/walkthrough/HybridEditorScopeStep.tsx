/**
 * §6.7 Hybrid editor scope intro (Wave 2C speech rewrite, 2026-05-27).
 *
 * NEW step introduced by Grant's 2026-05-27 tour script rewrite. Sits
 * between `hybrid-notes-vs-results` (HE-0) and `hybrid-markdown-intro`
 * (HE-1). Pure narration that frames the editor as a single shared
 * surface used everywhere in ResearchOS (project overviews, standalone
 * notes, method write-ups) so the upcoming markdown deep-dive reads as
 * a one-time investment.
 *
 * Wave 1 shipped the skeleton (correct id + voice + manual completion +
 * expectedRoute). Wave 2C fills in the real speech per the new script's
 * two-paragraph "About the editor itself..." / "I'll cover markdown
 * basics first..." narration.
 *
 * Voice classification per the new script: NARRATION
 * Spotlight: none (framing-only beat)
 * Completion: manual ("Got it, next")
 * ExpectedRoute: "/workbench"
 *
 * v4 tour speech manager — C
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

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
      <p>
        I&apos;ll cover markdown basics first, then how to drop in
        images and other files.
      </p>
    </>
  ),
  pose: "pointing",
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});
