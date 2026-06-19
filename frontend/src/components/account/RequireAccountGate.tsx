"use client";

// RequireAccountGate (require-account-ironclad, 2026-06-18).
//
// Enforces the one-model rule app-wide: your account IS your identity IS your
// sharing setup. When require-account is on and OAuth is actually available, a
// connected user whose account is local-only (a keypair with no verified-email
// binding) is held here, in front of the whole app, until they complete the one
// sign-in that claims the account. There is no "set up sharing" nag to dismiss
// and no way to slip past it into the app.
//
// NO SOFT LOCK: the gate only mounts when an OAuth claim path actually exists
// (the caller checks isOAuthPublishAvailable), the escape from the gate is
// completing the sign-in, and a secondary "use a different folder" action
// disconnects back to the connect screen so a user is never stranded. A build
// with no auth configured never reaches this gate (the caller's guard), so a
// no-auth self-host or dev build keeps working local-only.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";
import BeakerBot from "@/components/BeakerBot";
import Wordmark from "@/components/Wordmark";
import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import { useFileSystem } from "@/lib/file-system/file-system-context";

export default function RequireAccountGate({
  username,
  onClaimed,
}: {
  /** The folder-local username whose account is being claimed. */
  username: string;
  /** Called once the claim publishes, so the shell can re-read identity and release. */
  onClaimed: () => void;
}) {
  // The wizard here only STARTS a claim (provider choose / email entry). When a
  // provider redirect returns with ?sharingClaim, AppShell skips this gate so the
  // global SharingClaimResume finishes keygen + publish; the identity-written
  // event then releases the gate. The inline email-OTP path completes here and
  // calls onClaimed directly.
  const [wizardOpen, setWizardOpen] = useState(false);
  const { disconnect } = useFileSystem();

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-surface-sunken px-6">
      <div className="ros-popup-card w-full max-w-md rounded-2xl bg-surface-raised p-8 text-center">
        <div className="flex justify-center">
          <BeakerBot
            pose="waving"
            ariaLabel="ResearchOS BeakerBot"
            className="h-14 w-14 text-brand-sky"
          />
        </div>
        <div className="mt-3 flex justify-center">
          <Wordmark size="sm" textOnly />
        </div>
        <h1 className="mt-4 text-heading font-extrabold text-foreground">
          Finish creating your account
        </h1>
        <p className="mt-2 text-body text-foreground-muted leading-relaxed">
          Your account is your identity and your sharing setup, one and the same.
          Sign in once to claim it. Your work stays encrypted on your own machine
          and your private key never leaves this device. This is also what lets
          colleagues find you and lets you join a lab.
        </p>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="ros-btn-raise mt-6 w-full rounded-xl bg-brand-action px-4 py-2.5 text-body font-semibold text-white"
        >
          Continue with sign-in
        </button>
        <button
          type="button"
          onClick={() => void disconnect()}
          className="mt-3 text-meta text-foreground-muted underline-offset-2 hover:underline"
        >
          Use a different folder
        </button>
      </div>

      {wizardOpen && (
        <SharingSetupWizard
          username={username}
          onComplete={() => {
            // Re-read identity; once it reads as published the shell releases.
            onClaimed();
          }}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}
