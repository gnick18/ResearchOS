/**
 * R4 Lab Overview tour — sidebar rail step shape tests.
 *
 * Covers id, pose, target selector resolution, manual completion, the
 * lab-only gate, and graceful cursor-script degradation when the
 * sidebar anchor isn't yet mounted.
 */
import { describe, expect, it, afterEach } from "vitest";
import { render } from "@testing-library/react";

import { labOverviewSidebarRailStep } from "../LabOverviewSidebarRailStep";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("labOverviewSidebarRailStep shape", () => {
  it("exposes id, pose, target selector, manual completion, gate", () => {
    expect(labOverviewSidebarRailStep.id).toBe("lab-overview-sidebar-rail");
    expect(labOverviewSidebarRailStep.pose).toBe("pointing");
    expect(labOverviewSidebarRailStep.targetSelector).toBe(
      `[data-tour-target="lab-overview-sidebar"]`,
    );
    expect(labOverviewSidebarRailStep.completion.type).toBe("manual");
    expect(labOverviewSidebarRailStep.expectedRoute).toBe("/lab-overview");
    const gate = labOverviewSidebarRailStep.conditionalOn!;
    expect(gate({ account_type: "lab" })).toBe(true);
    expect(gate({ account_type: "solo" })).toBe(false);
  });

  it("renders the body without crashing", () => {
    const speechNode =
      typeof labOverviewSidebarRailStep.speech === "function"
        ? labOverviewSidebarRailStep.speech()
        : labOverviewSidebarRailStep.speech;
    const { getByTestId } = render(<>{speechNode}</>);
    expect(getByTestId("lab-overview-sidebar-rail")).toBeTruthy();
  });

  it("cursorScript produces an action when the anchor is mounted", async () => {
    document.body.innerHTML =
      '<aside data-tour-target="lab-overview-sidebar">rail</aside>';
    const actions = await labOverviewSidebarRailStep.cursorScript?.();
    expect(actions).toBeTruthy();
    expect(actions!.length).toBeGreaterThan(0);
  });

  it(
    "cursorScript returns an empty list when the anchor is missing",
    async () => {
      document.body.innerHTML = "";
      const actions = await labOverviewSidebarRailStep.cursorScript?.();
      expect(actions).toEqual([]);
    },
    10_000,
  );
});
