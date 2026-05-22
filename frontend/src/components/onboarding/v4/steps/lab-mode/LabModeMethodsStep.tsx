"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Methods tab walkthrough.
 *
 * Lab Mode manager 2026-05-22. Inside the DemoLabModeViewer. Cursor
 * clicks the Methods tab; methods-usage ranking renders.
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";

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
});
