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
import { dependenciesApi, goalsApi, projectsApi, tasksApi } from "@/lib/local-api";
import { attachImageToTask } from "@/lib/attachments/attach-image";
import { fileService } from "@/lib/file-system/file-service";
import { taskNotesBase } from "@/lib/tasks/results-paths";
import { patchOnboarding } from "@/lib/onboarding/sidecar";
import { appQueryClient } from "@/lib/query-client";
import type { Project, Task } from "@/lib/types";
import {
  DEP_CHAIN_NAMES,
  spawnDemoDependencyTasks,
} from "../GanttDependenciesStep";
import { appendArtifact, encodeTelegramImageId } from "./artifacts";

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
export async function onEnterGanttChainedDeps(ctx: {
  username: string | null;
}): Promise<number[]> {
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
    const spawned = await spawnDemoDependencyTasks(project.id);
    // v4 §6.8 cascade polish sub-bot 2026-05-21: create the A→B and
    // B→C dependency edges here, NOT via cursor drags. BeakerBotCursor's
    // `dragFromTo` primitive dispatches mouse events; the Gantt's
    // bar-onto-bar drop handler (`handleDropOnTask`) listens for HTML5
    // DragEvents, so the cursor's visual drag would not actually create
    // the dep records. Without real edges, the third cursor drag (A
    // onto a later date) would move A in isolation and B + C would
    // stay put — defeating the cascade demo. Creating the edges here
    // means the cursor's first two drags read as "watch me wire these
    // up" while the data is already in place.
    //
    // `dep_type: "FS"` (Finish-to-Start) matches the default branch the
    // user would pick from the dependency-creation popup if they were
    // doing it by hand — see GanttChart's depPopup branches; "FS" is
    // labelled "Start after" which is the most intuitive default for
    // the demo's narrative ("chains move as a unit when you reschedule").
    if (spawned.length === 3) {
      // Wave 1 sidecar hardening manager (v2): destructure into named
      // locals + explicit truthy checks. spawnDemoDependencyTasks types
      // its return as `number[]`; a partial-failure path could still
      // hand us `[undefined, undefined, undefined]` if a downstream
      // refactor stops filtering. Guarding the IDs here means the dep
      // create call below never gets a falsy parent_id / child_id.
      const [aId, bId, cId] = spawned;
      if (!aId || !bId || !cId) {
        console.warn(
          "[onboarding-v4] gantt-chained-deps: spawned ids missing; skip dep create",
          { aId, bId, cId },
        );
      } else {
        try {
          await dependenciesApi.create({
            parent_id: aId,
            child_id: bId,
            dep_type: "FS",
          });
          await dependenciesApi.create({
            parent_id: bId,
            child_id: cId,
            dep_type: "FS",
          });
          // Refresh the Gantt's task + dependency queries so the bars
          // and chain accents mount BEFORE the cursor's first visual
          // drag fires. Without this refetch, the user would briefly
          // see three unlinked bars (then a delayed chain render) which
          // breaks the "I wired them up" narrative.
          await Promise.all([
            appQueryClient.refetchQueries({ queryKey: ["tasks"] }),
            appQueryClient.refetchQueries({ queryKey: ["dependencies"] }),
          ]);
        } catch (err) {
          // Dependency creation failure is non-fatal: the demo still
          // shows three bars, just without the cascade. Surface in the
          // console so authors can spot it during dev.
          console.warn(
            "[onboarding-v4] gantt-chained-deps: dep create failed",
            err,
          );
        }
      }
    } else {
      // Wave 1 sidecar hardening manager (v2): explicit log on the
      // partial-spawn path. Previously a < 3 result silently dropped
      // the dependency-edge creation, leaving the user with N bars and
      // no cascade — defeating the demo with no console trail.
      console.warn(
        "[onboarding-v4] gantt-chained-deps: expected 3 spawned tasks, got",
        spawned.length,
      );
    }
    // Record one `task` artifact per spawned demo so the Phase 4
    // cleanup grid shows three rows under "Tasks" with
    // cleanup_default "discard". Type stays `task` (the brief reconciled
    // the docstring's hypothetical `demo_dep_task` to the canonical
    // `task` type — Phase4CleanupStep groups by type and a one-off
    // `demo_dep_task` would land in the tail "Other" section).
    // Username-gated: a missing user is best-effort, the spawn still
    // ran. cleanup-execution.ts `case "task"` already routes to
    // tasksApi.delete.
    if (ctx.username) {
      for (const taskId of spawned) {
        try {
          await patchOnboarding(ctx.username, (cur) =>
            appendArtifact(cur, {
              type: "task",
              id: String(taskId),
              cleanup_default: "discard",
            }),
          );
        } catch (err) {
          console.warn(
            "[onboarding-v4] gantt-chained-deps artifact persist failed",
            err,
          );
        }
      }
    }
    return spawned;
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
 * Seeds the active experiment's Notes-tab `Images/` folder with
 * BeakerBot's selfie PNG so the image strip below the hybrid editor
 * has something to drag from. Without this, the strip is empty and
 * the cursor script's `${strip} > *:first-child` selector resolves
 * to nothing.
 *
 * Storage location: writes to `taskNotesBase(...)/Images` — i.e.
 * `users/{owner}/results/task-{id}/notes/Images/` — NOT the outer
 * `taskResultsBase/Images`. The Notes tab's `ImageStrip` reads from
 * `attachBase` (= `taskNotesBase` per `TaskDetailPopup.tsx`), so the
 * selfie must live there for the strip to surface it. An earlier
 * revision wrote to `taskResultsBase/Images` (the per-tab split
 * happened after this helper was first authored); the file landed on
 * disk but in the wrong sub-folder, the strip stayed empty, and the
 * cursor's `safeDragAction` had no source to drag from.
 *
 * Idempotency: skip when `Images/beakerbot-selfie.png` already exists
 * under the experiment's NOTES base. The check uses
 * `fileService.fileExists` because `attachImageToTask` auto-suffixes
 * the filename on collision (we'd otherwise end up with
 * `beakerbot-selfie-1.png` on a second visit).
 *
 * The asset is fetched from `/onboarding/beakerbot-selfie.png` (a
 * committed public asset) and piped into `attachImageToTask` with an
 * explicit `basePath` override so the blob lands in
 * `taskNotesBase/Images`. The helper fires `imageEvents.emitAttached`
 * with that same base, so the Notes-tab strip refreshes immediately.
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
  // controller ctx. taskNotesBase requires `{id, owner}` so we
  // synthesize the minimal shape from whichever value is non-empty.
  const owner = experiment.owner || ctx.username || "";
  if (!owner) {
    console.warn(
      "[onboarding-v4] hybrid-editor-image-drop: no owner resolvable; skip",
    );
    return false;
  }
  // Per-tab notes base. The Notes-tab ImageStrip resolves attachments
  // off this path, so it's where the selfie must land. NOT the outer
  // `taskResultsBase` (which is what the legacy shared layout used).
  const notesBase = taskNotesBase({ id: experiment.id, owner });
  try {
    const alreadyThere = await fileService.fileExists(
      `${notesBase}/Images/${SELFIE_FILENAME}`,
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
      // Explicit override: route to the Notes-tab scoped folder so
      // the ImageStrip (which reads `${taskNotesBase}/Images`) sees
      // the file. Default `basePath` resolution would send this to
      // `taskResultsBase/Images`, which the Notes strip ignores.
      basePath: notesBase,
      blob,
      suggestedFilename: SELFIE_FILENAME,
      altText: "BeakerBot selfie",
    });
    // Record the artifact so Phase 4 cleanup can wipe the selfie on
    // tour exit. The id encodes filename + task location via the v3
    // `encodeTelegramImageId` helper — keeps the same `<filename>:task-<id>`
    // shape Phase 4 + cleanup-execution.ts already know how to decode.
    // cleanup_default "discard" because the selfie is a demo asset,
    // not user content (per the brief). Username-gated; sidecar is
    // per-user.
    if (ctx.username) {
      try {
        await patchOnboarding(ctx.username, (cur) =>
          appendArtifact(cur, {
            type: "notes_image",
            id: encodeTelegramImageId(SELFIE_FILENAME, {
              taskId: experiment.id,
            }),
            cleanup_default: "discard",
          }),
        );
      } catch (err) {
        console.warn(
          "[onboarding-v4] hybrid-editor-image-drop artifact persist failed",
          err,
        );
      }
    }
    return true;
  } catch (err) {
    console.warn(
      "[onboarding-v4] hybrid-editor-image-drop selfie spawn failed",
      err,
    );
    return false;
  }
}

