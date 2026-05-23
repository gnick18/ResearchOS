import type { FeaturePicks } from "@/lib/onboarding/sidecar";

/**
 * Construct the initial `feature_picks` object the v4 wizard writes at
 * the end of Q1 (the first step that persists a feature pick). The
 * sidecar starts a fresh user with `feature_picks: null`; Q1 cannot
 * patch a partial object onto null, so the first write needs the
 * Q1 answer set.
 *
 * Per Grant's 2026-05-21 feedback ("there should never be an option
 * preselected for the user when going through the setup page for the
 * first time"), Q2-Q6 fields are LEFT UNDEFINED here. Each step's
 * patchSidecar handler adds the field when the user explicitly picks.
 * The hydration in Q2-Q5 / Q6 then sees undefined and renders with
 * nothing pre-selected on first encounter. Back-stepping after a pick
 * still shows the saved answer because the field is set by then.
 *
 * Authoritative copy after the V3 rip (Phase B 2026-05-22).
 */
export function initialFeaturePicks(
  accountType: FeaturePicks["account_type"],
): FeaturePicks {
  return {
    account_type: accountType,
  };
}
