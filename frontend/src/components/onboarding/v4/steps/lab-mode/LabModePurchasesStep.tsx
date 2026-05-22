"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Purchases tab walkthrough.
 *
 * Lab Mode manager 2026-05-22, enriched in Lab Mode fix manager R1
 * (2026-05-22). Beats:
 *
 *   1. Click the Purchases tab so the lab-wide funding rollup mounts.
 *   2. (Deferred) scroll the first funding-balance card into view so
 *      the user's eye lands on the rollup row.
 *
 * No popup — the spec calls for "scroll to a balance card" as the
 * visible payoff. Clicking a balance card would FILTER the purchases
 * list, which would mislead the user about what the click is doing
 * (the speech says "audit-story info in one place," not "filter by
 * funding string").
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";
import {
  callbackAction,
  waitForElement,
} from "../walkthrough/lib/cursor-script";

const FIRST_FUNDING_CARD = `[data-tour-target="${TOUR_TARGETS.labModePurchasesFirstFundingCard}"]`;

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
  additionalActions: async () => {
    const spotlight = callbackAction(async () => {
      const el = await waitForElement(FIRST_FUNDING_CARD, 4000);
      if (!el) return;
      try {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch {
        // jsdom / non-browser — silently no-op.
      }
    });
    return [spotlight];
  },
});
