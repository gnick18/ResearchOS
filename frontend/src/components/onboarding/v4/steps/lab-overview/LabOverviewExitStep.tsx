"use client";

/**
 * R4 Lab Overview tour — exit beat.
 *
 * R4 Lab Mode retirement (2026-05-23). Wraps up the Lab Overview
 * cluster. Pure narration; BeakerBot waves the user back out into the
 * dashboard so they can customize it on their own.
 *
 * Gates on `picks.account_type === "lab"`. The next applicable step in
 * the order is `lab-cleanup` (the auto-cleanup terminal step for the
 * lab cluster), so manualAdvance with "Let's customize" lets the user
 * close the tour beat at their own pace.
 */
import type { TourStep } from "../../step-types";
import {
  buildWalkthroughStep,
  manualAdvance,
} from "../walkthrough/lib/step-helpers";

export const labOverviewExitStep: TourStep = buildWalkthroughStep({
  id: "lab-overview-exit",
  pose: "waving",
  speech: (
    <div
      data-step-id="lab-overview-exit"
      data-testid="lab-overview-exit"
      className="space-y-2"
    >
      <p>
        You are good to go. Customize this dashboard however helps you
        work: drag widgets around, add the lenses you care about, hide
        the ones you don&apos;t.
      </p>
      <p>
        Anything you share with the lab shows up here for your
        teammates too. Have fun.
      </p>
    </div>
  ),
  completion: manualAdvance("Let's customize"),
  conditionalOn: (picks) => picks?.account_type === "lab",
  expectedRoute: "/lab-overview",
});
