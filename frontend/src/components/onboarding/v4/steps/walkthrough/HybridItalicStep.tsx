/**
 * §6.7 HE-5b — italic typing beat.
 *
 * Hybrid editor manager 2026-05-22. Continuation of the HE-5 read-then-
 * watch sequence: single stars for italic.
 */
import { buildHybridTypingStep } from "./lib/hybrid-editor-helpers";

export const hybridItalicStep = buildHybridTypingStep({
  id: "hybrid-italic",
  speech: (
    <>
      <p className="mb-2">Now an italic sentence, single stars.</p>
      <p className="text-xs text-gray-500">
        Same pattern as bold, the stars disappear when the render lands.
      </p>
    </>
  ),
  markdownText: "*Reagent A is the one expiring Friday.*",
});
