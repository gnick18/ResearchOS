/**
 * Onboarding v4 P1 step-machine tests — exercises `getNextStep`,
 * `getPreviousStep`, the conditional gates (L16), and the boundary
 * conditions at both ends of the order.
 */
import { describe, expect, it } from "vitest";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import {
  applicableStepIndex,
  firstApplicableStep,
  getNextStep,
  getPreviousStep,
  isLabPhaseStep,
  isSetupPhaseStep,
  isStepGatedOut,
  TOUR_STEP_ORDER,
  totalApplicableSteps,
} from "../step-machine";
import type { TourStepId } from "../step-types";

/** Helper: produce a FeaturePicks with all "no" defaults so each test
 *  can opt features in piecewise. */
function picks(over: Partial<FeaturePicks> = {}): FeaturePicks {
  return {
    account_type: "solo",
    purchases: "no",
    calendar: "no",
    goals: "no",
    telegram: "no",
    ai_helper: "no",
    ...over,
  };
}

/** Helper: walk forward from a start step until phase4-cleanup or null. */
function walkForward(
  start: TourStepId,
  p: FeaturePicks | null,
): TourStepId[] {
  const visited: TourStepId[] = [start];
  let cur: TourStepId | null = start;
  for (let i = 0; i < 100; i++) {
    const next = getNextStep(cur, p);
    if (next === null) break;
    visited.push(next);
    cur = next;
  }
  return visited;
}

describe("TOUR_STEP_ORDER", () => {
  it("contains all P1-scaffolded step ids", () => {
    expect(TOUR_STEP_ORDER).toContain("welcome");
    expect(TOUR_STEP_ORDER).toContain("setup-q1");
    expect(TOUR_STEP_ORDER).toContain("setup-q1a");
    expect(TOUR_STEP_ORDER).toContain("setup-q1b");
    expect(TOUR_STEP_ORDER).toContain("setup-q6");
    expect(TOUR_STEP_ORDER).toContain("home-create-project");
    expect(TOUR_STEP_ORDER).toContain("methods-create");
    expect(TOUR_STEP_ORDER).toContain("hybrid-editor");
    expect(TOUR_STEP_ORDER).toContain("gantt-drag-drop");
    expect(TOUR_STEP_ORDER).toContain("ai-helper-deep-explain");
    expect(TOUR_STEP_ORDER).toContain("telegram");
    expect(TOUR_STEP_ORDER).toContain("purchases");
    expect(TOUR_STEP_ORDER).toContain("calendar");
    expect(TOUR_STEP_ORDER).toContain("lab-prompt");
    expect(TOUR_STEP_ORDER).toContain("lab-spawn-beakerbot");
    expect(TOUR_STEP_ORDER).toContain("lab-permission-practice");
    expect(TOUR_STEP_ORDER).toContain("lab-cleanup");
    expect(TOUR_STEP_ORDER).toContain("phase4-cleanup");
  });

  it("ends with phase4-cleanup", () => {
    expect(TOUR_STEP_ORDER[TOUR_STEP_ORDER.length - 1]).toBe("phase4-cleanup");
  });

  it("starts with welcome", () => {
    expect(TOUR_STEP_ORDER[0]).toBe("welcome");
  });
});

describe("isSetupPhaseStep / isLabPhaseStep", () => {
  it("classifies the Phase 1 setup steps", () => {
    expect(isSetupPhaseStep("welcome")).toBe(true);
    expect(isSetupPhaseStep("setup-q1")).toBe(true);
    expect(isSetupPhaseStep("setup-q1a")).toBe(true);
    expect(isSetupPhaseStep("setup-q1b")).toBe(true);
    expect(isSetupPhaseStep("setup-q6")).toBe(true);
    expect(isSetupPhaseStep("home-create-project")).toBe(false);
    expect(isSetupPhaseStep("phase4-cleanup")).toBe(false);
  });

  it("classifies the Phase 2c lab steps", () => {
    expect(isLabPhaseStep("lab-prompt")).toBe(true);
    expect(isLabPhaseStep("lab-spawn-beakerbot")).toBe(true);
    expect(isLabPhaseStep("lab-permission-practice")).toBe(true);
    expect(isLabPhaseStep("lab-cleanup")).toBe(true);
    expect(isLabPhaseStep("welcome")).toBe(false);
    expect(isLabPhaseStep("home-create-project")).toBe(false);
    expect(isLabPhaseStep("phase4-cleanup")).toBe(false);
  });
});

