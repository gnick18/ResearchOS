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
    expect(TOUR_STEP_ORDER).toContain("setup-q6");
    expect(TOUR_STEP_ORDER).toContain("home-create-project");
    expect(TOUR_STEP_ORDER).toContain("methods-open-picker");
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

  it("does NOT contain setup-q1a / setup-q1b (dropped 2026-05-22)", () => {
    // Lab storage decision moved to pre-onboarding §6.4 (cloud-provider
    // screen). The v4 setup phase no longer asks "where will lab data
    // live?" because by the time the user reaches it, they've already
    // picked + linked the folder via DataSetupScreen. Regression guard
    // matching the §6.3 notifications.not.toContain shape so a stale
    // resume_state record can't pin the controller to a step that no
    // longer exists.
    expect(TOUR_STEP_ORDER).not.toContain("setup-q1a");
    expect(TOUR_STEP_ORDER).not.toContain("setup-q1b");
  });

  it("contains the three §6.3 notification sub-step ids", () => {
    // Grant 2026-05-21: split the original single `notifications` step
    // into three beats (bell → silence → delete). The old id MUST be
    // gone so a stale resume_state record can't pin the controller to
    // a step that no longer exists.
    expect(TOUR_STEP_ORDER).toContain("notifications-bell");
    expect(TOUR_STEP_ORDER).toContain("notifications-silence");
    expect(TOUR_STEP_ORDER).toContain("notifications-delete");
    expect(TOUR_STEP_ORDER).not.toContain("notifications");
  });

  it("orders the §6.3 sub-steps bell → silence → delete", () => {
    const bellIdx = TOUR_STEP_ORDER.indexOf("notifications-bell");
    const silenceIdx = TOUR_STEP_ORDER.indexOf("notifications-silence");
    const deleteIdx = TOUR_STEP_ORDER.indexOf("notifications-delete");
    expect(bellIdx).toBeGreaterThanOrEqual(0);
    expect(silenceIdx).toBe(bellIdx + 1);
    expect(deleteIdx).toBe(silenceIdx + 1);
  });

  it("ends with phase4-cleanup", () => {
    expect(TOUR_STEP_ORDER[TOUR_STEP_ORDER.length - 1]).toBe("phase4-cleanup");
  });

  it("starts with welcome", () => {
    expect(TOUR_STEP_ORDER[0]).toBe("welcome");
  });

  it("places methods-open-picker between methods-category and methods-type-tour (sub-bot 2026-05-21)", () => {
    // §6.4 open-picker beat sits between finishing the category and the
    // wall of type-breadth speech. The cursor click on "+ New Method"
    // owns the modal-open transition before the type-tour body fires.
    const categoryIdx = TOUR_STEP_ORDER.indexOf("methods-category");
    const openPickerIdx = TOUR_STEP_ORDER.indexOf("methods-open-picker");
    const typeTourIdx = TOUR_STEP_ORDER.indexOf("methods-type-tour");
    expect(categoryIdx).toBeGreaterThanOrEqual(0);
    expect(openPickerIdx).toBeGreaterThan(categoryIdx);
    expect(typeTourIdx).toBeGreaterThan(openPickerIdx);
  });

  it("walks the methods-type-tour deep-demo arc in PCR-then-LC order (Grant 2026-05-21 rework)", () => {
    // §6.4b: methods-type-tour mounts the PCR builder (manual-advance
    // pause for exploration), then methods-lc-demo mounts the LC
    // builder (manual-advance pause), then methods-create takes over
    // with Standard Markdown. The intermediate PCR sub-steps (edit /
    // add-cycle / confirm-cycle) were removed per Grant's feedback
    // that the click-around drama moved too fast to follow.
    const order = [
      "methods-type-tour",
      "methods-lc-demo",
      "methods-create",
    ];
    const indices = order.map((id) => TOUR_STEP_ORDER.indexOf(id));
    indices.forEach((idx, i) => {
      expect(idx, `${order[i]} missing from TOUR_STEP_ORDER`).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        expect(
          idx,
          `${order[i]} must follow ${order[i - 1]}`,
        ).toBe(indices[i - 1] + 1);
      }
    });
  });
});

