// propose_plan tool unit tests (ai plan bot, 2026-06-11).
//
// The pure helpers that read the model's plan arguments, plus the tool shape. The
// loop's behavior around propose_plan (raising the approval, flipping the run-level
// flag) is covered in agent-loop-plan.test.ts, this file pins the building blocks.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  proposePlanTool,
  readPlanSteps,
  readPlanSummary,
  PROPOSE_PLAN_TOOL_NAME,
} from "../tools/propose-plan";

describe("readPlanSteps", () => {
  it("keeps non-empty trimmed strings in order", () => {
    expect(
      readPlanSteps({ steps: ["  Go to Methods ", "Click New Method"] }),
    ).toEqual(["Go to Methods", "Click New Method"]);
  });

  it("drops blank and non-string entries", () => {
    expect(
      readPlanSteps({ steps: ["Real step", "", "   ", 42, null, "Another"] }),
    ).toEqual(["Real step", "Another"]);
  });

  it("returns an empty array when steps is missing or not an array", () => {
    expect(readPlanSteps({})).toEqual([]);
    expect(readPlanSteps({ steps: "not an array" })).toEqual([]);
  });
});

describe("readPlanSummary", () => {
  it("returns a trimmed summary when present", () => {
    expect(readPlanSummary({ summary: "  Open the form  " })).toBe(
      "Open the form",
    );
  });

  it("returns undefined when absent or blank", () => {
    expect(readPlanSummary({})).toBeUndefined();
    expect(readPlanSummary({ summary: "   " })).toBeUndefined();
    expect(readPlanSummary({ summary: 5 })).toBeUndefined();
  });
});

describe("proposePlanTool shape", () => {
  it("is named propose_plan and is NOT an action tool (it is the gate, not an action)", () => {
    expect(proposePlanTool.name).toBe(PROPOSE_PLAN_TOOL_NAME);
    expect(proposePlanTool.name).toBe("propose_plan");
    // No action flag, so the per-action gate never wraps it.
    expect(proposePlanTool.action).toBeFalsy();
  });

  it("requires steps in its parameters", () => {
    expect(proposePlanTool.parameters.required).toContain("steps");
  });
});
