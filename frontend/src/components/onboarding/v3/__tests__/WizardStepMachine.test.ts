import { describe, expect, it } from "vitest";
import {
  ALL_STEP_IDS,
  getLabTourDecision,
  getNextStep,
  getPreviousStep,
  isSetupStep,
  isStepSkippedByGate,
  stepCreatesPrerequisite,
  stepIndex,
  totalSteps,
  type WizardStep,
} from "../WizardStepMachine";
import type {
  FeaturePicks,
  OnboardingSidecar,
} from "@/lib/onboarding/sidecar";

const baseSidecar = (
  patch: Partial<OnboardingSidecar> = {},
): OnboardingSidecar => ({
  version: 4,
  first_seen_at: "2026-05-20T00:00:00.000Z",
  active_seconds: 0,
  feature_picks: null,
  wizard_completed_at: null,
  wizard_skipped_at: null,
  wizard_force_show: false,
  wizard_resume_state: null,
  lab_tour_pending: false,
  lab_tour_dismissed_at: null,
  ...patch,
});

const fullPicks = (over: Partial<FeaturePicks> = {}): FeaturePicks => ({
  account_type: "solo",
  purchases: "no",
  calendar: "no",
  goals: "no",
  telegram: "no",
  ai_helper: "no",
  ...over,
});

function walkForward(
  startStep: WizardStep,
  sidecar: OnboardingSidecar,
  picks: FeaturePicks | null,
): WizardStep[] {
  const visited: WizardStep[] = [startStep];
  let cur: WizardStep | null = startStep;
  for (let i = 0; i < 200; i++) {
    const next: WizardStep | null = getNextStep(cur, sidecar, picks);
    if (next === null) break;
    visited.push(next);
    cur = next;
  }
  return visited;
}

describe("WizardStepMachine: ALL_STEP_IDS", () => {
  it("enumerates every step id (setup + W + L + cleanup)", () => {
    expect(ALL_STEP_IDS.length).toBeGreaterThanOrEqual(36);
    expect(ALL_STEP_IDS).toContain("intro");
    expect(ALL_STEP_IDS).toContain("phase4-cleanup");
    expect(ALL_STEP_IDS).toContain("W14");
    expect(ALL_STEP_IDS).toContain("L11");
    expect(ALL_STEP_IDS).toContain("lab-prompt");
  });
});

describe("WizardStepMachine: isSetupStep / stepCreatesPrerequisite", () => {
  it("classifies setup-q1, intro, setup-q6 as setup steps", () => {
    expect(isSetupStep("intro")).toBe(true);
    expect(isSetupStep("setup-q1")).toBe(true);
    expect(isSetupStep("setup-q6")).toBe(true);
    expect(isSetupStep("W1")).toBe(false);
    expect(isSetupStep("phase4-cleanup")).toBe(false);
  });

  it("identifies W1/W2/W3 as prerequisite-creators", () => {
    expect(stepCreatesPrerequisite("W1")).toBe(true);
    expect(stepCreatesPrerequisite("W2")).toBe(true);
    expect(stepCreatesPrerequisite("W3")).toBe(true);
    expect(stepCreatesPrerequisite("W4")).toBe(false);
    expect(stepCreatesPrerequisite("intro")).toBe(false);
  });
});

describe("WizardStepMachine: solo minimal path", () => {
  it("walks setup → W1-W9 → cleanup, skipping q1a/q1b and W10-W14 and lab", () => {
    const sidecar = baseSidecar();
    const picks = fullPicks({ account_type: "solo" });
    const walked = walkForward("intro", sidecar, picks);
    expect(walked).toEqual([
      "intro",
      "setup-q1",
      "setup-q2",
      "setup-q3",
      "setup-q4",
      "setup-q5",
      "setup-q6",
      "W1",
      "W2",
      "W3",
      "W4",
      "W5",
      "W6",
      "W7",
      "W8",
      "W9",
      "phase4-cleanup",
    ]);
  });

  it("with picks=null at intro, also skips q1a/q1b and conditional steps", () => {
    const sidecar = baseSidecar();
    const walked = walkForward("intro", sidecar, null);
    expect(walked.slice(0, 8)).toEqual([
      "intro",
      "setup-q1",
      "setup-q2",
      "setup-q3",
      "setup-q4",
      "setup-q5",
      "setup-q6",
      "W1",
    ]);
    expect(walked.at(-1)).toBe("phase4-cleanup");
    expect(walked).not.toContain("setup-q1a");
  });
});

