/**
 * §6.4b-3 PCR builder, click "+ Add Cycle" beat (v4 sec 6.4b upgrade
 * sub-bot, 2026-05-21).
 *
 * Third beat of the deep-PCR demo. By now `isEditing` is true (the
 * prior `methods-pcr-edit` step toggled it), so the Add Cycle button is
 * in the DOM. The cursor clicks "+ Add Cycle" which opens the small
 * "Add Empty Cycle" confirmation modal inside
 * `InteractiveGradientEditor` (`fixed inset-0 z-[60]`). The follow-up
 * `methods-pcr-add-cycle-confirm` step then clicks the modal's Add
 * button to commit and reveal the new cycle block in the gradient flow.
 *
 * Why split the open + confirm into two steps: the confirm button
 * doesn't exist in the DOM until Add Cycle is clicked, so a single
 * cursor script can't resolve both at build time. We could silent-pre-
 * click Add Cycle to materialise the modal, but that opens the modal
 * BEFORE the cursor arrives at the Add Cycle button (visually the
 * user sees the modal appear with no preceding click, and the cursor
 * then clicks on the now-covered Add Cycle button before clicking
 * Add). Splitting into two steps preserves the click-then-modal-then-
 * confirm narrative.
 *
 * Cursor responsibility: BEAKERBOT DEMO. Speech says "I'll add a new
 * thermal cycle" so the cursor performs the click.
 *
 * Auto-advance after the click. Budget: ~1180ms click + 320ms for the
 * modal to mount before the next step's cursor starts moving.
 *
 * No artifact (the new cycle never persists; the modal is closed and
 * the per-type editor is swapped out by methodsLcDemoStep then
 * methodsCreateStep without saving the PCR draft).
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

/** One click action (~1180ms) + 320ms for the confirmation modal mount. */
const PCR_ADD_CYCLE_BUDGET_MS = 1500;

export const methodsPcrAddCycleStep = buildWalkthroughStep({
  id: "methods-pcr-add-cycle",
  speech:
    "Now I'll add a new thermal cycle. ResearchOS opens a small confirmation so a mis-click doesn't change your gradient.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.pcrAddCycle),
  cursorScript: cursorScript(async () => {
    const addCycle = await safeClickAction(
      targetSelector(TOUR_TARGETS.pcrAddCycle),
      3000,
    );
    return compactScript([addCycle]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/methods",
  // §6.4b viewport anchor (input-lock + viewport-anchor sub-bot 2026-05-21):
  // anchor the whole PCR builder card so the user sees the gradient flow
  // change after the Add Cycle confirmation, not just the toolbar button.
  viewportAnchor: targetSelector(TOUR_TARGETS.pcrEditorWrapper),
});

export { PCR_ADD_CYCLE_BUDGET_MS };
