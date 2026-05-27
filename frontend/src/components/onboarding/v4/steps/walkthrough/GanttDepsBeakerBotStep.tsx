/**
 * §6.8 Gantt — BeakerBot wires Fake A → user_experiment as a dependency
 * (Gantt redesign 2026-05-22, Gantt manager).
 *
 * Replaces the FIRST half of the legacy `gantt-chained-deps` step. The
 * legacy step had BeakerBot wire an entire A→B→C chain in one beat;
 * the new arc splits the teaching: BeakerBot wires ONE dep (this step),
 * then the user wires the second dep themselves (gantt-deps-user), then
 * BeakerBot moves the head of the chain so the user sees the cascade
 * (gantt-deps-cascade).
 *
 * onEnter:
 *   1. Spawn Fake experiment A + Fake experiment B in the user's most
 *      recent project (idempotent on name).
 *   2. Create the A → user_experiment dep edge in-data so the cursor's
 *      visual drag has a real edge to narrate.
 *
 * Cursor:
 *   1. Glide to Fake A's bar.
 *   2. Drag Fake A onto the user's experiment bar.
 *   3. (Real implementation: the dep edge was already created by
 *      onEnter; the cursor's drag is the visual narration.)
 *
 * Manual advance — same pattern as the legacy chained-deps step.
 */
import {
  cursorScript,
  safeDragAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import {
  createFakeAToUserDep,
  spawnGanttRedesignFakeTasks,
} from "./lib/gantt-redesign-helpers";

export const ganttDepsBeakerBotStep = buildWalkthroughStep({
  id: "gantt-deps-beakerbot",
  speech: (
    <>
      <p className="mb-2">
        Dependencies ensure you don't schedule an experiment before you
        have the necessary prerequisites. I'm linking "Fake A" so it
        has to finish before your experiment can start.
      </p>
      <p>Notice the arrow pointing from A to your experiment.</p>
    </>
  ),
  pose: "thinking",
  targetSelector: targetSelector(TOUR_TARGETS.ganttBarFakeA),
  onEnter: async (ctx) => {
    await spawnGanttRedesignFakeTasks(ctx);
    // Edge wiring is sequenced AFTER the spawn so the dep references
    // the freshly-created Fake A id.
    await createFakeAToUserDep(ctx);
  },
  cursorScript: cursorScript(async () => {
    // Visual narration of the dep we just wired in data. The drag's
    // mouse events don't trigger the Gantt's HTML5-DragEvent drop
    // handler (mismatch documented in the legacy GanttDependenciesStep
    // docstring); the cursor is the user-facing "watch me do it" beat
    // while the actual edge already exists.
    const dragOntoUserExp = await safeDragAction(
      targetSelector(TOUR_TARGETS.ganttBarFakeA),
      targetSelector(TOUR_TARGETS.ganttBarUserExperiment),
    );
    return compactScript([dragOntoUserExp]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});
