/**
 * §6.5 Workbench experiment creation — BeakerBot files the experiment
 * INTO the user's §6.1-created project, then types the placeholder
 * name and clicks Save (demo sub-step, Grant 2026-05-21 split,
 * project-bucket fix by experiment-create sub-bot 2026-05-26).
 *
 * Second beat of the open-then-demo flow. The open step
 * (`workbench-create-experiment-open`, in
 * WorkbenchCreateExperimentOpenStep.tsx) handed off after the user
 * clicked "+ New Experiment" and the modal mounted. This step's cursor
 * then:
 *   1. Selects the user's project in the Project dropdown so the
 *      experiment files into the project the user just created in §6.1
 *      (instead of the default Miscellaneous bucket — that was wrong
 *      both pedagogically and structurally per Grant 2026-05-26).
 *   2. CLEARS the Task Name input via the React-safe setter. The modal
 *      uses a controlled input fed by RHF / form-draft retention (chip
 *      ac4b0640), so a stale draft from a prior modal open lingers in
 *      the field. Without the clear, safeTypeAction would APPEND the
 *      placeholder name on top of the existing text and the final
 *      value would read "Demo Experiment OneDemo Experiment One".
 *   3. Types the placeholder name into the Task Name input.
 *   4. Clicks Create Experiment.
 * Completion fires on the polling `tasksApi.create` watcher.
 *
 * The placeholder experiment name is fixed for §6.11 (Search): the
 * search demo types a query matching this name. Keep the constant
 * exported so the search step body can re-use it.
 *
 * Classification: BEAKERBOT DEMO (Grant 2026-05-21 split). Speech is
 * BeakerBot-led ("watch me file this into your project, name it, save");
 * the cursor performs the select + clear + type + click. Same shape as
 * §6.4-demo (`methodsCategoryDemoStep`).
 *
 * Artifact:
 *   { type: "experiment", id: "<taskId>", cleanup_default: "keep" }
 *
 * The onEnter / onExit baseline-diff logic uses the resolved user
 * project bucket (not project 0). The captured project id is resolved
 * once per step entry and re-used across onEnter, cursorScript, and
 * onExit so all three observe the same bucket.
 */
