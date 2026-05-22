"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Lab Gantt tab walkthrough.
 *
 * Lab Mode manager 2026-05-22. Inside the DemoLabModeViewer. Cursor
 * clicks the GANTT tab so the lab-wide Gantt (colored by person)
 * mounts. Manual advance.
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";

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
});
