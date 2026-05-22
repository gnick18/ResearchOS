"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Methods tab walkthrough.
 *
 * Lab Mode manager 2026-05-22, enriched in Lab Mode fix manager R1
 * (2026-05-22). Beats:
 *
 *   1. Click the Methods tab so the methods-usage ranking mounts.
 *   2. (Deferred) click the top-ranked method row → linked
 *      experiments list expands inline.
 *   3. (Deferred) click the first linked experiment → TaskDetailPopup
 *      mounts.
 *   4. (Deferred) click the popup close button → popup dismisses.
 *
 * Three deferred clicks because each downstream anchor only mounts
 * after the previous click plays.
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";

const TOP_ROW = `[data-tour-target="${TOUR_TARGETS.labModeMethodsTopRow}"]`;
const FIRST_EXPERIMENT = `[data-tour-target="${TOUR_TARGETS.labModeMethodsFirstExperiment}"]`;
const POPUP_CLOSE = `[data-tour-target="task-popup-close"]`;

export const labModeMethodsStep = buildLabModeTabStep({
  id: "lab-mode-methods",
  tabTarget: TOUR_TARGETS.labModeMethodsTab,
  speech: (
    <>
      <p>
        Methods in use ranks every method by how often the lab runs
        it.
      </p>
      <p>
        You can see who&apos;s used a method, what experiments link to
        it. Useful for inheriting protocols, find the person who runs
        it most, ask them what&apos;s quirky.
      </p>
    </>
  ),
  additionalActions: async ({ deferredClickAction }) => {
    return [
      deferredClickAction(TOP_ROW),
      deferredClickAction(FIRST_EXPERIMENT),
      deferredClickAction(POPUP_CLOSE),
    ];
  },
});
