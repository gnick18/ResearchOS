/**
 * §6.7 HE-5c — underline typing beat.
 *
 * Hybrid editor manager 2026-05-22. Continuation of the HE-5 read-then-
 * watch sequence: underscores for underline.
 */
import { buildHybridTypingStep } from "./lib/hybrid-editor-helpers";

export const hybridUnderlineStep = buildHybridTypingStep({
  id: "hybrid-underline",
  speech: <p>Underline uses single underscores.</p>,
  markdownText: "_Re-order before then._",
});
