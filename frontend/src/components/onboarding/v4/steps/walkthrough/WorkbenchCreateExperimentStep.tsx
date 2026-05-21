/**
 * §6.5 Workbench experiment creation — universal walkthrough.
 *
 * After the funny method lands (§6.4d), BeakerBot points to the
 * Workbench's New Experiment affordance. The user clicks it, fills the
 * name + saves. Completes on `tasksApi.create` success (polling watcher).
 *
 * The placeholder experiment name is fixed for §6.11 (Search): the
 * search demo types a query matching this name. Keep the constant
 * exported so the search step body can re-use it.
 *
 * Classification: USER ACTION (per Grant's design correction 2026-05-21).
 * Speech is "let's make an experiment", invitational, not a "watch me"
 * promise. The brief treats experiment creation as a simple-enough
 * action the user should own (alongside project creation). Cursor does
 * NOT click New Experiment, does NOT type the name, does NOT submit.
 * Spotlight on the New Experiment button gives the visual cue; the
 * user does the rest. Completion still fires on the real API event.
 *
 * Artifact:
 *   { type: "experiment", id: "<taskId>", cleanup_default: "keep" }
 */
import { advanceOnEvent, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchTaskCreated } from "./lib/tour-events";

/** Placeholder experiment name. Re-used by the §6.11 search step's
 *  cursor-typed query. Kept exported so the search step still has a
 *  stable query string even though this step no longer types it
 *  automatically. Most users will name their experiment something
 *  containing "Demo" / "Experiment" / "One" or close enough that the
 *  partial search demo still surfaces results; if not, §6.11's speech
 *  already acknowledges the empty-results case. */
export const PLACEHOLDER_EXPERIMENT_NAME = "Demo Experiment One";

export const workbenchCreateExperimentStep = buildWalkthroughStep({
  id: "workbench-create-experiment",
  speech: "Now let's make an experiment that uses that method.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchNewExperiment),
  // Intentionally no cursorScript: the user creates the experiment.
  // BeakerBot points; spotlight reads; user clicks New Experiment,
  // types their own name, saves. The tasksApi.create event still
  // fires the completion.
  completion: advanceOnEvent(watchTaskCreated),
  expectedRoute: "/workbench",
});