describe("WizardStepMachine: lab maximal path", () => {
  it("walks setup (with q1a/q1b) → W1-W14 → lab-prompt → L1-L11 → cleanup", () => {
    const sidecar = baseSidecar();
    const picks = fullPicks({
      account_type: "lab",
      purchases: "yes",
      calendar: "yes",
      goals: "yes",
      telegram: "yes",
      ai_helper: "full",
    });
    const walked = walkForward("intro", sidecar, picks);
    expect(walked).toEqual([
      "intro",
      "setup-q1",
      "setup-q1a",
      "setup-q1b",
      "setup-q2",
      "setup-q3",
      "setup-q4",
      "setup-q5",
      "setup-q6",
      "W1",
      "W2",
      "W3",
      "W4",
      "W5",
      "W6",
      "W7",
      "W8",
      "W9",
      "W10",
      "W11",
      "W12",
      "W13",
      "W14",
      "lab-prompt",
      "L1",
      "L2",
      "L3",
      "L4",
      "L5",
      "L6",
      "L7",
      "L8",
      "L9",
      "L10",
      "L11",
      "phase4-cleanup",
    ]);
  });

  it("when lab user defers ('later'), skips L1-L11 but keeps lab-prompt", () => {
    // P3a moved the "later" signal off the sentinel-in-skipped_steps
    // scheme onto the real sidecar field that P0 shipped (lab_tour_pending).
    const sidecar = baseSidecar({ lab_tour_pending: true });
    const picks = fullPicks({
      account_type: "lab",
      purchases: "yes",
      ai_helper: "medium",
    });
    const walked = walkForward("lab-prompt", sidecar, picks);
    expect(walked).toEqual(["lab-prompt", "phase4-cleanup"]);
  });

  it("when lab user dismisses, skips L1-L11", () => {
    // P3a reads lab_tour_dismissed_at directly.
    const sidecar = baseSidecar({
      lab_tour_dismissed_at: "2026-05-20T01:23:45.000Z",
    });
    const picks = fullPicks({ account_type: "lab" });
    expect(getNextStep("lab-prompt", sidecar, picks)).toBe("phase4-cleanup");
  });
});

