/**
 * R4 Lab Overview tour — exit step shape tests.
 *
 * Covers id, pose, manual completion ("Let's customize"), and the
 * lab-only gate. Pure-narration terminal beat for the cluster.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { labOverviewExitStep } from "../LabOverviewExitStep";

describe("labOverviewExitStep shape", () => {
  it("exposes id, pose, completion, gate, expectedRoute", () => {
    expect(labOverviewExitStep.id).toBe("lab-overview-exit");
    expect(labOverviewExitStep.pose).toBe("waving");
    expect(labOverviewExitStep.completion.type).toBe("manual");
    if (labOverviewExitStep.completion.type === "manual") {
      expect(labOverviewExitStep.completion.buttonLabel).toMatch(/customize/i);
    }
    expect(labOverviewExitStep.expectedRoute).toBe("/lab-overview");
    // setup-q1c lab head manager 2026-05-23: gate is now `lab_head ===
    // true`. Lab members skip the cluster; only lab heads see it.
    const gate = labOverviewExitStep.conditionalOn!;
    expect(gate({ account_type: "lab", lab_head: true })).toBe(true);
    expect(gate({ account_type: "lab", lab_head: false })).toBe(false);
    expect(gate({ account_type: "lab" })).toBe(false);
    expect(gate({ account_type: "solo" })).toBe(false);
    expect(gate(null)).toBe(false);
  });

  it("renders the body without crashing", () => {
    const speechNode =
      typeof labOverviewExitStep.speech === "function"
        ? labOverviewExitStep.speech()
        : labOverviewExitStep.speech;
    const { getByTestId } = render(<>{speechNode}</>);
    expect(getByTestId("lab-overview-exit")).toBeTruthy();
  });
});
