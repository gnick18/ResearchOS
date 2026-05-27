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
  // Script rewrite 2026-05-27: absorbs the section intro that previously
  // lived in the dropped `workbench-page-intro` step. Voice stays
  // USER_ACTION (the user clicks the spotlighted "+ New Experiment"
  // button themselves; BeakerBot doesn't drive a cursor here).
  speech: (
    <>
      <p className="mb-2">
        Methods are the recipe. The Workbench is where you actually run
        it.
      </p>
      <p>
        Every experiment you do gets its own entry here, with space for
        notes, results, attached protocols, and files. This is the page
        you&apos;ll spend most of your time on. Click{" "}
        <strong>+ New Experiment</strong> to make your first one.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchNewExperiment),
  // No cursorScript: user-action step.
  completion: advanceOnEvent(watchWorkbenchExperimentModalOpened),
  expectedRoute: "/workbench",
});