/**
 * §6.8 `gantt-goals-overview` placeholder-goal name. Exported for the
 * sub-bot test seam (and so the audit can grep one canonical constant
 * rather than a string scattered across step + cleanup code).
 *
 * The Phase 4 cleanup grid resolves the goal by id (from the artifact
 * entry), not by name; the name is only used here for idempotency
 * (don't double-spawn on a refresh between steps) and for the actual
 * goal label the user sees in the Gantt overlay.
 */
export const GANTT_DEMO_GOAL_NAME = "BeakerBot demo goal";

/**
 * §6.8 `gantt-goals-overview` onEnter.
 *
 * The step's speech promises "Goals visualize over the Gantt" and the
 * cursor clicks the goals affordance. Without a seeded goal, the
 * overlay opens empty and the speech reads as a broken promise. This
 * helper spawns a placeholder personal goal (project-scoped to the
 * active project, NOT lab-wide — keeps the demo scoped to the user's
 * own data) spanning today through ~3 days from today so the goal's
 * Gantt bar overlaps the timeline window the user is looking at.
 *
 * Why project-scoped instead of personal (`project_id: null`):
 *   - Phase 4 cleanup defaults to "discard" for this artifact (the
 *     demo goal isn't useful beyond the tour), and a project-scoped
 *     goal disappears alongside the demo project if the user discards
 *     the whole project tree.
 *   - The Gantt's goal overlay shows project-scoped goals when the
 *     active project filter matches; a `null`-project personal goal
 *     would only show on the "All" filter, which the §6.8 cursor
 *     script doesn't switch to. Project-scope keeps the overlay
 *     visible no matter where the user is in the project filter.
 *
 * Idempotency: skip the spawn if a goal named `GANTT_DEMO_GOAL_NAME`
 * already exists for the active project. A refresh mid-tour re-fires
 * onEnter, so without this guard the user would end up with two,
 * three, N identical placeholder goals.
 *
 * Artifact: appended to the wizard sidecar's `artifacts_created`
 * under `{ type: "goal", id: <goalId>, cleanup_default: "discard" }`
 * so Phase 4 cleanup's existing `case "goal"` branch (see
 * cleanup-execution.ts ~line 200) can delete it on tour exit. The
 * artifact write is guarded by `ctx.username` — without a username
 * we can't address the sidecar, so we skip the artifact write (the
 * goal still spawns; worst-case it sticks around as orphaned demo
 * data, which the user can delete manually).
 *
 * Returns the created goal id (or `null` when skipped / failed).
 * Caller ignores; exposed for the test seam + a future audit pass
 * that wants to confirm the spawn ran.
 */
