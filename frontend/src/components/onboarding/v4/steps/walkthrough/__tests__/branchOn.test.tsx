/**
 * `branchOn` completion primitive tests.
 *
 * Inline-editor collapse (onboarding-inline bot 2026-06-02): the §6.7 HE-2
 * `hybrid-markdown-familiarity` branch gate (the "have you used markdown
 * before?" picker) was removed when the HE-1..HE-11 markdown deep-dive
 * collapsed into the single `inline-editor` beat. The HE-2-specific tests
 * that lived here are gone with it. The generic `branchOn` helper is still
 * used by other branch steps (e.g. the Gantt cluster), so its unit test is
 * retained.
 */
import { describe, expect, it } from "vitest";
import { branchOn } from "../lib/step-helpers";

describe("branchOn helper", () => {
  it("produces a TourStepCompletion with type 'branch' + the branches array", () => {
    const c = branchOn([
      { label: "a", buttonLabel: "A", nextStep: "step-a" },
      { label: "b", buttonLabel: "B", nextStep: "step-b" },
    ]);
    expect(c.type).toBe("branch");
    if (c.type === "branch") {
      expect(c.branches).toHaveLength(2);
      expect(c.branches[0].nextStep).toBe("step-a");
      expect(c.branches[1].buttonLabel).toBe("B");
    }
  });
});
