/**
 * R4 Lab Overview tour — widget canvas step shape tests.
 *
 * Covers id, pose, target selector resolution, manual completion, the
 * lab-only gate, and the cursor script's graceful degradation when the
 * canvas anchor isn't mounted (e.g. the layout hasn't loaded yet).
 */
import { describe, expect, it, afterEach } from "vitest";
import { render } from "@testing-library/react";

import { labOverviewWidgetCanvasStep } from "../LabOverviewWidgetCanvasStep";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("labOverviewWidgetCanvasStep shape", () => {
  it("exposes id, pose, target selector, manual completion, gate", () => {
    expect(labOverviewWidgetCanvasStep.id).toBe("lab-overview-widget-canvas");
    expect(labOverviewWidgetCanvasStep.pose).toBe("pointing");
    expect(labOverviewWidgetCanvasStep.targetSelector).toBe(
      `[data-tour-target="lab-overview-canvas"]`,
    );
    expect(labOverviewWidgetCanvasStep.completion.type).toBe("manual");
    expect(labOverviewWidgetCanvasStep.expectedRoute).toBe("/lab-overview");
    // setup-q1c lab head manager 2026-05-23: gate is now `lab_head ===
    // true`, not `account_type === "lab"`. Lab members (account_type=lab
    // but lab_head=false) skip the cluster; only lab heads see it.
    const gate = labOverviewWidgetCanvasStep.conditionalOn!;
    expect(gate({ account_type: "lab", lab_head: true })).toBe(true);
    expect(gate({ account_type: "lab", lab_head: false })).toBe(false);
    expect(gate({ account_type: "lab" })).toBe(false);
    expect(gate({ account_type: "solo" })).toBe(false);
  });

  it("renders the body without crashing", () => {
    const speechNode =
      typeof labOverviewWidgetCanvasStep.speech === "function"
        ? labOverviewWidgetCanvasStep.speech()
        : labOverviewWidgetCanvasStep.speech;
    const { getByTestId } = render(<>{speechNode}</>);
    expect(getByTestId("lab-overview-widget-canvas")).toBeTruthy();
  });

  it("cursorScript produces an action when the anchor is mounted", async () => {
    document.body.innerHTML =
      '<div data-tour-target="lab-overview-canvas">grid</div>';
    const actions = await labOverviewWidgetCanvasStep.cursorScript?.();
    expect(actions).toBeTruthy();
    expect(actions!.length).toBeGreaterThan(0);
  });

  it(
    "cursorScript returns an empty list when the anchor is missing",
    async () => {
      document.body.innerHTML = "";
      // waitForElement (inside safeGlideToElementAction) has a 5s default
      // timeout; the test timeout has to clear that with a small buffer.
      const actions = await labOverviewWidgetCanvasStep.cursorScript?.();
      expect(actions).toEqual([]);
    },
    10_000,
  );
});
