/**
 * §6.8 Gantt — drag-drop demo sub-step.
 *
 * Cursor moves to the experiment's bar on the timeline. Drags from
 * current position to a different date. Bar moves; date updates. Then
 * cursor grabs the right edge of the bar and drags right to resize
 * duration.
 *
 * Source selector: `[data-tour-target="gantt-first-task-bar"]` is set
 * on the most recently created experiment's bar element by the Gantt
 * surface (real product UI patch lands as part of this P5 chip).
 *
 * Destination: best-effort — drag 100-150px right on the timeline.
 * The `safeDragAction` primitive takes element-to-element, not
 * element-to-offset. We pick the rightmost visible day cell of the
 * timeline as the drop target; the actual offset depends on viewport
 * width but the visual is "task moved right." A P13 polish chip can
 * add an offset variant to the cursor primitive.
 *
 * Classification: BEAKERBOT DEMO (per Grant's design correction
 * 2026-05-21). Although the speech reads imperatively ("Drag a task
 * bar to reschedule it"), the brief lists gantt-* as canonical demo
 * territory: drag mechanics on the Gantt are the kind of action where
 * "watch BeakerBot do it once" reads more clearly than asking the
 * user to perform on their own bar. Cursor keeps the drag. (A future
 * polish chip could rephrase the speech to "Watch me drag this bar"
 * for full intent alignment; deferred so the gantt suite ships
 * consistent with the brief's classification table.)
 */
import {
  cursorScript,
  safeDragAction,
  compactScript,
  waitForElement,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const ganttDragDropStep = buildWalkthroughStep({
  id: "gantt-drag-drop",
  speech:
    "Watch me drag this task bar to reschedule it. You can drop a bar anywhere on the timeline to change its date.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttFirstTaskBar),
  cursorScript: cursorScript(async () => {
    const bar = await waitForElement(
      targetSelector(TOUR_TARGETS.ganttFirstTaskBar),
    );
    if (!bar) return [];
    // Target the timeline element as the drop site. Real Gantt
    // implementations parse the drop X-coordinate against day-cell
    // widths; dropping anywhere on the timeline will trigger a date
    // update.
    const drag = await safeDragAction(
      targetSelector(TOUR_TARGETS.ganttFirstTaskBar),
      targetSelector(TOUR_TARGETS.ganttTimeline),
    );
    return compactScript([drag]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});
