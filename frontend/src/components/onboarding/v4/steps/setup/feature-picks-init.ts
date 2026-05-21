import type { FeaturePicks } from "@/lib/onboarding/sidecar";

/**
 * Construct the initial `feature_picks` object the v4 wizard writes at
 * the end of Q1 (the first step that persists a feature pick). The
 * sidecar starts a fresh user with `feature_picks: null`; Q1 cannot
 * patch a partial object onto null, so the first write needs every
 * required field at its safe default.
 *
 * Defaults per ONBOARDING_V4_PROPOSAL.md §6 (which references v3 §4):
 *   - account_type: caller-supplied (the answer to Q1 itself)
 *   - purchases / calendar / goals / telegram: "maybe" (deferred)
 *   - ai_helper: "full" (recommended default, L6 lock from v3 carried over)
 *   - lab_storage: omitted (Q1a writes this only on the lab branch)
 *
 * Duplicated from the v3 feature-picks-init.ts so P9 can delete the v3
 * tree without leaving a dangling import.
 */
export function initialFeaturePicks(
  accountType: FeaturePicks["account_type"],
): FeaturePicks {
  return {
    account_type: accountType,
    purchases: "maybe",
    calendar: "maybe",
    goals: "maybe",
    telegram: "maybe",
    ai_helper: "full",
  };
}