describe("WizardStepMachine: conditional W10-W14 gating", () => {
  it("W10 fires only when purchases === yes", () => {
    expect(isStepSkippedByGate("W10", fullPicks({ purchases: "no" }), baseSidecar())).toBe(true);
    expect(isStepSkippedByGate("W10", fullPicks({ purchases: "maybe" }), baseSidecar())).toBe(true);
    expect(isStepSkippedByGate("W10", fullPicks({ purchases: "yes" }), baseSidecar())).toBe(false);
  });

  it("W11 fires only when goals === yes", () => {
    expect(isStepSkippedByGate("W11", fullPicks({ goals: "yes" }), baseSidecar())).toBe(false);
    expect(isStepSkippedByGate("W11", fullPicks({ goals: "no" }), baseSidecar())).toBe(true);
  });

  it("W12 fires only when telegram === yes", () => {
    expect(isStepSkippedByGate("W12", fullPicks({ telegram: "yes" }), baseSidecar())).toBe(false);
    expect(isStepSkippedByGate("W12", fullPicks({ telegram: "maybe" }), baseSidecar())).toBe(true);
  });

  it("W13 fires only when calendar === yes", () => {
    expect(isStepSkippedByGate("W13", fullPicks({ calendar: "yes" }), baseSidecar())).toBe(false);
    expect(isStepSkippedByGate("W13", fullPicks({ calendar: "no" }), baseSidecar())).toBe(true);
  });

  it("W14 fires when ai_helper is full/medium/minimal, skips on no/maybe", () => {
    expect(isStepSkippedByGate("W14", fullPicks({ ai_helper: "full" }), baseSidecar())).toBe(false);
    expect(isStepSkippedByGate("W14", fullPicks({ ai_helper: "medium" }), baseSidecar())).toBe(false);
    expect(isStepSkippedByGate("W14", fullPicks({ ai_helper: "minimal" }), baseSidecar())).toBe(false);
    expect(isStepSkippedByGate("W14", fullPicks({ ai_helper: "no" }), baseSidecar())).toBe(true);
    expect(isStepSkippedByGate("W14", fullPicks({ ai_helper: "maybe" }), baseSidecar())).toBe(true);
  });

  it("lab L8 fires only for lab + lab-tour-active + purchases:yes", () => {
    // P3a: "lab tour active" = sidecar has neither lab_tour_pending nor
    // lab_tour_dismissed_at set. The "Now" pick at lab-prompt writes
    // nothing, so the sidecar stays in this shape and L1-L11 (including
    // L8) flow as part of the universal walkthrough.
    const labNowYesPurchases = fullPicks({ account_type: "lab", purchases: "yes" });
    const sidecarActive = baseSidecar();
    expect(isStepSkippedByGate("L8", labNowYesPurchases, sidecarActive)).toBe(false);

    const labNowNoPurchases = fullPicks({ account_type: "lab", purchases: "no" });
    expect(isStepSkippedByGate("L8", labNowNoPurchases, sidecarActive)).toBe(true);

    const solo = fullPicks({ account_type: "solo", purchases: "yes" });
    expect(isStepSkippedByGate("L8", solo, sidecarActive)).toBe(true);

    // L8 also skips when the lab user opted out at lab-prompt.
    const labLater = baseSidecar({ lab_tour_pending: true });
    expect(isStepSkippedByGate("L8", labNowYesPurchases, labLater)).toBe(true);
    const labDismiss = baseSidecar({
      lab_tour_dismissed_at: "2026-05-20T00:00:00.000Z",
    });
    expect(isStepSkippedByGate("L8", labNowYesPurchases, labDismiss)).toBe(true);
  });
});

describe("WizardStepMachine: getPreviousStep", () => {
  it("returns null at intro", () => {
    const sidecar = baseSidecar();
    const picks = fullPicks({ account_type: "solo" });
    expect(getPreviousStep("intro", sidecar, picks)).toBeNull();
  });

  it("walks solo path backwards from W3", () => {
    const sidecar = baseSidecar();
    const picks = fullPicks({ account_type: "solo" });
    expect(getPreviousStep("W3", sidecar, picks)).toBe("W2");
    expect(getPreviousStep("W2", sidecar, picks)).toBe("W1");
    expect(getPreviousStep("W1", sidecar, picks)).toBe("setup-q6");
  });

  it("skips q1a/q1b backwards for solo accounts", () => {
    const sidecar = baseSidecar();
    const picks = fullPicks({ account_type: "solo" });
    expect(getPreviousStep("setup-q2", sidecar, picks)).toBe("setup-q1");
  });

  it("hits q1b/q1a backwards for lab accounts", () => {
    const sidecar = baseSidecar();
    const picks = fullPicks({ account_type: "lab" });
    expect(getPreviousStep("setup-q2", sidecar, picks)).toBe("setup-q1b");
    expect(getPreviousStep("setup-q1b", sidecar, picks)).toBe("setup-q1a");
    expect(getPreviousStep("setup-q1a", sidecar, picks)).toBe("setup-q1");
  });

  it("skips skipped conditional W steps backwards from cleanup", () => {
    const sidecar = baseSidecar();
    const picks = fullPicks({ account_type: "solo", goals: "yes" });
    // From phase4-cleanup, walking back lands on W11 (goals tour),
    // then W9, then the rest of the universal sequence in reverse.
    expect(getPreviousStep("phase4-cleanup", sidecar, picks)).toBe("W11");
    expect(getPreviousStep("W11", sidecar, picks)).toBe("W9");
  });
});

