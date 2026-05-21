"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import WizardMount from "@/components/onboarding/v3/WizardMount";
import type { WizardStep } from "@/components/onboarding/v3/WizardStepMachine";
import {
  clearWizardCompletion,
  patchOnboarding,
} from "@/lib/onboarding/sidecar";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";

/**
 * Onboarding v3 orchestrator + provider.
 *
 * P1 (this file) fills in the orchestrator body. The
 * OnboardingProvider mount decision tree from P0 is preserved
 * verbatim — specifically the line marked LOCKED below — so the four
 * gate-precedence states stay deterministic:
 *
 *   ?wikiCapture=1 alone               → fixture mode, wizard HIDDEN.
 *                                          Just renders children; no
 *                                          tutorial overlay (the v1
 *                                          `/demo?tutorial=1` sequencer
 *                                          is deleted in P7).
 *   ?wizard-preview=1 alone            → real account, wizard SHOWN
 *                                          (dev hook).
 *   ?wikiCapture=1 & ?wizard-preview=1 → fixture mode WITH wizard
 *                                          shown (wiki manager P6
 *                                          screenshot path). The
 *                                          short-circuit at the LOCKED
 *                                          line lets this through.
 *   neither flag                       → standard §11 gating; the
 *                                          WizardMount component below
 *                                          consults the sidecar and
 *                                          decides whether to mount.
 *
 * The useOnboarding() context exposes three minimal commands so
 * DevForceTipButton (and any future surface like the Settings re-run
 * card) can drive the wizard without poking the sidecar directly.
 */

interface OrchestratorContextValue {
  /** Mark the wizard skipped (wizard_skipped_at = now). Clears resume
   *  state and the wizard_force_show flag. Useful when a non-wizard
   *  surface wants to opt the user out without rendering the wizard. */
  skipWizard: () => Promise<void>;
  /** Mark the wizard completed (wizard_completed_at = now). Clears
   *  resume state and the wizard_force_show flag. */
  completeWizard: () => Promise<void>;
  /** Force-fire the wizard at a specific step. Sets
   *  wizard_force_show=true via clearWizardCompletion(), then plants
   *  a resume_state pointing at the requested step. Caller is
   *  responsible for reloading the page (or the mount probe re-fires
   *  on next render). Used by the DevForceTipButton "mount wizard at
   *  this step" affordance. */
  jumpToStep: (step: WizardStep) => Promise<void>;
}

const OrchestratorContext = createContext<OrchestratorContextValue | null>(null);

export function OnboardingOrchestrator({
  username,
  children,
}: {
  username: string;
  children: ReactNode;
}) {
  const skipWizard = useCallback(async () => {
    await patchOnboarding(username, (cur) => ({
      ...cur,
      wizard_skipped_at: new Date().toISOString(),
      wizard_force_show: false,
      wizard_resume_state: null,
    }));
  }, [username]);

  const completeWizard = useCallback(async () => {
    await patchOnboarding(username, (cur) => ({
      ...cur,
      wizard_completed_at: new Date().toISOString(),
      wizard_force_show: false,
      wizard_resume_state: null,
    }));
  }, [username]);

  const jumpToStep = useCallback(
    async (step: WizardStep) => {
      await clearWizardCompletion(username);
      await patchOnboarding(username, (cur) => ({
        ...cur,
        wizard_resume_state: {
          current_step: step,
          skipped_steps: cur.wizard_resume_state?.skipped_steps ?? [],
          artifacts_created:
            cur.wizard_resume_state?.artifacts_created ?? [],
        },
      }));
    },
    [username],
  );

  const value: OrchestratorContextValue = {
    skipWizard,
    completeWizard,
    jumpToStep,
  };

  return (
    <OrchestratorContext.Provider value={value}>
      {children}
      <WizardMount username={username} />
    </OrchestratorContext.Provider>
  );
}

export function useOnboarding(): OrchestratorContextValue | null {
  return useContext(OrchestratorContext);
}

/**
 * Top-level provider that decides what onboarding surface (if any)
 * to mount. The decision tree below is the authoritative four-state
 * truth table — keep it in sync with the docblock above.
 *
 * LOCKED: the `(isDemoOrWikiCapture() && !wizardPreviewMode)`
 * short-circuit below is the gate-precedence pivot. Touching it changes
 * the fixture × preview combined case (P6 wiki-manager screenshot
 * path) so leave it as-is unless master explicitly re-litigates.
 */
export function OnboardingProvider({
  currentUser,
  children,
}: {
  currentUser: string | null;
  children: ReactNode;
}) {
  const searchParams = useSearchParams();
  const wizardPreviewMode = searchParams?.get("wizard-preview") === "1";

  if (!currentUser) return <>{children}</>;
  // Lab Mode is a read-only cross-user view, not a real account. The
  // "lab" sentinel flows through FileSystemProvider just like a normal
  // username, so without this gate the wizard + tips orchestrator
  // mounts on /lab and the Welcome modal can pop in front of the Exit
  // Lab Mode button (QA persona 05, 2026-05-20). Mirror the !currentUser
  // and fixture-mode short-circuits: Lab Mode never owns user-setup UI.
  if (currentUser.toLowerCase() === "lab") return <>{children}</>;
  if (isDemoOrWikiCapture() && !wizardPreviewMode) {
    return <>{children}</>;
  }
  return (
    <OnboardingOrchestrator username={currentUser}>
      {children}
    </OnboardingOrchestrator>
  );
}
