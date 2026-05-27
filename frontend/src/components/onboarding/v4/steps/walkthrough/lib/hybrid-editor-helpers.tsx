/**
 * §6.7 hybrid editor shared helpers — used by the bold / italic /
 * underline / H1 / H2 / H3 sub-steps (HE-5 + HE-6).
 *
 * Hybrid editor manager 2026-05-22. Each typing beat shares the same
 * shape:
 *   - On step ENTRY (mount), the TourController's cursorScript effect
 *     immediately begins the script: the cursor first commits any open
 *     edit block (Escape), clicks the editor's "+ Add paragraph"
 *     affordance to spawn a NEW empty edit block, then types a sample
 *     sentence into that block, then clicks outside so the manual-save
 *     buffer settles before the next beat.
 *   - The user reads BeakerBot's "Watch me type..." speech bubble
 *     while the cursor performs the action.
 *   - The step then advances on manualAdvance ("Got it, next").
 *
 * The whole sequence sits behind a `pageLock` (no allow-list) so the
 * user can't accidentally click into the editor between beats.
 *
 * 2026-05-27 paragraph-break fix (hybrid editor demo fix manager) —
 * Grant hand-walk. Prior to this fix every typing beat appended into
 * whichever textarea the previous beat left open (under the manual-
 * save model `clickOutsideEditor` no longer commits + exits edit
 * mode). Result: bold + italic + underline + h1 + h2 + h3 piled into
 * ONE paragraph block as a wall of unparsed markdown. Fix: explicitly
 * dispatch Escape on the active textarea to commit + exit, then click
 * the "+ Add paragraph" button (now stamped with
 * `data-tour-target="hybrid-editor-add-paragraph"`) to spawn a fresh
 * empty block. The `\n\n\n` source-level prepend that was added in
 * R2 chip E Fix is no longer needed because each beat now starts in
 * its own block; we drop it so the typed markdown is clean.
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
  safeClickAction,
  safeTypeAction,
  clickOutsideEditorAction,
  callbackAction,
  compactScript,
} from "./cursor-script";
import { dispatchTourSyntheticEscape } from "./synthetic-escape";

/**
 * Shared shape for one bold/italic/underline/heading typing beat.
 */
export interface HybridTypingStepOpts {
  id: string;
  speech: ReactNode;
  /** Raw markdown the cursor types into the fresh empty paragraph block
   *  spawned by the pre-step "+ Add paragraph" click. No paragraph-
   *  break prefix needed; the per-beat block isolation is now
   *  structural (each beat = one new block via the editor's
   *  "+ Add paragraph" affordance) rather than syntactic. */
  markdownText: string;
}

/**
 * Dispatch a synthetic Escape keydown on whichever textarea inside the
 * hybrid editor currently holds the open edit-block buffer (if any).
 *
 * The editor's `handleEditKeyDown` listens for `e.key === "Escape"` and
 * calls `handleEditBlur`, which commits the buffered edit and unmounts
 * the textarea. Without this commit step, the next beat's
 * `safeTypeAction` would resolve the SAME (still-open) textarea and
 * append its sample sentence into the previous beat's content — every
 * beat piles into a single paragraph block.
 *
 * Implementation notes:
 *  - We dispatch on the *active* textarea inside the editor wrapper, not
 *    on document-level. The editor's keydown handler is attached via
 *    React `onKeyDown` (synthetic event), so we dispatch a real
 *    KeyboardEvent with `bubbles: true` that React's synthetic-event
 *    system picks up.
 *  - If no textarea is open (first beat, fresh document), the helper is
 *    a no-op. The subsequent "+ Add paragraph" click handles the
 *    fresh-block path.
 */
