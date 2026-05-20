// frontend/src/lib/onboarding/wizard-tip-marking.test.ts
//
// Pins the master-locked marking rules for the Onboarding v2 Phase 3
// wizard-covered tip mark-as-seen logic. Each `it` here pins one row of
// the rule table in `wizard-tip-marking.ts` so a future edit that
// flips one case (e.g. starts marking on `telegramDecision: "skipped"`)
// fails loud.
//
// The 12 cases below mirror the brief's locked rule table:
//   1.  telegramDecision: "paired"     → mark telegram tip
//   2.  telegramDecision: "later"      → mark telegram tip
//   3.  telegramDecision: "skipped"    → DO NOT mark (auto-skip carve-out)
//   4.  telegramDecision: undefined    → DO NOT mark (step never reached)
//   5.  calendarDecision: "added"      → mark calendar tip
//   6.  calendarDecision: "later"      → mark calendar tip
//   7.  calendarDecision: undefined    → DO NOT mark
//   8.  aiHelperDecision: "copied"     → mark ai-helper tip
//   9.  aiHelperDecision: "later"      → mark ai-helper tip
//   10. aiHelperDecision: undefined    → DO NOT mark
//   11. Non-overwrite invariant        → preserve pre-existing record
//   12. All three valid                → mark all three, others untouched

import { describe, expect, it } from "vitest";
import {
  markWizardCoveredTips,
  WIZARD_COVERED_TIP_IDS,
  type WizardCompletionDecisions,
} from "./wizard-tip-marking";
import type { OnboardingSidecar, TipRecord } from "./sidecar";

const NOW_ISO = "2026-05-20T15:30:00.000Z";

function freshSidecar(
  overrides: Partial<OnboardingSidecar> = {},
): OnboardingSidecar {
  return {
    version: 3,
    first_seen_at: "2026-05-14T00:00:00.000Z",
    active_seconds: 1000,
    last_tip_at: 0,
    tips: {},
    tips_off: false,
    shown_count: 0,
    mode: "suggestions",
    use_cases: null,
    wizard_completed_at: null,
    wizard_skipped_at: null,
    other_use_case: null,
    telegram_decision: null,
    calendar_decision: null,
    ai_helper_decision: null,
    wizard_force_show: false,
    ...overrides,
  };
}

function expectMarked(tips: Record<string, TipRecord>, tipId: string): void {
  expect(tips[tipId]).toBeDefined();
  expect(tips[tipId].outcome).toBe("action-cancel");
  expect(tips[tipId].shown_at).toBeNull();
  expect(tips[tipId].dismissed_at).toBe(NOW_ISO);
}

function expectNotMarked(
  tips: Record<string, TipRecord>,
  tipId: string,
): void {
  expect(tips[tipId]).toBeUndefined();
}

