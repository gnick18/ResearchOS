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
 *
 * R1 fix-pass (Hybrid fix manager R1, 2026-05-22): the script now
 * appends an explicit "click out" callback after the type action so
 * the editor's `mousedown`-based click-outside listener commits the
 * block and the rendered markdown lands. Without this, BeakerBot's
 * typed text stayed inside the open textarea (technically committed
 * to React state but not yet rendered as the bold/italic/heading
 * block the user expects to see).
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
  clickOutsideEditorAction,
  callbackAction,
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
 *
 * R1 fix-pass details:
 *   1. The hybrid editor's outer wrapper carries the
 *      `[data-tour-target="hybrid-editor-textarea"]` attribute but the
 *      ACTUAL <textarea> only mounts once a block is being edited.
 *      `BeakerBotCursor.typeInto` now handles the wrapper case by
 *      clicking the wrapper to mount the textarea, then typing into
 *      the descendant <textarea> with `setNativeInputValue` so
 *      React's onChange fires and the markdown actually commits.
 *   2. After typing, a `clickOutsideEditorAction` is queued so the
 *      editor's document-level mousedown click-outside listener
 *      commits the block and renders the markdown. Without this, the
 *      stars/underscores/hashes stayed visible inside the textarea
 *      forever and the user never saw the bold/italic/heading land.
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
        // The first sub-beat lands into a fresh edit block — no leading
        // newlines needed. For subsequent sub-beats the editor commits
        // the prior block (via the click-out below) before this one's
        // wrapper-click re-enters edit mode on a NEW empty paragraph,
        // so we don't need the prior helper's `\n\n` prefix here.
        opts.markdownText,
        25,
      );
      // Click out so the editor's mousedown click-outside listener
      // commits the block and the bold/italic/heading renders. Small
      // delay between type-completion and click-out so the user sees
      // the typed source briefly before it flips to its rendered form.
      const settle = callbackAction(async () => {
        await new Promise<void>((r) => setTimeout(r, 250));
      });
      const clickOut = clickOutsideEditorAction();
      return compactScript([typeAction, settle, clickOut]);
    }),
    // Universal pacing: user reads bubble, clicks Got it, next; cursor
    // then types. The pageLock keeps them from interacting with the
    // editor in the meantime.
    completion: manualAdvance("Got it, next"),
    // Page lock: total (no allow-list). The bubble is implicitly allowed
    // so Skip/Back/Got-it stay reachable. Copy updated R1 fix-pass per
    // verifier C P2-11: less imperative-sounding pill.
    pageLock: { pillLabel: "BeakerBot is typing — back in a sec." },
  });
}
