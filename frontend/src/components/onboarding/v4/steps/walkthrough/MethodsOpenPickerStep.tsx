/**
 * §6.7c Methods page, single awareness beat for the purpose-built editors.
 *
 * 2026-06-03 (HR / tour-simplification): collapsed the methods-builder
 * demos 3 to 1. This beat used to be a bridge that opened the picker for a
 * follow-up `methods-type-tour` (PCR builder) + `methods-lc-demo` (LC
 * Gradient) pair. Those two tile demos were cut: the editors drive a
 * self-evident UI, so a single awareness beat is enough. The speech now
 * explains WHAT the purpose-built editors are and WHY to use them; the
 * cursor opens the +New Method catalog so it is visible, then stops and
 * lets the user explore the thermal-cycle builder and the live gradient
 * chart themselves.
 *
 * Cursor responsibility: one click to open the picker so the catalog is
 * on screen. After that the user is free to poke around.
 *
 * Completion: `manualAdvance("Got it, next")`. The user opens an editor
 * and explores at their own pace, then clicks to continue.
 *
 * No artifact (the modal is closed back out before the markdown method is
 * built; the catalog browse is transient). No expectedRoute beyond
 * `/methods` because the previous step's expectedRoute already landed us
 * there. `methods-create` (which follows) opens its own picker via
 * `withNewMethodModalOpen`, so it never relied on this beat leaving the
 * modal open.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import {
  manualAdvance,
  buildWalkthroughStep,
} from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const methodsOpenPickerStep = buildWalkthroughStep({
  id: "methods-open-picker",
  speech:
    "For common techniques like PCR and LC gradients, ResearchOS gives you a purpose-built editor instead of plain text. The thermal-cycle builder and the live gradient chart live in the New Method catalog. Open one and try it whenever you like.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.methodsNewMethodButton),
  cursorScript: cursorScript(async () => {
    const openPicker = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsNewMethodButton),
    );
    return compactScript([openPicker]);
  }),
  // Universal pacing (Grant 2026-05-22): the step waits for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/methods",
  // 2026-06-03 (HR / tour-simplification): the cursor opens the catalog,
  // then the speech invites the user to open an editor and explore. Allow
  // the CreateMethodModal subtree so they can actually click around inside
  // it (matches the lock the cut PCR demo used); clicks outside the modal
  // are still blocked so they can't walk off the tour. The cursor's own
  // opening click passes through via the `__beakerBotCursorClicking` flag.
  pageLock: {
    allowList: [TOUR_TARGETS.methodsCreateForm],
    pillLabel: "Open a builder and explore. Hit Got it, next when you're ready.",
  },
});
