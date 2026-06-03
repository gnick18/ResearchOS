/**
 * §6.7 inline editor beat (onboarding-inline collapse 2026-06-02).
 *
 * Replaces the old hybrid markdown deep-dive (HE-1 through HE-11:
 * markdown-intro / familiarity / overview / mechanic / bold / italic /
 * underline / h1 / h2 / h3 / shortcuts / image-attach / image-drag-in /
 * image-resize / file-attach). Those ~15 beats taught the retired hybrid
 * "click a block to edit it, click out to render" interaction and typed
 * into the now-dormant HybridMarkdownEditor, so they were both
 * overcomplicated and broken once the editor went inline-only.
 *
 * The new single beat spotlights the live CodeMirror 6 surface
 * (InlineMarkdownEditor inside LiveMarkdownEditor, stamped with
 * `data-tour-target="inline-editor-surface"`) and teaches the one thing
 * that matters now: it's a live document where you just type markdown and
 * it renders as you go. One closing sentence points at Save checkpoint as
 * the way to drop a version you can revert to.
 *
 * Voice classification: NARRATION. Pure speech + a spotlight on the editor
 * surface, no cursor demo and no user action (the editor is live, so there
 * is nothing to click through).
 *
 * Spotlight: the inline editor surface.
 * Completion: manual ("Got it, next").
 *
 * No artifacts.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { ensureExperimentPopupOpen } from "./lib/on-enter-helpers";

export const inlineEditorStep = buildWalkthroughStep({
  id: "inline-editor",
  speech: (
    <>
      <p className="mb-2">
        This is your editor. Just start typing, and it formats as you go.
        Begin a line with <code># </code> for a heading, or wrap a word in{" "}
        <code>**stars**</code> to make it bold.
      </p>
      <p className="mb-2">
        You always see the finished page while you write, so there is no
        edit mode or preview to switch between.
      </p>
      <p>
        When you reach a good stopping point, hit{" "}
        <strong>Save checkpoint</strong>. It saves a version of your work you
        can jump back to anytime.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.inlineEditorSurface),
  // tour-popup-resilience bot 2026-06-03: this pure-narration beat
  // spotlights the live editor surface, which only renders on the Notes
  // tab inside the experiment popup. A mid-tour refresh closes the popup
  // (portal state, not a route). Reopen it AND activate the Notes tab
  // (the popup opens on Details by default) so the inline-editor-surface
  // spotlight resolves. There's no cursor script here to self-heal the
  // tab, so we drive the tab switch via the reopen helper. No-op on the
  // canonical path where the popup is already open on Notes.
  onEnter: () => ensureExperimentPopupOpen(TOUR_TARGETS.experimentNotesTab),
  completion: manualAdvance("Got it, next"),
});
