/**
 * §6.8 Gantt — chained dependencies demo sub-step.
 *
 * BeakerBot programmatically creates 3 placeholder tasks that appear
 * in the Gantt (via `onEnterGanttChainedDeps` on step entry). Cursor
 * drags Demo A onto Demo B, then Demo B onto Demo C, then Demo A onto
 * a future date marker. The dependency edges and the reschedule are
 * applied programmatically via the local APIs so the cascade actually
 * fires (see the docstring on `tasksApi.move`'s usage below + the
 * onEnter helper for the dep-edge wiring); the cursor's drags are the
 * VISUAL narration of those operations.
 *
 * Design call (§12 Q2 in the proposal): the demo task names are
 * BeakerBot-themed per Grant's hint, not bare "Demo A / B / C." The
 * proposal suggests "Beaker A," "Beaker B," "Beaker C" but P5
 * picks "BeakerBot Boil," "BeakerBot Brew," "BeakerBot Sip" — playful,
 * three-word names that fit the coffee theme of §6.4d's funny method.
 * The cleanup grid (P8) shows these names verbatim.
 *
 * Three artifacts:
 *   { type: "demo_dep_task", id: "<taskId-A>", cleanup_default: "discard" }
 *   { type: "demo_dep_task", id: "<taskId-B>", cleanup_default: "discard" }
 *   { type: "demo_dep_task", id: "<taskId-C>", cleanup_default: "discard" }
 *
 * Classification: BEAKERBOT DEMO (per Grant's design correction
 * 2026-05-21). Speech is BeakerBot-led ("Watch me drag this task to a
 * later date. Notice how the chained tasks shift with it"); both the
 * "Watch me drag" framing and the cascade-call-out match what the
 * cursor + the programmatic `tasksApi.move` actually do.
 *
 * Why the actual API calls happen here, not via the cursor's drag
 * (v4 §6.8 cascade polish sub-bot 2026-05-21):
 *   BeakerBotCursor's `dragFromTo` primitive dispatches mouse events
 *   (mousedown/mousemove/mouseup). The Gantt's drop handler listens for
 *   HTML5 DragEvents (onDragStart/onDragOver/onDrop). The cursor's drag
 *   is therefore PURELY VISUAL — it never reaches the Gantt's data
 *   layer. To make the cascade visible (B + C shift right when A
 *   moves), we run the cursor's visual drag in parallel with a real
 *   `tasksApi.move(aId, ...)` call so the rerender lands after the
 *   cursor finishes. The dep-edge creation is similarly delegated to
 *   `onEnterGanttChainedDeps` (see lib/on-enter-helpers.ts).
 */
import { dependenciesApi, projectsApi, tasksApi } from "@/lib/local-api";
import { appQueryClient } from "@/lib/query-client";
import {
  cursorScript,
  safeDragAction,
  compactScript,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const DEP_CHAIN_NAMES = [
  "BeakerBot Boil",
  "BeakerBot Brew",
  "BeakerBot Sip",
] as const;

/** Spawn the three demo dependency-chain tasks. Returns the created
 *  task ids so the caller can record them in the sidecar artifacts
 *  list. Exported for the registry hookup + test seam. */
export async function spawnDemoDependencyTasks(
  projectId: number,
): Promise<number[]> {
  const today = new Date().toISOString().slice(0, 10);
  const ids: number[] = [];
  for (let i = 0; i < DEP_CHAIN_NAMES.length; i++) {
    const name = DEP_CHAIN_NAMES[i];
    const task = await tasksApi.create({
      project_id: projectId,
      name,
      start_date: today,
      duration_days: 1,
      task_type: "list",
      sort_order: i,
    });
    ids.push(task.id);
  }
  return ids;
}

/**
 * Compute the ISO date string for the cascade-reschedule target: today
 * + 7 days. Matches the date GanttChart stamps the
 * `gantt-later-date-marker` attribute on, so the cursor's visual drop
 * and the programmatic `tasksApi.move` land on the SAME date.
 */
function getCascadeTargetDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve the active project's first demo task id (the "A" task —
 * "BeakerBot Boil"). Returns null if the active project / task can't
 * be found; caller treats null as "skip the move" so a partial state
 * doesn't wedge the cursor script. Used by the cursor build callback
 * to fire the actual cascade after the cursor's visual drag completes.
 */
