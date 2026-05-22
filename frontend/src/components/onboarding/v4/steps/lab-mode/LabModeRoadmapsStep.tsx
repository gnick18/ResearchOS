"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Roadmaps tab walkthrough.
 *
 * Lab Mode manager 2026-05-22. Inside the DemoLabModeViewer. Cursor
 * clicks the Roadmaps tab; SMART-goal progress trackers render.
 *
 * Demo data dependency: requires SMART goals seeded in the demo
 * bundle. If absent, the Roadmaps panel renders an empty state and
 * the speech still narrates the feature concept. Demo-seed sub-bot
 * flagged in the redesign brief.
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";

export const labModeRoadmapsStep = buildLabModeTabStep({
  id: "lab-mode-roadmaps",
  tabTarget: TOUR_TARGETS.labModeRoadmapsTab,
  speech: (
    <>
      <p>
        If anyone in the lab sets goals as SMART goals, they show up
        here as progress trackers.
      </p>
      <p>
        Click a project&apos;s tracker to expand, you get the specific
        goals plus where each one stands.
      </p>
    </>
  ),
});
