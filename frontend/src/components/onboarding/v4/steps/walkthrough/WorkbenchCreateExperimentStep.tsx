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
import { tasksApi } from "@/lib/local-api";
import { advanceOnEvent, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchTaskCreated } from "./lib/tour-events";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";

const STEP_ID = "workbench-create-experiment";

/** Snapshot of task ids known at step entry. Diffed on exit against
 *  the current task list to identify the experiment the user just
 *  created. Module-level so onEnter + onExit share scope without
 *  re-plumbing TourController context. */
const baselineTaskIds = new Set<number>();

/** Placeholder experiment name. Re-used by the §6.11 search step's
 *  cursor-typed query. Kept exported so the search step still has a
 *  stable query string even though this step no longer types it
 *  automatically. Most users will name their experiment something
 *  containing "Demo" / "Experiment" / "One" or close enough that the
 *  partial search demo still surfaces results; if not, §6.11's speech
 *  already acknowledges the empty-results case. */
export const PLACEHOLDER_EXPERIMENT_NAME = "Demo Experiment One";

export const workbenchCreateExperimentStep = buildWalkthroughStep({
  id: STEP_ID,
  speech: "Now let's make an experiment that uses that method.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchNewExperiment),
  // Intentionally no cursorScript: the user creates the experiment.
  // BeakerBot points; spotlight reads; user clicks New Experiment,
  // types their own name, saves. The tasksApi.create event still
  // fires the completion.
  completion: advanceOnEvent(watchTaskCreated),
  // Snapshot the no-project task ids on enter; the diff on exit
  // identifies the experiment the user created. No DOM event exists
  // for tasksApi.create (the watcher polls listByProject), so we
  // mirror the same polling shape ourselves to find the new id.
  // Project bucket 0 matches `watchTaskCreated`'s `projectId ?? 0`
  // default since the workbench surface creates tasks without a
  // project when none is selected.
  onEnter: async () => {
    baselineTaskIds.clear();
    try {
      const tasks = await tasksApi.listByProject(0);
      for (const task of tasks) baselineTaskIds.add(task.id);
    } catch (err) {
      console.warn(
        "[onboarding-v4] workbench-create-experiment baseline read failed:",
        err,
      );
    }
  },
  onExit: async () => {
    try {
      const tasks = await tasksApi.listByProject(0);
      for (const task of tasks) {
        if (!baselineTaskIds.has(task.id)) {
          pendingArtifactStore.add(STEP_ID, {
            type: "experiment",
            id: String(task.id),
            cleanup_default: "keep",
          });
        }
      }
    } catch (err) {
      console.warn(
        "[onboarding-v4] workbench-create-experiment diff read failed:",
        err,
      );
    }
    baselineTaskIds.clear();
    await flushPendingArtifacts(STEP_ID);
  },
  expectedRoute: "/workbench",
});
