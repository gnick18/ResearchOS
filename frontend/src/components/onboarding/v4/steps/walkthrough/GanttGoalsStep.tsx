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
 * Behavior: pure narration + spotlight on the toolbar Goal button so
 * the user knows where the affordance lives. No cursor click — the
 * speech is about VIEWING goals, not creating one, and clicking the
 * "+ Goal" button opens the HighLevelGoalModal (CREATE flow) which
 * mismatches the narration.
 *
 * gantt cluster consolidation manager (2026-05-27, Bug #36): chose
 * option (a) from the brief — cursor no longer opens the New Goal
 * modal. The earlier behavior would surface the create modal mid-tour
 * which both mismatched the speech ("Goals visualize over the Gantt"
 * is a viewing concept, not a creating one) AND layered on top of any
 * leftover experiment popup from the previous step, producing a stack
 * of two modals the user had to dismiss before continuing. The
 * onEnter now also defensively closes any stale TaskDetailPopup
 * lingering from earlier Gantt-share steps so this step starts on a
 * clean Gantt surface.
 *
 * Classification: NARRATION (post-Grant 2026-05-27 brief). The
 * spotlight ring on the "+ Goal" button is the visual cue for "this
 * is where goals live"; the speech does the rest.
 */
import { tourClickWithLockBypass } from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const ganttGoalsStep = buildWalkthroughStep({
  id: "gantt-goals-overview",
  speech: (
    <>
      <p className="mb-2">One last thing on the timeline: goals.</p>
      <p>
        Goals visualize directly over the Gantt chart. You can keep
        them private to your account or share them so the whole lab
        can see what you're working towards.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttGoalsButton),
  // gantt cluster consolidation manager (2026-05-27, Bug #36): close
  // any leftover TaskDetailPopup before this step's speech fires. The
  // prior gantt-share-user-sees-edit step leaves the user with an open
  // experiment popup (Lab Notes tab on Fake A); without this defensive
  // close, the New Goal modal — which used to be opened by this step's
  // cursor click on "+ Goal" — would layer on top, and even with the
  // cursor click dropped (Bug 36 fix), users who left the popup open
  // would still see it occlude the goals affordance the spotlight is
  // anchored to. Route through tourClickWithLockBypass so the
  // InputLockOverlay's capture-phase blocker doesn't swallow the X.
  onEnter: async () => {
    if (typeof document === "undefined") return;
    const closeBtn = document.querySelector<HTMLElement>(
      '[data-tour-target="task-popup-close"]',
    );
    if (closeBtn) tourClickWithLockBypass(closeBtn);
  },
  // No cursorScript: pure narration. The static spotlight on the
  // ganttGoalsButton anchor is the visual cue.
  completion: manualAdvance("Got it, next"),
  // Gate matches step-machine.ts `isStepGatedOut`:
  //   gantt-goals-overview → picks?.goals !== "yes"
  conditionalOn: (picks) => picks?.goals === "yes",
  expectedRoute: "/gantt",
});
