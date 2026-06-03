/**
 * §6.8 Gantt — spotlight the user's existing experiment (Gantt redesign
 * 2026-05-22, Gantt manager).
 *
 * Second sub-step in the redesigned arc. The user just made an
 * experiment in §6.5 on the Workbench; this beat confirms that the
 * experiment appears on the timeline automatically and that the user
 * can click it to open the popup.
 *
 * 2026-06-03 (HR / tour-simplification): cursor downgrade. The beat used
 * to glide to the user's experiment bar, click it open, then auto-close
 * the popup with a scheduled Escape. Opening a bar is self-evident, so the
 * cursor (and the open/close Escape choreography) was dropped. The
 * spotlight on the user's own bar + the speech stay; the user clicks the
 * bar themselves if they want to open it.
 *
 * NOTE: the user's experiment bar carries `data-tour-target="gantt-bar-
 * user-experiment"` AND the legacy `gantt-first-task-bar` attribute.
 * The new attribute is stable across the Gantt redesign; the legacy
 * one keeps GanttDragDropStep + other consumers working unchanged.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { ensureFirstExperimentExists } from "./lib/ensure-helpers";

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
        here without having to bounce back to the Workbench. Click your
        experiment bar to open it.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttBarUserExperiment),
  // Tour robustification 2026-05-27 (tour robustification manager):
  // ensure an experiment with a today-bounded date exists so a bar
  // appears on the Gantt for the spotlight to anchor on. A seed-jump past
  // §6.5 leaves the timeline empty of user experiments.
  // 2026-06-03 (HR / tour-simplification): kept onEnter (the spotlight
  // still needs a bar); the cursor + the open/close Escape choreography are
  // gone (no popup is opened by the tour now, so nothing to dismiss).
  onEnter: async () => {
    await ensureFirstExperimentExists();
  },
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/gantt",
});
