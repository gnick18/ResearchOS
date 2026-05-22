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
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

/** Delay (ms) between the cursor's open-popup click and the
 *  controller-scheduled Escape keydown that closes the popup before the
 *  next step transition. The cursor's single click primitive takes
 *  ~1180ms; +1500ms dwell so the user sees the popup mount AND read the
 *  speech bubble's continuation before it auto-closes. */
const POPUP_DISMISS_DELAY_MS = 2800;

export const ganttExistingExperimentStep = buildWalkthroughStep({
  id: "gantt-existing-experiment",
  speech: (
    <>
      <p className="mb-2">
        Here's the experiment you made earlier on the Workbench. It
        shows up here automatically because it's on the timeline now.
      </p>
      <p>
        I'll click it to open the experiment popup. You can add notes
        from here too, not just from the Workbench.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttBarUserExperiment),
  cursorScript: cursorScript(async () => {
    const openPopup = await safeClickAction(
      targetSelector(TOUR_TARGETS.ganttBarUserExperiment),
    );

    // Schedule a deterministic Escape keydown so the popup closes
    // before the next step's cursor (or the user) starts driving the
    // timeline. Same fire-and-forget pattern as the legacy
    // GanttIntroStep's modal-dismiss timeout.
    if (typeof document !== "undefined" && typeof window !== "undefined") {
      window.setTimeout(() => {
        try {
          document.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              code: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
        } catch {
          // No-op in environments where KeyboardEvent construction is
          // unavailable. User can dismiss the popup themselves.
        }
      }, POPUP_DISMISS_DELAY_MS);
    }
    return compactScript([openPopup]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});
