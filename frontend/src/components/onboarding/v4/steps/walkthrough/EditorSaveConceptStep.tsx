/**
 * §6.7 editor-save-concept (renamed from hybrid-save-concept; the save model
 * is unchanged now that the inline CM6 editor is the sole editor surface).
 *
 * Sits between `inline-editor` and `workbench-notes-intro`. Covers three
 * teaching beats Grant called out on the hand-walk:
 *
 *   1. ResearchOS doesn't auto-save. The user hits Save (top-right of the
 *      editor surface) when they're done.
 *   2. Every save is version-controlled, so the user can look back at past
 *      versions or restore earlier ones.
 *   3. Reassurance: navigating away with unsaved changes triggers a warning
 *      prompt, so work isn't lost by accident.
 *
 * Voice classification: NARRATION. The Save button lives in TaskDetailPopup,
 * not the editor itself (the editor fires onChange on each change; the popup
 * wraps it with a manual "Save notes" affordance). When the Save button isn't
 * a direct editor child we fall back to no-spotlight pure narration. The speech
 * lands cleanly because it's a conceptual beat (no DOM interaction needed).
 *
 * Spotlight: none (pure narration — no spotlight needed for a conceptual beat).
 * Completion: manual ("Got it, next").
 *
 * No artifacts. Pure speech.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { ensureExperimentPopupOpen } from "./lib/on-enter-helpers";

export const editorSaveConceptStep = buildWalkthroughStep({
  id: "hybrid-save-concept",
  speech: (
    <>
      <p className="mb-2">
        One last thing about the editor. ResearchOS doesn&apos;t auto-save,
        so hit <strong>Save</strong> up here when you&apos;re done adding
        notes, results, or anything else.
      </p>
      <p className="mb-2">
        Every save is version-controlled, so you can always look back at
        past versions or restore earlier ones.
      </p>
      <p>
        If you try to navigate away with unsaved changes, you&apos;ll get a
        warning prompt asking to save first. You won&apos;t lose work by
        accident.
      </p>
    </>
  ),
  pose: "pointing",
  // tour-popup-resilience bot 2026-06-03: this is a pure-narration beat
  // about the editor's Save behavior, conceptually "inside" the experiment
  // popup; a mid-tour refresh closes the popup (portal state, not a route).
  // It has no spotlight of its own, but reopening here keeps the popup back
  // for the immediately-following beat and keeps the §6.7 cluster coherent.
  // No-op on the canonical path.
  onEnter: () => ensureExperimentPopupOpen(),
  completion: manualAdvance("Got it, next"),
});
