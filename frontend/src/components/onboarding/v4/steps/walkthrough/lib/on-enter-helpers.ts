/**
 * Onboarding v4 universal-walkthrough `onEnter` side-effects.
 *
 * Two §6.10 step bodies promise BeakerBot-led demo spawns in their
 * speech ("I made three throwaway tasks", "here's my selfie") but the
 * spawn helpers themselves need the active project / experiment id,
 * which the step body can't resolve in isolation. The registry binding
 * wires those spawns via the step's `onEnter` slot using the helpers
 * here.
 *
 * Why a separate file:
 *   - `step-registry.ts` stays a flat id-to-body map plus a small
 *     conditional patch list; adding two ~30-line spawn closures there
 *     would balloon it.
 *   - Both helpers re-derive the "active project / experiment" via
 *     `projectsApi.list()` / `tasksApi.listByProject()` because the
 *     TourController state doesn't track `activeProjectId` yet (per
 *     the walkthrough docstrings, the active project is implicit:
 *     §6.1 created exactly one project, so "most recently created" is
 *     unambiguous during the walkthrough).
 *   - Each spawn is IDEMPOTENT: a refresh between steps re-fires
 *     onEnter, and we'd double up demo tasks / images otherwise.
 *
 * The TourController catches throws from `onEnter` and logs them at
 * warn level (see TourController.tsx ~line 640). Helpers below also
 * swallow + log internally so a partial failure (e.g. fileService
 * mocked out under jsdom) never wedges the step transition. Worst
 * case: the demo data doesn't appear but the tour keeps moving.
 *
 * HR-dispatched: v4 onEnter wiring sub-bot 2026-05-21.
 */
import { projectsApi, tasksApi } from "@/lib/local-api";
import { attachImageToTask } from "@/lib/attachments/attach-image";
import { fileService } from "@/lib/file-system/file-service";
import { taskResultsBase } from "@/lib/tasks/results-paths";
import type { Project, Task } from "@/lib/types";
import {
  DEP_CHAIN_NAMES,
  spawnDemoDependencyTasks,
} from "../GanttDependenciesStep";

/** Selfie filename written into the experiment's `Images/` folder. The
 *  asset itself lives in `frontend/public/onboarding/beakerbot-selfie.png`
 *  and is reached via `fetch("/onboarding/beakerbot-selfie.png")`. */
export const SELFIE_FILENAME = "beakerbot-selfie.png";

/** Public URL the browser fetches when seeding the selfie blob. */
export const SELFIE_PUBLIC_URL = "/onboarding/beakerbot-selfie.png";

/**
 * Resolve the "active project" for the walkthrough by listing all
 * projects and returning the most-recently-created one. Returns `null`
 * when no project exists (e.g. the user skipped §6.1, the test
 * harness mocks an empty store, etc.). Caller treats null as "skip the
 * spawn"; the tour still advances on the step's own completion path.
 */
async function getActiveProject(): Promise<Project | null> {
  try {
    const projects = await projectsApi.list();
    if (!projects.length) return null;
    // Sort descending by created_at; ties broken by id (newer ids = later).
    const sorted = [...projects].sort((a, b) => {
      const cmp = (b.created_at ?? "").localeCompare(a.created_at ?? "");
      if (cmp !== 0) return cmp;
      return b.id - a.id;
    });
    return sorted[0] ?? null;
  } catch (err) {
    console.warn("[onboarding-v4] getActiveProject failed", err);
    return null;
  }
}

/**
 * Resolve the "active experiment" inside the active project. Picks the
 * most-recently-created `task_type === "experiment"` task. Returns
 * `null` when none exists.
 */
async function getActiveExperiment(projectId: number): Promise<Task | null> {
  try {
    const tasks = await tasksApi.listByProject(projectId);
    const experiments = tasks.filter((t) => t.task_type === "experiment");
    if (!experiments.length) return null;
    // Use task id as the recency proxy: per-user ids are monotonic.
    const sorted = [...experiments].sort((a, b) => b.id - a.id);
    return sorted[0] ?? null;
  } catch (err) {
    console.warn("[onboarding-v4] getActiveExperiment failed", err);
    return null;
  }
}

