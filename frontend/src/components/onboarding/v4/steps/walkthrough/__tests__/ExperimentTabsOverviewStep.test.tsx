/**
 * §6.6 walkthrough reorder — experiment-tabs sub-bot (2026-05-26).
 *
 * Tests for the new `experiment-tabs-overview` beat that lands BETWEEN
 * `experiment-attach-method-open` and `experiment-attach-method-tab`.
 * Pure narration plus a soft cursor glide across the four popup tabs.
 *
 * The tests guard three things:
 *
 *   1. Step ORDER in TOUR_STEP_ORDER: -open → tabs-overview → -tab.
 *      This is the load-bearing assertion for the reorder; if the
 *      machine walks the wrong order, the user reverts to seeing the
 *      click demo before the conceptual frame.
 *   2. Step CONTENT: the speech bubble names all four tabs (Details,
 *      Lab Notes, Method, Results), explains what each holds, and
 *      ends with a transition cue into the methods-attach demo.
 *   3. No em-dashes in the new speech (Grant's standing rule —
 *      mirrored on the universal step-bodies sweep, but checked here
 *      again so a regression on this specific body fails loudly).
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { TourStep } from "../../../step-types";
import { TOUR_STEP_ORDER } from "../../../step-machine";
import { TOUR_STEPS } from "../../../step-registry";
import { experimentTabsOverviewStep } from "../ExperimentTabsOverviewStep";

/** Render the step's speech to plain text for substring assertions.
 *  Mirrors the shared helper in step-bodies.test.tsx so this test's
 *  output matches the universal sweep. */
function renderSpeech(step: TourStep): string {
  const speech =
    typeof step.speech === "function" ? step.speech() : step.speech;
  const { container, unmount } = render(<>{speech}</>);
  const text = container.textContent ?? "";
  unmount();
  return text;
}

describe("experiment-tabs-overview step (§6.6 reorder, 2026-05-26)", () => {
  it("has the expected id", () => {
    expect(experimentTabsOverviewStep.id).toBe("experiment-tabs-overview");
  });

  it("lands between experiment-attach-method-open and -tab in TOUR_STEP_ORDER", () => {
    const order = TOUR_STEP_ORDER;
    const openIdx = order.indexOf("experiment-attach-method-open");
    const overviewIdx = order.indexOf("experiment-tabs-overview");
    const tabIdx = order.indexOf("experiment-attach-method-tab");
    expect(openIdx, "experiment-attach-method-open missing from TOUR_STEP_ORDER").toBeGreaterThanOrEqual(0);
    expect(overviewIdx, "experiment-tabs-overview missing from TOUR_STEP_ORDER").toBeGreaterThanOrEqual(0);
    expect(tabIdx, "experiment-attach-method-tab missing from TOUR_STEP_ORDER").toBeGreaterThanOrEqual(0);
    // The reorder contract: overview sits strictly between -open and -tab.
    expect(overviewIdx).toBeGreaterThan(openIdx);
    expect(overviewIdx).toBeLessThan(tabIdx);
    // And specifically immediately after -open (no orphan steps between).
    expect(overviewIdx).toBe(openIdx + 1);
  });

  it("resolves to a registered body in step-registry", () => {
    expect(TOUR_STEPS["experiment-tabs-overview"]).toBeDefined();
    expect(TOUR_STEPS["experiment-tabs-overview"]).toBe(experimentTabsOverviewStep);
  });

  it("speech names all four popup tabs in the right order", () => {
    const text = renderSpeech(experimentTabsOverviewStep);
    // Each of the four tabs must be present so the user reads the
    // full conceptual frame before any tab-click demo fires.
    const detailsIdx = text.indexOf("Details");
    const labNotesIdx = text.indexOf("Lab Notes");
    const methodIdx = text.indexOf("Method");
    const resultsIdx = text.indexOf("Results");
    expect(detailsIdx, "Details tab missing from overview speech").toBeGreaterThanOrEqual(0);
    expect(labNotesIdx, "Lab Notes tab missing from overview speech").toBeGreaterThanOrEqual(0);
    expect(methodIdx, "Method tab missing from overview speech").toBeGreaterThanOrEqual(0);
    expect(resultsIdx, "Results tab missing from overview speech").toBeGreaterThanOrEqual(0);
    // Order matches the rendered pill row: Details, Lab Notes,
    // Method, Results. The bullets in the speech follow the same
    // order so the user's eye can map speech to spotlight without
    // re-scanning.
    expect(detailsIdx).toBeLessThan(labNotesIdx);
    expect(labNotesIdx).toBeLessThan(methodIdx);
    expect(methodIdx).toBeLessThan(resultsIdx);
  });

  it("speech ends with a transition cue into the methods-attach demo", () => {
    const text = renderSpeech(experimentTabsOverviewStep);
    // The brief: "End with 'Then I'll show you how to attach a
    // method' or similar transition cue". We use "Now I'll show you
    // how to attach a method" which delivers the same cue.
    expect(text).toMatch(/attach a method/i);
  });

  it("speech contains no em-dashes (Grant's standing rule)", () => {
    const text = renderSpeech(experimentTabsOverviewStep);
    expect(text.includes("—"), "em-dash (U+2014) found in overview speech").toBe(false);
  });

  it("spotlight targets the experiment-tab-container so all four pills sit inside the ring", () => {
    expect(experimentTabsOverviewStep.targetSelector).toBe(
      "[data-tour-target=\"experiment-tab-container\"]",
    );
  });

  it("uses manual completion (universal pacing rule, Grant 2026-05-22)", () => {
    expect(experimentTabsOverviewStep.completion.type).toBe("manual");
  });

  it("expectedRoute is /workbench (popup is portaled over /workbench)", () => {
    expect(experimentTabsOverviewStep.expectedRoute).toBe("/workbench");
  });

  it("has a cursorScript for the soft tab-glide demo", () => {
    expect(experimentTabsOverviewStep.cursorScript).toBeDefined();
  });
});
