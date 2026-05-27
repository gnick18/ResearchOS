/**
 * §6.5 Workbench experiment creation — open the New Experiment modal
 * (user-action sub-step, Grant 2026-05-21 split).
 *
 * Sits before workbench-create-experiment (demo: type the placeholder
 * name and click Save). The user clicks the spotlighted "+ New
 * Experiment" button to open the modal; the demo step then takes over
 * to type the placeholder experiment name and submit.
 *
 * Classification: USER ACTION. No cursorScript — the user does the
 * click themselves. Same pattern as §6.1 home-create-project and §6.4
 * methods-category-open where the user opens the create form before
 * BeakerBot fills it.
 *
 * Completion: event-driven on `tour:workbench-experiment-modal-opened`,
 * which WorkbenchExperimentsPanel.tsx dispatches from the New Experiment
 * button's onClick. DOM-mount fallback in the watcher handles the case
 * where the modal is already up when the step mounts (e.g. the user
 * clicked during the previous methods-create step before this step took
 * over).
 */
import { advanceOnEvent, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchWorkbenchExperimentModalOpened } from "./lib/tour-events";

export const workbenchCreateExperimentOpenStep = buildWalkthroughStep({
  id: "workbench-create-experiment-open",
  // Script rewrite 2026-05-27 + hand-walk edit 2026-05-27 (Grant): the
  // "Methods are the recipe" framing was dropped; copy reads as a direct
  // workbench intro with the +New Experiment CTA on its own line. Voice
  // stays USER_ACTION.
  speech: (
    <>
      <p className="mb-2">
        The Workbench is where you log your day-to-day lab work. Every
        experiment you run gets its own entry, with space for notes,
        results, attached methods, and files.
      </p>
      <p>
        Click <strong>+ New Experiment</strong> to make your first one.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchNewExperiment),
  // No cursorScript: user-action step.
  completion: advanceOnEvent(watchWorkbenchExperimentModalOpened),
  expectedRoute: "/workbench",
});