describe("isStepGatedOut — Phase 1 sub-questions (L9, Q1=lab gating)", () => {
  it("hides setup-q1a/q1b for solo accounts", () => {
    const p = picks({ account_type: "solo" });
    expect(isStepGatedOut("setup-q1a", p)).toBe(true);
    expect(isStepGatedOut("setup-q1b", p)).toBe(true);
  });

  it("shows setup-q1a/q1b for lab accounts", () => {
    const p = picks({ account_type: "lab" });
    expect(isStepGatedOut("setup-q1a", p)).toBe(false);
    expect(isStepGatedOut("setup-q1b", p)).toBe(false);
  });

  it("hides setup-q1a/q1b when picks is null (pre-Q1)", () => {
    expect(isStepGatedOut("setup-q1a", null)).toBe(true);
    expect(isStepGatedOut("setup-q1b", null)).toBe(true);
  });
});

describe("isStepGatedOut — Phase 2 conditional walkthroughs (§6.13-6.15)", () => {
  it("gates telegram on picks.telegram === 'yes'", () => {
    expect(isStepGatedOut("telegram", picks({ telegram: "yes" }))).toBe(false);
    expect(isStepGatedOut("telegram", picks({ telegram: "no" }))).toBe(true);
    expect(isStepGatedOut("telegram", picks({ telegram: "maybe" }))).toBe(true);
  });

  it("gates purchases on picks.purchases === 'yes'", () => {
    expect(isStepGatedOut("purchases", picks({ purchases: "yes" }))).toBe(false);
    expect(isStepGatedOut("purchases", picks({ purchases: "no" }))).toBe(true);
    expect(isStepGatedOut("purchases", picks({ purchases: "maybe" }))).toBe(true);
  });

  it("gates calendar on picks.calendar === 'yes'", () => {
    expect(isStepGatedOut("calendar", picks({ calendar: "yes" }))).toBe(false);
    expect(isStepGatedOut("calendar", picks({ calendar: "no" }))).toBe(true);
    expect(isStepGatedOut("calendar", picks({ calendar: "maybe" }))).toBe(true);
  });

  it("gates gantt-goals-overview on picks.goals === 'yes'", () => {
    expect(isStepGatedOut("gantt-goals-overview", picks({ goals: "yes" }))).toBe(
      false,
    );
    expect(isStepGatedOut("gantt-goals-overview", picks({ goals: "no" }))).toBe(
      true,
    );
    expect(
      isStepGatedOut("gantt-goals-overview", picks({ goals: "maybe" })),
    ).toBe(true);
  });

  it("gates ai-helper-deep-explain on full/medium/minimal", () => {
    expect(
      isStepGatedOut("ai-helper-deep-explain", picks({ ai_helper: "full" })),
    ).toBe(false);
    expect(
      isStepGatedOut("ai-helper-deep-explain", picks({ ai_helper: "medium" })),
    ).toBe(false);
    expect(
      isStepGatedOut("ai-helper-deep-explain", picks({ ai_helper: "minimal" })),
    ).toBe(false);
    expect(
      isStepGatedOut("ai-helper-deep-explain", picks({ ai_helper: "no" })),
    ).toBe(true);
    expect(
      isStepGatedOut("ai-helper-deep-explain", picks({ ai_helper: "maybe" })),
    ).toBe(true);
    expect(isStepGatedOut("ai-helper-deep-explain", null)).toBe(true);
  });
});

