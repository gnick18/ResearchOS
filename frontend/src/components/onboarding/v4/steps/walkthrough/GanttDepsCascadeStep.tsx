/**
 * §6.8 Gantt — BeakerBot moves Fake A forward; cascade fires (Gantt
 * redesign 2026-05-22, Gantt manager).
 *
 * Replaces the SECOND half of the legacy `gantt-chained-deps` step.
 * After both deps are wired (A → user, user → B), BeakerBot drags
 * Fake A forward 2 days; both downstream tasks shift with it. This is
 * the "dependency cascade" reveal.
 *
 * Cursor: drag Fake A onto the later-date marker. The actual
 * `tasksApi.move` fires programmatically ~3s after the cursor begins
 * (mismatch: cursor's mousedown/up doesn't drive Gantt's HTML5
 * DragEvent drop handler; same pattern as the legacy step).
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
import { moveFakeAForward } from "./lib/gantt-redesign-helpers";

/** Delay (ms) between the cursor script kicking off and the programmatic
 *  `tasksApi.move` fire that actually moves Fake A in the data layer.
 *  The visual drag takes ~2100ms; +900ms dwell so the cursor's drop
 *  animation visibly lands BEFORE the cascade renders. */
const CASCADE_FIRE_DELAY_MS = 3000;

/** How many days forward to push Fake A. Two days is enough to be a
 *  clearly visible shift on the timeline; not so far that the user
 *  loses sight of the bars. */
const FORWARD_DAYS = 2;

export const ganttDepsCascadeStep = buildWalkthroughStep({
  id: "gantt-deps-cascade",
  speech: (
    <>
      <p className="mb-2">Watch what happens when I move the head of the chain.</p>
      <p>
        Both linked tasks shift with it. That's the dependency cascade.
        Earlier task moves, everything downstream moves too.
      </p>
    </>
  ),
  pose: "thinking",
  targetSelector: targetSelector(TOUR_TARGETS.ganttBarFakeA),
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
