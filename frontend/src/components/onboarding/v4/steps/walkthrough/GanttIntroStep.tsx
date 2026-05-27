/**
 * §6.8 Gantt intro (Gantt redesign 2026-05-22, Gantt manager).
 *
 * Replaces the legacy `gantt-task-types` step (which assumed the user
 * already knew what a Gantt chart was and jumped straight to listing
 * task types). The new opener explains the surface from scratch — many
 * wet-lab scientists have never used a Gantt before.
 *
 * Pure narration: no cursor, no user-action. Spotlight points at the
 * full timeline so the user has a visual to anchor the speech to.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const ganttIntroStep = buildWalkthroughStep({
  id: "gantt-intro",
  speech: (
    <>
      <p className="mb-2">
        Once you have more than a few experiments running, a list view
        stops being enough. You need to see what overlaps, what's
        blocking what, and what your week actually looks like.
      </p>
      <p className="mb-2">
        That's what the Gantt chart is for. Every experiment, task, and
        purchase order with a date lives here on one timeline, so you
        can spot when you're overbooked or plan backward from a
        deadline.
      </p>
      <p>
        We'll cover three things on this page: rescheduling work by
        dragging bars around, wiring up dependencies between tasks, and
        sharing experiments with your lab.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttTimeline),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});