/**
 * §6.10 `gantt-chained-deps` onEnter.
 *
 * Spawns three throwaway demo tasks (BeakerBot Boil / Brew / Sip) so
 * BeakerBot's "I made three throwaway tasks for you" speech matches
 * what the user sees in the Gantt. Idempotency check: if any task in
 * the active project already has a name in `DEP_CHAIN_NAMES`, skip
 * the spawn entirely. A second visit to the step (refresh mid-tour)
 * therefore reuses the same three tasks instead of producing six.
 *
 * Returns the list of task ids spawned this run (empty array on
 * skip-due-to-idempotency, empty array on missing-project). The
 * registry binding ignores the return; the value is exposed so a
 * future P12 patch can record artifact ids into the sidecar.
 */
export async function onEnterGanttChainedDeps(): Promise<number[]> {
  const project = await getActiveProject();
  if (!project) {
    console.warn(
      "[onboarding-v4] gantt-chained-deps: no active project; skip spawn",
    );
    return [];
  }
  try {
    const existing = await tasksApi.listByProject(project.id);
    const demoNameSet = new Set<string>(DEP_CHAIN_NAMES);
    const alreadyPresent = existing.some((t) => demoNameSet.has(t.name));
    if (alreadyPresent) return [];
    return await spawnDemoDependencyTasks(project.id);
  } catch (err) {
    console.warn(
      "[onboarding-v4] gantt-chained-deps onEnter spawn failed",
      err,
    );
    return [];
  }
}

/**
 * §6.10 `hybrid-editor-image-drop` onEnter.
 *
 * Seeds the active experiment's `Images/` folder with BeakerBot's
 * selfie PNG so the image strip below the hybrid editor has something
 * to drag from. Without this, the strip is empty and the cursor
 * script's `${strip} > *:first-child` selector resolves to nothing.
 *
 * Idempotency: skip when `Images/beakerbot-selfie.png` already exists
 * under the experiment's results base. The check uses
 * `fileService.fileExists` because `attachImageToTask` auto-suffixes
 * the filename on collision (we'd otherwise end up with
 * `beakerbot-selfie-1.png` on a second visit).
 *
 * The asset is fetched from `/onboarding/beakerbot-selfie.png` (a
 * committed public asset) and piped into `attachImageToTask`, which
 * writes the blob into `Images/` and fires
 * `imageEvents.emitAttached` so the strip refreshes immediately.
 *
 * Returns `true` when the spawn ran, `false` when it short-circuited
 * (no experiment, already present, fetch failed). Caller ignores;
 * exposed for the test seam.
 */
export async function onEnterHybridEditorImageDrop(ctx: {
  username: string | null;
}): Promise<boolean> {
  const project = await getActiveProject();
  if (!project) {
    console.warn(
      "[onboarding-v4] hybrid-editor-image-drop: no active project; skip",
    );
    return false;
  }
  const experiment = await getActiveExperiment(project.id);
  if (!experiment) {
    console.warn(
      "[onboarding-v4] hybrid-editor-image-drop: no active experiment; skip",
    );
    return false;
  }
  // Use the task's `owner` if set, else the active username from the
  // controller ctx. taskResultsBase requires `{id, owner}` so we
  // synthesize the minimal shape from whichever value is non-empty.
  const owner = experiment.owner || ctx.username || "";
  if (!owner) {
    console.warn(
      "[onboarding-v4] hybrid-editor-image-drop: no owner resolvable; skip",
    );
    return false;
  }
  const base = taskResultsBase({ id: experiment.id, owner });
  try {
    const alreadyThere = await fileService.fileExists(
      `${base}/Images/${SELFIE_FILENAME}`,
    );
    if (alreadyThere) return false;
  } catch (err) {
    // fileExists failures are not fatal; fall through to the attach
    // attempt which will surface a more useful error if writing fails.
    console.warn(
      "[onboarding-v4] hybrid-editor-image-drop: fileExists probe failed",
      err,
    );
  }
  try {
    const res = await fetch(SELFIE_PUBLIC_URL);
    if (!res.ok) {
      console.warn(
        "[onboarding-v4] hybrid-editor-image-drop: selfie fetch %d",
        res.status,
      );
      return false;
    }
    const blob = await res.blob();
    await attachImageToTask({
      ownerUsername: owner,
      taskId: experiment.id,
      blob,
      suggestedFilename: SELFIE_FILENAME,
      altText: "BeakerBot selfie",
    });
    return true;
  } catch (err) {
    console.warn(
      "[onboarding-v4] hybrid-editor-image-drop selfie spawn failed",
      err,
    );
    return false;
  }
}
