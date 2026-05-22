/**
 * §6.7 hybrid editor shared helpers — used by the bold / italic /
 * underline / H1 / H2 / H3 sub-steps (HE-5 + HE-6).
 *
 * Hybrid editor manager 2026-05-22. Each typing beat shares the same
 * shape:
 *   - Speech: short pose + read-the-bubble copy
 *   - User clicks "Got it, next" → cursor types a sample sentence into
 *     a NEW paragraph block at the end of the editor body → cursor
 *     clicks outside the block so it renders.
 *
 * The whole sequence sits behind a `pageLock` (no allow-list) so the
 * user can't accidentally click into the editor between beats.
 */
import type { ReactNode } from "react";
import {
  buildWalkthroughStep,
  manualAdvance,
} from "./step-helpers";
import type { TourStep } from "../../../step-types";
import { TOUR_TARGETS, targetSelector } from "./targets";
import {
  cursorScript,
  safeTypeAction,
  compactScript,
} from "./cursor-script";

/**
 * Shared shape for one bold/italic/underline/heading typing beat.
 * `markdownText` is what the cursor types; the helper prepends `\n\n`
 * so the typed content lands in a NEW paragraph block under whatever
 * the editor already contains.
 */
export interface HybridTypingStepOpts {
  id: string;
  speech: ReactNode;
  /** Raw markdown the cursor types into the editor. The helper prepends
   *  two newlines so the content lands in a fresh paragraph block. */
  markdownText: string;
}

/**
 * Build one read-then-watch typing step. Universal pacing rule + page
 * lock applied. Manual advance with "Got it, next".
 */
export function buildHybridTypingStep(opts: HybridTypingStepOpts): TourStep {
  return buildWalkthroughStep({
    id: opts.id,
    speech: opts.speech,
    pose: "typing-on-laptop",
    targetSelector: targetSelector(TOUR_TARGETS.hybridEditorTextarea),
    cursorScript: cursorScript(async () => {
      const typeAction = await safeTypeAction(
        targetSelector(TOUR_TARGETS.hybridEditorTextarea),
        // \n\n forces a new paragraph chunk so each sub-beat lands in its
        // own block — matches the §6.7 HE-4 mental model ("each paragraph
        // is a separately editable block").
        `\n\n${opts.markdownText}`,
        25,
      );
      return compactScript([typeAction]);
    }),
    // Universal pacing: user reads bubble, clicks Got it, next; cursor
    // then types. The pageLock keeps them from interacting with the
    // editor in the meantime.
    completion: manualAdvance("Got it, next"),
    // Page lock: total (no allow-list). The bubble is implicitly allowed
    // so Skip/Back/Got-it stay reachable.
    pageLock: { pillLabel: "Watch me type." },
  });
}
