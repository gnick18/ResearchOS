/**
 * §6.4 Methods page — open New Category modal (user-action sub-step,
 * Grant 2026-05-21 rethink).
 *
 * Sits between methods-category-prompt (picker) and methods-category
 * (demo: type + Create Empty). The user clicks the spotlighted "+ New
 * Category" button to open the modal; the demo step then takes over
 * to type the picked label and submit.
 *
 * Classification: USER ACTION. No cursorScript — the user does the
 * click themselves. Same pattern as §6.1 home-create-project where the
 * user opens the project create form before BeakerBot fills it.
 *
 * Completion: event-driven on `tour:methods-category-modal-opened`,
 * which methods/page.tsx dispatches from the New Category button's
 * onClick. DOM-mount fallback in the watcher handles the case where
 * the modal is already up when the step mounts (e.g. the user clicked
 * during the prompt before this step took over).
 */
import { advanceOnEvent, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchMethodsCategoryModalOpened } from "./lib/tour-events";

export const methodsCategoryOpenStep = buildWalkthroughStep({
  id: "methods-category-open",
  speech:
    "First, click + New Category up here to open the form. I'll take it from there.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.methodsNewCategoryButton),
  // No cursorScript: user-action step.
  completion: advanceOnEvent(watchMethodsCategoryModalOpened),
  expectedRoute: "/methods",
});
