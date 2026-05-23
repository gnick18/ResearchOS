/**
 * §6.4b-5 LC Gradient builder, deep-demo beat (v4 sec 6.4b upgrade
 * sub-bot, 2026-05-21).
 *
 * Fifth and final beat of the deep-builder demos. The cursor:
 *
 *   1. Clicks the LC Gradient tile (`data-tour-target="method-type-lc-
 *      gradient"`) to swap the in-modal editor from
 *      `InteractiveGradientEditor` (PCR) to `LcGradientEditor`.
 *   2. Glides over the recharts line chart
 *      (`data-tour-target="lc-gradient-chart"`) so users see the chart
 *      surface and (in browsers) the recharts hover tooltip showing
 *      the position-in-gradient indicator.
 *   3. Clicks the "+ Add step" footer button
 *      (`data-tour-target="lc-add-step"`) which appends a new step row
 *      to the gradient table. The recharts line chart picks up the new
 *      data point automatically: the exact "watch the graph update as
 *      I change steps" beat Grant called out.
 *
 * Builder pattern (per brief investigation): same modal-in-place
 * pattern as PCR. Clicking the LC tile in the picker swaps the editor
 * below the picker; no route navigation. The PCR draft (with the new
 * cycle from the prior step) is discarded when the editor swaps:
 * acceptable, the modal's eventual save is in methodsCreateStep
 * (Markdown method, not PCR/LC).
 *
 * Silent-pre-render trick (used only for the LC tile swap): at build
 * time we silent-click the LC tile so `LcGradientEditor` mounts and
 * the chart + Add step affordances become resolvable for the cursor
 * action list. Setting `uploadType` to "lc_gradient" when it's already
 * "lc_gradient" is a React no-op (setState with same primitive value
 * doesn't re-render), so the runtime cursor's click on the same tile
 * is purely visual: no doubled swap, no flicker. The trade-off: the
 * user sees the editor swap to LC BEFORE the cursor ripples on the
 * tile (~10ms after step entry). Less jarring than the PCR add-cycle
 * modal pop because the LC swap is a content change inside the open
 * modal, not a new floating dialog appearing. If this reads weird in
 * Grant's review, the natural follow-up split is into a
 * `methods-lc-tile` step + a `methods-lc-edit-graph` step.
 *
 * Cursor responsibility: BEAKERBOT DEMO. Speech says "watch the graph
 * update" so the cursor performs all clicks + the chart hover glide.
 *
 * Manual advance ("Got it, next"). The final beat of the deep-demo
 * arc deserves a user-acknowledged moment before the tour jumps to
 * methodsCreateStep (which picks the Standard Markdown tile and types
 * a funny method body).
 *
 * No artifact (the LC draft is discarded when methodsCreateStep
 * switches back to Markdown).
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
  waitForElement,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const methodsLcDemoStep = buildWalkthroughStep({
  id: "methods-lc-demo",
  speech:
    "And here's the LC Gradient editor. Play around, the chart updates live as you change steps in the table. Click Got it, next when you're ready to keep going.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.methodsTypeLcGradientTile),
  cursorScript: cursorScript(async () => {
    // Grant 2026-05-21 rework: drop the click-LC-tile + glide-chart +
    // click-add-step click-around drama (it moved too fast to follow).
    // The cursor now does a single visible click on the LC tile to
    // mount the editor, and the user explores at their own pace.
    const lcTile = await waitForElement(
      targetSelector(TOUR_TARGETS.methodsTypeLcGradientTile),
      3000,
    );
    if (!lcTile) return [];
    const clickLcTile = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsTypeLcGradientTile),
      2000,
    );
    return compactScript([clickLcTile]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/methods",
  // §6.4b viewport anchor (input-lock + viewport-anchor sub-bot 2026-05-21):
  // anchor the whole LC builder card so users see the recharts line chart
  // update when the cursor clicks "+ Add step". The LC tile click pre-
  // mounts the LcGradientEditor, then the anchor scrolls the whole card
  // (description + chart + table) into view before the cursor demo runs.
  viewportAnchor: targetSelector(TOUR_TARGETS.lcEditorWrapper),
  // Methods fix manager 2026-05-22: allow-list lock so the user can
  // poke around the LC Gradient editor (per the speech bubble's "play
  // around to get a feel for it") but can't accidentally click
  // outside the CreateMethodModal and soft-walk themselves out of the
  // tour. The methodsCreateForm anchor covers the whole modal subtree,
  // including the picker tiles + the just-mounted LcGradientEditor +
  // its recharts line chart + the gradient step table.
  pageLock: {
    allowList: [TOUR_TARGETS.methodsCreateForm],
    pillLabel: "Play with LC Gradient. Hit Got it, next when you're ready.",
  },
});