describe("markWizardCoveredTips — Phase 3 rule table", () => {
  // Case 1
  it("telegramDecision='paired' marks telegram-send-to-task", () => {
    const cur = freshSidecar();
    const result: WizardCompletionDecisions = { telegramDecision: "paired" };
    const tips = markWizardCoveredTips(cur, result, NOW_ISO);
    expectMarked(tips, WIZARD_COVERED_TIP_IDS.telegram);
  });

  // Case 2
  it("telegramDecision='later' marks telegram-send-to-task (user saw pitch)", () => {
    const cur = freshSidecar();
    const result: WizardCompletionDecisions = { telegramDecision: "later" };
    const tips = markWizardCoveredTips(cur, result, NOW_ISO);
    expectMarked(tips, WIZARD_COVERED_TIP_IDS.telegram);
  });

  // Case 3 — key invariant: auto-skip mode does NOT mark
  it("telegramDecision='skipped' does NOT mark (user saw auto-skip card, not pitch)", () => {
    const cur = freshSidecar();
    const result: WizardCompletionDecisions = { telegramDecision: "skipped" };
    const tips = markWizardCoveredTips(cur, result, NOW_ISO);
    expectNotMarked(tips, WIZARD_COVERED_TIP_IDS.telegram);
  });

  // Case 4
  it("telegramDecision=undefined does NOT mark (step never reached)", () => {
    const cur = freshSidecar();
    const result: WizardCompletionDecisions = {};
    const tips = markWizardCoveredTips(cur, result, NOW_ISO);
    expectNotMarked(tips, WIZARD_COVERED_TIP_IDS.telegram);
  });

  // Case 5
  it("calendarDecision='added' marks link-calendars", () => {
    const cur = freshSidecar();
    const result: WizardCompletionDecisions = { calendarDecision: "added" };
    const tips = markWizardCoveredTips(cur, result, NOW_ISO);
    expectMarked(tips, WIZARD_COVERED_TIP_IDS.calendar);
  });

  // Case 6
  it("calendarDecision='later' marks link-calendars (user saw step)", () => {
    const cur = freshSidecar();
    const result: WizardCompletionDecisions = { calendarDecision: "later" };
    const tips = markWizardCoveredTips(cur, result, NOW_ISO);
    expectMarked(tips, WIZARD_COVERED_TIP_IDS.calendar);
  });

  // Case 7
  it("calendarDecision=undefined does NOT mark", () => {
    const cur = freshSidecar();
    const result: WizardCompletionDecisions = {};
    const tips = markWizardCoveredTips(cur, result, NOW_ISO);
    expectNotMarked(tips, WIZARD_COVERED_TIP_IDS.calendar);
  });

  // Case 8
  it("aiHelperDecision='copied' marks ai-helper-prompt", () => {
    const cur = freshSidecar();
    const result: WizardCompletionDecisions = { aiHelperDecision: "copied" };
    const tips = markWizardCoveredTips(cur, result, NOW_ISO);
    expectMarked(tips, WIZARD_COVERED_TIP_IDS.aiHelper);
  });

  // Case 9
  it("aiHelperDecision='later' marks ai-helper-prompt (user saw step)", () => {
    const cur = freshSidecar();
    const result: WizardCompletionDecisions = { aiHelperDecision: "later" };
    const tips = markWizardCoveredTips(cur, result, NOW_ISO);
    expectMarked(tips, WIZARD_COVERED_TIP_IDS.aiHelper);
  });

  // Case 10
  it("aiHelperDecision=undefined does NOT mark", () => {
    const cur = freshSidecar();
    const result: WizardCompletionDecisions = {};
    const tips = markWizardCoveredTips(cur, result, NOW_ISO);
    expectNotMarked(tips, WIZARD_COVERED_TIP_IDS.aiHelper);
  });

  // Case 11 — non-overwrite invariant
  it("preserves a pre-existing tip record untouched (non-destructive)", () => {
    const existingDismiss = "2026-05-19T10:00:00.000Z";
    const existingShown = "2026-05-19T09:00:00.000Z";
    const cur = freshSidecar({
      tips: {
        [WIZARD_COVERED_TIP_IDS.telegram]: {
          shown_at: existingShown,
          dismissed_at: existingDismiss,
          outcome: "later",
        },
      },
    });
    // Even though the decision says "paired" (which would normally mark),
    // the pre-existing record wins and is left untouched.
    const result: WizardCompletionDecisions = { telegramDecision: "paired" };
    const tips = markWizardCoveredTips(cur, result, NOW_ISO);
    expect(tips[WIZARD_COVERED_TIP_IDS.telegram]).toEqual({
      shown_at: existingShown,
      dismissed_at: existingDismiss,
      outcome: "later",
    });
  });

  // Case 12 — all three decisions valid
  it("marks all three tips when all three decisions are valid", () => {
    const cur = freshSidecar({
      tips: {
        // Unrelated pre-existing record must survive untouched.
        "create-goal": {
          shown_at: "2026-05-18T12:00:00.000Z",
          dismissed_at: "2026-05-18T12:00:30.000Z",
          outcome: "got-it",
        },
      },
    });
    const result: WizardCompletionDecisions = {
      telegramDecision: "paired",
      calendarDecision: "added",
      aiHelperDecision: "copied",
    };
    const tips = markWizardCoveredTips(cur, result, NOW_ISO);
    expectMarked(tips, WIZARD_COVERED_TIP_IDS.telegram);
    expectMarked(tips, WIZARD_COVERED_TIP_IDS.calendar);
    expectMarked(tips, WIZARD_COVERED_TIP_IDS.aiHelper);
    // Unrelated record preserved.
    expect(tips["create-goal"]).toEqual({
      shown_at: "2026-05-18T12:00:00.000Z",
      dismissed_at: "2026-05-18T12:00:30.000Z",
      outcome: "got-it",
    });
  });
});

describe("markWizardCoveredTips — purity guarantees", () => {
  it("does NOT mutate the input sidecar's tips map", () => {
    const cur = freshSidecar();
    const beforeRef = cur.tips;
    const result: WizardCompletionDecisions = {
      telegramDecision: "paired",
      calendarDecision: "added",
      aiHelperDecision: "copied",
    };
    const tips = markWizardCoveredTips(cur, result, NOW_ISO);
    // Returned map is a fresh object.
    expect(tips).not.toBe(beforeRef);
    // Original is unchanged.
    expect(cur.tips).toEqual({});
  });
});
