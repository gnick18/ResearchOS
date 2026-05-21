/**
 * §6.4b-4 PCR builder, confirm-the-new-cycle beat (v4 sec 6.4b upgrade
 * sub-bot, 2026-05-21).
 *
 * Fourth beat of the deep-PCR demo. The prior step opened the "Add
 * Empty Cycle" confirmation modal (`addingCycle = true` in
 * InteractiveGradientEditor). The cursor here clicks the modal's "Add"
 * button (`data-tour-target="pcr-add-cycle-confirm"`) which fires
 * `handleAddCycle`: appends a new empty cycle container to
 * `gradient.cycles` and closes the modal. The user sees a new
 * purple-ringed cycle container appear in the gradient flow, exactly
 * the kind of "interactive thing" Grant asked the demo to surface.
 *
 * Cursor responsibility: BEAKERBOT DEMO. Speech says "Confirm, and
 * the cycle drops in" so the cursor performs the click.
 *
 * Auto-advance after the click. Budget: ~1180ms click + 500ms for the
 * new cycle block to visibly mount in the flow.
 *
 * No artifact (the PCR draft is discarded when the modal closes; the
 * follow-up methodsLcDemoStep swaps to the LC editor and
 * methodsCreateStep eventually swaps to Markdown and saves there).
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { autoAdvanceAfter, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

/** One click action (~1180ms) + 500ms for the new cycle block render. */
const PCR_CONFIRM_CYCLE_BUDGET_MS = 1700;

export const methodsPcrConfirmCycleStep = buildWalkthroughStep({
  id: "methods-pcr-confirm-cycle",
  speech:
    "Confirm, and the new cycle drops into the flow ready for steps.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.pcrAddCycleConfirm),
  cursorScript: cursorScript(async () => {
    const confirm = await safeClickAction(
      targetSelector(TOUR_TARGETS.pcrAddCycleConfirm),
      3000,
    );
    return compactScript([confirm]);
  }),
  completion: autoAdvanceAfter(PCR_CONFIRM_CYCLE_BUDGET_MS),
  expectedRoute: "/methods",
});

export { PCR_CONFIRM_CYCLE_BUDGET_MS };
