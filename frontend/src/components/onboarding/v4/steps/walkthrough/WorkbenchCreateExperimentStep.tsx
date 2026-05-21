/**
 * §6.5 Workbench experiment creation — universal walkthrough.
 *
 * After the funny method lands (§6.4d), BeakerBot navigates to the
 * Workbench page, clicks the New Experiment affordance, types a
 * placeholder experiment name, and saves. Completes on
 * `tasksApi.create` success (polling watcher).
 *
 * The placeholder experiment name is fixed for §6.11 (Search): the
 * search demo types a query matching this name. Keep the constant
 * exported so the search step body can re-use it.
 *
 * Artifact:
 *   { type: "experiment", id: "<taskId>", cleanup_default: "keep" }
 */
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  compactScript,
} from "./lib/cursor-script";
import { advanceOnEvent, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchTaskCreated } from "./lib/tour-events";

/** Placeholder experiment name. Re-used by the §6.11 search step's
 *  cursor-typed query. */
export const PLACEHOLDER_EXPERIMENT_NAME = "Demo Experiment One";

export const workbenchCreateExperimentStep = buildWalkthroughStep({
  id: "workbench-create-experiment",
  speech: "Now let's make an experiment that uses that method.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchNewExperiment),
  cursorScript: cursorScript(async () => {
    const openModal = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchNewExperiment),
    );
    const typeName = await safeTypeAction(
      targetSelector(TOUR_TARGETS.workbenchExperimentNameInput),
      PLACEHOLDER_EXPERIMENT_NAME,
    );
    const submit = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchExperimentSubmit),
    );
    return compactScript([openModal, typeName, submit]);
  }),
  completion: advanceOnEvent(watchTaskCreated),
  expectedRoute: "/workbench",
});