export async function onEnterGanttGoalsOverview(ctx: {
  username: string | null;
}): Promise<number | null> {
  const project = await getActiveProject();
  if (!project) {
    console.warn(
      "[onboarding-v4] gantt-goals-overview: no active project; skip spawn",
    );
    return null;
  }
  // Idempotency probe: a refresh between steps re-fires onEnter, so
  // we look for an existing demo goal scoped to this project before
  // creating another one.
  try {
    const existing = await goalsApi.list();
    const alreadyPresent = existing.find(
      (g) => g.project_id === project.id && g.name === GANTT_DEMO_GOAL_NAME,
    );
    if (alreadyPresent) return alreadyPresent.id;
  } catch (err) {
    // List failures are not fatal; fall through to create. Worst-
    // case: a duplicate goal lands; cleanup will still wipe whichever
    // id we record in the artifact below.
    console.warn(
      "[onboarding-v4] gantt-goals-overview: goals list probe failed",
      err,
    );
  }

  // Date range: today through today+3 days. Three days is short
  // enough to fit comfortably in the user's current Gantt viewport
  // (most users see a one- to two-week window) but long enough that
  // the goal bar reads as a meaningful range rather than a single-day
  // tick. ISO `YYYY-MM-DD` matches HighLevelGoal.start_date / end_date
  // shape used elsewhere in the app.
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 3);
  const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

  let createdId: number | null = null;
  try {
    const goal = await goalsApi.create({
      project_id: project.id,
      name: GANTT_DEMO_GOAL_NAME,
      start_date: toIsoDate(today),
      end_date: toIsoDate(endDate),
      // Sky-blue palette nod to BeakerBot. Color is optional; passing
      // an explicit value keeps the demo goal visually consistent
      // across runs instead of inheriting whatever the goal overlay
      // assigns by default.
      color: "#38bdf8",
    });
    createdId = goal.id;
  } catch (err) {
    console.warn(
      "[onboarding-v4] gantt-goals-overview: goal create failed",
      err,
    );
    return null;
  }

  // Record the artifact so Phase 4 cleanup can wipe it on tour exit.
  // Guarded by username because the sidecar I/O is per-user; without
  // a username we have no address to write to. Skipping the artifact
  // write doesn't roll back the spawn — the goal stays in the user's
  // store and they can delete it manually if cleanup doesn't reach
  // it — which matches the brief's "best-effort" contract for
  // onEnter helpers. Wave 1 sidecar hardening manager (v2): also guard
  // on `createdId !== null` so a successful spawn with a falsy id
  // (defensive: shouldn't happen with the early-return above, but the
  // typed signature permits it) doesn't append `"null"` to the
  // sidecar's artifact list.
  if (ctx.username && createdId !== null) {
    try {
      await patchOnboarding(ctx.username, (cur) =>
        appendArtifact(cur, {
          type: "goal",
          id: String(createdId),
          // §6.8: demo goal is throwaway; default to discard so the
          // Phase 4 cleanup grid pre-checks it for removal. The user
          // can still flip it to keep at the grid if they want.
          cleanup_default: "discard",
        }),
      );
    } catch (err) {
      console.warn(
        "[onboarding-v4] gantt-goals-overview: artifact persist failed",
        err,
      );
    }
  } else if (ctx.username && createdId === null) {
    console.warn(
      "[onboarding-v4] gantt-goals-overview: createdId null after spawn; skip artifact persist",
    );
  }

  return createdId;
}
