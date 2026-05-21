/**
 * §6.4b + §6.4c Methods page, type-breadth tour + Compound explanation.
 *
 * Grant's 2026-05-21 feedback on the previous body: the speech leaned on
 * jargon ("kit", "downstream protocol") and the cursor never visibly
 * demonstrated that each method type is its own editable graphic. The
 * cursor opened the picker and stopped there. This rewrite:
 *
 *  1. Replaces the speech with concrete language, drops "sequencing"
 *     (not a method type) and "Compound" from the hover-tour list since
 *     Compound is hidden from the picker.
 *  2. Adds a clearer Compound paragraph with a concrete two-method
 *     example (PCR + gel electrophoresis) instead of the abstract
 *     "kit / downstream protocol" framing.
 *  3. Adds a real cursor demo: after the picker is open, the cursor
 *     glides to each visible method-type tile in turn (PCR, LC Gradient,
 *     Plate Layout, Cell Culture, Mass Spec, qPCR, Coding) so the user
 *     can see them light up as the cursor passes over. Each glide blocks
 *     for the cursor's configured glideMs (default 1000ms) which acts as
 *     the per-tile pause. No tile is clicked, nothing is saved.
 *
 * The Compound tile is omitted from the hover sweep because the registry
 * marks it `hiddenFromPicker` (compounds are reached by extending an
 * existing method, not as a standalone "+ New Method" choice). The
 * speech still describes Compound prominently so users know it exists.
 *
 * Scope chosen: A (hover sweep across tiles). Scope B (clicking into
 * PCR + LC Gradient builders to demonstrate editable wells / gradient
 * rows, then closing back out) is Grant's "ideal" version but a heavier
 * lift, since it requires navigating into the per-type builders,
 * triggering an edit affordance, and exiting cleanly without persisting.
 * Scope B is documented here as future work; the data-tour-target
 * attributes on the tiles are reusable by a Scope B implementation
 * (they'd add click + nested glide actions on the editor surface).
 *
 * Speech (no em-dashes per Grant's standing rule):
 *
 *   "ResearchOS has structured editors for common lab techniques: PCR,
 *    qPCR, LC Gradient, Plate Layouts, Cell Culture, Mass Spec, and
 *    Coding. Each one is its own editable graphic, not just a text
 *    form. Watch, I'll move across them so you can see what I mean.
 *
 *    There's also a special type called Compound. It bundles multiple
 *    methods together so you don't have to re-attach the same
 *    combination every time. For example: if every experiment in your
 *    lab starts with the same PCR setup followed by the same gel
 *    electrophoresis, make a Compound that includes both. Attach the
 *    Compound to an experiment and you get both methods at once, with
 *    all their defaults pre-filled."
 *
 * Manual advance, no API event to listen for since nothing persists.
 * The cursor narrative is the whole step.
 *
 * No artifact (transient hovers, no save).
 *
 * Classification: BEAKERBOT DEMO. Speech says "Watch, I'll move across
 * them" so the cursor performs the hover sweep.
 */
import {
  cursorScript,
  safeGlideToElementAction,
  compactScript,
  waitForElement,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

/**
 * The kebab-case tile slugs the cursor hovers over, in display order.
 * Matches `methodTypeTourSlug()` in `MethodTypePicker.tsx`. PCR leads
 * since it's the most-recognised technique; the rest follow the
 * registry's "Structured methods" group order. Compound is omitted
 * because the registry hides it from the picker.
 */
export const METHODS_BREADTH_TILE_TARGETS = [
  "method-type-pcr",
  "method-type-lc-gradient",
  "method-type-plate-layout",
  "method-type-cell-culture",
  "method-type-mass-spec",
  "method-type-qpcr",
  "method-type-coding",
] as const;

export const methodsBreadthStep = buildWalkthroughStep({
  id: "methods-type-tour",
  speech: (
    <>
      <p className="mb-2">
        ResearchOS has structured editors for common lab techniques:
        PCR, qPCR, LC Gradient, Plate Layouts, Cell Culture, Mass Spec,
        and Coding. Each one is its own editable graphic, not just a
        text form. Watch, I&apos;ll move across them so you can see
        what I mean.
      </p>
      <p>
        There&apos;s also a special type called Compound. It bundles
        multiple methods together so you don&apos;t have to re-attach
        the same combination every time. For example: if every
        experiment in your lab starts with the same PCR setup followed
        by the same gel electrophoresis, make a Compound that includes
        both. Attach the Compound to an experiment and you get both
        methods at once, with all their defaults pre-filled.
      </p>
    </>
  ),
  pose: "thinking",
  targetSelector: targetSelector(TOUR_TARGETS.methodsTypePicker),
  cursorScript: cursorScript(async () => {
    // Wait for the picker to be visible (the open-picker beat
    // immediately preceding this step opens it; in dev / replay it may
    // already be open).
    await waitForElement(targetSelector(TOUR_TARGETS.methodsTypePicker), 3000);
    // Glide to each tile in sequence. Each glide takes the cursor's
    // configured glideMs (default 1000ms) which provides the per-tile
    // pause without a separate sleep primitive. Tiles that fail to
    // resolve are silently filtered by compactScript, so the demo
    // degrades gracefully if a method type ships hidden in the future.
    const tileGlides = await Promise.all(
      METHODS_BREADTH_TILE_TARGETS.map((slug) =>
        safeGlideToElementAction(`[data-tour-target="${slug}"]`, 2000),
      ),
    );
    return compactScript(tileGlides);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/methods",
});
