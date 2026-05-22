/**
 * §6.16 Phase 2c Lab Mode tour — lab-mode-prompt step tests.
 *
 * Lab Mode fix manager R1 (2026-05-22) updated the step to use the
 * declarative `branchOn` completion primitive + `onChoose` sidecar
 * persistence hook. Tests now assert:
 *
 *   - Step shape: id, pose (thinking), `branch` completion with the
 *     three branches, conditionalOn gate on account_type === "lab".
 *   - LAB_MODE_PROMPT_BRANCHES routes Now → lab-mode-intro,
 *     Later → lab-cleanup, Dismiss → lab-cleanup.
 *   - `persistLabModePromptChoice` writes lab_mode_tour_choice plus
 *     the back-compat mirrors (lab_tour_pending, lab_tour_dismissed_at).
 *   - The branchOn's onChoose hook dispatches the persistence function
 *     for each branch label.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { patchOnboardingMock, getCurrentUserCachedMock } = vi.hoisted(() => ({
  patchOnboardingMock: vi.fn(),
  getCurrentUserCachedMock: vi.fn(),
}));

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

import {
  labModePromptStep,
  LAB_MODE_PROMPT_BRANCHES,
  LAB_MODE_PROMPT_LABEL_TO_PICK,
  persistLabModePromptChoice,
} from "../LabModePromptStep";

function baselineSidecar() {
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
  };
}

describe("labModePromptStep shape", () => {
  it("exposes id + pose + branchOn completion", () => {
    expect(labModePromptStep.id).toBe("lab-mode-prompt");
    expect(labModePromptStep.pose).toBe("thinking");
    expect(labModePromptStep.completion.type).toBe("branch");
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

  it("declares three branches matching LAB_MODE_PROMPT_BRANCHES", () => {
    if (labModePromptStep.completion.type !== "branch") {
      throw new Error("expected branchOn completion");
    }
    const branches = labModePromptStep.completion.branches;
    expect(branches).toHaveLength(3);
    const byLabel = Object.fromEntries(branches.map((b) => [b.label, b]));
    expect(byLabel.now?.nextStep).toBe("lab-mode-intro");
    expect(byLabel.later?.nextStep).toBe("lab-cleanup");
    expect(byLabel.dismiss?.nextStep).toBe("lab-cleanup");
    expect(byLabel.now?.buttonLabel).toMatch(/now/i);
    expect(byLabel.later?.buttonLabel).toMatch(/later/i);
    expect(byLabel.dismiss?.buttonLabel).toMatch(/dismiss/i);
  });

  it("provides an onChoose hook (per Lab Mode fix manager R1)", () => {
    if (labModePromptStep.completion.type !== "branch") {
      throw new Error("expected branchOn completion");
    }
    expect(typeof labModePromptStep.completion.onChoose).toBe("function");
  });
});

describe("persistLabModePromptChoice", () => {
  beforeEach(() => {
    patchOnboardingMock.mockReset();
    getCurrentUserCachedMock.mockReset();
    getCurrentUserCachedMock.mockResolvedValue("alex");
    patchOnboardingMock.mockImplementation(async (_username, patch) =>
      patch(baselineSidecar()),
    );
  });

  it("writes lab_mode_tour_choice='now' with no back-compat side effects", async () => {
    await persistLabModePromptChoice("now");
    const result = await patchOnboardingMock.mock.results[0]!.value;
    expect(result.lab_mode_tour_choice).toBe("now");
    expect(result.lab_tour_pending).toBe(false);
    expect(result.lab_tour_dismissed_at).toBeNull();
  });

  it("writes lab_mode_tour_choice='later' + lab_tour_pending=true", async () => {
    await persistLabModePromptChoice("later");
    const result = await patchOnboardingMock.mock.results[0]!.value;
    expect(result.lab_mode_tour_choice).toBe("later");
    expect(result.lab_tour_pending).toBe(true);
    expect(result.lab_tour_dismissed_at).toBeNull();
  });

  it("writes lab_mode_tour_choice='dismiss' + ISO lab_tour_dismissed_at", async () => {
    await persistLabModePromptChoice("dismiss");
    const result = await patchOnboardingMock.mock.results[0]!.value;
    expect(result.lab_mode_tour_choice).toBe("dismiss");
    expect(result.lab_tour_pending).toBe(false);
    expect(typeof result.lab_tour_dismissed_at).toBe("string");
    // Loose ISO-shape check — must include a T separator and at least
    // a year-month-day prefix.
    expect(result.lab_tour_dismissed_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
    );
  });

  it("no-ops when no username is resolvable", async () => {
    await persistLabModePromptChoice("now", {
      getUsername: async () => null,
      patchSidecar: patchOnboardingMock,
    });
    expect(patchOnboardingMock).not.toHaveBeenCalled();
  });
});

describe("branchOn.onChoose dispatch", () => {
  beforeEach(() => {
    patchOnboardingMock.mockReset();
    getCurrentUserCachedMock.mockReset();
    getCurrentUserCachedMock.mockResolvedValue("alex");
    patchOnboardingMock.mockImplementation(async (_username, patch) =>
      patch(baselineSidecar()),
    );
  });

  it("dispatches persistence with the chosen branch's label → pick mapping", async () => {
    if (labModePromptStep.completion.type !== "branch") {
      throw new Error("expected branchOn completion");
    }
    const onChoose = labModePromptStep.completion.onChoose!;
    await onChoose({
      label: "now",
      buttonLabel: "Now (~5 min)",
      nextStep: "lab-mode-intro",
    });
    expect(patchOnboardingMock).toHaveBeenCalledTimes(1);
    const result = await patchOnboardingMock.mock.results[0]!.value;
    expect(result.lab_mode_tour_choice).toBe("now");
  });

  it("LAB_MODE_PROMPT_LABEL_TO_PICK covers every branch label", () => {
    if (labModePromptStep.completion.type !== "branch") {
      throw new Error("expected branchOn completion");
    }
    for (const b of labModePromptStep.completion.branches) {
      expect(LAB_MODE_PROMPT_LABEL_TO_PICK[b.label]).toBeTruthy();
    }
  });
});
