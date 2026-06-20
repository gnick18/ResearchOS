// The step a resumed onboarding wizard should land on, the FIRST step the user
// has not completed, so a re-entry continues instead of restarting at the handle.
//
// Without this, the post-OAuth / re-entry resume always mounted at "handle" and
// walked handle -> profile -> [lab-setup] -> folder again, so a user who bailed
// to the demo and came back re-entered their handle, name, and lab name every
// time. This computes where to land from the durable completion signals the host
// can observe: whether a handle is already claimed, and (for the lab track)
// whether lab branding is already stashed.
//
// Pure, so it is unit-tested. The host (providers.tsx) supplies the live signals.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { WizardSelection } from "@/components/onboarding/wizard/OnboardingWizard";

export interface WizardResumeSignals {
  /** A handle is already claimed for the account (the handle step is done). */
  handleClaimed: boolean;
  /** Lab branding is already captured (the lab-setup step is done). */
  hasBranding: boolean;
}

/**
 * The step id a resumed research wizard should start at.
 *
 * First pass (handle not yet claimed) -> "handle", so the normal
 * handle -> profile -> [lab-setup] -> folder sequence still runs and the
 * optional profile is shown once. Re-entry (handle already claimed) -> skip the
 * handle and the optional profile and land on the first remaining required step:
 * "lab-setup" for a lab head (unless branding is already stashed, then "folder"),
 * or "folder" for a solo researcher. The folder step is where the wizard yields
 * once a folder connects, so it is the right terminal landing.
 */
export function computeResumeStepId(
  selection: WizardSelection,
  signals: WizardResumeSignals,
): string {
  if (!signals.handleClaimed) return "handle";
  if (selection === "pi-create") {
    return signals.hasBranding ? "folder" : "lab-setup";
  }
  // solo-free (and any other account track): the only remaining required step
  // after the handle is the folder. Profile is optional and editable later.
  return "folder";
}
