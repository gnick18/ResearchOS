/**
 * §6.4b + §6.4c Methods page — type-breadth tour + compound method
 * peek. The two sub-steps live in one body because the cursor flow
 * runs continuously: open the type picker, hover across PCR / LC
 * Gradient / Plate / Cell Culture / Mass Spec / qPCR / Sequencing /
 * Coding / Compound, briefly open PCR + LC Gradient builders to show
 * they're editable graphics, then briefly open a Compound method to
 * narrate the bundling idea. No method gets saved here — the cursor
 * always cancels back out before §6.4d takes over.
 *
 * Speech bubble (combined from §6.4b + §6.4c, no em-dashes per Grant's
 * standing rule):
 *
 *   "Quick tour of method types. ResearchOS ships structured editors
 *    for PCR, LC Gradient, Plate layouts, Cell Culture, Mass Spec,
 *    qPCR, Sequencing, Coding, and Compound bundles. Watch the cursor
 *    hover, oh, see how each one is its own editable graphic.
 *
 *    Sometimes you want a kit, a method that combines a blank plate
 *    layout with a downstream protocol. Build it once, reuse it across
 *    experiments. Just FYI for now."
 *
 * Manual advance — there's no API event to listen for since nothing
 * persists; the cursor narrative is the whole step.
 *
 * No artifact (transient hovers, no save).
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
  waitForElement,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const methodsBreadthStep = buildWalkthroughStep({
  id: "methods-type-tour",
  speech: (
    <>
      <p className="mb-2">
        Quick tour of method types. ResearchOS ships structured editors
        for PCR, LC Gradient, Plate layouts, Cell Culture, Mass Spec,
        qPCR, Sequencing, Coding, and Compound bundles. Watch the
        cursor hover, see how each one is its own editable graphic.
      </p>
      <p>
        Sometimes you want a kit: a method that combines a blank plate
        layout with a downstream protocol. Build it once, reuse it
        across experiments. Just FYI for now.
      </p>
    </>
  ),
  pose: "thinking",
  targetSelector: targetSelector(TOUR_TARGETS.methodsTypePicker),
  cursorScript: cursorScript(async () => {
    // Open the "+ New Method" picker.
    const openPicker = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsNewMethod),
    );
    // The picker contains tile-style buttons for each method type. We
    // can't reasonably hover-via-cursor for each one (the cursor API
    // is glide+click+type+drag; there's no hover primitive in P2). The
    // cursor glides to the picker, which is enough to signal "this is
    // where the variety lives." Future refinement: add a hover
    // primitive in P13.
    await waitForElement(targetSelector(TOUR_TARGETS.methodsTypePicker), 2000);
    return compactScript([openPicker]);
  }),
  completion: manualAdvance("Got it, next"),
});
