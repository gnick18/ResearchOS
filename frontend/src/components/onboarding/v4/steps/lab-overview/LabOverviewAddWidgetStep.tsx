"use client";

/**
 * R4 Lab Overview tour — Add widget beat.
 *
 * R4 Lab Mode retirement (2026-05-23). Shows the user how to pull a new
 * widget onto the canvas. The cursor glides to the "+ Add widget"
 * toolbar button, then BeakerBot narrates the catalog popover that
 * opens when the user clicks it (each entry toggles a widget on /
 * off the canvas).
 *
 * We deliberately do NOT auto-click the button here: the popover is the
 * step's teaching moment, and asking the user to drive the click
 * themselves makes the next time they want a widget feel natural.
 * Manual-advance keeps pacing in the user's hands.
 *
 * Target: WidgetCanvas's toolbar button, stamped with
 * `data-tour-target="lab-overview-add-widget"`.
 *
 * Gates on `picks.account_type === "lab"`.
 */
import type { TourStep } from "../../step-types";
import {
  cursorScript,
  safeGlideToElementAction,
  compactScript,
} from "../walkthrough/lib/cursor-script";
import {
  buildWalkthroughStep,
  manualAdvance,
} from "../walkthrough/lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "../walkthrough/lib/targets";

export const labOverviewAddWidgetStep: TourStep = buildWalkthroughStep({
  id: "lab-overview-add-widget",
  pose: "pointing",
  speech: (
    <div
      data-step-id="lab-overview-add-widget"
      data-testid="lab-overview-add-widget"
      className="space-y-2"
    >
      <p>
        Want a new widget? Click <strong>+ Add widget</strong> up top.
        You&apos;ll get a catalog popover with every widget available
        for your account.
      </p>
      <p>
        Click a row to drop the widget onto the canvas. Click the same
        row again to remove it. Try it later, when you have a feel for
        which lenses matter most.
      </p>
    </div>
  ),
  targetSelector: targetSelector(TOUR_TARGETS.labOverviewAddWidget),
  cursorScript: cursorScript(async () => {
    const glide = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.labOverviewAddWidget),
    );
    return compactScript([glide]);
  }),
  completion: manualAdvance("Got it, next"),
  conditionalOn: (picks) => picks?.lab_head === true,
  expectedRoute: "/lab-overview",
});
