/**
 * §6.7 hybrid-save-concept (NEW step, hybrid-save-concept manager 2026-05-27).
 *
 * Sits between `hybrid-file-attach` (HE-11, the §6.7 hybrid-editor cluster's
 * old terminal beat) and `workbench-notes-intro` (§6.7b first beat). Covers
 * three teaching beats Grant called out on the hand-walk:
 *
 *   1. ResearchOS doesn't auto-save. The user hits Save (top-right of the
 *      editor surface) when they're done.
 *   2. Every save is version-controlled, so the user can look back at past
 *      versions or restore earlier ones.
 *   3. Reassurance: navigating away with unsaved changes triggers a warning
 *      prompt, so work isn't lost by accident.
 *
 * Voice classification: NARRATION. The Save button lives in TaskDetailPopup,
 * not HybridMarkdownEditor itself (the editor is auto-save-on-change via
 * onChange; the popup wraps it with a manual "Save notes" affordance). Per
 * the hybrid-save-concept manager brief, when the Save button isn't a direct
 * editor child we fall back to no-spotlight pure narration rather than reach
 * across into TaskDetailPopup just to stamp a tour-target. The speech still
 * lands cleanly because it's a conceptual beat (no DOM interaction needed).
 *
 * Spotlight: none (fallback per brief — "Otherwise, fall back to no spotlight
 *   + just speech.").
 * Completion: manual ("Got it, next").
 *
 * No artifacts. Pure speech.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { ensureExperimentPopupOpen } from "./lib/on-enter-helpers";

export const hybridSaveConceptStep = buildWalkthroughStep({
  id: "hybrid-save-concept",
  speech: (
    <>
      <p className="mb-2">
        One last thing about the editor: ResearchOS doesn&apos;t auto-save.
        Hit <strong>Save</strong> up here when you&apos;re done adding
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
  // for the immediately-following `hybrid-focus-exit` beat (which clicks a
  // popup-internal control) and keeps the §6.7 cluster coherent. No-op on
  // the canonical path.
  onEnter: () => ensureExperimentPopupOpen(),
  completion: manualAdvance("Got it, next"),
});
