/**
 * Shared props shape for every Onboarding v4 modal-setup step body.
 *
 * Onboarding v4's Phase 1 (Welcome + Q1 + Q1a/Q1b + Q2-Q6) stays
 * modal-contained per ONBOARDING_V4_PROPOSAL.md L9 ("no real surface to
 * anchor on yet"), so the bodies look + behave identically to v3's setup
 * bodies. The big difference vs v3: they mount under the v4 TourController's
 * modal-setup surface, not the v3 WizardMount shell.
 *
 * The contract mirrors v3 intentionally so a developer porting any of the
 * 9 setup bodies just renames the import and drops it in. The fields are:
 *
 *   - `sidecar`           : current onboarding sidecar snapshot (or null
 *                           while the very first persistence write is
 *                           still in flight).
 *   - `setNextDisabled`   : the body calls this to gate the modal shell's
 *                           Next button. Q1-Q5 disable Next until a pick
 *                           is made, the Welcome / Q1b / Q6 bodies leave
 *                           Next enabled.
 *   - `patchSidecar`      : generic sidecar mutator. Q1-Q6 spread + override
 *                           a single feature_picks field per pick. Returns
 *                           a promise the shell can await for the L10
 *                           "tab-close mid-write" invariant.
 */
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

export interface SetupStepProps {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}
