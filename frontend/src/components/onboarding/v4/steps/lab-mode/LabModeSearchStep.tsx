"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Search tab walkthrough.
 *
 * Lab Mode manager 2026-05-22. Inside the DemoLabModeViewer. Cursor
 * clicks the Search tab; LabSearchPanel mounts with its filter chips.
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";

export const labModeSearchStep = buildLabModeTabStep({
  id: "lab-mode-search",
  tabTarget: TOUR_TARGETS.labModeSearchTab,
  speech: (
    <>
      <p>
        Last thing: lab-wide search. Filter by date, owner, method,
        experiment, anything.
      </p>
      <p>
        Quick example. Type a query, or pick a filter chip like
        someone&apos;s name, results render below.
      </p>
    </>
  ),
});
