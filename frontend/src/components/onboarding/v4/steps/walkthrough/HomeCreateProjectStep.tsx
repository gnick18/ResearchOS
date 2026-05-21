/**
 * §6.1 Home page + first project — TRIGGER sub-step.
 *
 * First of two §6.1 sub-steps. BeakerBot points to the home page's
 * "+ New Project" button and waits for the user (or the cursor script's
 * synthetic click) to open the create-project form. Advances the
 * moment `tour:home-create-modal-opened` fires (dispatched by
 * `app/page.tsx` on the button's onClick).
 *
 * Split rationale: Grant's v4 §6.1 walkthrough surfaced that BeakerBot's
 * speech never updated between "click the button" and "the project is
 * created." Splitting into trigger + fill sub-steps lets BeakerBot guide
 * each beat: highlight the button, then explain the name + color + the
 * seven-day-week toggle as soon as the form mounts.
 *
 * Per L11 gentle redirect: any click outside the expected target during
 * this step still works as a real product click (the spotlight is
 * visual, not blocking). The wrong-action handling is driven by the
 * tour controller's `interactedWithCurrentStep` flag, out of scope for
 * this file; the registry hookup is what wires the body in.
 *
 * Artifact tracking lives on the fill sub-step's completion, where the
 * project actually lands. This trigger step creates no artifact.
 */
import { cursorScript, safeClickAction, compactScript } from "./lib/cursor-script";
import {
  buildWalkthroughStep,
  advanceOnEvent,
} from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchHomeCreateModalOpened } from "./lib/tour-events";

export const homeCreateProjectStep = buildWalkthroughStep({
  id: "home-create-project",
  speech:
    "Let's make your first project. Click the blue plus button up there to get started.",
  pose: "pointing-up",
  targetSelector: targetSelector(TOUR_TARGETS.homeNewProject),
  cursorScript: cursorScript(async () => {
    const click = await safeClickAction(
      targetSelector(TOUR_TARGETS.homeNewProject),
    );
    return compactScript([click]);
  }),
  completion: advanceOnEvent(watchHomeCreateModalOpened),
});
