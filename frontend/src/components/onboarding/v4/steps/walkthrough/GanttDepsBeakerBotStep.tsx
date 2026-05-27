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
 *   3. Click "Finish before" in the dep-rule dialog so the dialog closes
 *      and the next step has a clear page.
 *   4. (Real implementation: the dep edge was already created by
 *      onEnter; the cursor's drag + click is the visual narration.)
 *
 * Manual advance — same pattern as the legacy chained-deps step.
 *
 * gantt cluster consolidation manager (2026-05-27, Bug #29): added the
 * "Finish before" click after the drag. Without it the Create
 * Dependency dialog stayed open on screen and blocked the cursor +
 * spotlight on the next step.
 */
import {
  cursorScript,
  safeClickAction,
  safeDragAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import {
  createFakeAToUserDep,
  spawnGanttRedesignFakeTasks,
} from "./lib/gantt-redesign-helpers";
import { ensureFirstExperimentExists } from "./lib/ensure-helpers";

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
    // Tour robustification 2026-05-27 (tour robustification manager):
    // ensure the user's experiment exists BEFORE spawning the fake
    // chain — `createFakeAToUserDep` reads `resolveUserExperiment` and
    // silently no-ops when no user experiment exists (seed-jump past
    // §6.5). The ensure helper closes that gap so the dep edge wires
    // up even on a skipped flow. Canonical flow no-ops the helper.
    await ensureFirstExperimentExists();
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
    // gantt cluster consolidation manager (2026-05-27, Bug #29):
    // close out the Create Dependency dialog that the GanttChart
    // opens whenever a bar-on-bar drag lands. The cursor clicks the
    // "Finish before" button (data-tour-target="gantt-dep-picker-start-before",
    // dep_type "SF") so the dialog dispatches handleCreateDependency
    // and unmounts. The dep edge itself was already wired in onEnter,
    // so this click is purely a UI cleanup beat (a duplicate dep
    // attempt is caught by the existing duplicate-detection branch in
    // GanttChart's handleCreateDependency).
    const clickFinishBefore = await safeClickAction(
      targetSelector(TOUR_TARGETS.ganttDepPickerStartBefore),
    );
    return compactScript([dragOntoUserExp, clickFinishBefore]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});
