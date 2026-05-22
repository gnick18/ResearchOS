"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Activity tab walkthrough.
 *
 * Lab Mode manager 2026-05-22, enriched in Lab Mode fix manager R1
 * (2026-05-22): the cursor now opens a popup AND closes it instead
 * of merely clicking the tab. Beats:
 *
 *   1. Click the Activity tab so the panel mounts.
 *   2. Click the first activity row → TaskDetailPopup mounts.
 *   3. (Deferred) click the popup close button so the popup
 *      dismisses before the next tab demo starts.
 *
 * The close button is a `deferredClickAction` because the popup
 * doesn't exist at script-build time (the row click hasn't played
 * yet). `deferredClickAction` waits for the close button to mount at
 * playback time, then fires the click programmatically.
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";

const FIRST_ROW = `[data-tour-target="${TOUR_TARGETS.labModeActivityFirstRow}"]`;
const POPUP_CLOSE = `[data-tour-target="task-popup-close"]`;

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
  additionalActions: async ({ deferredClickAction }) => {
    // Click the first activity row to open the unified task popup,
    // then close it. Both deferred because the row may not be
    // mounted at script-build time (the tab click hasn't played
    // yet, even when Activity is the default tab the previous step
    // may have left a different tab active) and the popup never is.
    return [
      deferredClickAction(FIRST_ROW),
      deferredClickAction(POPUP_CLOSE),
    ];
  },
});
