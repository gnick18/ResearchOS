/**
 * §6.4b-2 PCR builder, enter-edit-mode beat (v4 sec 6.4b upgrade
 * sub-bot, 2026-05-21).
 *
 * Second beat of the deep-PCR demo (Grant's "show that these are
 * interactive things" mandate). The prior step (`methods-type-tour`)
 * clicked the PCR tile so `InteractiveGradientEditor` is now mounted
 * inside `CreateMethodModal`. The cursor here clicks the "Edit Cycle"
 * toggle (`data-tour-target="pcr-edit-toggle"` on the EditingToolbar in
 * `InteractiveGradientEditor.tsx`) which flips `isEditing` to true. The
 * toolbar then expands to show the Add Cycle / Add Step / Eraser / Clear
 * All buttons (which the NEXT step `methods-pcr-add-cycle` clicks).
 *
 * Why split this into its own step instead of folding into the next:
 * the Add Cycle button doesn't exist in the DOM until isEditing flips
 * on, so a single cursor script can't resolve both elements at build
 * time. Splitting lets each script run after the prior state mutation
 * has fully committed.
 *
 * Cursor responsibility: BEAKERBOT DEMO. Speech says "Watch. I'm
 * flipping into edit mode" so the cursor performs the click.
 *
 * Auto-advance after the click (~1500ms gives the toolbar expansion
 * animation a beat to land before the next speech bubble).
 *
 * No artifact.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
  waitForElement,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

/** ~1180ms click + 320ms buffer for the toolbar to render new buttons. */
const PCR_EDIT_TOGGLE_BUDGET_MS = 1500;

export const methodsPcrEditStep = buildWalkthroughStep({
  id: "methods-pcr-edit",
  speech:
    "Watch. I'm flipping into edit mode, and the toolbar opens up with Add Cycle, Add Step, and the rest of the editing affordances.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.pcrEditToggle),
  cursorScript: cursorScript(async () => {
    // Wait for the PCR editor to be on screen (the prior step clicked
    // the PCR tile which mounts InteractiveGradientEditor). The Edit
    // Cycle button is always present in the toolbar so this resolves
    // immediately if the React commit has happened.
    const editBtn = await safeClickAction(
      targetSelector(TOUR_TARGETS.pcrEditToggle),
      3000,
    );
    return compactScript([editBtn]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/methods",
  // §6.4b viewport anchor (input-lock + viewport-anchor sub-bot 2026-05-21):
  // the whole PCR builder card (description + Thermal Gradient heading +
  // InteractiveGradientEditor + Reaction Recipe) is the user's intended
  // focus, not just the Edit Cycle toggle.
  viewportAnchor: targetSelector(TOUR_TARGETS.pcrEditorWrapper),
});

/** Helper for tests so the budget constant doesn't need re-exporting
 *  ad hoc (mirrors the export pattern from MethodsBreadthStep). */
export { PCR_EDIT_TOGGLE_BUDGET_MS };

/**
 * Wait helper for tests: returns true if the Edit Cycle toggle is in
 * the DOM. Lets the step-bodies test fixture mount + assert without
 * duplicating the selector string.
 */
export async function waitForPcrEditToggle(timeoutMs?: number) {
  return waitForElement(targetSelector(TOUR_TARGETS.pcrEditToggle), timeoutMs);
}
