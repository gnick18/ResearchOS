/**
 * §6.7 HE-2 branchOn primitive tests.
 *
 * Asserts:
 *   - `branchOn(...)` produces a TourStepCompletion with type "branch"
 *     and the expected branches array shape
 *   - The hybrid-markdown-familiarity step's inner picker renders the
 *     yes/no buttons initially, then transitions to the follow-up
 *     question on the "no" branch.
 *   - Each terminal button calls `branchTo` with the expected next step.
 */
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import {
  hybridMarkdownFamiliarityStep,
  HE2_BRANCH_TARGETS,
} from "../HybridMarkdownFamiliarityStep";
import { branchOn } from "../lib/step-helpers";

// Mock useTourController so the picker can read it without a full
// provider mount. The mock captures branchTo calls so the test can
// assert on the chosen next step.
const branchToMock = vi.fn();
vi.mock("../../../TourController", () => ({
  useTourController: () => ({
    branchTo: branchToMock,
    noteManualAdvance: () => {},
    exitTour: () => {},
  }),
}));

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
  it("step body uses pose: thinking + manual completion", () => {
    expect(hybridMarkdownFamiliarityStep.pose).toBe("thinking");
    expect(hybridMarkdownFamiliarityStep.completion.type).toBe("manual");
  });

  it("renders the yes/no buttons initially", () => {
    branchToMock.mockReset();
    const speechNode =
      typeof hybridMarkdownFamiliarityStep.speech === "function"
        ? hybridMarkdownFamiliarityStep.speech()
        : hybridMarkdownFamiliarityStep.speech;
    const { getByText, queryByText } = render(<>{speechNode}</>);
    expect(getByText("Yes, I know markdown")).toBeTruthy();
    expect(getByText("No, never used it")).toBeTruthy();
    // Follow-up buttons not visible yet.
    expect(queryByText("Sure, show me")).toBeNull();
  });

  it("clicking 'Yes' jumps directly to hybrid-editor-mechanic (skips overview)", () => {
    branchToMock.mockReset();
    const speechNode =
      typeof hybridMarkdownFamiliarityStep.speech === "function"
        ? hybridMarkdownFamiliarityStep.speech()
        : hybridMarkdownFamiliarityStep.speech;
    const { getByText } = render(<>{speechNode}</>);
    fireEvent.click(getByText("Yes, I know markdown"));
    expect(branchToMock).toHaveBeenCalledWith(HE2_BRANCH_TARGETS.knowsMarkdown);
    expect(HE2_BRANCH_TARGETS.knowsMarkdown).toBe("hybrid-editor-mechanic");
  });

  it("clicking 'No' shows the follow-up question with sure/skip buttons", () => {
    branchToMock.mockReset();
    const speechNode =
      typeof hybridMarkdownFamiliarityStep.speech === "function"
        ? hybridMarkdownFamiliarityStep.speech()
        : hybridMarkdownFamiliarityStep.speech;
    const { getByText } = render(<>{speechNode}</>);
    fireEvent.click(getByText("No, never used it"));
    // Follow-up beat: the two terminal buttons should now be on screen.
    expect(getByText("Sure, show me")).toBeTruthy();
    expect(getByText(/Skip,/)).toBeTruthy();
    // branchTo NOT called yet (the no click is internal-only).
    expect(branchToMock).not.toHaveBeenCalled();
  });

  it("'Sure, show me' jumps to the overview step (HE-3)", () => {
    branchToMock.mockReset();
    const speechNode =
      typeof hybridMarkdownFamiliarityStep.speech === "function"
        ? hybridMarkdownFamiliarityStep.speech()
        : hybridMarkdownFamiliarityStep.speech;
    const { getByText } = render(<>{speechNode}</>);
    fireEvent.click(getByText("No, never used it"));
    fireEvent.click(getByText("Sure, show me"));
    expect(branchToMock).toHaveBeenCalledWith(HE2_BRANCH_TARGETS.wantsOverview);
    expect(HE2_BRANCH_TARGETS.wantsOverview).toBe("hybrid-markdown-overview");
  });

  it("'Skip, I'll learn as I go' jumps past the overview to HE-4", () => {
    branchToMock.mockReset();
    const speechNode =
      typeof hybridMarkdownFamiliarityStep.speech === "function"
        ? hybridMarkdownFamiliarityStep.speech()
        : hybridMarkdownFamiliarityStep.speech;
    const { getByText } = render(<>{speechNode}</>);
    fireEvent.click(getByText("No, never used it"));
    fireEvent.click(getByText(/Skip,/));
    expect(branchToMock).toHaveBeenCalledWith(HE2_BRANCH_TARGETS.skipOverview);
    expect(HE2_BRANCH_TARGETS.skipOverview).toBe("hybrid-editor-mechanic");
  });
});
