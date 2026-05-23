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
 * This step now does the INTRO + PCR tile click only. The deeper PCR
 * demo (Edit Cycle toggle, Add Cycle modal) lives in two follow-up
 * steps so each cursor script can resolve elements that exist at script
 * build time without the silent-pre-render trick (which doesn't survive
 * non-idempotent state changes like toggling Edit Cycle).
 *
 * Sub-step flow (5 steps total replacing the prior 1):
 *
 *   1. `methods-type-tour` (this file) ─ speech intro + cursor clicks
 *      the PCR tile. PCR editor (`InteractiveGradientEditor`) mounts
 *      inside the same modal (the picker stays visible at the top, the
 *      per-type editor swaps below). Auto-advance after the click.
 *   2. `methods-pcr-edit` ─ cursor clicks the "Edit Cycle" toggle so
 *      the toolbar expands and the Add Cycle button mounts.
 *   3. `methods-pcr-add-cycle` ─ cursor clicks "+ Add Cycle" then the
 *      confirmation modal's "Add" button. A new empty cycle appears in
 *      the gradient flow.
 *   4. `methods-lc-demo` ─ cursor clicks the LC Gradient tile (editor
 *      swaps), glides over the recharts line chart so users see the
 *      hover indicator, then clicks "+ Add step" to demonstrate the
 *      live graph update.
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
 * Cursor responsibility: BEAKERBOT DEMO. Speech literally says "I'll
 * click into one" so the cursor performs the click.
 *
 * Auto-advance after the click. The PCR editor mounts synchronously
 * after the React commit, but we give a small buffer (1500ms) so the
 * user sees the click ripple fade before the next speech bubble lands.
 *
 * No artifact (the modal stays open across sub-steps; the eventual
 * methodsCreateStep saves a Markdown method, this builder pivot
 * persists nothing).
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
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
        I&apos;ll open the PCR builder now. Click around to get a feel
        for it, then hit Got it, next when you&apos;re ready to see the
        LC Gradient one. The wiki has the full reference whenever you
        want details.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.methodsTypePcrTile),
  cursorScript: cursorScript(async () => {
    // Wait for the picker (already visible from the open-picker beat
    // immediately preceding this step; in dev / replay it may already
    // be open). Single click into the PCR tile mounts the builder; the
    // user explores at their own pace after that.
    await waitForElement(targetSelector(TOUR_TARGETS.methodsTypePicker), 3000);
    const clickPcr = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsTypePcrTile),
      2000,
    );
    return compactScript([clickPcr]);
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
  pageLock: {
    allowList: [TOUR_TARGETS.methodsCreateForm],
    pillLabel: "Play with PCR. Hit Got it, next when you're ready.",
  },
  // §6.4b viewport anchor (input-lock + viewport-anchor sub-bot 2026-05-21):
  // the cursor only clicks the small PCR tile, but the user should see
  // the whole CreateMethodModal surface so the tile click context is
  // visible. Using the modal wrapper (methodsCreateForm) rather than a
  // narrower per-builder wrapper because this step is the picker entry —
  // the PCR builder hasn't mounted yet.
  viewportAnchor: targetSelector(TOUR_TARGETS.methodsCreateForm),
});
