import type { FeaturePicks } from "@/lib/onboarding/sidecar";

/**
 * Construct the initial `feature_picks` object the v3 wizard writes at
 * the end of Q1 (the first step that persists a feature pick). The
 * sidecar starts a fresh user with `feature_picks: null`; Q1 cannot
 * patch a partial object onto null, so the first write needs every
 * required field at its safe default.
 *
 * Defaults per ONBOARDING_V3_PROPOSAL.md §4:
 *   - account_type: caller-supplied (the answer to Q1 itself)
 *   - purchases / calendar / goals / telegram: "maybe" (deferred)
 *   - ai_helper: "full" (recommended default, L6 lock)
 *   - lab_storage: omitted (Q1a writes this only on the lab branch)
 *
 * Subsequent steps (Q1a + Q2-Q6) consume the existing picks object and
 * spread + override their one field. Only Q1 ever constructs the
 * initial shape.
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
