"use client";

/**
 * R4 Lab Overview tour — intro beat.
 *
 * R4 Lab Mode retirement (2026-05-23). Pure narration. BeakerBot sets
 * the scene for the new Lab Overview surface: a customizable widget
 * dashboard that replaces the old "Lab Mode" cross-user view + the
 * `/lab` pseudo-account aggregation. No cursor, no DOM target; the
 * controller's expectedRoute auto-navigates to `/lab-overview` before
 * the speech bubble lands.
 *
 * Gates on `picks.account_type === "lab"`. Solo accounts skip the
 * entire cluster (the step-machine LAB_OVERVIEW_STEP_IDS list).
 */
import type { TourStep } from "../../step-types";
import {
  buildWalkthroughStep,
  manualAdvance,
} from "../walkthrough/lib/step-helpers";

export const labOverviewIntroStep: TourStep = buildWalkthroughStep({
  id: "lab-overview-intro",
  pose: "waving",
  speech: (
    <div
      data-step-id="lab-overview-intro"
      data-testid="lab-overview-intro"
      className="space-y-2"
    >
      <p>
        This is your Lab Overview. It is a customizable dashboard built
        from widgets, your home base for everything cross-lab.
      </p>
      <p>
        Drop in announcements, watch the team&apos;s comment feed,
        spotlight a member. Each widget is a small lens on your lab.
      </p>
    </div>
  ),
  completion: manualAdvance("Got it, next"),
  conditionalOn: (picks) => picks?.account_type === "lab",
  expectedRoute: "/lab-overview",
});
