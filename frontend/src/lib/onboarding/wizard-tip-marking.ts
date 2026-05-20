// TODO P7: delete this file as part of the tips-system deprecation
// sweep (ONBOARDING_V3_PROPOSAL.md §12 row P7). The old wizard-covered
// tip mark-as-seen helper lived against the v2 use_cases / three
// integration decision fields, all of which are gone in the sidecar
// v3 → v4 migration (P0).
//
// P0 keeps the export name alive as a no-op so any straggling caller
// (none in-tree as of P0, but cheap insurance) compiles. The body
// returns an empty record; the orchestrator body that called it has
// already been stubbed out.

export interface WizardCompletionDecisions {
  telegramDecision?: "paired" | "later" | "skipped";
  calendarDecision?: "added" | "later";
  aiHelperDecision?: "copied" | "later";
}

export const WIZARD_COVERED_TIP_IDS = {
  telegram: "telegram-send-to-task",
  calendar: "link-calendars",
  aiHelper: "ai-helper-prompt",
} as const;

export function markWizardCoveredTips(): Record<string, never> {
  return {};
}
