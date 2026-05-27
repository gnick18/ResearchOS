/**
 * §6.8 Gantt — spotlight the user's existing experiment (Gantt redesign
 * 2026-05-22, Gantt manager).
 *
 * Second sub-step in the redesigned arc. The user just made an
 * experiment in §6.5 on the Workbench; this beat confirms that the
 * experiment appears on the timeline automatically and that the user
 * can click it to open the popup.
 *
 * Cursor: glide to the user's experiment bar, click to open the popup,
 * then close the popup before advancing. The popup-open beat is the
 * "you can also reach this here" reveal; the close is so the next step
 * fires against an unobstructed timeline.
 *
 * NOTE: the user's experiment bar carries `data-tour-target="gantt-bar-
 * user-experiment"` AND the legacy `gantt-first-task-bar` attribute.
 * The new attribute is stable across the Gantt redesign; the legacy
 * one keeps GanttDragDropStep + other consumers working unchanged.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { dispatchTourSyntheticEscape } from "./lib/synthetic-escape";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { ensureFirstExperimentExists } from "./lib/ensure-helpers";

/** Delay (ms) between the cursor's open-popup click and the
 *  controller-scheduled Escape keydown that closes the popup before the
 *  next step transition. The cursor's single click primitive takes
 *  ~1180ms; +1500ms dwell so the user sees the popup mount AND read the
 *  speech bubble's continuation before it auto-closes.
 *
 *  Gantt fix manager R1 (P2 #12): the escape is also fired via the
 *  step's onExit handler so a manual "Got it, next" click before the
 *  timer fires still closes the popup. Otherwise the popup leaks into
 *  the next step. Both paths are safe (Escape on an already-closed
 *  popup is a no-op). */
const POPUP_DISMISS_DELAY_MS = 2800;

/** Dispatch an Escape keydown so the experiment popup closes. Used by
 *  both the post-click timer and the step's onExit handler.
 *
 *  esc-skip-confirm misfire manager (2026-05-27): tagged via
 *  `dispatchTourSyntheticEscape` so TourController's window-level
 *  Escape listener skips it. Prior to the marker, this dispatch
 *  bubbled to the window-capture listener and tripped the
 *  "Skip to the cleanup selector?" confirm modal on every advance off
 *  this step. The popup's own Escape handler (TaskDetailPopup) still
 *  fires normally — the marker only blocks the skip-confirm trigger. */
function dispatchEscape(): void {
  if (typeof document === "undefined") return;
  dispatchTourSyntheticEscape(document);
}

export const ganttExistingExperimentStep = buildWalkthroughStep({
  id: "gantt-existing-experiment",
  speech: (
    <>
      <p className="mb-2">
        Anything with a date attached lands on the timeline
        automatically, including the experiment you just made.
      </p>
      <p>
        You can open, edit, reschedule, and manage anything right from
        here without having to bounce back to the Workbench. I&apos;ll
        click your experiment to show you.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttBarUserExperiment),
  // Tour robustification 2026-05-27 (tour robustification manager):
  // ensure an experiment with a today-bounded date exists so a bar
  // appears on the Gantt for the cursor to click. A seed-jump past
  // §6.5 leaves the timeline empty of user experiments.
  onEnter: async () => {
    await ensureFirstExperimentExists();
  },
  cursorScript: cursorScript(async () => {
    const openPopup = await safeClickAction(
      targetSelector(TOUR_TARGETS.ganttBarUserExperiment),
    );

    // Schedule a deterministic Escape keydown so the popup closes
    // before the next step's cursor (or the user) starts driving the
    // timeline. Same fire-and-forget pattern as the legacy
    // GanttIntroStep's modal-dismiss timeout. The step's onExit also
    // fires Escape as a belt-and-braces for the manual-advance race
    // (Gantt fix manager R1, P2 #12).
    if (typeof window !== "undefined") {
      window.setTimeout(dispatchEscape, POPUP_DISMISS_DELAY_MS);
    }
    return compactScript([openPopup]);
  }),
  completion: manualAdvance("Got it, next"),
  onExit: async () => {
    // Belt-and-braces popup dismiss: if the user clicks "Got it, next"
    // before the post-click timer fires, the popup would otherwise leak
    // into the next step.
    dispatchEscape();
  },
  expectedRoute: "/gantt",
});
