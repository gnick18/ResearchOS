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
 *
 * Page lock (Methods fix manager 2026-05-22): allow-listed lock so the
 * user must click the spotlighted "+ New Category" button. Other clicks
 * are intercepted and flash an "Oops, click + New Category" speech
 * bubble for 2 seconds. Pattern mirrors §6.8 GanttDepsUserStep: a
 * speech component that toggles the page-lock on mount and clears it
 * on unmount via the optional TourController hook. The speech bubble
 * itself always passes through (so Skip / Back / Got-it stay reachable).
 */
import { useEffect } from "react";
import { advanceOnEvent, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchMethodsCategoryModalOpened } from "./lib/tour-events";
import { useOptionalTourController } from "../../TourController";

/**
 * Inline speech component. Toggles the imperative page-lock allow-list
 * + wrong-click flash speech on mount; clears it on unmount. The user-
 * facing copy stays in this component (so back-stepping into the step
 * re-mounts the component and re-installs the lock with fresh speech).
 *
 * Pattern matches GanttDepsUserStep.tsx — kept consistent across the
 * v4 user-action steps so a future contributor adding a similar step
 * has one shape to copy.
 */
function MethodsCategoryOpenSpeech() {
  const controller = useOptionalTourController();
  useEffect(() => {
    // Optional controller — when this body renders outside a
    // TourControllerProvider (in step-bodies.test rendering speech in
    // isolation), skip the page-lock wiring entirely.
    if (!controller) return;
    controller.setPageLock(
      [TOUR_TARGETS.methodsNewCategoryButton],
      (
        <>
          <p className="mb-1">Oops, that&apos;s not the right thing.</p>
          <p>
            Click <strong>+ New Category</strong> up at the top of the
            Methods page so we can set up your first category.
          </p>
        </>
      ),
    );
    return () => {
      controller.clearPageLock();
    };
  }, [controller]);
  return (
    <p className="mb-2">
      First, click <strong>+ New Category</strong> up here to open the
      form. I&apos;ll take it from there.
    </p>
  );
}

export const methodsCategoryOpenStep = buildWalkthroughStep({
  id: "methods-category-open",
  speech: () => <MethodsCategoryOpenSpeech />,
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.methodsNewCategoryButton),
  // No cursorScript: user-action step.
  completion: advanceOnEvent(watchMethodsCategoryModalOpened),
  expectedRoute: "/methods",
});
