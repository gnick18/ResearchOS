/**
 * §6.8 Gantt — task types intro + alt-creation peek (combined).
 *
 * First Gantt sub-step. Speech introduces the three task types
 * (experiments / lists / projects), and the cursor demos that there
 * are TWO ways to create tasks on the Gantt page:
 *
 *   1. Double-click a day on the timeline → new-task affordance.
 *   2. Click the blue "+ Task" button.
 *
 * The cursor does the first (double-click) then cancels, then clicks
 * the "+ Task" button. The button click sequence opens the modal but
 * the cursor immediately closes it (we already created an experiment
 * on the Workbench in §6.5). The point is to show both affordances
 * exist.
 *
 * BeakerBotCursor's primitive set doesn't include double-click; we
 * click twice in quick succession against the timeline target as a
 * stand-in. Real handlers that distinguish click vs double-click
 * (e.g., Gantt's day-cell hit-zones) will read the second click as
 * the double-click event due to the rapid timing.
 *
 * Manual advance — there's no clean API event to wait for; the cursor
 * narrative is the whole demo.
 *
 * Classification: BEAKERBOT DEMO (per Grant's design correction
 * 2026-05-21). Speech closes with "You already made yours on the
 * Workbench", i.e. the cursor's double-click + Task-button click
 * sequence is purely demonstrative, NOT a directive for the user to
 * follow. The point is to show the two affordances exist. Cursor
 * keeps the click sequence as a demo. (Note: the modal that opens
 * from the + Task click is dismissed by the next step's onEnter:
 * out of scope for this body, but flagged for follow-up.)
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const ganttIntroStep = buildWalkthroughStep({
  id: "gantt-task-types",
  speech: (
    <>
      <p className="mb-2">
        Gantt time. Three task types: experiments, lists, and projects.
        You just made an experiment; let me show you the timeline.
      </p>
      <p>
        Two ways to make tasks here: double-click a day on the
        timeline, or click the blue + Task button. You already made
        yours on the Workbench.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttTimeline),
  cursorScript: cursorScript(async () => {
    // Double-click stand-in: click the timeline twice. Real double-
    // click detectors fire on consecutive clicks within ~500ms; the
    // cursor's click-then-glide-then-click sequence is fast enough.
    const dblA = await safeClickAction(
      targetSelector(TOUR_TARGETS.ganttTimeline),
    );
    const dblB = await safeClickAction(
      targetSelector(TOUR_TARGETS.ganttTimeline),
    );
    const buttonClick = await safeClickAction(
      targetSelector(TOUR_TARGETS.ganttNewTaskButton),
    );
    return compactScript([dblA, dblB, buttonClick]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});
