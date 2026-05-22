"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — terminal exit step.
 *
 * Lab Mode manager 2026-05-22. The last beat inside the demo viewer.
 * Cursor clicks the "Exit Lab Mode" button so the user sees the
 * overlay dismiss visually. The viewer's `onExit` fires
 * `closeDemoLabModeViewer()` which the host listens for; the user is
 * back on whatever route they were on when the warp step fired.
 *
 * On advance, the controller's normal forward traversal lands on
 * `lab-cleanup` (still account_type === "lab" gated), which cleans up
 * any BeakerBot share artifacts spawned during Gantt teaching, then
 * Phase 4 cleanup.
 *
 * Belt-and-suspenders: the step's onExit ALSO dispatches close in
 * case the cursor click didn't land (the user advanced via the
 * speech bubble's button instead of the cursor's click; either path
 * tears the overlay down).
 */
import {
  closeDemoLabModeViewer,
} from "../../DemoLabModeMount";
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "../walkthrough/lib/cursor-script";
import {
  buildWalkthroughStep,
  manualAdvance,
} from "../walkthrough/lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "../walkthrough/lib/targets";
import type { TourStep } from "../../step-types";
import { useLabModeResumeGuard } from "./LabModeIntroStep";

function LabModeExitInner() {
  useLabModeResumeGuard();
  return (
    <div
      data-step-id="lab-mode-exit"
      data-testid="lab-mode-exit"
      className="space-y-2"
    >
      <p>
        That&apos;s the tour. Once you&apos;ve been running real
        experiments for a few weeks, your own Lab Mode will look like
        this.
      </p>
      <p>Watch me head back to your account.</p>
    </div>
  );
}

export const labModeExitStep: TourStep = buildWalkthroughStep({
  id: "lab-mode-exit",
  pose: "pointing",
  speech: () => <LabModeExitInner />,
  targetSelector: targetSelector(TOUR_TARGETS.labModeExitButton),
  // Cursor clicks the Exit Lab Mode button. The viewer's onExit
  // fires the close event, which the DemoLabModeMount host listens
  // for; the overlay unmounts.
  cursorScript: cursorScript(async () => {
    // Resume-friendly short-circuit: if the viewer overlay isn't on
    // screen (e.g. the user manually closed it), skip the cursor
    // demo instead of waiting on the 5s waitForElement timeout.
    if (typeof document !== "undefined") {
      if (
        !document.querySelector(
          targetSelector(TOUR_TARGETS.labModeExitButton),
        )
      ) {
        return [];
      }
    }
    const click = await safeClickAction(
      targetSelector(TOUR_TARGETS.labModeExitButton),
    );
    return compactScript([click]);
  }),
  completion: manualAdvance("Back to my account"),
  // Always tear down on exit (even if the cursor click didn't fire).
  // closeDemoLabModeViewer is idempotent; a no-op if the overlay was
  // already closed by the cursor's click.
  onExit: () => {
    closeDemoLabModeViewer();
  },
  conditionalOn: (picks) => picks?.account_type === "lab",
});

export default LabModeExitInner;
