/**
 * §6.4b Methods page, type-breadth INTRO + PCR builder entry (v4 sec
 * 6.4b upgrade sub-bot, 2026-05-21).
 *
 * Grant's 2026-05-21 feedback on the prior 7-tile hover sweep: "We
 * don't want them to go through all seven. Just show off the PCR and
 * the LC gradient. And I don't just wanna click on it and then show it
 * for a second. Have them show that these are interactive things that
 * are built into the website... three to five things [per builder].
 * Doesn't need to be anything more than 15-20 seconds per step."
 *
 * This step now does the INTRO + PCR tile click + Edit Cycle demo beat.
 * The deeper PCR sub-steps (`methods-pcr-edit`, `methods-pcr-add-cycle`)
 * exist as separate files but are NOT wired into TOUR_STEP_ORDER; this
 * single step is the active PCR demo entry.
 *
 * Sub-step flow:
 *
 *   1. `methods-type-tour` (this file) ─ speech intro; cursor clicks the
 *      PCR tile so `InteractiveGradientEditor` mounts inside the modal,
 *      THEN clicks the "Edit Cycle" toggle. The toolbar expands to show
 *      Add Cycle / Add Step / Eraser buttons, which is the visual
 *      evidence that "these are interactive things" the user can poke.
 *      Free-play follows. Manual advance.
 *   2. `methods-lc-demo` ─ cursor clicks the LC Gradient tile (editor
 *      swaps), user explores.
 *
 * Cursor demo beat (pcr-demo sub-bot 2026-05-26): Grant's fresh-user run
 * found that clicking just the PCR tile and handing off to free-play
 * left users unsure the populated thermal cycle was editable. The Edit
 * Cycle click is the affordance demonstration: when the toggle flips,
 * the toolbar expands with NEW buttons (+ Add Cycle / + Add Step /
 * Gradient Eraser / Cycle Eraser / Clear All) which loudly signals
 * "this is a builder, not a static recipe view." The Edit Cycle click
 * uses `deferredClickAction` because the toggle DOM node only mounts
 * after the prior tile-click commits (script-build-time resolution
 * would miss it).
 *
 * Spotlight target (pcr-demo sub-bot 2026-05-26): targetSelector points
 * at `methodsCreateForm` (the whole modal panel) rather than the small
 * PCR tile. The tile sits at the top of the picker section inside the
 * modal's scrollable content; once the user scrolls down to see the
 * builder, the tile leaves the viewport and TourSpotlight's
 * IntersectionObserver would scroll it back, making the modal's
 * `overflow-y-auto` content feel scroll-locked. The modal panel itself
 * is `fixed` + `max-h-[90vh]` centered in the viewport, so it never
 * leaves the viewport, IO never re-scrolls, and the user can scroll
 * the modal contents freely. Bonus: the spotlight glow around the
 * whole modal reads as "this is your sandbox" which matches the
 * "play around" instruction in the speech bubble.
 *
 * Builder pattern investigation (per brief): CreateMethodModal is a
 * modal-in-place pattern, NOT a route nav. The picker (`MethodTypeCategoryPicker`)
 * renders ALWAYS at the top of the modal regardless of `uploadType`; the
 * per-type editor (PCR / LC Gradient / Plate / etc.) renders conditionally
 * below it. Clicking another tile swaps the editor in the same DOM
 * subtree without navigating. This means the modal stays mounted across
 * all sub-steps, and `methodsCreateStep` (§6.4d) picks up with the same
 * modal still open and just switches the editor back to Markdown.
 *
 * Cursor responsibility: BEAKERBOT DEMO. Speech literally says "Watch
 * me open the PCR builder and flip into edit mode" so the cursor
 * performs both clicks.
 *
 * Manual advance ("Got it, next") so the user has time to poke the
 * builder.
 *
 * No artifact (the modal stays open across sub-steps; the eventual
 * methodsCreateStep saves a Markdown method, this builder pivot
 * persists nothing).
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
  deferredClickAction,
  pause,
  waitForElement,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

/**
 * The two tiles the deep-demo sub-steps visit, in display order. PCR
 * first (it's the most-recognised technique and lands the user in the
 * most visually interesting editor), then LC Gradient (which adds the
 * live-chart hook).
 *
 * Kept as an exported const so the v4 sec 6.4b upgrade tests can assert
 * the demo visits exactly these two tiles and no others (regression
 * guard against re-introducing the 7-tile sweep).
 */