describe("WizardStepMachine: stepIndex / totalSteps", () => {
  it("solo minimal: 17 applicable steps", () => {
    const sidecar = baseSidecar();
    const picks = fullPicks({ account_type: "solo" });
    expect(totalSteps(sidecar, picks)).toBe(17);
    expect(stepIndex("intro", sidecar, picks)).toBe(1);
    expect(stepIndex("phase4-cleanup", sidecar, picks)).toBe(17);
  });

  it("lab maximal: every step in the union", () => {
    // P3a: no sentinel needed. A fresh sidecar with no opt-out fields
    // means the lab tour is "active" (undecided / Now-pick branch),
    // so the L-step gate lets every L1-L11 through.
    const sidecar = baseSidecar();
    const picks = fullPicks({
      account_type: "lab",
      purchases: "yes",
      calendar: "yes",
      goals: "yes",
      telegram: "yes",
      ai_helper: "full",
    });
    expect(totalSteps(sidecar, picks)).toBe(36);
  });

  it("returns 0 when current step is itself gated out (defensive)", () => {
    const sidecar = baseSidecar();
    const solo = fullPicks({ account_type: "solo" });
    // setup-q1a is gated out for solo accounts.
    expect(stepIndex("setup-q1a", sidecar, solo)).toBe(0);
  });
});

describe("WizardStepMachine: getLabTourDecision", () => {
  it("defaults to undecided when no opt-out is recorded (P3a default flip)", () => {
    // P1 defaulted to "now" so test reachability worked; P3a flipped
    // the default to "undecided" once the real lab-prompt step body
    // landed. "Now" is no longer a return value; absence of opt-out =
    // active tour, evaluated via isLabTourActive.
    expect(getLabTourDecision(null)).toBe("undecided");
    expect(getLabTourDecision(baseSidecar())).toBe("undecided");
  });

  it("reads later from lab_tour_pending sidecar field", () => {
    const sidecar = baseSidecar({ lab_tour_pending: true });
    expect(getLabTourDecision(sidecar)).toBe("later");
  });

  it("reads dismiss from lab_tour_dismissed_at sidecar field", () => {
    const sidecar = baseSidecar({
      lab_tour_dismissed_at: "2026-05-20T00:00:00.000Z",
    });
    expect(getLabTourDecision(sidecar)).toBe("dismiss");
  });

  it("dismissed_at takes precedence over pending (terminal opt-out)", () => {
    // Defensive: if both fields ever end up set on the same sidecar
    // (e.g. a race between two P3b prompts), the terminal dismiss wins.
    const sidecar = baseSidecar({
      lab_tour_pending: true,
      lab_tour_dismissed_at: "2026-05-20T00:00:00.000Z",
    });
    expect(getLabTourDecision(sidecar)).toBe("dismiss");
  });
});

describe("WizardStepMachine: edge cases", () => {
  it("getNextStep on phase4-cleanup returns null", () => {
    const sidecar = baseSidecar();
    const picks = fullPicks({ account_type: "solo" });
    expect(getNextStep("phase4-cleanup", sidecar, picks)).toBeNull();
  });

  it("getNextStep with unknown current step rewinds to intro", () => {
    const sidecar = baseSidecar();
    const picks = fullPicks({ account_type: "solo" });
    expect(
      getNextStep("not-a-real-step" as unknown as WizardStep, sidecar, picks),
    ).toBe("intro");
  });

  it("solo with all features yes walks W10-W14 but no lab path", () => {
    const sidecar = baseSidecar();
    const picks = fullPicks({
      account_type: "solo",
      purchases: "yes",
      calendar: "yes",
      goals: "yes",
      telegram: "yes",
      ai_helper: "full",
    });
    const walked = walkForward("intro", sidecar, picks);
    expect(walked).toContain("W10");
    expect(walked).toContain("W14");
    expect(walked).not.toContain("lab-prompt");
    expect(walked).not.toContain("L1");
    expect(walked.at(-1)).toBe("phase4-cleanup");
  });
});