describe("isSetupPhaseStep / isLabPhaseStep", () => {
  it("classifies the Phase 1 setup steps", () => {
    expect(isSetupPhaseStep("welcome")).toBe(true);
    expect(isSetupPhaseStep("setup-q1")).toBe(true);
    expect(isSetupPhaseStep("setup-q6")).toBe(true);
    expect(isSetupPhaseStep("home-create-project")).toBe(false);
    expect(isSetupPhaseStep("phase4-cleanup")).toBe(false);
    // setup-q1a / setup-q1b removed 2026-05-22 — no longer setup steps.
    expect(isSetupPhaseStep("setup-q1a")).toBe(false);
    expect(isSetupPhaseStep("setup-q1b")).toBe(false);
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

// 2026-05-22: setup-q1a / setup-q1b dropped from the v4 setup phase.
// The gating tests they used to live in were removed; lab storage is
// now decided in pre-onboarding §6.4 (cloud-provider screen) instead.

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
    // setup-q1a / setup-q1b are no longer in the order (dropped
    // 2026-05-22 — lab storage decision moved to pre-onboarding §6.4).
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
    expect(visited).toContain("methods-open-picker");
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
    // setup-q1a / setup-q1b were dropped 2026-05-22 — lab storage now
    // lives in pre-onboarding §6.4 (cloud-provider screen).
    expect(visited).not.toContain("setup-q1a");
    expect(visited).not.toContain("setup-q1b");
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

  it("solo-from-welcome step 2 lands on setup-q1, then setup-q2", () => {
    const p = picks({ account_type: "solo" });
    expect(getNextStep("welcome", p)).toBe("setup-q1");
    expect(getNextStep("setup-q1", p)).toBe("setup-q2");
  });

  it("lab-from-q1 lands on setup-q2 (q1a/q1b removed 2026-05-22)", () => {
    // setup-q1a (lab storage picker) + setup-q1b (lab connect info)
    // were dropped from the v4 setup phase. Lab storage is decided in
    // pre-onboarding §6.4 (cloud-provider screen) now. So setup-q1
    // advances straight to setup-q2 for lab users, same as solo.
    const p = picks({ account_type: "lab" });
    expect(getNextStep("setup-q1", p)).toBe("setup-q2");
  });
});

describe("getPreviousStep — backward traversal", () => {
  it("returns null at the head of the order", () => {
    expect(getPreviousStep("welcome", picks())).toBeNull();
    expect(getPreviousStep("welcome", null)).toBeNull();
  });

  it("solo backstep from setup-q2 lands on setup-q1", () => {
    const p = picks({ account_type: "solo" });
    expect(getPreviousStep("setup-q2", p)).toBe("setup-q1");
  });

  it("lab backstep from setup-q2 also lands on setup-q1 (q1a/q1b removed 2026-05-22)", () => {
    // setup-q1a / setup-q1b dropped from the v4 setup phase; lab
    // storage decision moved to pre-onboarding §6.4. Backstep behavior
    // for lab is now identical to solo.
    const p = picks({ account_type: "lab" });
    expect(getPreviousStep("setup-q2", p)).toBe("setup-q1");
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
    // 2026-05-22: setup-q1a / setup-q1b removed from TOUR_STEP_ORDER.
    // Solo+minimal: 5 conditionals skipped (-5; telegram, purchases,
    // calendar, gantt-goals-overview, ai-helper-deep-explain), 4 lab
    // steps skipped (-4) = TOUR_STEP_ORDER.length - 9
    expect(soloCount).toBe(TOUR_STEP_ORDER.length - 9);
    expect(labCount).toBe(TOUR_STEP_ORDER.length);
  });

  it("applicableStepIndex is 1-based and skips gated steps", () => {
    const p = picks({ account_type: "solo" });
    expect(applicableStepIndex("welcome", p)).toBe(1);
    // setup-q1 is the 2nd applicable step
    expect(applicableStepIndex("setup-q1", p)).toBe(2);
    // setup-q2 is the 3rd applicable step (q1a/q1b removed 2026-05-22)
    expect(applicableStepIndex("setup-q2", p)).toBe(3);
  });

  it("applicableStepIndex returns 0 for a gated-out current", () => {
    const p = picks({ account_type: "solo" });
    expect(applicableStepIndex("lab-prompt", p)).toBe(0);
  });
});
