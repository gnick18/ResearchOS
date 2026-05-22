"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — warp to demo viewer.
 *
 * Lab Mode manager 2026-05-22. Mounts the `<DemoLabModeViewer>`
 * overlay via the window-event-driven `DemoLabModeMount` host. The
 * overlay stays mounted through every subsequent lab-mode-* step
 * until `lab-mode-exit` dismisses it.
 *
 * Pose: cheering. Speech: "Welcome to the demo. Real fake lab data,
 * lots of it. Let's tour the surfaces."
 *
 * No cursor. The viewer is the artifact; the user reads the
 * speech, sees the overlay appear, and clicks Got it, next to
 * advance into the per-tab tour beats.
 */
import { useEffect } from "react";
import { openDemoLabModeViewer } from "../../DemoLabModeMount";
import type { TourStep } from "../../step-types";
import {
  buildWalkthroughStep,
  manualAdvance,
} from "../walkthrough/lib/step-helpers";
import { useLabModeResumeGuard } from "./LabModeIntroStep";

function LabModeWarpToDemoInner() {
  useLabModeResumeGuard();
  // The onEnter hook on the step body also dispatches the open, but
  // we redundantly dispatch from the speech mount so the overlay
  // shows up the same render the user reads the cheer copy. The
  // mount listener is idempotent (a second open while already open
  // is a no-op).
  useEffect(() => {
    openDemoLabModeViewer();
  }, []);
  return (
    <div
      data-step-id="lab-mode-warp-to-demo"
      data-testid="lab-mode-warp-to-demo"
      className="space-y-2"
    >
      <p>
        Welcome to the demo. Real fake lab data, lots of it.
      </p>
      <p>Let&apos;s tour the surfaces.</p>
    </div>
  );
}

export const labModeWarpToDemoStep: TourStep = buildWalkthroughStep({
  id: "lab-mode-warp-to-demo",
  pose: "cheering",
  speech: () => <LabModeWarpToDemoInner />,
  // Belt-and-suspenders: the inner speech component dispatches on
  // mount, AND the step's onEnter dispatches as soon as the
  // controller picks it. Either path is enough; both are idempotent.
  onEnter: () => {
    openDemoLabModeViewer();
  },
  completion: manualAdvance("Got it, next"),
  conditionalOn: (picks) => picks?.account_type === "lab",
});

export default LabModeWarpToDemoInner;
