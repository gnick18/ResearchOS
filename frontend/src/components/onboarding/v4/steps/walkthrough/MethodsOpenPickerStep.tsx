/**
 * §6.4 Methods page, open-picker beat (sub-bot 2026-05-21).
 *
 * Sits BETWEEN category creation (§6.4a) and the type-breadth tour
 * (§6.4b/c). Grant's feedback after testing §6.4 was that the tour
 * jumped straight from finishing the category to a wall of type-breadth
 * speech with no on-screen anchor: the user had no idea where the New
 * Method picker was about to appear. This step inserts a short narrative
 * beat where BeakerBot announces the move ("Now let me show you the
 * kinds of methods you can build. I'm clicking New Method to open the
 * picker.") and the cursor demos clicking the "+ New Method" button.
 * The follow-up type-tour body then takes over with the picker already
 * visible.
 *
 * Cursor responsibility: BEAKERBOT DEMO. Speech literally says "I'm
 * clicking", so the cursor performs the click. The user just watches.
 *
 * Completion: event-driven. The step advances on the
 * `tour:methods-picker-opened` custom DOM event, which `CreateMethodModal`
 * dispatches from a mount-effect. The watch helper also falls back to
 * detecting the picker anchor in the DOM via MutationObserver so a
 * future refactor that drops the dispatch still trips the advance.
 *
 * No artifact (the modal is closed back out before §6.4d so the type
 * picker hover is transient). No expectedRoute beyond `/methods` because
 * the previous step's expectedRoute already landed us there.
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
    "Now let me show you the kinds of methods you can build. I'm clicking New Method to open the picker.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.methodsNewMethodButton),
  cursorScript: cursorScript(async () => {
    const openPicker = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsNewMethodButton),
    );
    return compactScript([openPicker]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/methods",
  // Methods fix manager 2026-05-22: full page-lock during the
  // BeakerBot demo. Cursor click passes through via the
  // `__beakerBotCursorClicking` flag; user clicks outside the speech
  // bubble are blocked so they can't accidentally walk off the tour
  // while the picker is mounting.
  pageLock: {
    allowList: [],
    pillLabel: "BeakerBot is opening the picker, back in a sec.",
  },
});
