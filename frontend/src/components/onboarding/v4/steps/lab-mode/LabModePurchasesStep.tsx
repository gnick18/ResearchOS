"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Purchases tab walkthrough.
 *
 * Lab Mode manager 2026-05-22. Inside the DemoLabModeViewer. Cursor
 * clicks the Purchases tab; the lab-wide funding rollup panel mounts.
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";

export const labModePurchasesStep = buildLabModeTabStep({
  id: "lab-mode-purchases",
  tabTarget: TOUR_TARGETS.labModePurchasesTab,
  speech: (
    <>
      <p>
        Purchases at the lab level. This is where PIs and lab managers
        live.
      </p>
      <p>
        Funding-string balances, who placed each order, when it
        shipped, what experiment it tied to. All the audit-story info
        in one place.
      </p>
    </>
  ),
});
