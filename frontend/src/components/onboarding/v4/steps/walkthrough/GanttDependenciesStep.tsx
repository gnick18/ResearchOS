/**
 * §6.8 Gantt — chained dependencies demo sub-step.
 *
 * BeakerBot programmatically creates 3 placeholder tasks that appear
 * in the Gantt. Cursor drags Demo A onto Demo B, then Demo B onto
 * Demo C. Dependency chain forms. Cursor drags Demo A's bar; B and C
 * shift with it.
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
 * The spawn happens in `onEnter`. Spawning calls `tasksApi.create`
 * directly + appends each task id to the wizard sidecar's
 * `artifacts_created`. P5 ships the spawn helper; the actual sidecar
 * write is routed via the controller's hook in P12 (resume contract),
 * NOT inline here, so the body stays unit-testable.
 *
 * Classification: BEAKERBOT DEMO (per Grant's design correction
 * 2026-05-21). Speech is "Quick demo: I made three throwaway tasks.
 * Watch how dependencies work." Both "I made" (BeakerBot-led API
 * spawn) and "Watch how" (canonical demo signal) are explicit
 * BeakerBot-led promises. Cursor performs the linking drags + the
 * reschedule drag as advertised.
 */
import { tasksApi } from "@/lib/local-api";
import {
  cursorScript,
  safeDragAction,
  compactScript,
} from "./lib/cursor-script";
import { autoAdvanceAfter, buildWalkthroughStep } from "./lib/step-helpers";
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

export const ganttDependenciesStep = buildWalkthroughStep({
  id: "gantt-chained-deps",
  speech: (
    <>
      <p className="mb-2">
        Quick demo: I made three throwaway tasks. Watch how
        dependencies work.
      </p>
      <p>
        Chains move as a unit when you reschedule. Useful for protocol
        stages.
      </p>
    </>
  ),
  pose: "thinking",
  targetSelector: targetSelector(TOUR_TARGETS.ganttTimeline),
  // The actual spawn fires when the controller wires this step's
  // `onEnter` against the active project context. Spawning here would
  // require a project id which the body doesn't have access to in
  // isolation; defer to the registry hookup or a P5+ TourController
  // patch.
  cursorScript: cursorScript(async () => {
    // Drag Demo A onto Demo B: link as dependency. The Gantt surface
    // listens for bar-onto-bar drops and creates a dependency record.
    // Selectors target the demo-task bars by index.
    const linkAB = await safeDragAction(
      "[data-tour-target='gantt-demo-bar-0']",
      "[data-tour-target='gantt-demo-bar-1']",
    );
    const linkBC = await safeDragAction(
      "[data-tour-target='gantt-demo-bar-1']",
      "[data-tour-target='gantt-demo-bar-2']",
    );
    // Drag Demo A right; B + C shift with it via the dependency chain.
    const reschedA = await safeDragAction(
      "[data-tour-target='gantt-demo-bar-0']",
      targetSelector(TOUR_TARGETS.ganttTimeline),
    );
    return compactScript([linkAB, linkBC, reschedA]);
  }),
  completion: autoAdvanceAfter(4500),
  expectedRoute: "/gantt",
});