export const METHODS_BREADTH_TILE_TARGETS = [
  "method-type-pcr",
  "method-type-lc-gradient",
] as const;

/** ~700ms gap between the PCR tile click and the Edit Cycle click.
 *  Long enough for the click ripple to fade and for React to commit
 *  the editor mount so the deferred Edit Cycle resolve finds its
 *  target on the first poll. Shorter than 1s so the demo still feels
 *  snappy. */
const PCR_BUILDER_MOUNT_PAUSE_MS = 700;

export const methodsBreadthStep = buildWalkthroughStep({
  id: "methods-type-tour",
  speech: (
    <>
      <p className="mb-2">
        Most method types are interactive builders, not text forms. PCR
        is a thermal cycle builder; LC Gradient draws a live chart;
        Compound bundles multiple methods together so a common combo
        attaches in one shot.
      </p>
      <p>
        Watch me open the PCR builder and flip it into edit mode, the
        toolbar opens up so you can see what&apos;s adjustable. Click
        around to get a feel for it, then hit Got it, next when
        you&apos;re ready to see the LC Gradient one. The wiki has the
        full reference whenever you want details.
      </p>
    </>
  ),
  pose: "pointing",
  // pcr-demo sub-bot 2026-05-26: spotlight tracks the whole modal panel
  // (methodsCreateForm) instead of the small PCR tile. See file header
  // for the scroll-lock rationale.
  targetSelector: targetSelector(TOUR_TARGETS.methodsCreateForm),
  cursorScript: cursorScript(async () => {
    // Wait for the picker (already visible from the open-picker beat
    // immediately preceding this step; in dev / replay it may already
    // be open).
    await waitForElement(targetSelector(TOUR_TARGETS.methodsTypePicker), 3000);
    // 1) Click the PCR tile, which mounts InteractiveGradientEditor
    //    below the picker. Resolves at build time since the tile is
    //    already in the DOM.
    const clickPcr = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsTypePcrTile),
      2000,
    );
    // 2) Brief pause so the click ripple lands and React commits the
    //    PCR editor mount before the next click goes after the Edit
    //    Cycle toggle.
    const mountPause = pause(PCR_BUILDER_MOUNT_PAUSE_MS);
    // 3) Click the Edit Cycle toggle. `deferredClickAction` resolves
    //    the toggle at PLAYBACK time (not build time) because the
    //    toggle DOM node only exists AFTER the prior tile-click
    //    committed the editor mount. Flipping into edit mode expands
    //    the toolbar with Add Cycle / Add Step / Eraser / Clear All
    //    buttons, the visible "this is editable" affordance.
    const clickEditToggle = deferredClickAction(
      targetSelector(TOUR_TARGETS.pcrEditToggle),
      5000,
    );
    return compactScript([clickPcr, mountPause, clickEditToggle]);
  }),
  // Grant 2026-05-21 rework: manual advance so the user has time to
  // poke at the PCR builder + read the speech bubble. The prior
  // 4-sub-step click-around drama moved too fast to follow.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/methods",
  // Methods fix manager 2026-05-22: allow-list lock so the user can
  // poke around the PCR builder (per the speech bubble's "click
  // around to get a feel for it") but can't accidentally click outside
  // the CreateMethodModal / category builder and soft-walk themselves
  // out of the tour. The methodsCreateForm anchor covers the whole
  // modal subtree, including the picker tiles + the just-mounted
  // InteractiveGradientEditor.
  //
  // Scroll note (pcr-demo sub-bot 2026-05-26): TourPageLock blocks
  // clicks only, it does NOT block scroll. Combined with the
  // targetSelector pointing at the modal panel (which stays in the
  // viewport, so TourSpotlight's IO doesn't yank scroll back), the
  // user can scroll the modal's overflow-y-auto content freely during
  // free-play to see the full builder.
  pageLock: {
    allowList: [TOUR_TARGETS.methodsCreateForm],
    pillLabel: "Play with PCR. Hit Got it, next when you're ready.",
  },
  // §6.4b viewport anchor (input-lock + viewport-anchor sub-bot 2026-05-21):
  // the cursor opens the PCR builder, so the user should see the whole
  // CreateMethodModal surface centered before the demo starts. Same as
  // the targetSelector now (pcr-demo sub-bot 2026-05-26).
  viewportAnchor: targetSelector(TOUR_TARGETS.methodsCreateForm),
});
