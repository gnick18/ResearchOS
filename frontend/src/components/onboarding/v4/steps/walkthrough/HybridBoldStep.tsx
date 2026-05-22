/**
 * §6.7 HE-5a — bold typing beat.
 *
 * Hybrid editor manager 2026-05-22. Read-then-watch sequence: user
 * reads the bubble, clicks "Got it, next", cursor types a bold
 * sentence wrapped in `**` in a new paragraph block. Page lock is on
 * for the whole step so a stray click into the editor can't race the
 * cursor's typing.
 */
import { buildHybridTypingStep } from "./lib/hybrid-editor-helpers";

export const hybridBoldStep = buildHybridTypingStep({
  id: "hybrid-bold",
  speech: (
    <p>
      Watch me write a bold sentence. I&apos;ll wrap the words in two
      stars on each side.
    </p>
  ),
  markdownText: "**The pipettes are calibrated this morning.**",
});