async function resolveDemoTaskAId(): Promise<number | null> {
  try {
    const projects = await projectsApi.list();
    if (!projects.length) return null;
    const sorted = [...projects].sort((a, b) => {
      const cmp = (b.created_at ?? "").localeCompare(a.created_at ?? "");
      if (cmp !== 0) return cmp;
      return b.id - a.id;
    });
    const project = sorted[0];
    if (!project) return null;
    const tasks = await tasksApi.listByProject(project.id);
    const aTask = tasks.find((t) => t.name === DEP_CHAIN_NAMES[0]);
    return aTask?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Idempotency-safe wrapper around the dependency-edge creation. The
 * `onEnter` helper is the canonical place for this, but step bodies
 * are unit-tested in isolation without the registry's onEnter wiring,
 * so a re-create call here is a defensive backup: it's a no-op when
 * the edges already exist (the dependenciesApi.list filter checks
 * parent/child id pairs). Best-effort; failures are logged.
 */
async function ensureDemoDependencies(): Promise<void> {
  try {
    const projects = await projectsApi.list();
    if (!projects.length) return;
    const sorted = [...projects].sort((a, b) => {
      const cmp = (b.created_at ?? "").localeCompare(a.created_at ?? "");
      if (cmp !== 0) return cmp;
      return b.id - a.id;
    });
    const project = sorted[0];
    if (!project) return;
    const tasks = await tasksApi.listByProject(project.id);
    const a = tasks.find((t) => t.name === DEP_CHAIN_NAMES[0]);
    const b = tasks.find((t) => t.name === DEP_CHAIN_NAMES[1]);
    const c = tasks.find((t) => t.name === DEP_CHAIN_NAMES[2]);
    if (!a || !b || !c) return;
    const existing = await dependenciesApi.list(project.id);
    const has = (parentId: number, childId: number): boolean =>
      existing.some(
        (d) => d.parent_id === parentId && d.child_id === childId,
      );
    if (!has(a.id, b.id)) {
      await dependenciesApi.create({
        parent_id: a.id,
        child_id: b.id,
        dep_type: "FS",
      });
    }
    if (!has(b.id, c.id)) {
      await dependenciesApi.create({
        parent_id: b.id,
        child_id: c.id,
        dep_type: "FS",
      });
    }
  } catch (err) {
    console.warn(
      "[onboarding-v4] gantt-chained-deps: ensureDemoDependencies failed",
      err,
    );
  }
}

export const ganttDependenciesStep = buildWalkthroughStep({
  id: "gantt-chained-deps",
  speech: (
    <>
      <p className="mb-2">
        Quick demo: I made three throwaway tasks and wired them into a
        chain.
      </p>
      <p>
        Watch me drag this task to a later date. Notice how the chained
        tasks shift with it, that's the dependency in action.
      </p>
    </>
  ),
  pose: "thinking",
  targetSelector: targetSelector(TOUR_TARGETS.ganttTimeline),
  cursorScript: cursorScript(async () => {
    // Defensive backup: make sure the A→B and B→C edges exist. The
    // canonical creation runs in `onEnterGanttChainedDeps`; this is a
    // no-op when the edges are already in place (the helper checks
    // parent/child id pairs against the existing deps list).
    await ensureDemoDependencies();

    // Drag Demo A onto Demo B: visual link narration. The actual dep
    // record was already created by onEnterGanttChainedDeps; this is
    // BeakerBot-led demonstration ("watch me wire these up").
    const linkAB = await safeDragAction(
      "[data-tour-target='gantt-demo-bar-0']",
      "[data-tour-target='gantt-demo-bar-1']",
    );
    // Drag Demo B onto Demo C: same pattern.
    const linkBC = await safeDragAction(
      "[data-tour-target='gantt-demo-bar-1']",
      "[data-tour-target='gantt-demo-bar-2']",
    );
    // Drag Demo A onto the later-date marker. The marker lands on the
    // day header (today + 7 days) per GanttChart's stamping logic.
    // The cursor's drag is purely visual; the actual reschedule is
    // fired programmatically below so the cascade reaches the data
    // layer and B + C visibly slide right alongside A.
    const reschedA = await safeDragAction(
      "[data-tour-target='gantt-demo-bar-0']",
      targetSelector(TOUR_TARGETS.ganttLaterDateMarker),
    );

    // Schedule the programmatic move to fire AFTER the visual drags
    // finish. The cursor's drags run sequentially via the controller's
    // `runScript`; each safeDragAction's animation takes ~glideMs * 2 +
    // press/release latency (~2100ms). Three drags → ~6300ms; we use
    // an explicit delay (~6500ms) plus a small buffer to be safe. A
    // shorter delay would have B + C cascade BEFORE the cursor's final
    // drop animation reads as "moving A," which would break the
    // narrative.
    //
    // Why setTimeout from inside the build callback (not a new cursor
    // primitive): the cursor's CursorAction union has no `sleep` or
    // `api-call` primitive. The pattern mirrors `GanttIntroStep`'s
    // scheduled Escape keydown — fire-and-forget from the build
    // callback, deterministic delay against a known-length script.
    if (typeof window !== "undefined") {
      const CASCADE_DELAY_MS = 6500;
      window.setTimeout(async () => {
        try {
          const aId = await resolveDemoTaskAId();
          if (aId == null) return;
          await tasksApi.move(aId, {
            new_start_date: getCascadeTargetDate(),
            confirmed: true,
          });
          // Refetch the tasks query so the Gantt's render picks up
          // the new dates for A + cascaded B + C. The tasks query key
          // pattern matches the rest of the app's `tasksApi.move`
          // callsites (handleDrop / handleConfirmShift in GanttChart).
          await appQueryClient.refetchQueries({ queryKey: ["tasks"] });
        } catch (err) {
          console.warn(
            "[onboarding-v4] gantt-chained-deps: programmatic move failed",
            err,
          );
        }
      }, CASCADE_DELAY_MS);
    }

    return compactScript([linkAB, linkBC, reschedA]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  // The cascade reschedule (fired at ~6500ms post-script-start) still
  // lands while the user reads the speech bubble; clicking "Got it,
  // next" advances after the user has seen B and C cascade.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});
