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
 * setup-q1c lab head manager 2026-05-23: re-gated from
 * `account_type === "lab"` to `lab_head === true`. The Lab Overview
 * dashboard is a PI tool (widget curation, member spotlighting, sharing
 * concepts), so lab members who picked "Lab" on Q1 but "No, I'm a lab
 * member" on Q1c skip the cluster entirely. They still see the
 * universal walkthrough.
 *
 * FOLLOW-UP (deferred 2026-05-23): Grant's direction is that lab heads
 * should land on /lab-overview as their first post-setup destination,
 * with Mira's demo lab data substituted in for visual richness. Today
 * R4's tour runs against the user's REAL canvas, which can be empty
 * when other lab members haven't filled it in yet. A future variant
 * should swap in Mira's substrate so a brand-new lab head sees a rich
 * dashboard before their team has populated theirs. Not built here.
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
  conditionalOn: (picks) => picks?.lab_head === true,
  expectedRoute: "/lab-overview",
});
