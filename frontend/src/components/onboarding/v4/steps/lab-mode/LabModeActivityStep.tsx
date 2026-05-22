"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Activity tab walkthrough.
 *
 * Lab Mode manager 2026-05-22. Inside the DemoLabModeViewer; the
 * cursor clicks the Activity tab so the panel mounts as BeakerBot
 * narrates. Pure narration after that: the speech mentions clickable
 * activity items + the unified popup, but doesn't drive a click chain
 * (the user can explore manually before advancing).
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";

export const labModeActivityStep = buildLabModeTabStep({
  id: "lab-mode-activity",
  tabTarget: TOUR_TARGETS.labModeActivityTab,
  speech: (
    <>
      <p>
        Activity is the landing page. It shows what experiments,
        purchases, and tasks are happening right now, plus what&apos;s
        wrapped up in the last 30 days.
      </p>
      <p>
        It&apos;s the page you come back to when you want a
        &ldquo;what happened recently?&rdquo; quick-scan. Anything you
        see here is clickable for the full popup.
      </p>
    </>
  ),
});
