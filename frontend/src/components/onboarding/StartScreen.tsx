"use client";

// The start screen: the top-level front door shown when a visitor is NOT
// auto-reconnected (no live session). It routes intent so a returning user is
// never dropped onto the generic folder-picker as if we have nothing saved:
//
//   Sign in        -> provider OAuth (returning Free / Lab account, or a new device)
//   Open a folder  -> connect a local folder directly (solo, or any returning user)
//   Create account -> the 3-tier AccountTierChooser (the new-account flow)
//
// Copy adapts for a returning visitor (a previously-connected folder is known):
// it leads with "Open your folder" and "Sign in" rather than "create".
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import BeakerBot from "@/components/BeakerBot";
import { markLandingSeen } from "@/lib/landing/landing-gate";
import SharingProviderButtons, {
  type SharingProvider,
} from "@/components/sharing/SharingProviderButtons";
import BetaDonationButton from "@/components/BetaDonationButton";
import FeedbackModal from "@/components/FeedbackModal";
import { useErrorReporting } from "@/hooks/useErrorReporting";

export interface StartScreenProps {
  /** True when a previously-connected folder is known (returning visitor). */
  returning: boolean;
  /** Connect / reconnect a local folder directly (solo + returning paths). */
  onOpenFolder: () => void;
  /** Start the new-account flow (the 3-tier chooser). */
  onCreateAccount: () => void;
  /**
   * When provided, a bouncing "What is ResearchOS?" scroll-down affordance is
   * shown at the bottom; clicking it snaps down to the welcome section. Supplied
   * by OAuthFirstLanding; omitted when the StartScreen renders standalone.
   */
  onScrollDown?: () => void;
}

export function StartScreen({
  returning,
  onOpenFolder,
  onCreateAccount,
  onScrollDown,
}: StartScreenProps) {
  const router = useRouter();
  const [showSignIn, setShowSignIn] = useState(false);
  const { showBugReport, currentError, openBugReport, closeBugReport } =
    useErrorReporting();

  const signIn = (provider: SharingProvider) => {
    markLandingSeen();
    router.push("/?connect=1&signIn=" + provider);
  };

  return (
    <div className="relative min-h-screen w-full bg-surface flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-md flex flex-col items-center text-center">
        <BeakerBot pose="waving" className="w-36 h-36 mb-4 text-sky-500" />
        <h1 className="text-2xl font-extrabold text-foreground">
          {returning ? "Welcome back" : "Welcome to ResearchOS"}
        </h1>
        <p className="mt-2 text-sm text-foreground-muted">
          {returning
            ? "Open your folder to pick up where you left off, or sign in to your account."
            : "Your lab, your data, your machine. How would you like to start?"}
        </p>

        {!showSignIn ? (
          <div className="mt-8 w-full flex flex-col gap-3">
            {/* Returning users lead with Open your folder; fresh users see it
                lower, after sign-in. */}
            {returning && (
              <button
                type="button"
                onClick={onOpenFolder}
                className="w-full btn-brand py-3 rounded-xl font-semibold text-sm"
              >
                Open your folder
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowSignIn(true)}
              className={`w-full py-3 rounded-xl font-semibold text-sm border ${
                returning
                  ? "border-border bg-surface-raised text-foreground hover:border-brand-action"
                  : "btn-brand"
              }`}
            >
              Sign in
            </button>

            {!returning && (
              <button
                type="button"
                onClick={onOpenFolder}
                className="w-full py-3 rounded-xl font-semibold text-sm border border-border bg-surface-raised text-foreground hover:border-brand-action"
              >
                Open a folder
              </button>
            )}

            <button
              type="button"
              onClick={onCreateAccount}
              className="w-full py-3 rounded-xl font-semibold text-sm border border-border bg-surface-raised text-foreground hover:border-brand-action"
            >
              Create a new account
            </button>
          </div>
        ) : (
          <div className="mt-8 w-full flex flex-col items-center">
            <button
              type="button"
              onClick={() => setShowSignIn(false)}
              className="self-start text-sm font-semibold text-foreground-muted hover:text-brand-action mb-3"
            >
              &larr; Back
            </button>
            <p className="text-sm text-foreground-muted mb-4">
              Sign in to your ResearchOS account.
            </p>
            <SharingProviderButtons onProvider={signIn} />
          </div>
        )}
      </div>

      {!showSignIn && (
        <p className="mt-8 text-xs text-foreground-muted max-w-sm text-center">
          Everything is local-first. Your files always live on your own disk. A
          free account is your identity, the way researchers find each other,
          not a place we store your data.
        </p>
      )}

      {/* Footer links, rehomed from the retired ResearchFolderSetupNew landing
          card (onboarding redundancy removal, 2026-06-10). The setup guide and
          the lab-sharing primer answer the two most common pre-connect
          questions; Report Bug + Support keep the beta-feedback affordances at
          the front door. */}
      {!showSignIn && (
        <div className="mt-6 flex items-center justify-center gap-4 flex-wrap text-center">
          <Link
            href="/wiki/getting-started/connecting-your-folder"
            className="text-foreground-muted hover:text-foreground text-meta transition-colors"
          >
            New here? Read the setup guide
          </Link>
          <Link
            href="/wiki/shared-lab-accounts"
            className="text-foreground-muted hover:text-foreground text-meta transition-colors"
          >
            Sharing a folder with your lab?
          </Link>
          <button
            onClick={openBugReport}
            className="text-foreground-muted hover:text-foreground text-meta transition-colors"
          >
            Report Bug
          </button>
          <BetaDonationButton variant="link" />
        </div>
      )}

      <FeedbackModal
        isOpen={showBugReport}
        onClose={closeBugReport}
        prefilledError={currentError}
      />

      {/* Bouncing scroll-down affordance: snaps to the welcome section below. */}
      {onScrollDown && !showSignIn && (
        <button
          type="button"
          onClick={onScrollDown}
          aria-label="Learn what ResearchOS is"
          className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 text-foreground-muted hover:text-brand-action transition-colors animate-bounce"
        >
          <span className="text-xs font-medium">What is ResearchOS?</span>
          <span className="block w-3 h-3 border-b-2 border-r-2 border-current rotate-45" />
        </button>
      )}
    </div>
  );
}

export default StartScreen;
