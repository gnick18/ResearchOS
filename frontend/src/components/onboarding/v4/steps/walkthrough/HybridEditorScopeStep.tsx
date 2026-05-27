/**
 * §6.7 Hybrid editor scope intro (Wave 1 skeleton, 2026-05-27).
 *
 * NEW step introduced by Grant's 2026-05-27 tour script rewrite. Sits
 * between `hybrid-notes-vs-results` (HE-0) and `hybrid-markdown-intro`
 * (HE-1). Pure narration that frames the editor as a single shared
 * surface used everywhere in ResearchOS (project overviews, standalone
 * notes, method write-ups) so the upcoming markdown deep-dive reads as
 * a one-time investment.
 *
 * Wave 1 ships the skeleton (correct id + voice + manual completion +
 * expectedRoute). Wave 2 will fill in the real speech.
 *
 * Voice classification per the new script: NARRATION
 * Spotlight: none (framing-only beat)
 * Completion: manual ("Got it, next")
 * ExpectedRoute: "/workbench"
 *
 * v4 tour structural manager
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

export const hybridEditorScopeStep = buildWalkthroughStep({
  id: "hybrid-editor-scope",
  speech: "TODO(wave2): hybrid-editor-scope",
  pose: "pointing",
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});
