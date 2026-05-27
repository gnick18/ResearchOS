/**
 * §6.7 hybrid editor shared helpers — used by the bold / italic /
 * underline / H1 / H2 / H3 sub-steps (HE-5 + HE-6).
 *
 * Hybrid editor manager 2026-05-22. Each typing beat shares the same
 * shape (R2 chip E Fix 3 docstring repair, 2026-05-22):
 *   - On step ENTRY (mount), the TourController's cursorScript effect
 *     immediately begins the script: the cursor types a sample
 *     sentence into a NEW paragraph block at the end of the editor
 *     body, then clicks outside the block so it renders.
 *   - The user reads BeakerBot's "Watch me type..." speech bubble
 *     while the cursor performs the action.
 *   - The step then advances on manualAdvance ("Got it, next"). The
 *     "Got it, next" click does NOT start the typing — typing already
 *     happened on entry; the button only confirms the user is ready
 *     to move on.
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
 * `markdownText` is what the cursor types; the helper prepends three
 * newlines (2 blank lines) so the content lands in its own NEW
 * paragraph block per the triple-newline rule (markdown-block-parser).
 * Without this, every beat in §6.7 piled into the same block and the
 * rendered preview was a wall of unparsed markdown.
 */
export interface HybridTypingStepOpts {
  id: string;
  speech: ReactNode;
  /** Raw markdown the cursor types into the editor. The helper prepends
   *  three newlines (2 blank lines, per the triple-newline rule) so the
   *  content lands in a fresh paragraph block separated from whatever
   *  the editor already contains. */
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
      // Grant feedback 2026-05-26: prior code assumed each sub-beat's
      // wrapper-click would re-enter edit mode on a NEW empty paragraph
      // (so no leading newlines needed). In practice, every beat
      // appended into the SAME block. Result: the rendered preview was
      // one wall of unparsed markdown — `**bold**` showing as literal
      // stars, `# heading` showing as literal hashes, because in the
      // middle of a paragraph that syntax doesn't parse as block-level.
      //
      // Fix: prepend `\n\n\n` (2 blank lines) to every typed chunk.
      // Per the markdown-block-parser triple-newline rule that landed
      // earlier today (b1802d8a chain), 2+ blank lines force a new
      // paragraph block. Each demo beat now lands in its own rendered
      // paragraph so users see bold/italic/heading lock in distinctly
      // after each cursor sequence. First beat picks up some leading
      // whitespace under the auto-generated experiment header — that's
      // cheap cosmetic cost for the clarity gain.
      const PARAGRAPH_BREAK = "\n\n\n";
      const typeAction = await safeTypeAction(
        targetSelector(TOUR_TARGETS.hybridEditorTextarea),
        PARAGRAPH_BREAK + opts.markdownText,
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
    // Universal pacing: on step entry, the cursor immediately types
    // while the user reads BeakerBot's "Watch me type..." speech.
    // After the cursor finishes (and clicks out so the block renders),
    // the user clicks "Got it, next" to advance to the next sub-beat.
    // The pageLock keeps them from interacting with the editor while
    // the cursor is mid-script. (R2 chip E Fix 3 docstring repair.)
    completion: manualAdvance("Got it, next"),
    // Page lock: total (no allow-list). The bubble is implicitly allowed
    // so Skip/Back/Got-it stay reachable. Copy updated R1 fix-pass per
    // verifier C P2-11: less imperative-sounding pill.
    pageLock: { pillLabel: "BeakerBot is typing, back in a sec." },
  });
}
