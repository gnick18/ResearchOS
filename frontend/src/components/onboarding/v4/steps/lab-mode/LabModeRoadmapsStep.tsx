"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Roadmaps tab walkthrough.
 *
 * Lab Mode manager 2026-05-22, enriched in Lab Mode fix manager R1
 * (2026-05-22). Beats:
 *
 *   1. Click the Roadmaps tab so the SMART-goal trackers mount.
 *   2. (Deferred) click the first project's tracker button so it
 *      expands and reveals the nested goals beneath it.
 *
 * No popup — the tracker click expands inline. The speech narrates
 * "click a tracker to expand" so the visible state change after the
 * click is the whole point.
 *
 * Demo data dependency: requires SMART goals seeded in the demo
 * bundle. If absent, the Roadmaps panel renders an empty state and
 * the tracker selector misses; the cursor demo no-ops gracefully.
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";

const FIRST_TRACKER = `[data-tour-target="${TOUR_TARGETS.labModeRoadmapsFirstTracker}"]`;

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
  additionalActions: async ({ deferredClickAction }) => {
    return [deferredClickAction(FIRST_TRACKER)];
  },
});
