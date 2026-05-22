"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Experiments tab walkthrough.
 *
 * Lab Mode manager 2026-05-22. Inside the DemoLabModeViewer. Cursor
 * clicks the Experiments tab; panel mounts.
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";

export const labModeExperimentsStep = buildLabModeTabStep({
  id: "lab-mode-experiments",
  tabTarget: TOUR_TARGETS.labModeExperimentsTab,
  speech: (
    <>
      <p>
        Experiments tab summarizes every recent experiment in the lab,
        both active and completed.
      </p>
      <p>
        Great for the &ldquo;has anyone done X before?&rdquo; moment.
        Search-friendly, filterable by status.
      </p>
    </>
  ),
});
