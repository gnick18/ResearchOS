/**
 * §6.7 HE-6b — H2 heading typing beat.
 *
 * Hybrid editor manager 2026-05-22.
 */
import { buildHybridTypingStep } from "./lib/hybrid-editor-helpers";

export const hybridH2Step = buildHybridTypingStep({
  id: "hybrid-h2",
  speech: <p>Two hashes create a slightly smaller header.</p>,
  markdownText: "## Hypothesis",
});
