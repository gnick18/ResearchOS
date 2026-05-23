"use client";

/**
 * R4 Lab Overview tour — sidebar rail beat.
 *
 * R4 Lab Mode retirement (2026-05-23). Spotlights the sidebar widget
 * rail on the left of `/lab-overview`. The rail hosts narrower, always-
 * visible widgets (recent activity, PI quick actions, member workload)
 * that don't need the full canvas grid. BeakerBot points at the rail
 * and narrates the persistent-context role it plays alongside the main
 * canvas.
 *
 * Target: the SidebarWidgetRail's `<aside>` element, stamped with
 * `data-tour-target="lab-overview-sidebar"`. The cursor glides to the
 * rail; the user's eye lands on the column.
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

export const labOverviewSidebarRailStep: TourStep = buildWalkthroughStep({
  id: "lab-overview-sidebar-rail",
  pose: "pointing",
  speech: (
    <div
      data-step-id="lab-overview-sidebar-rail"
      data-testid="lab-overview-sidebar-rail"
      className="space-y-2"
    >
      <p>
        Off to the side you have the sidebar rail. Narrower widgets that
        stay put: recent activity, your PI quick actions, member
        workload.
      </p>
      <p>
        Click the gear up top to reorder the rail or hide a widget you
        don&apos;t need.
      </p>
    </div>
  ),
  targetSelector: targetSelector(TOUR_TARGETS.labOverviewSidebar),
  cursorScript: cursorScript(async () => {
    const glide = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.labOverviewSidebar),
    );
    return compactScript([glide]);
  }),
  completion: manualAdvance("Got it, next"),
  conditionalOn: (picks) => picks?.account_type === "lab",
  expectedRoute: "/lab-overview",
});
