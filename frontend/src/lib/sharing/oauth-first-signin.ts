"use client";

// OAuth-first sign-in kickoff (entry-flow redesign, 2026-06-11).
//
// The OLD flow deferred the real signIn() until AFTER a folder + user were
// connected: a provider click did router.push("/?connect=1&signIn=<p>"), the
// boot gate showed FolderConnectGate, then lib/providers fired the redirect.
// That is the bug the redesign fixes, the user clicked Google and got a folder
// picker.
//
// This helper INVERTS that: the provider opens IMMEDIATELY on click. We call
// next-auth signIn() right away with a callbackUrl carrying ?sharingClaim=1, so
// when the provider returns the user lands back in the app where the global
// SharingClaimResume mount completes the identity claim (reads the verified
// email, mints the keypair). The folder step happens AFTER the return, framed as
// "save your account on your disk", and SharingClaimResume already waits for a
// connected folder-local user before it mounts, so the ordering is correct by
// construction.
//
// For the lab-create path we still set the researchos:lab-create marker before
// the redirect (LabCreateResume consumes it on return), exactly as the old
// AccountTierChooser.handleLabCreateProvider did.
//
// The last provider used is recorded so the "Welcome back" screen can float it
// to the top with a "Last used" badge.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { signIn } from "next-auth/react";

import type { SharingProvider } from "@/components/sharing/SharingProviderButtons";
import { markLandingSeen } from "@/lib/landing/landing-gate";
import { rememberLastProvider } from "@/lib/sharing/oauth-first-login";
import { resolveDevMockSignInOptions } from "@/lib/sharing/dev-mock-email";

interface OAuthFirstOptions {
  /** Set the researchos:lab-create marker before redirecting (Lab create
   *  path). LabCreateResume reads it on return to provision the lab. */
  labCreate?: boolean;
  /**
   * Onboarding wizard go-live (NEXT_PUBLIC_ONBOARDING_WIZARD). When set, the
   * callback also carries ?onbWizard=<free|lab> so the boot gate re-mounts the
   * research wizard at the handle step on return (instead of falling through to
   * FolderConnectGate). The ?sharingClaim=1 flag is still set, so the global
   * SharingClaimResume keypair-mint and LabCreateResume provisioning run exactly
   * as before; this only changes which onboarding surface the user sees, so the
   * folder step is reached inside the wizard with no fresh-folder bounce.
   */
  onboardingWizard?: "free" | "lab";
  /**
   * Cold paid-signup door (Billing handoff, 2026-06-17). When a brand-new user
   * picks a PAID path in the tier chooser (Start a lab today, a future Solo door),
   * set this so that on return, once the session and lab are provisioned, the flow
   * redirects to the Stripe card-on-file checkout instead of leaving them a free
   * signed-in user. Stored as a sessionStorage marker that survives the OAuth
   * round-trip; LabCreateResume reads + consumes it after provisioning. The
   * card-setup endpoint is billing-flag-gated server side, so this is a clean
   * no-op (the user stays a provisioned free account) when billing is off.
   */
  startPlan?: "lab" | "solo";
}

/**
 * Start an OAuth sign-in immediately (the provider opens now), returning into
 * the app with the sharing-claim resume flag set. The folder step follows the
 * provider return, not the click.
 */
export function startOAuthFirstSignIn(
  provider: SharingProvider,
  options: OAuthFirstOptions = {},
): void {
  if (typeof window === "undefined") return;

  // Resolve the dev-mock email (and honour a cancel) BEFORE any side effects, so
  // a cancelled prompt leaves landing/provider markers untouched.
  const devMock = resolveDevMockSignInOptions(provider);
  if (devMock === null) return; // dev-mock email prompt cancelled

  markLandingSeen();
  rememberLastProvider(provider);

  if (options.labCreate) {
    try {
      sessionStorage.setItem("researchos:lab-create", "1");
    } catch {
      // sessionStorage unavailable (private mode); the redirect still fires,
      // the lab just is not auto-provisioned on return.
    }
  }

  if (options.startPlan) {
    try {
      sessionStorage.setItem("researchos:start-plan", options.startPlan);
    } catch {
      // sessionStorage unavailable; the user just lands as a free signed-in
      // account and converts later via the in-app upgrade nudge instead.
    }
  }

  // The callback always carries ?sharingClaim=1 (keypair-mint resume). When the
  // onboarding wizard is driving this sign-in, append ?onbWizard=<free|lab> so the
  // boot gate resumes the wizard at the handle step rather than FolderConnectGate.
  const callbackUrl = options.onboardingWizard
    ? `/?sharingClaim=1&onbWizard=${options.onboardingWizard}`
    : "/?sharingClaim=1";

  // The devmock provider has no real OAuth round trip; route it the same way the
  // claim resume expects (it signs in via the mock and returns with the flag).
  // devMock carries the chosen email for the mock provider, {} otherwise.
  void signIn(provider, { callbackUrl, ...devMock });
}
