"use client";

// Start an OAuth sharing-claim directly from a provider button.
//
// The "Set up sharing" provider buttons used to just open the SharingSetupWizard,
// which then showed the SAME provider buttons again (a confusing double prompt).
// Instead, a click should go STRAIGHT to the provider. This signs in with the
// chosen provider and returns to the current page with ?sharingClaim=1, where the
// global SharingClaimResume (mounted in AppShell) mounts the wizard and its resume
// effect completes the claim (reads the verified email from the session, mints the
// keypair, seals it). No local wizard chooser in between.

import { signIn } from "next-auth/react";

import type { SharingProvider } from "@/components/sharing/SharingProviderButtons";
import { resolveDevMockSignInOptions } from "@/lib/sharing/dev-mock-email";

export function startSharingClaimOAuth(provider: SharingProvider): void {
  if (typeof window === "undefined") return;
  const devMock = resolveDevMockSignInOptions(provider);
  if (devMock === null) return; // dev-mock email prompt cancelled
  const url = new URL(window.location.href);
  url.searchParams.set("sharingClaim", "1");
  void signIn(provider, {
    callbackUrl: url.pathname + url.search + url.hash,
    ...devMock,
  });
}
