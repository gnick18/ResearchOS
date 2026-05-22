/**
 * §6.5 Workbench experiment creation — BeakerBot types the placeholder
 * name and clicks Save (demo sub-step, Grant 2026-05-21 split).
 *
 * Second beat of the open-then-demo flow. The open step
 * (`workbench-create-experiment-open`, in
 * WorkbenchCreateExperimentOpenStep.tsx) handed off after the user
 * clicked "+ New Experiment" and the modal mounted. This step's cursor
 * then types the placeholder experiment name into the Task Name input
 * and clicks Create Experiment. Completion fires on the polling
 * `tasksApi.create` watcher.
 *
 * The placeholder experiment name is fixed for §6.11 (Search): the
 * search demo types a query matching this name. Keep the constant
 * exported so the search step body can re-use it.
 *
 * Classification: BEAKERBOT DEMO (Grant 2026-05-21 split). Speech is
 * "watch me type the name and save" (BeakerBot-led); the cursor
 * performs the type + click. Same shape as §6.4-demo
 * (`methodsCategoryDemoStep`).
 *
 * Artifact:
 *   { type: "experiment", id: "<taskId>", cleanup_default: "keep" }
 *
 * The onEnter / onExit baseline-diff logic preserved from the prior
 * user-action body: the artifact is captured by snapshotting the task
 * ids on step entry and diffing on exit to identify the freshly-created
 * task. Same Phase 4 cleanup behaviour as before — the split changes
 * who clicks, not what gets tracked.
 */
import { tasksApi } from "@/lib/local-api";
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  compactScript,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";

const STEP_ID = "workbench-create-experiment";

/** Snapshot of task ids known at step entry. Diffed on exit against
 *  the current task list to identify the experiment BeakerBot just
 *  created. Module-level so onEnter + onExit share scope without
 *  re-plumbing TourController context. */
const baselineTaskIds = new Set<number>();

/** Placeholder experiment name. Re-used by the §6.11 search step's
 *  cursor-typed query. The demo step types this string into the Task
 *  Name input verbatim, so the search query in §6.11 always finds the
 *  freshly-created experiment. */
export const PLACEHOLDER_EXPERIMENT_NAME = "Demo Experiment One";

export const workbenchCreateExperimentStep = buildWalkthroughStep({
  id: STEP_ID,
  speech: "Now let me name the experiment. Watch.",
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchExperimentNameInput),
  cursorScript: cursorScript(async () => {
    // Grant 2026-05-21 split: the user opens the modal themselves in
    // the previous `workbench-create-experiment-open` step. The demo
    // step's job is JUST to type the placeholder name and click
    // Create Experiment. 25ms cadence keeps the typing visible without
    // dragging the sequence out (~0.5 seconds for "Demo Experiment One").
    const typeName = await safeTypeAction(
      targetSelector(TOUR_TARGETS.workbenchExperimentNameInput),
      PLACEHOLDER_EXPERIMENT_NAME,
      25,
    );
    const submit = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchExperimentSubmit),
    );
    return compactScript([typeName, submit]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
  // Snapshot the no-project task ids on enter; the diff on exit
  // identifies the experiment BeakerBot created. No DOM event exists
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
