/**
 * §6.8 Gantt — BeakerBot moves Fake A forward; cascade fires (Gantt
 * redesign 2026-05-22, Gantt manager).
 *
 * Replaces the SECOND half of the legacy `gantt-chained-deps` step.
 * After both deps are wired (A → user, user → B), BeakerBot drags
 * Fake A forward 2 days; both downstream tasks shift with it. This is
 * the "dependency cascade" reveal.
 *
 * Cursor: drag Fake A onto the later-date marker (today + 7 days,
 * stamped by GanttChart). The actual `tasksApi.move` fires
 * programmatically ~3s after the cursor begins (mismatch: cursor's
 * mousedown/up doesn't drive Gantt's HTML5 DragEvent drop handler;
 * same pattern as the legacy step). FORWARD_DAYS MUST match the
 * marker offset so the programmatic landing lines up with the
 * cursor's visual drop and there's no "snap back" second move.
 *
 * Manual advance after the cascade lands. The user reads "both linked
 * tasks shift with it" then clicks Got it.
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
  moveFakeAForward,
  spawnGanttRedesignFakeTasks,
} from "./lib/gantt-redesign-helpers";
import { ensureFirstExperimentExists } from "./lib/ensure-helpers";

/** Delay (ms) between the cursor script kicking off and the programmatic
 *  `tasksApi.move` fire that actually moves Fake A in the data layer.
 *  The visual drag takes ~2100ms; the dwell needs to be generous enough
 *  that the cursor's drop animation visibly lands BEFORE the cascade
 *  renders, even on slow machines (Gantt fix manager R1, P2 #13). */
const CASCADE_FIRE_DELAY_MS = 3500;

/** How many days forward to push Fake A. MUST match the
 *  `ganttLaterDateMarker` offset (today + 7 days) so the programmatic
 *  data move lands on the SAME date the cursor visually dropped on,
 *  preventing the "double bump" Grant flagged on 2026-05-27 (the legacy
 *  GanttDependenciesStep already gets this right via getCascadeTargetDate).
 *  Without this alignment, the cursor would visually land Fake A on
 *  next week (where the marker lives), then React would re-render with
 *  Fake A at today + 2 (the prior FORWARD_DAYS value), producing a
 *  visible "snap back" a second after the cursor's drop animation. */
const FORWARD_DAYS = 7;

export const ganttDepsCascadeStep = buildWalkthroughStep({
  id: "gantt-deps-cascade",
  speech:
    "Once tasks are linked, moving an upstream task drags everything downstream with it. If Fake A slips by a week, your experiment and Fake B slip too, with no rescheduling by hand.",
  pose: "thinking",
  targetSelector: targetSelector(TOUR_TARGETS.ganttBarFakeA),
  // Tour robustification 2026-05-27 (tour robustification manager):
  // ensure the dependency chain (user experiment + Fake A + dep edge)
  // exists before the cursor demos the cascade. A seed-jump past
  // gantt-deps-beakerbot would leave Fake A unconnected and the cascade
  // would be a single-bar shift instead of a chain reveal. All three
  // helpers are idempotent on name; canonical flow no-ops.
  onEnter: async (ctx) => {
    await ensureFirstExperimentExists();
    await spawnGanttRedesignFakeTasks(ctx);
    await createFakeAToUserDep(ctx);
  },
  cursorScript: cursorScript(async () => {
    // Visual narration: drag Fake A onto the later-date marker (today
    // + 7 days; GanttChart stamps that marker on the day header).
    const drag = await safeDragAction(
      targetSelector(TOUR_TARGETS.ganttBarFakeA),
      targetSelector(TOUR_TARGETS.ganttLaterDateMarker),
    );

    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        void moveFakeAForward(FORWARD_DAYS);
      }, CASCADE_FIRE_DELAY_MS);
    }
    return compactScript([drag]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});
