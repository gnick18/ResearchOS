/**
 * R4 Lab Overview tour — intro step shape tests.
 *
 * Covers id, pose, expectedRoute, manual completion, and the lab-only
 * gate. Pure-narration step; no cursor, no resume-guard.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { labOverviewIntroStep } from "../LabOverviewIntroStep";

describe("labOverviewIntroStep shape", () => {
  it("exposes id, pose, completion, gate, expectedRoute", () => {
    expect(labOverviewIntroStep.id).toBe("lab-overview-intro");
    expect(labOverviewIntroStep.pose).toBe("waving");
    expect(labOverviewIntroStep.completion.type).toBe("manual");
    expect(labOverviewIntroStep.expectedRoute).toBe("/lab-overview");
    const gate = labOverviewIntroStep.conditionalOn!;
    expect(gate({ account_type: "lab" })).toBe(true);
    expect(gate({ account_type: "solo" })).toBe(false);
    expect(gate(null)).toBe(false);
  });

  it("renders the body without crashing", () => {
    const speechNode =
      typeof labOverviewIntroStep.speech === "function"
        ? labOverviewIntroStep.speech()
        : labOverviewIntroStep.speech;
    const { getByTestId } = render(<>{speechNode}</>);
    expect(getByTestId("lab-overview-intro")).toBeTruthy();
  });
});
