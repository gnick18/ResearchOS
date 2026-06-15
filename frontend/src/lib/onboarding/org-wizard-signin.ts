"use client";

// OAuth kickoff + resume marker for the org-admin wizard (Track 3).
//
// The org wizard is folderless and never mints a research keypair, so it must
// NOT use the research ?sharingClaim=1 callback (that path runs the keypair mint
// + folder connect). Instead it returns with ?orgWizard=<dept|inst>, which the
// boot gate reads to re-mount the org wizard at the name step (sign-in already
// happened). The provider opens immediately on click, exactly like the research
// OAuth-first kickoff.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { signIn } from "next-auth/react";

import type { SharingProvider } from "@/components/sharing/SharingProviderButtons";
import { markLandingSeen } from "@/lib/landing/landing-gate";
import { rememberLastProvider } from "@/lib/sharing/oauth-first-login";

export type OrgWizardKind = "dept" | "inst";

const PARAM = "orgWizard";

/** Start an OAuth sign-in for the org wizard, returning with the org marker. */
export function startOrgWizardSignIn(
  provider: SharingProvider,
  kind: OrgWizardKind,
): void {
  if (typeof window === "undefined") return;
  markLandingSeen();
  rememberLastProvider(provider);
  void signIn(provider, { callbackUrl: `/?${PARAM}=${kind}` });
}

/**
 * Reads the org-wizard resume marker from the current URL, or null. Pure read,
 * safe in SSR (returns null when there is no window).
 */
export function readOrgWizardReturn(): OrgWizardKind | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get(PARAM);
  return v === "dept" || v === "inst" ? v : null;
}

/** Strips the org-wizard marker from the URL without a navigation. */
export function clearOrgWizardReturn(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(PARAM)) return;
  url.searchParams.delete(PARAM);
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event("researchos:locationchange"));
}