describe("isStepGatedOut — Phase 2c lab tour cluster", () => {
  it("hides all lab steps for solo accounts", () => {
    const p = picks({ account_type: "solo" });
    expect(isStepGatedOut("lab-prompt", p)).toBe(true);
    expect(isStepGatedOut("lab-spawn-beakerbot", p)).toBe(true);
    expect(isStepGatedOut("lab-permission-practice", p)).toBe(true);
    expect(isStepGatedOut("lab-cleanup", p)).toBe(true);
  });

  it("shows all lab steps for lab accounts", () => {
    const p = picks({ account_type: "lab" });
    expect(isStepGatedOut("lab-prompt", p)).toBe(false);
    expect(isStepGatedOut("lab-spawn-beakerbot", p)).toBe(false);
    expect(isStepGatedOut("lab-permission-practice", p)).toBe(false);
    expect(isStepGatedOut("lab-cleanup", p)).toBe(false);
  });

  it("hides lab steps when picks is null", () => {
    expect(isStepGatedOut("lab-prompt", null)).toBe(true);
    expect(isStepGatedOut("lab-spawn-beakerbot", null)).toBe(true);
    expect(isStepGatedOut("lab-permission-practice", null)).toBe(true);
    expect(isStepGatedOut("lab-cleanup", null)).toBe(true);
  });
});

describe("getNextStep — forward traversal", () => {
  it("solo + minimal picks walks the universal path only", () => {
    const p = picks({ account_type: "solo" });
    const visited = walkForward("welcome", p);
    // Solo skips setup-q1a/q1b
    expect(visited).not.toContain("setup-q1a");
    expect(visited).not.toContain("setup-q1b");
    // Solo skips all lab steps
    expect(visited).not.toContain("lab-prompt");
    expect(visited).not.toContain("lab-spawn-beakerbot");
    expect(visited).not.toContain("lab-permission-practice");
    expect(visited).not.toContain("lab-cleanup");
    // All-no skips conditionals
    expect(visited).not.toContain("telegram");
    expect(visited).not.toContain("purchases");
    expect(visited).not.toContain("calendar");
    expect(visited).not.toContain("gantt-goals-overview");
    expect(visited).not.toContain("ai-helper-deep-explain");
    // Always includes core walkthrough
    expect(visited).toContain("home-create-project");
    expect(visited).toContain("methods-create");
    expect(visited).toContain("hybrid-editor");
    expect(visited).toContain("gantt-drag-drop");
    // Terminates at phase4-cleanup
    expect(visited[visited.length - 1]).toBe("phase4-cleanup");
  });

  it("lab + all conditionals walks the maximal path", () => {
    const p = picks({
      account_type: "lab",
      purchases: "yes",
      calendar: "yes",
      goals: "yes",
      telegram: "yes",
      ai_helper: "full",
    });
    const visited = walkForward("welcome", p);
    expect(visited).toContain("setup-q1a");
    expect(visited).toContain("setup-q1b");
    expect(visited).toContain("telegram");
    expect(visited).toContain("purchases");
    expect(visited).toContain("calendar");
    expect(visited).toContain("gantt-goals-overview");
    expect(visited).toContain("ai-helper-deep-explain");
    expect(visited).toContain("lab-prompt");
    expect(visited).toContain("lab-spawn-beakerbot");
    expect(visited).toContain("lab-permission-practice");
    expect(visited).toContain("lab-cleanup");
    expect(visited[visited.length - 1]).toBe("phase4-cleanup");
  });

  it("returns null when current is already phase4-cleanup", () => {
    expect(getNextStep("phase4-cleanup", picks())).toBeNull();
    expect(getNextStep("phase4-cleanup", null)).toBeNull();
  });

  it("returns the first applicable step from an unknown id", () => {
    const p = picks({ account_type: "solo" });
    expect(getNextStep("not-a-real-step", p)).toBe("welcome");
  });

  it("solo-from-welcome step 2 lands on setup-q1, not setup-q1a", () => {
    const p = picks({ account_type: "solo" });
    expect(getNextStep("welcome", p)).toBe("setup-q1");
    // After q1 with solo, q1a + q1b are skipped → q2
    expect(getNextStep("setup-q1", p)).toBe("setup-q2");
  });

  it("lab-from-q1 lands on q1a (not q2)", () => {
    const p = picks({ account_type: "lab" });
    expect(getNextStep("setup-q1", p)).toBe("setup-q1a");
    expect(getNextStep("setup-q1a", p)).toBe("setup-q1b");
    expect(getNextStep("setup-q1b", p)).toBe("setup-q2");
  });
});

