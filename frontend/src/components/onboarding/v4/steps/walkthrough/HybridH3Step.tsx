/**
 * §6.7 HE-6c — H3 heading typing beat.
 *
 * Hybrid editor manager 2026-05-22.
 */
import { buildHybridTypingStep } from "./lib/hybrid-editor-helpers";

export const hybridH3Step = buildHybridTypingStep({
  id: "hybrid-h3",
  speech: <p>Three hashes create an even smaller header.</p>,
  markdownText: "### Notes",
});