function commitOpenEditAction() {
  return callbackAction(async () => {
    if (typeof document === "undefined") return;
    const wrapper = document.querySelector(
      "[data-tour-target=\"hybrid-editor-textarea\"]",
    );
    if (!(wrapper instanceof HTMLElement)) return;
    const active = wrapper.querySelector("textarea");
    if (!(active instanceof HTMLTextAreaElement)) return;
    try {
      active.focus();
    } catch {
      // No-op.
    }
    // esc-skip-confirm misfire manager (2026-05-27): dispatch via the
    // tour-synthetic helper so TourController's window-level Escape
    // listener skips this event. The textarea's own onKeyDown (in
    // HybridMarkdownEditor) still fires and runs the commit + blur
    // path; only the skip-confirm modal is suppressed.
    dispatchTourSyntheticEscape(active);
    // Give React a tick to commit + unmount the textarea so the next
    // action's "+ Add paragraph" click can re-mount a fresh one.
    await new Promise<void>((r) => setTimeout(r, 60));
  });
}

/**
 * Build one read-then-watch typing step. Universal pacing rule + page
 * lock applied. Manual advance with "Got it, next".
 *
 * Cursor sequence per beat:
 *   1. Escape any open edit (commitOpenEditAction) — no-op on first beat
 *   2. Click "+ Add paragraph" — spawns a fresh empty block + enters
 *      edit mode on it
 *   3. Type the sample markdown into the freshly mounted textarea
 *   4. Brief settle pause so the user reads the source
 *   5. Click outside to fire any non-edit listeners (selection tracking
 *      etc.). Manual-save model means this no longer commits — the next
 *      beat's Escape (step 1) handles that.
 */
export function buildHybridTypingStep(opts: HybridTypingStepOpts): TourStep {
  return buildWalkthroughStep({
    id: opts.id,
    speech: opts.speech,
    pose: "typing-on-laptop",
    targetSelector: targetSelector(TOUR_TARGETS.hybridEditorTextarea),
    // Hand-walk fix 2026-05-27: force the speech bubble to the RIGHT
    // side of the viewport. The hybrid editor's left-side Shortcuts /
    // Style Guide sidebar isn't a popup/dialog, so the auto-flip
    // predicate doesn't know to avoid it. Without this override the
    // bubble lands on the left and covers the sidebar.
    forceBubbleSide: "right",
    cursorScript: cursorScript(async () => {
      // Step 1: commit any currently-open edit block so the next beat
      // starts cleanly. No-op on the first beat (no textarea open).
      const commitOpen = commitOpenEditAction();

      // Step 2: click the editor's "+ Add paragraph" button to spawn a
      // fresh empty paragraph block + enter edit mode on it. The
      // editor's onClick handler on this button (HybridMarkdownEditor.tsx)
      // pushes a new "\n\n" onto the document and begins an edit
      // session on the resulting blank-line block.
      const addParagraph = await safeClickAction(
        targetSelector(TOUR_TARGETS.hybridEditorAddParagraph),
        3000,
      );

      // Step 3: type the demo markdown into the freshly mounted
      // textarea. BeakerBotCursor.typeInto's wrapper-with-input
      // fallback finds the descendant textarea inside the editor
      // wrapper; the "+ Add paragraph" click above has already
      // mounted it via beginEditSession.
      const typeAction = await safeTypeAction(
        targetSelector(TOUR_TARGETS.hybridEditorTextarea),
        opts.markdownText,
        25,
      );

      // Step 4: brief settle so the user reads the source markdown
      // before BeakerBot's bubble pivots to "Got it, next".
      const settle = callbackAction(async () => {
        await new Promise<void>((r) => setTimeout(r, 250));
      });

      // Step 5: click outside the editor. Under the manual-save model
      // this no longer commits the block (that happens via Escape on
      // the NEXT beat's commitOpenEdit). The click-out still fires
      // synthetic listeners (selection tracking, page-lock pill, etc.)
      // and matches the prior cursor-script shape so other steps that
      // observed "type + clickOut" don't regress.
      const clickOut = clickOutsideEditorAction();

      return compactScript([
        commitOpen,
        addParagraph,
        typeAction,
        settle,
        clickOut,
      ]);
    }),
    completion: manualAdvance("Got it, next"),
    pageLock: { pillLabel: "BeakerBot is typing, back in a sec." },
  });
}