import { projectsApi, tasksApi } from "@/lib/local-api";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { readOnboarding } from "@/lib/onboarding/sidecar";
import {
  cursorScript,
  safeChangeSelectAction,
  safeClearInputAction,
  safeClickAction,
  safeTypeAction,
  compactScript,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import {
  findArtifact,
  flushPendingArtifacts,
  pendingArtifactStore,
} from "./lib/artifacts";

const STEP_ID = "workbench-create-experiment";

/** Snapshot of task ids known at step entry. Diffed on exit against
 *  the current task list to identify the experiment BeakerBot just
 *  created. Module-level so onEnter + onExit + cursorScript share scope
 *  without re-plumbing TourController context. */
const baselineTaskIds = new Set<number>();

/**
 * Guard flag: true when `onEnter` ran and successfully populated
 * `baselineTaskIds` for the current step visit. Reset to false by
 * `onExit` after the diff runs.
 *
 * Safety net against over-scoping: if the user navigates directly
 * to this step (e.g. via "Skip ahead" or a page refresh that
 * resumes mid-tour), `onEnter` never fired, so `baselineTaskIds`
 * is empty. Without this flag, `onExit` would treat ALL tasks in
 * the project bucket as "newly created by the tour" and incorrectly
 * add pre-existing task ids to `artifacts_created`, causing cleanup
 * to delete data the tour did not create.
 */
let baselineWasTaken = false;

/**
 * Resolved project id for the current step visit. Captured by
 * `resolveTargetProjectId` on `onEnter`, re-used by `cursorScript`
 * (to select the right option in the Project dropdown) and `onExit`
 * (to list tasks in the SAME bucket the experiment landed in for the
 * baseline diff). Reset to null on exit.
 *
 * Initialised to null. `cursorScript` reads it lazily inside the
 * async builder (after `onEnter` has had a chance to run) so the
 * cursor sees the resolved value, not the stale module-level zero.
 */
let resolvedProjectId: number | null = null;

/** Placeholder experiment name. Re-used by the §6.11 search step's
 *  cursor-typed query. The demo step types this string into the Task
 *  Name input verbatim, so the search query in §6.11 always finds the
 *  freshly-created experiment. */
export const PLACEHOLDER_EXPERIMENT_NAME = "Demo Experiment One";

/**
 * Resolve the project id the experiment should file into. Three-level
 * fallback so a missing artifact / sidecar / projects list doesn't
 * wedge the demo:
 *
 *  1. Sidecar `wizard_resume_state.artifacts_created` — the §6.1
 *     home-create-project-fill step stashes the created project id
 *     here via `flushPendingArtifacts` on exit, so by the time §6.5
 *     runs the artifact is on disk. This is the canonical path.
 *  2. projectsApi.list() most-recent non-Miscellaneous, non-archived,
 *     non-shared project. Handles the case where artifact tracking
 *     failed (transient FS error in §6.1's onExit) but the project
 *     itself created fine.
 *  3. Project id 0 (Miscellaneous). Last-resort fallback so the demo
 *     keeps working even if the user has no projects (e.g. resumed
 *     mid-tour after a project delete). Pedagogically wrong but
 *     better than wedging the cursor on a missing select option.
 *
 * Returns null only when both the sidecar read AND the projects list
 * threw — extremely unlikely in practice. Callers treat null as
 * "fall back to project 0" so the demo still produces an experiment.
 */
async function resolveTargetProjectId(): Promise<number | null> {
  // Path 1: sidecar artifact.
  try {
    const username = await getCurrentUserCached();
    if (username && username !== "_no_user_") {
      const sidecar = await readOnboarding(username);
      const projectArtifact = findArtifact(sidecar, "project");
      if (projectArtifact) {
        const id = Number(projectArtifact.id);
        if (Number.isFinite(id) && id > 0) {
          return id;
        }
      }
    }
  } catch (err) {
    console.warn(
      "[onboarding-v4] workbench-create-experiment sidecar project lookup failed:",
      err,
    );
  }

  // Path 2: projects list — most recently created non-Misc project.
  try {
    const projects = await projectsApi.list();
    const candidates = projects.filter(
      (p) =>
        !p.is_archived &&
        !p.is_shared_with_me &&
        p.name !== "Miscellaneous" &&
        !p.is_hidden,
    );
    if (candidates.length > 0) {
      // Sort by created_at desc and take the first (the §6.1 project).
      candidates.sort((a, b) => {
        const aTime = new Date(a.created_at).getTime();
        const bTime = new Date(b.created_at).getTime();
        return bTime - aTime;
      });
      return candidates[0].id;
    }
  } catch (err) {
    console.warn(
      "[onboarding-v4] workbench-create-experiment projects list fallback failed:",
      err,
    );
  }

  // Path 3: no projects at all. Caller treats null as "use bucket 0".
  return null;
}

export const workbenchCreateExperimentStep = buildWalkthroughStep({
  id: STEP_ID,
  speech:
    "Now watch me file this experiment into your project and give it a name.",
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchExperimentNameInput),
  cursorScript: cursorScript(async () => {
    // Lazy-read the resolved project id. `onEnter` ran first and
    // populated this — but if `onEnter` somehow lost a race (rare,
    // would only happen on a resumed-mid-tour edge case where the
    // controller calls cursorScript before onEnter awaited), fall back
    // to a fresh resolve here. Either way, by the time the cursor
    // glides to the select, we have a real project id.
    if (resolvedProjectId === null) {
      resolvedProjectId = await resolveTargetProjectId();
    }

    const actions = [];

    // Beat 1: select the user's project in the dropdown. Skip if we
    // could not resolve a project id (path 3 of resolveTargetProjectId
    // returned null) — leave the select on its default and let the
    // experiment file into Miscellaneous as a last-resort fallback.
    if (resolvedProjectId !== null) {
      const selectProject = await safeChangeSelectAction(
        targetSelector(TOUR_TARGETS.workbenchExperimentProjectSelect),
        String(resolvedProjectId),
      );
      actions.push(selectProject);
    }

    // Beat 2: clear the Task Name input. RHF / form-draft persistence
    // (chip ac4b0640) retains the previous modal's input value across
    // re-mounts; without this, safeTypeAction would APPEND on top of
    // whatever stale text the field already holds and the final value
    // would read "Demo Experiment OneDemo Experiment One".
    const clearName = await safeClearInputAction(
      targetSelector(TOUR_TARGETS.workbenchExperimentNameInput),
    );
    actions.push(clearName);

    // Beat 3: type the placeholder name. 25ms cadence keeps the typing
    // visible without dragging the sequence out (around 0.5 seconds
    // for "Demo Experiment One").
    const typeName = await safeTypeAction(
      targetSelector(TOUR_TARGETS.workbenchExperimentNameInput),
      PLACEHOLDER_EXPERIMENT_NAME,
      25,
    );
    actions.push(typeName);

    // Beat 4: click Create Experiment.
    const submit = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchExperimentSubmit),
    );
    actions.push(submit);

    return compactScript(actions);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
  // Snapshot the task ids in the user's project bucket on enter; the
  // diff on exit identifies the experiment BeakerBot created. No DOM
  // event exists for tasksApi.create (the watcher polls listByProject),
  // so we mirror the same polling shape ourselves to find the new id.
  //
  // Project bucket selection: prefer the resolved user project so the
  // diff sees the new task in the SAME bucket the cursor filed it into.
  // Fall back to bucket 0 (Miscellaneous) only when no user project
  // could be resolved, mirroring the cursor script's last-resort branch.
  onEnter: async () => {
    baselineTaskIds.clear();
    baselineWasTaken = false;
    resolvedProjectId = await resolveTargetProjectId();
    const bucket = resolvedProjectId ?? 0;
    try {
      const tasks = await tasksApi.listByProject(bucket);
      for (const task of tasks) baselineTaskIds.add(task.id);
      // Mark baseline as taken only after a successful read so onExit
      // knows it can safely trust the diff. An empty set is legitimate
      // (no pre-existing tasks in this project) and is fine — we just
      // need to know that onEnter actually ran.
      baselineWasTaken = true;
    } catch (err) {
      console.warn(
        "[onboarding-v4] workbench-create-experiment baseline read failed:",
        err,
      );
    }
  },
  onExit: async () => {
    // Guard: if onEnter never ran for this step visit (e.g. the user
    // arrived via "Skip ahead" or a mid-tour page refresh), skip the
    // diff entirely. An empty baseline would treat ALL existing tasks
    // as tour-created, incorrectly adding pre-existing task ids to
    // artifacts_created and causing cleanup to delete data the tour
    // did not create. cleanup scope fix manager 2026-05-23.
    if (!baselineWasTaken) {
      baselineTaskIds.clear();
      resolvedProjectId = null;
      return;
    }
    const bucket = resolvedProjectId ?? 0;
    try {
      const tasks = await tasksApi.listByProject(bucket);
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
    baselineWasTaken = false;
    resolvedProjectId = null;
    await flushPendingArtifacts(STEP_ID);
  },
  expectedRoute: "/workbench",
});
