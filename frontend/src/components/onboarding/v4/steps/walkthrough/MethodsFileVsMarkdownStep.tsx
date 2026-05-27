/**
 * §6.4b-0 Methods page, file-vs-markdown common-case explainer
 * (methods-cluster sub-bot, 2026-05-26).
 *
 * Grant's 2026-05-26 live-test feedback: the prior methods phase jumped
 * straight from opening the New Method picker into the PCR builder
 * show-off, without telling users how Methods actually works for the
 * common case. Most labs already have protocols written as Word docs
 * or PDFs (or people just copy-paste protocol text), so the two most
 * common ways to add a method are:
 *
 *   (1) Attach a PDF or Word file as a method (drag and drop or upload).
 *   (2) Paste your protocol into the markdown editor for a method that
 *       supports rich formatting, images, and tables.
 *
 * For specific common method types we ALSO have interactive builders
 * that draw live charts and let users tweak parameters. The PCR builder
 * follow-up (`methods-type-tour`) shows that off; this step sets it up
 * by anchoring the user's mental model on the common case first.
 *
 * Cursor responsibility: NARRATION-ONLY. No cursor demo, no clicks. The
 * user reads the bubble, looks at the picker tiles behind it, and clicks
 * "Got it, next" when ready. The spotlight points at the Markdown tile
 * (`method-type-markdown`); the PDF tile is mentioned in the speech but
 * the spotlight primitive renders one rect per step.
 *
 * Completion: manual ("Got it, next"). Universal pacing rule.
 *
 * No artifact (the picker stays mounted across this step into the next).
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const methodsFileVsMarkdownStep = buildWalkthroughStep({
  id: "methods-file-vs-markdown",
  speech: (
    <>
      <p className="mb-2">
        Most labs already have protocols written as Word docs or PDFs,
        or people just copy-paste protocol text. So the two most common
        ways to add a method are: attach a PDF or Word file straight as
        the method (drag and drop or upload), or paste your protocol
        into the markdown editor for a method that supports rich
        formatting, images, and tables.
      </p>
      <p>
        For specific common method types, we also have interactive
        builders that draw live charts and let you tweak parameters.
        Let me show you the PCR builder as an example.
      </p>
    </>
  ),
  pose: "pointing",
  // Spotlight the Markdown tile (the most common option). The PDF tile
  // is named in the speech but the spotlight primitive highlights one
  // rect per step. See note in MethodsFileVsMarkdownStep.tsx header.
  targetSelector: targetSelector(TOUR_TARGETS.methodsTypeMarkdown),
  // No cursorScript on purpose. Narration-only beat.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/methods",
  // Allow the user to read the picker behind the bubble. The page-lock
  // covers the whole modal subtree so a stray click on Markdown or PDF
  // doesn't soft-walk them out of the tour. Same pattern as
  // methodsBreadthStep (the PCR follow-up).
  pageLock: {
    allowList: [TOUR_TARGETS.methodsCreateForm],
    pillLabel: "Read along. Hit Got it, next when you're ready.",
  },
  // Anchor the whole CreateMethodModal so the picker tiles + the
  // upcoming PCR builder card are both visible after the next step
  // mounts. Matches methodsBreadthStep's anchor for visual continuity.
  viewportAnchor: targetSelector(TOUR_TARGETS.methodsCreateForm),
});
