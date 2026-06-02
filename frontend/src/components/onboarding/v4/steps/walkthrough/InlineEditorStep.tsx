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

export const inlineEditorStep = buildWalkthroughStep({
  id: "inline-editor",
  speech: (
    <>
      <p className="mb-2">
        This is a live document: just type, and your{" "}
        <strong>markdown</strong> renders as you go. A{" "}
        <code># </code> starts a heading, <code>**stars**</code> make text
        bold, and a <code>- </code> begins a list. No buttons to hunt for,
        no switching in and out of an edit mode.
      </p>
      <p>
        When you hit a good stopping point, <strong>Save checkpoint</strong>{" "}
        drops a version you can always come back to and revert to later.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.inlineEditorSurface),
  completion: manualAdvance("Got it, next"),
});
