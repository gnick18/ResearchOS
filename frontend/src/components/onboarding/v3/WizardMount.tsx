"use client";

/**
 * P11 (Onboarding v4): v3's auto-fire is disabled. This component now
 * renders nothing; v4's `<TourBootstrap>` (mounted via
 * `V4MountForUser`) owns the decision of whether to start the tour for
 * the active user. The original v3 mount logic is preserved in git
 * history one commit before P11. See the commit titled "Onboarding
 * v4 P11: mount TourControllerProvider and Settings re-run reconnect"
 * for the full pre-P11 body.
 *
 * Why a stub vs deleting the file:
 *
 *   1. `OnboardingProvider` (orchestrator.tsx) still imports the
 *      default export; deleting the file would force an orchestrator
 *      edit too. P9 owns the wholesale v3 deletion sweep.
 *   2. The v3-in-flight migration prompt in `TourBootstrap` already
 *      gives users a clean way out of any leftover v3 resume state,
 *      so v3's own mount path no longer needs to fire even when a
 *      user has a non-null `wizard_resume_state` with a v3 step id.
 *   3. `OnboardingWizardV3.tsx`, `WizardResumeModal.tsx`,
 *      `WizardStepMachine.ts`, and the orchestrator's
 *      `useOnboarding().jumpToStep()` API still exist; they just
 *      don't auto-mount any more.
 *
 * Approach: Option A from the P11 brief (render nothing). Picked over
 * Option B (gate on v3 step id) because the v3-in-flight prompt in
 * `TourBootstrap` already gives users a clean way out of any v3
 * resume state, so v3's own mount path no longer needs to fire.
 */
interface WizardMountProps {
  username: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- prop kept for API stability across the v3 -> v4 cutover window; P9 deletes this file.
export default function WizardMount(_props: WizardMountProps) {
  return null;
}