describe("getPreviousStep — backward traversal", () => {
  it("returns null at the head of the order", () => {
    expect(getPreviousStep("welcome", picks())).toBeNull();
    expect(getPreviousStep("welcome", null)).toBeNull();
  });

  it("solo backstep from setup-q2 skips q1a/q1b → q1", () => {
    const p = picks({ account_type: "solo" });
    expect(getPreviousStep("setup-q2", p)).toBe("setup-q1");
  });

  it("lab backstep from setup-q2 lands on q1b", () => {
    const p = picks({ account_type: "lab" });
    expect(getPreviousStep("setup-q2", p)).toBe("setup-q1b");
  });

  it("conditional-on backstep traverses the conditional step", () => {
    const p = picks({ purchases: "yes" });
    // "calendar" is gated out (calendar=no), so backstep from
    // "lab-prompt" with lab=solo → first non-lab non-calendar before.
    // Easier check: from "calendar" with all-no, getPreviousStep should
    // skip purchases too (gated out under all-no).
    const allNo = picks({ purchases: "no", calendar: "no", telegram: "no" });
    expect(getPreviousStep("calendar", allNo)).toBe("wiki-pointer");
    // With purchases=yes, backstep from "calendar" (still gated out for
    // a calendar=no caller, but the function accepts current as opaque)
    // lands on "purchases".
    expect(getPreviousStep("calendar", p)).toBe("purchases");
  });

  it("returns null for unknown current id", () => {
    expect(getPreviousStep("not-a-real-step", picks())).toBeNull();
  });
});

describe("firstApplicableStep / totalApplicableSteps / applicableStepIndex", () => {
  it("firstApplicableStep returns welcome under every picks shape", () => {
    expect(firstApplicableStep(null)).toBe("welcome");
    expect(firstApplicableStep(picks())).toBe("welcome");
    expect(firstApplicableStep(picks({ account_type: "lab" }))).toBe("welcome");
  });

  it("totalApplicableSteps reflects gating", () => {
    const soloMin = picks({ account_type: "solo" });
    const labMax = picks({
      account_type: "lab",
      purchases: "yes",
      calendar: "yes",
      goals: "yes",
      telegram: "yes",
      ai_helper: "full",
    });
    const soloCount = totalApplicableSteps(soloMin);
    const labCount = totalApplicableSteps(labMax);
    expect(labCount).toBeGreaterThan(soloCount);
    // Solo+minimal: q1a/q1b skipped (-2), 5 conditionals skipped (-5),
    // 4 lab steps skipped (-4) = TOUR_STEP_ORDER.length - 11
    expect(soloCount).toBe(TOUR_STEP_ORDER.length - 11);
    expect(labCount).toBe(TOUR_STEP_ORDER.length);
  });

  it("applicableStepIndex is 1-based and skips gated steps", () => {
    const p = picks({ account_type: "solo" });
    expect(applicableStepIndex("welcome", p)).toBe(1);
    // setup-q1 is the 2nd applicable step for solo
    expect(applicableStepIndex("setup-q1", p)).toBe(2);
    // setup-q2 is the 3rd (q1a/q1b skipped)
    expect(applicableStepIndex("setup-q2", p)).toBe(3);
  });

  it("applicableStepIndex returns 0 for a gated-out current", () => {
    const p = picks({ account_type: "solo" });
    expect(applicableStepIndex("setup-q1a", p)).toBe(0);
    expect(applicableStepIndex("lab-prompt", p)).toBe(0);
  });
});
