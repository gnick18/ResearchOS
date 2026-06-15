"use client";

// Resume marker for the RESEARCH onboarding wizard (Free / Lab-create tracks),
// the go-live counterpart of org-wizard-signin's ?orgWizard marker.
//
// The research tracks sign in with the normal OAuth-first kickoff
// (startOAuthFirstSignIn), so the callback keeps ?sharingClaim=1 and the global
// SharingClaimResume / LabCreateResume mounts still run the keypair mint + lab
// provisioning. This marker is purely additive: it tells the boot gate to render
// the wizard (resumed at the handle step) instead of FolderConnectGate, so the
// folder step is reached inside the wizard with no fresh-folder bounce.
//
// Pure reads, SSR-safe (null when there is no window).
//
// No emojis, no em-dashes, no mid-sentence colons.

export type OnbWizardReturn = "free" | "lab";

const PARAM = "onbWizard";

/** The wizard selection a marker maps to. */
export function selectionForOnbWizardReturn(
  v: OnbWizardReturn,
): "solo-free" | "pi-create" {
  return v === "lab" ? "pi-create" : "solo-free";
}

/** Reads the research-wizard resume marker from the current URL, or null. */
export function readOnboardingWizardReturn(): OnbWizardReturn | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get(PARAM);
  return v === "free" || v === "lab" ? v : null;
}

/** Strips the research-wizard marker from the URL without a navigation. */
export function clearOnboardingWizardReturn(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(PARAM)) return;
  url.searchParams.delete(PARAM);
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event("researchos:locationchange"));
}
