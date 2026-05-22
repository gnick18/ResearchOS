"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Lab Gantt tab walkthrough.
 *
 * Lab Mode manager 2026-05-22, enriched in Lab Mode fix manager R1
 * (2026-05-22). Beats:
 *
 *   1. Click the GANTT tab so the lab-wide Gantt mounts.
 *   2. (Deferred) click the first task bar → TaskDetailPopup mounts.
 *   3. (Deferred) click the popup close button so the popup
 *      dismisses before the next tab demo starts.
 *
 * Both follow-up clicks are deferred to playback so they wait for
 * their anchors to mount (the Gantt bars only render after the tab
 * click plays).
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";

const FIRST_BAR = `[data-tour-target="${TOUR_TARGETS.labModeGanttFirstBar}"]`;
const POPUP_CLOSE = `[data-tour-target="task-popup-close"]`;

export const labModeGanttStep = buildLabModeTabStep({
  id: "lab-mode-gantt",
  tabTarget: TOUR_TARGETS.labModeGanttTab,
  speech: (
    <>
      <p>
        Lab-mode Gantt overlays everyone&apos;s timeline in one view,
        colored by person instead of by project.
      </p>
      <p>
        Useful when you&apos;re trying to schedule something with
        someone and want to see who&apos;s slammed vs who has open
        days. Bars are clickable, same popup as the regular Gantt.
      </p>
    </>
  ),
  additionalActions: async ({ deferredClickAction }) => {
    const openBar = deferredClickAction(FIRST_BAR);
    const closePopup = deferredClickAction(POPUP_CLOSE);
    return [openBar, closePopup];
  },
});
