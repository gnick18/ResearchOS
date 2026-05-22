/**
 * §6.7 HE-2 branchOn primitive tests.
 *
 * R1 fix-pass (Hybrid fix manager R1, 2026-05-22): HE-2 was refactored
 * to use the declarative `branchOn` completion primitive. The inline
 * picker UI is gone; the controller renders one button per branch
 * underneath the speech. Tests asserting on the inner-picker
 * rendering have been retired; the new shape is verified by:
 *
 *   - `branchOn(...)` produces a TourStepCompletion with type "branch"
 *     and the expected branches array
 *   - HE-2's completion declares the three branches mapping to the
 *     HE2_BRANCH_TARGETS destinations
 *   - The HE-2 speech is pure narration (no rendered buttons inside
 *     the speech itself)
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  hybridMarkdownFamiliarityStep,
  HE2_BRANCH_TARGETS,
} from "../HybridMarkdownFamiliarityStep";
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

describe("HybridMarkdownFamiliarityStep (§6.7 HE-2 branch gate)", () => {
  it("step body uses pose: thinking + branch completion", () => {
    expect(hybridMarkdownFamiliarityStep.pose).toBe("thinking");
    expect(hybridMarkdownFamiliarityStep.completion.type).toBe("branch");
  });

  it("declares three branches mapping to the HE2_BRANCH_TARGETS destinations", () => {
    const c = hybridMarkdownFamiliarityStep.completion;
    expect(c.type).toBe("branch");
    if (c.type !== "branch") return;
    expect(c.branches).toHaveLength(3);
    const dests = new Set(c.branches.map((b) => b.nextStep));
    expect(dests.has(HE2_BRANCH_TARGETS.knowsMarkdown)).toBe(true);
    expect(dests.has(HE2_BRANCH_TARGETS.wantsOverview)).toBe(true);
    expect(dests.has(HE2_BRANCH_TARGETS.skipOverview)).toBe(true);
  });

  it("knowsMarkdown + skipOverview both route to hybrid-editor-mechanic (HE-4)", () => {
    expect(HE2_BRANCH_TARGETS.knowsMarkdown).toBe("hybrid-editor-mechanic");
    expect(HE2_BRANCH_TARGETS.skipOverview).toBe("hybrid-editor-mechanic");
    expect(HE2_BRANCH_TARGETS.wantsOverview).toBe("hybrid-markdown-overview");
  });

  it("speech is pure narration — no inline button elements", () => {
    const speechNode =
      typeof hybridMarkdownFamiliarityStep.speech === "function"
        ? hybridMarkdownFamiliarityStep.speech()
        : hybridMarkdownFamiliarityStep.speech;
    const { container, queryByText } = render(<>{speechNode}</>);
    // The speech bubble's narration should mention markdown but the
    // branch buttons themselves are NOT rendered by the speech (they
    // come from the controller's branch-rendering path).
    expect(container.querySelector("button")).toBeNull();
    // The narration should ask the familiarity question.
    expect(queryByText(/used markdown before/i)).toBeTruthy();
  });
});
