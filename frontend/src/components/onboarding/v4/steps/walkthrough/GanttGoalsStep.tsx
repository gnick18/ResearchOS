/**
 * §6.8 Gantt — goals overview sub-step. Conditional on Q4 = yes
 * (`feature_picks.goals === "yes"`). The step-machine already gates
 * this id via `isStepGatedOut` in P1; the registry just provides the
 * body.
 *
 * Speech (no em-dashes):
 *   "Goals visualize over the Gantt. You can keep them personal (just
 *    you) or share with the lab (everyone sees them). Personal goals
 *    are private to your account; lab-wide goals appear for every lab
 *    member."
 *
 * Cursor creates a placeholder personal goal spanning a few days. Goal
 * overlay appears on the Gantt. Manual advance afterward.
 *
 * Artifact:
 *   { type: "goal", id: "<goalId>", cleanup_default: "keep" }
 *
 * Cleanup default keep — goals the user opted into are useful even
 * after the tour. Q4 was opt-in, so the user signaled they cared.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const ganttGoalsStep = buildWalkthroughStep({
  id: "gantt-goals-overview",
  speech: (
    <>
      <p className="mb-2">
        Goals visualize over the Gantt. You can keep them personal
        (just you) or share with the lab (everyone sees them).
      </p>
      <p>
        Personal goals are private to your account; lab-wide goals
        appear for every lab member.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttGoalsButton),
  cursorScript: cursorScript(async () => {
    const openGoals = await safeClickAction(
      targetSelector(TOUR_TARGETS.ganttGoalsButton),
    );
    return compactScript([openGoals]);
  }),
  completion: manualAdvance("Got it, next"),
  // Gate matches step-machine.ts `isStepGatedOut`:
  //   gantt-goals-overview → picks?.goals !== "yes"
  conditionalOn: (picks) => picks?.goals === "yes",
});
