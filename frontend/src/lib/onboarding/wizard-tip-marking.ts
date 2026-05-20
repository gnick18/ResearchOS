// frontend/src/lib/onboarding/wizard-tip-marking.ts
//
// Onboarding v2 Phase 3: mark wizard-covered tips as already-seen when
// the v2 wizard completes.
//
// Three catalog entries overlap with wizard step content:
//   - `telegram-send-to-task` (priority 1)  — wizard step 4 (Telegram pitch)
//   - `link-calendars`        (priority 4)  — wizard step 5 (Calendar feeds)
//   - `ai-helper-prompt`      (priority 11) — wizard step 6 (AI Helper)
//
// On wizard completion (NOT skip), we stamp `outcome: "action-cancel"`
// for these tips so they don't re-fire as redundant context after the
// user has already seen the equivalent step. Semantically this mirrors
// the orchestrator's existing `cancelTip` flow: the user did the thing
// the tip would have explained before the tip fired.
//
// Marking is CONDITIONAL on the user actually having seen the
// corresponding step's pitch content (not the auto-skip notice card):
//
//   Decision value          | Behavior
//   ------------------------|---------------------------------------------
//   telegramDecision        |
//     "paired"              | Mark   (user paired inline)
//     "later"               | Mark   (user saw the pitch, chose Maybe later)
//     "skipped"             | DON'T  (user got auto-skip notice, not pitch)
//     undefined             | DON'T  (user never reached step 4)
//   calendarDecision        |
//     "added"               | Mark
//     "later"               | Mark   (user saw step, chose Maybe later)
//     undefined             | DON'T
//   aiHelperDecision        |
//     "copied"              | Mark
//     "later"               | Mark   (user saw step, chose Maybe later)
//     undefined             | DON'T
//
// Master-locked carve-out (2026-05-20): `telegram_decision: "skipped"`
// is the auto-skip path — the wizard fast-forwarded past the Telegram
// pitch because the user picked only computational use-cases on step 2.
// The user saw an auto-skip notice card, NOT the integration pitch, so
// the catalog tip remains a novel discoverable.
//
// Non-destructive: if `cur.tips[tipId]` already has a record (e.g. the
// user dismissed the tip via the tip card before the wizard ran on a
// replay flow), the existing record is preserved untouched.
//
// Does NOT bump `shown_count` — the wizard step "showed" the equivalent
// content but the tip card itself never appeared on screen, so the
// active-shown count stays accurate. Callers should NOT increment
// `shown_count` for these marks.

import type { OnboardingSidecar, TipRecord } from "./sidecar";

/** Result subset consumed by the mark-as-seen helper. Mirrors the
 *  `OnboardingWizard` onComplete payload's three decision fields, but
 *  decoupled to a narrow input so the helper stays pure. */
export interface WizardCompletionDecisions {
  telegramDecision?: "paired" | "later" | "skipped";
  calendarDecision?: "added" | "later";
  aiHelperDecision?: "copied" | "later";
}

/** Tip IDs covered by the wizard's three integration steps. Exported so
 *  tests can pin the exact ids and a future "step <-> tip" audit can
 *  cross-reference. */
export const WIZARD_COVERED_TIP_IDS = {
  telegram: "telegram-send-to-task",
  calendar: "link-calendars",
  aiHelper: "ai-helper-prompt",
} as const;

/** Returns the updated `tips` map after applying the wizard-covered
 *  mark-as-seen logic. Pure function: does not mutate `cur.tips`. The
 *  caller is responsible for splicing the result back into the sidecar
 *  via `patchOnboarding`.
 *
 *  @param cur     The current sidecar (read inside `patchOnboarding`'s
 *                 callback).
 *  @param result  The wizard's onComplete payload (decision fields).
 *  @param nowIso  ISO timestamp to stamp on `dismissed_at`. Passed in
 *                 (rather than `new Date().toISOString()` here) so the
 *                 caller can share one timestamp across all sidecar
 *                 fields stamped in the same write.
 */
export function markWizardCoveredTips(
  cur: OnboardingSidecar,
  result: WizardCompletionDecisions,
  nowIso: string,
): Record<string, TipRecord> {
  const next = { ...cur.tips };

  const entries: ReadonlyArray<{
    tipId: string;
    decision: string | undefined;
  }> = [
    {
      tipId: WIZARD_COVERED_TIP_IDS.telegram,
      decision: result.telegramDecision,
    },
    {
      tipId: WIZARD_COVERED_TIP_IDS.calendar,
      decision: result.calendarDecision,
    },
    {
      tipId: WIZARD_COVERED_TIP_IDS.aiHelper,
      decision: result.aiHelperDecision,
    },
  ];

  for (const { tipId, decision } of entries) {
    if (decision === undefined) continue;       // user never reached step
    if (decision === "skipped") continue;        // saw auto-skip card, not pitch
    if (next[tipId] !== undefined) continue;     // pre-existing record; preserve
    next[tipId] = {
      shown_at: null,
      dismissed_at: nowIso,
      outcome: "action-cancel",
    };
  }

  return next;
}
