/**
 * §6.7 HE-5c — underline typing beat.
 *
 * Hybrid editor manager 2026-05-22. Continuation of the HE-5 read-then-
 * watch sequence: underscores for underline.
 */
import { buildHybridTypingStep } from "./lib/hybrid-editor-helpers";

export const hybridUnderlineStep = buildHybridTypingStep({
  id: "hybrid-underline",
  speech: (
    <>
      <p className="mb-2">Underline uses single underscores.</p>
      <p className="text-xs text-gray-500">
        The underscores disappear on render.
      </p>
    </>
  ),
  markdownText: "_Re-order before then._",
});
