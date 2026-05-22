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
        This is a Gantt chart. If you've never used one before: it's a
        timeline view of everything you're working on, laid out by date.
      </p>
      <p>
        On this page you'll see your experiments, tasks, and purchase
        orders side-by-side in time. It's where you check whether you're
        overbooked, work backward from a deadline, or just see what's
        happening this week.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttTimeline),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});
