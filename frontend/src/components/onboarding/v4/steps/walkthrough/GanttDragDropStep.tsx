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
 * Destination (gantt drag-and-spotlight fix manager, 2026-05-27):
 * resolves the user's experiment start_date at PLAYBACK time, computes
 * `start + 1 day` skipping weekends (advance to the next Monday when
 * the +1 lands on Sat/Sun, since the Gantt's default is
 * `enable_seven_day_week=false`), then drags onto the matching day
 * header cell (`data-testid="day-header-YYYY-MM-DD"`). Previously the
 * drag aimed at the whole `gantt-timeline` element. `dragFromTo`
 * resolves the drop coords via `elementCenter`, so that aimed the
 * drop at the geometric middle of the entire chart container,
 * frequently off-screen on the user's viewport (Grant hand-walk
 * 2026-05-27: bar dragged off-screen, no visible move). Anchoring on
 * a specific day cell gives a predictable, visible single-day shift.
 *
 * Falls back to the timeline if the user-experiment record can't be
 * resolved (test harness short-circuit, no §6.5 experiment) — the
 * fallback's "drag to timeline center" failure mode is the same as
 * before in that edge case, but the cursor at least animates.
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
import { resolveUserExperiment } from "./lib/gantt-redesign-helpers";

/**
 * Add `days` calendar days to a YYYY-MM-DD string and return the new
 * YYYY-MM-DD. Local-time math so the result matches the Gantt's
 * `formatDate` (which uses `getFullYear/getMonth/getDate`, not UTC).
 * Exported for tests.
 */
export function addDaysLocal(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** 0 = Sunday, 6 = Saturday — matches GanttChart's `isWeekend`. */
function isWeekendYmd(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return false;
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  return dow === 0 || dow === 6;
}

/**
 * Compute a "one weekday forward" drop date from a start_date string.
 * Weekend-aware: if start + 1 lands on Saturday, advance to Monday
 * (+3 from start); if Sunday, advance to Monday (+2 from start).
 * Exported for tests.
 *
 * Why: the Gantt's default is `enable_seven_day_week=false`, so the
 * weekend cells render muted and feel non-actionable. Landing on the
 * next working day produces a drop target the user can see on the
 * grid (the Monday cell still renders since weeks are 7 days wide
 * regardless of the option; the weekend cells just look muted).
 */
export function computeDragTargetDate(startDate: string): string {
  const plusOne = addDaysLocal(startDate, 1);
  if (!isWeekendYmd(plusOne)) return plusOne;
  // +1 is weekend. Advance one calendar day at a time until we hit
  // a weekday. In practice the loop runs at most twice (Saturday
  // → Sunday → Monday).
  let target = plusOne;
  while (isWeekendYmd(target)) {
    target = addDaysLocal(target, 1);
  }
  return target;
}

export const ganttDragDropStep = buildWalkthroughStep({
  id: "gantt-drag-drop",
  speech:
    "Need to push something to next week, or pull a deadline forward? Grab the bar and drop it where you want it. The dates update instantly, no popup, no form.",
  pose: "pointing",
  // Gantt redesign 2026-05-22 (Gantt manager): target the user-experiment
  // attribute specifically. The legacy `ganttFirstTaskBar` is preserved
  // on the same element for back-compat; using the new attribute here
  // documents the intent (the demo is dragging the USER's experiment,
  // not whatever happens to be the first bar).
  targetSelector: targetSelector(TOUR_TARGETS.ganttBarUserExperiment),
  cursorScript: cursorScript(async () => {
    const bar = await waitForElement(
      targetSelector(TOUR_TARGETS.ganttBarUserExperiment),
    );
    if (!bar) return [];

    // gantt drag-and-spotlight fix manager (2026-05-27): compute the
    // drop target dynamically. Previous version dragged to the whole
    // `gantt-timeline` element — `dragFromTo` resolves the drop coords
    // via `elementCenter`, which is the geometric middle of the
    // entire chart container (frequently off-screen on the user's
    // viewport). Now we read the user experiment's start_date from
    // the data layer, compute start + 1 weekday, and aim the drop at
    // the matching day-header cell (which has a stable
    // `data-testid="day-header-YYYY-MM-DD"`).
    const userExp = await resolveUserExperiment();
    let destSelector = targetSelector(TOUR_TARGETS.ganttTimeline);
    if (userExp?.start_date) {
      const targetDate = computeDragTargetDate(userExp.start_date);
      const cellSelector = `[data-testid="day-header-${targetDate}"]`;
      const cell = await waitForElement(cellSelector, 1500);
      if (cell) {
        destSelector = cellSelector;
      }
      // If the cell isn't mounted (target date past the visible
      // window, etc.), fall back to the timeline. The user sees the
      // same off-target behaviour as before in that edge case, but
      // the common path now lands on a real day cell.
    }

    const drag = await safeDragAction(
      targetSelector(TOUR_TARGETS.ganttBarUserExperiment),
      destSelector,
    );
    return compactScript([drag]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});
