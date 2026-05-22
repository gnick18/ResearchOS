/**
 * §6.16 Phase 2c Lab Mode tour — lab-mode-intro step tests.
 *
 * Covers step shape (id, pose, gate, manual completion + button
 * label) and the resume-guard: when the sidecar reports
 * `lab_mode_tour_choice === "later"` or `"dismiss"`, the body's
 * useEffect calls `branchTo("lab-cleanup")` so a stale resume into
 * this step routes past the cluster.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const { readOnboardingMock, getCurrentUserCachedMock, branchToMock } = vi.hoisted(
  () => ({
    readOnboardingMock: vi.fn(),
    getCurrentUserCachedMock: vi.fn(),
    branchToMock: vi.fn(),
  }),
);

vi.mock("@/lib/onboarding/sidecar", () => ({
  readOnboarding: readOnboardingMock,
  patchOnboarding: vi.fn(),
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

import { labModeIntroStep } from "../LabModeIntroStep";

function defaultSidecar(over: Record<string, unknown> = {}) {
  return {
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
    ...over,
  };
}

describe("labModeIntroStep shape", () => {
  it("exposes id, pose, completion, gate", () => {
    expect(labModeIntroStep.id).toBe("lab-mode-intro");
    expect(labModeIntroStep.pose).toBe("pointing");
    expect(labModeIntroStep.completion.type).toBe("manual");
    if (labModeIntroStep.completion.type === "manual") {
      expect(labModeIntroStep.completion.buttonLabel).toMatch(/take me there/i);
    }
    const gate = labModeIntroStep.conditionalOn!;
    expect(gate({ account_type: "lab" })).toBe(true);
    expect(gate({ account_type: "solo" })).toBe(false);
  });
});

describe("labModeIntroStep resume-guard", () => {
  beforeEach(() => {
    readOnboardingMock.mockReset();
    getCurrentUserCachedMock.mockReset();
    branchToMock.mockReset();
    getCurrentUserCachedMock.mockResolvedValue("alex");
  });

  it("does NOT branch away when lab_mode_tour_choice is 'now'", async () => {
    readOnboardingMock.mockResolvedValue(
      defaultSidecar({ lab_mode_tour_choice: "now" }),
    );
    const speechNode =
      typeof labModeIntroStep.speech === "function"
        ? labModeIntroStep.speech()
        : labModeIntroStep.speech;
    render(<>{speechNode}</>);
    // The promise queue needs to drain; allow a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(branchToMock).not.toHaveBeenCalled();
  });

  it("branches to lab-cleanup when lab_mode_tour_choice is 'later'", async () => {
    readOnboardingMock.mockResolvedValue(
      defaultSidecar({ lab_mode_tour_choice: "later" }),
    );
    const speechNode =
      typeof labModeIntroStep.speech === "function"
        ? labModeIntroStep.speech()
        : labModeIntroStep.speech;
    render(<>{speechNode}</>);
    await waitFor(() => {
      expect(branchToMock).toHaveBeenCalledWith("lab-cleanup");
    });
  });

  it("branches to lab-cleanup when lab_mode_tour_choice is 'dismiss'", async () => {
    readOnboardingMock.mockResolvedValue(
      defaultSidecar({ lab_mode_tour_choice: "dismiss" }),
    );
    const speechNode =
      typeof labModeIntroStep.speech === "function"
        ? labModeIntroStep.speech()
        : labModeIntroStep.speech;
    render(<>{speechNode}</>);
    await waitFor(() => {
      expect(branchToMock).toHaveBeenCalledWith("lab-cleanup");
    });
  });
});
