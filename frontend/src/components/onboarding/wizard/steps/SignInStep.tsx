"use client";

// Wizard step: sign in. Renders the shared branded provider buttons. Clicking a
// provider kicks off the existing OAuth-first sign-in (startOAuthFirstSignIn),
// which leaves the page and returns into the app with ?sharingClaim=1. The
// wizard does not advance with next() here, the page-leaving redirect is the
// transition; the host resumes the wizard at the following step on return (see
// the resume wiring in Phase 5).
//
// For the lab-create track the labCreate option is passed so the existing
// LabCreateResume provisions the lab on return, exactly as the chooser did.
//
// No emojis, no em-dashes, no mid-sentence colons.

import BeakerBot from "@/components/BeakerBot";
import SharingProviderButtons from "@/components/sharing/SharingProviderButtons";
import type { SharingProvider } from "@/components/sharing/SharingProviderButtons";
import { startOAuthFirstSignIn } from "@/lib/sharing/oauth-first-signin";
import {
  startOrgWizardSignIn,
  type OrgWizardKind,
} from "@/lib/onboarding/org-wizard-signin";

export interface SignInStepProps {
  /** Heading copy, varies by track (free account vs create a lab). */
  heading: string;
  /** Supporting line under the heading. */
  subheading: string;
  /**
   * When true, set the lab-create marker before the OAuth redirect so the lab is
   * provisioned on return (PI / lab Create track).
   */
  labCreate?: boolean;
  /**
   * When set, this is the org-admin track sign in. It uses the org OAuth kickoff
   * (returns with ?orgWizard=<kind>, never the research keypair-mint callback)
   * so the org wizard resumes at the name step on return.
   */
  orgKind?: OrgWizardKind;
  /**
   * Test/host seam: override the provider-click handler. Defaults to the real
   * OAuth-first kickoff. Lets a preview or test exercise the step without a live
   * redirect.
   */
  onProvider?: (provider: SharingProvider) => void;
}

export default function SignInStep({
  heading,
  subheading,
  labCreate = false,
  orgKind,
  onProvider,
}: SignInStepProps) {
  const handleProvider = (provider: SharingProvider) => {
    if (onProvider) {
      onProvider(provider);
      return;
    }
    if (orgKind) {
      startOrgWizardSignIn(provider, orgKind);
      return;
    }
    startOAuthFirstSignIn(provider, labCreate ? { labCreate: true } : {});
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center">
      <div className="mb-3 h-16 w-16">
        <BeakerBot
          pose="idle"
          alive
          className="h-full w-full text-sky-400"
          ariaLabel="BeakerBot"
        />
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
        {heading}
      </h1>
      <p className="mb-8 mt-2 text-sm text-foreground-muted">{subheading}</p>
      <div className="w-full">
        <SharingProviderButtons onProvider={handleProvider} />
      </div>
    </div>
  );
}
