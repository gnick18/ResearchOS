/**
 * §6.7 HE-6a — H1 heading typing beat.
 *
 * Hybrid editor manager 2026-05-22. First of three header beats. One
 * hash for H1.
 */
import { buildHybridTypingStep } from "./lib/hybrid-editor-helpers";

export const hybridH1Step = buildHybridTypingStep({
  id: "hybrid-h1",
  speech: (
    <p>
      Headers use one hash for H1, two for H2, three for H3. Bigger to
      smaller. Watch the H1 first.
    </p>
  ),
  markdownText: "# This experiment",
});
