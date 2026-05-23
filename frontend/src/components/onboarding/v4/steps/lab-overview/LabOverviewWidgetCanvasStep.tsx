"use client";

/**
 * R4 Lab Overview tour — widget canvas beat.
 *
 * R4 Lab Mode retirement (2026-05-23). Points at the widget grid on
 * `/lab-overview` and explains the free-grid layout. The cursor glides
 * to the canvas wrapper so the user's attention lands on the grid
 * itself (not the toolbar), then BeakerBot narrates the drag / resize /
 * remove affordances available in Edit mode.
 *
 * Target: the WidgetCanvas's outer wrapper, stamped with
 * `data-tour-target="lab-overview-canvas"`. When the canvas hasn't
 * mounted yet (e.g. the layout still loading), the cursor script
 * resolves to an empty action list and the step degrades to speech-only
 * narration.
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

export const labOverviewWidgetCanvasStep: TourStep = buildWalkthroughStep({
  id: "lab-overview-widget-canvas",
  pose: "pointing",
  speech: (
    <div
      data-step-id="lab-overview-widget-canvas"
      data-testid="lab-overview-widget-canvas"
      className="space-y-2"
    >
      <p>
        Here is the widget canvas. Each tile is independent: drag to
        reposition, grab a corner to resize, click the X to remove.
      </p>
      <p>
        Flip on Edit layout when you want to rearrange. Your layout
        saves per user, so your dashboard is yours.
      </p>
    </div>
  ),
  targetSelector: targetSelector(TOUR_TARGETS.labOverviewCanvas),
  cursorScript: cursorScript(async () => {
    const glide = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.labOverviewCanvas),
    );
    return compactScript([glide]);
  }),
  completion: manualAdvance("Got it, next"),
  conditionalOn: (picks) => picks?.account_type === "lab",
  expectedRoute: "/lab-overview",
});
