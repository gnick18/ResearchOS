"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Experiments tab walkthrough.
 *
 * Lab Mode manager 2026-05-22, enriched in Lab Mode fix manager R1
 * (2026-05-22). Beats:
 *
 *   1. Click the Experiments tab so the gallery mounts.
 *   2. (Deferred) glide the cursor over the first experiment card so
 *      the user's eye lands on it. No click — the spec calls for a
 *      scroll + spotlight only, since the next step is the popup-
 *      heavy purchases beat and a flickering popup chain would be
 *      visual noise.
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";
import {
  callbackAction,
  waitForElement,
} from "../walkthrough/lib/cursor-script";

const FIRST_CARD = `[data-tour-target="${TOUR_TARGETS.labModeExperimentsFirstCard}"]`;

export const labModeExperimentsStep = buildLabModeTabStep({
  id: "lab-mode-experiments",
  tabTarget: TOUR_TARGETS.labModeExperimentsTab,
  speech: (
    <>
      <p>
        Experiments tab summarizes every recent experiment in the lab,
        both active and completed.
      </p>
      <p>
        Great for the &ldquo;has anyone done X before?&rdquo; moment.
        Search-friendly, filterable by status.
      </p>
    </>
  ),
  additionalActions: async () => {
    // Wait for the first card to mount, then scroll it to center as a
    // soft spotlight beat. No click — the experiments tab tour is a
    // visual highlight per the spec. Wrapped in callbackAction so the
    // wait + scroll happens at playback time (the cards only render
    // after the tab click).
    const spotlight = callbackAction(async () => {
      const el = await waitForElement(FIRST_CARD, 4000);
      if (!el) return;
      try {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch {
        // jsdom / non-browser — silently no-op. The visual spotlight
        // is best-effort.
      }
    });
    return [spotlight];
  },
});
