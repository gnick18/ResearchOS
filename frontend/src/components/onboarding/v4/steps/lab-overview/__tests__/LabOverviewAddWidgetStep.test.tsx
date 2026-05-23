/**
 * R4 Lab Overview tour — Add widget step shape tests.
 *
 * Covers id, pose, target selector resolution, manual completion, the
 * lab-only gate, and graceful cursor-script degradation when the
 * toolbar button isn't mounted.
 */
import { describe, expect, it, afterEach } from "vitest";
import { render } from "@testing-library/react";

import { labOverviewAddWidgetStep } from "../LabOverviewAddWidgetStep";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("labOverviewAddWidgetStep shape", () => {
  it("exposes id, pose, target selector, manual completion, gate", () => {
    expect(labOverviewAddWidgetStep.id).toBe("lab-overview-add-widget");
    expect(labOverviewAddWidgetStep.pose).toBe("pointing");
    expect(labOverviewAddWidgetStep.targetSelector).toBe(
      `[data-tour-target="lab-overview-add-widget"]`,
    );
    expect(labOverviewAddWidgetStep.completion.type).toBe("manual");
    expect(labOverviewAddWidgetStep.expectedRoute).toBe("/lab-overview");
    // setup-q1c lab head manager 2026-05-23: gate is now `lab_head ===
    // true`. Lab members skip the cluster; only lab heads see it.
    const gate = labOverviewAddWidgetStep.conditionalOn!;
    expect(gate({ account_type: "lab", lab_head: true })).toBe(true);
    expect(gate({ account_type: "lab", lab_head: false })).toBe(false);
    expect(gate({ account_type: "lab" })).toBe(false);
    expect(gate({ account_type: "solo" })).toBe(false);
  });

  it("renders the body without crashing", () => {
    const speechNode =
      typeof labOverviewAddWidgetStep.speech === "function"
        ? labOverviewAddWidgetStep.speech()
        : labOverviewAddWidgetStep.speech;
    const { getByTestId } = render(<>{speechNode}</>);
    expect(getByTestId("lab-overview-add-widget")).toBeTruthy();
  });

  it("cursorScript produces an action when the anchor is mounted", async () => {
    document.body.innerHTML =
      '<button data-tour-target="lab-overview-add-widget">+ Add widget</button>';
    const actions = await labOverviewAddWidgetStep.cursorScript?.();
    expect(actions).toBeTruthy();
    expect(actions!.length).toBeGreaterThan(0);
  });

  it(
    "cursorScript returns an empty list when the anchor is missing",
    async () => {
      document.body.innerHTML = "";
      const actions = await labOverviewAddWidgetStep.cursorScript?.();
      expect(actions).toEqual([]);
    },
    10_000,
  );
});
