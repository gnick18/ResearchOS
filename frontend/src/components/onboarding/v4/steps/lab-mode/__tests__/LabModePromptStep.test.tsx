/**
 * §6.16 Phase 2c Lab Mode tour — lab-mode-prompt step tests.
 *
 * Covers:
 *   - Step shape: id, pose (thinking), manual fallback completion,
 *     conditionalOn gate.
 *   - The three buttons render with the right labels.
 *   - Picking Now: persists `lab_mode_tour_choice = "now"` + calls
 *     branchTo("lab-mode-intro").
 *   - Picking Later: persists `lab_mode_tour_choice = "later"` and
 *     mirrors `lab_tour_pending = true`; branches to `lab-cleanup`.
 *   - Picking Dismiss: persists `lab_mode_tour_choice = "dismiss"`
 *     and mirrors `lab_tour_dismissed_at` to a timestamp; branches
 *     to `lab-cleanup`.
 *   - `LAB_MODE_PROMPT_BRANCHES` shape.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

const { patchOnboardingMock, getCurrentUserCachedMock, branchToMock } = vi.hoisted(
  () => ({
    patchOnboardingMock: vi.fn(),
    getCurrentUserCachedMock: vi.fn(),
    branchToMock: vi.fn(),
  }),
);

vi.mock("@/lib/onboarding/sidecar", () => ({
  patchOnboarding: patchOnboardingMock,
  readOnboarding: vi.fn(),
}));

vi.mock("@/lib/storage/json-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/json-store")>();
  return {
    ...actual,
    getCurrentUserCached: getCurrentUserCachedMock,
  };
});

vi.mock("../../../TourController", () => ({
  useTourController: () => ({
    branchTo: branchToMock,
    noteManualAdvance: () => {},
    exitTour: () => {},
  }),
}));

import {
  labModePromptStep,
  LAB_MODE_PROMPT_BRANCHES,
} from "../LabModePromptStep";

function renderSpeech() {
  const speechNode =
    typeof labModePromptStep.speech === "function"
      ? labModePromptStep.speech()
      : labModePromptStep.speech;
  return render(<>{speechNode}</>);
}

describe("labModePromptStep shape", () => {
  it("exposes the expected id + pose + manual fallback completion", () => {
    expect(labModePromptStep.id).toBe("lab-mode-prompt");
    expect(labModePromptStep.pose).toBe("thinking");
    expect(labModePromptStep.completion.type).toBe("manual");
  });

  it("gates on picks.account_type === 'lab'", () => {
    const gate = labModePromptStep.conditionalOn!;
    expect(gate({ account_type: "lab" })).toBe(true);
    expect(gate({ account_type: "solo" })).toBe(false);
    expect(gate(null)).toBe(false);
  });

  it("LAB_MODE_PROMPT_BRANCHES routes Now to intro and Later/Dismiss to lab-cleanup", () => {
    expect(LAB_MODE_PROMPT_BRANCHES.now).toBe("lab-mode-intro");
    expect(LAB_MODE_PROMPT_BRANCHES.later).toBe("lab-cleanup");
    expect(LAB_MODE_PROMPT_BRANCHES.dismiss).toBe("lab-cleanup");
  });
});

describe("labModePromptStep button behavior", () => {
  beforeEach(() => {
    patchOnboardingMock.mockReset();
    getCurrentUserCachedMock.mockReset();
    branchToMock.mockReset();
    getCurrentUserCachedMock.mockResolvedValue("alex");
    patchOnboardingMock.mockImplementation(async (_username, patch) =>
      patch({
        version: 4,
        first_seen_at: "",
        active_seconds: 0,
        feature_picks: null,
        wizard_completed_at: null,
        wizard_skipped_at: null,
        wizard_force_show: false,
        wizard_resume_state: null,
        lab_tour_pending: false,
        lab_tour_dismissed_at: null,
        lab_mode_tour_choice: null,
      }),
    );
  });

  it("renders Now / Later / Dismiss buttons with their labels", () => {
    const { getByText } = renderSpeech();
    expect(getByText(/Now \(/)).toBeTruthy();
    expect(getByText(/Later/)).toBeTruthy();
    expect(getByText(/Dismiss/)).toBeTruthy();
  });

  it("clicking Now persists lab_mode_tour_choice='now' and branches to lab-mode-intro", async () => {
    const { getByText } = renderSpeech();
    fireEvent.click(getByText(/Now \(/));
    await waitFor(() => {
      expect(patchOnboardingMock).toHaveBeenCalledTimes(1);
    });
    const patchedRecord = await patchOnboardingMock.mock.results[0]!.value;
    expect(patchedRecord.lab_mode_tour_choice).toBe("now");
    expect(patchedRecord.lab_tour_pending).toBe(false);
    expect(patchedRecord.lab_tour_dismissed_at).toBeNull();
    expect(branchToMock).toHaveBeenCalledWith("lab-mode-intro");
  });

  it("clicking Later persists 'later' and branches to lab-cleanup", async () => {
    const { getByText } = renderSpeech();
    fireEvent.click(getByText(/Later/));
    await waitFor(() => {
      expect(patchOnboardingMock).toHaveBeenCalledTimes(1);
    });
    const patchedRecord = await patchOnboardingMock.mock.results[0]!.value;
    expect(patchedRecord.lab_mode_tour_choice).toBe("later");
    // Back-compat mirror: lab_tour_pending stays in sync with the
    // new field for the brief back-compat window.
    expect(patchedRecord.lab_tour_pending).toBe(true);
    expect(branchToMock).toHaveBeenCalledWith("lab-cleanup");
  });

  it("clicking Dismiss persists 'dismiss' and an ISO timestamp into lab_tour_dismissed_at, then branches to lab-cleanup", async () => {
    const { getByText } = renderSpeech();
    fireEvent.click(getByText(/Dismiss/));
    await waitFor(() => {
      expect(patchOnboardingMock).toHaveBeenCalledTimes(1);
    });
    const patchedRecord = await patchOnboardingMock.mock.results[0]!.value;
    expect(patchedRecord.lab_mode_tour_choice).toBe("dismiss");
    expect(typeof patchedRecord.lab_tour_dismissed_at).toBe("string");
    expect(branchToMock).toHaveBeenCalledWith("lab-cleanup");
  });
});
