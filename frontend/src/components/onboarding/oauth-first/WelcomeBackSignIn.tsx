"use client";

// The "Welcome back" re-login screen (entry-flow redesign change 5, 2026-06-11).
//
// Reached from the landing's "Sign in". Shows the provider logins with the
// provider the visitor used LAST floated to the top and badged "Last used", the
// rest collapsed behind "More sign-in options". Clicking a provider opens it
// IMMEDIATELY (OAuth-first), the folder step follows the return. A solo user
// with no account skips login entirely via "Open a folder, no account".
//
// Provider availability mirrors SharingProviderButtons (the same flag gates), so
// this screen never shows a button that would dead-end at /api/auth/error. In a
// dev-mock build the single mock button stands in for the real providers.
//
// Faithful to docs/mockups/2026-06-10-entry-flow-oauth-first.html (the "Welcome
// back" deckscreen). Permanently light, like the landing.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useMemo, useState } from "react";

import LightOnly from "@/components/LightOnly";
import BeakerSpeech from "@/components/beakerbot/BeakerSpeech";
import { buildEntryGreetingLines } from "@/lib/beakerbot/entry-lines";
import {
  GitHubIcon,
  GoogleIcon,
  LinkedInIcon,
  MicrosoftIcon,
  OrcidIcon,
} from "@/components/sharing/icons";
import type { SharingProvider } from "@/components/sharing/SharingProviderButtons";
import {
  isOAuthPublishAvailable,
  isDevMockAuth,
  isMicrosoftAuthEnabled,
} from "@/lib/sharing/oauth-availability";
import { readLastProvider } from "@/lib/sharing/oauth-first-login";
import { isRequireAccountEnabled, isLocalPathVisible } from "@/lib/account/require-account";
import { startOAuthFirstSignIn } from "@/lib/sharing/oauth-first-signin";
import { IntroBubbleBot } from "./IntroBubbleBot";
import LandingBackdrop from "./LandingBackdrop";

export interface WelcomeBackSignInProps {
  /** Return to the landing. */
  onBack: () => void;
  /** Open a folder with no account (solo escape). Triggers the OS picker. */
  onOpenFolder: () => void;
}

interface ProviderDef {
  id: SharingProvider;
  label: string;
  icon: React.ReactNode;
  /** Dark branded button (GitHub / LinkedIn) vs the white branded button. */
  dark?: "github" | "linkedin";
}

export function WelcomeBackSignIn({
  onBack,
  onOpenFolder,
}: WelcomeBackSignInProps) {
  const [showAll, setShowAll] = useState(false);

  // Current hour, computed after mount (client-only, avoids hydration mismatch).
  const [hour, setHour] = useState(0);
  useEffect(() => {
    setHour(new Date().getHours());
  }, []);

  const entryLines = buildEntryGreetingLines({ hour, returning: true });

  // The full ordered provider set, honoring the same availability gates as
  // SharingProviderButtons. ORCID + Google always show when OAuth is available;
  // Microsoft is on its own flag.
  const allProviders = useMemo<ProviderDef[]>(() => {
    const list: ProviderDef[] = [
      { id: "orcid", label: "Continue with ORCID", icon: <OrcidIcon className="h-4 w-4" /> },
      { id: "google", label: "Continue with Google", icon: <GoogleIcon className="h-4 w-4" /> },
    ];
    if (isMicrosoftAuthEnabled()) {
      list.push({
        id: "microsoft-entra-id",
        label: "Continue with Microsoft",
        icon: <MicrosoftIcon className="h-4 w-4" />,
      });
    }
    list.push(
      { id: "github", label: "Continue with GitHub", icon: <GitHubIcon className="h-4 w-4" />, dark: "github" },
      { id: "linkedin", label: "Continue with LinkedIn", icon: <LinkedInIcon className="h-4 w-4" />, dark: "linkedin" },
    );
    return list;
  }, []);

  const lastProvider = useMemo(() => readLastProvider(), []);

  // Float the last-used provider to the top; the rest keep their order.
  const ordered = useMemo(() => {
    if (!lastProvider) return allProviders;
    const match = allProviders.find((p) => p.id === lastProvider);
    if (!match) return allProviders;
    return [match, ...allProviders.filter((p) => p.id !== match.id)];
  }, [allProviders, lastProvider]);

  // With a known last provider we show only it up front (plus a "More" toggle);
  // without one we show the default short stack (ORCID + Google) and collapse
  // the rest. Either way "More sign-in options" reveals everything.
  const primaryCount = lastProvider ? 1 : 2;
  const visible = showAll ? ordered : ordered.slice(0, primaryCount);
  const hasMore = ordered.length > primaryCount;

  const oauthAvailable = isOAuthPublishAvailable();
  const devMock = isDevMockAuth();
  // Require-account pivot: when the flag is on, retire the no-account "Open a
  // folder" escape so sign-in is the only way in. The shared helper keeps the
  // escape whenever OAuth is NOT available in this build, since hiding it then
  // would leave no path forward (no soft-locks).
  const hideSoloEscape = !isLocalPathVisible({
    requireAccount: isRequireAccountEnabled(),
    hasAccountTier: oauthAvailable,
  });

  function btnClass(def: ProviderDef): string {
    const base =
      "relative w-full flex items-center justify-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold transition-transform hover:-translate-y-px";
    if (def.dark === "github") return `${base} bg-[#24292e] text-white`;
    if (def.dark === "linkedin") return `${base} bg-[#0A66C2] text-white`;
    // The light-branded providers (ORCID, Google, Microsoft) stay white in BOTH
    // themes so the multicolor brand logos stay legible and the label is always
    // dark-on-white. A theme-aware surface here goes dark-on-dark in dark mode.
    return `${base} border border-slate-300 bg-white text-slate-800 hover:bg-slate-100`;
  }

  return (
    <LightOnly>
      <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
        {/* Shared deck backdrop, matching the OAuth-first landing exactly. */}
        <LandingBackdrop />

        <button
          type="button"
          onClick={onBack}
          className="absolute left-5 top-5 z-[4] text-sm font-semibold text-foreground-muted hover:text-brand-action transition-colors"
        >
          <span aria-hidden>&larr;</span> Back
        </button>

        <div className="relative z-[1] flex w-full max-w-xs flex-col items-center">
          {/* Same beaker size + center placement as the landing hero, so he
              never shrinks or jumps between the welcome and the sign-in screen. */}
          <IntroBubbleBot size="xl" className="mb-2" />

          {/* Tier-A greeting bubble, compact for the narrow card. The notch
              points up toward the beaker above. rotateMs slightly slower so it
              does not distract while the user is reading provider buttons. */}
          <BeakerSpeech
            lines={entryLines}
            tinted
            rotateMs={5500}
            className="mb-4 w-full"
          />

          <h1 className="text-[23px] font-extrabold tracking-tight text-brand-ink">
            Welcome back
          </h1>
          <p className="mt-1 max-w-[36ch] text-[12.5px] text-foreground-muted">
            {hideSoloEscape
              ? "Sign in to continue. Your work still lives on your own disk."
              : "Sign in to unlock sharing, or just open your folder if you work solo with no account."}
          </p>

          {oauthAvailable && devMock ? (
            // Dev-mock build: the real providers dead-end without creds, so the
            // single mock button stands in (it exercises the same claim flow).
            <button
              type="button"
              onClick={() => startOAuthFirstSignIn("devmock")}
              className="ros-btn-raise mt-6 w-full rounded-[10px] bg-amber-500 px-3 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-amber-600"
            >
              Dev mock sign-in (test the link flow)
            </button>
          ) : oauthAvailable ? (
            <div className="mt-6 w-full space-y-2">
              {visible.map((def) => {
                const isLast = def.id === lastProvider;
                return (
                  <button
                    key={def.id}
                    type="button"
                    onClick={() => startOAuthFirstSignIn(def.id)}
                    className={`${btnClass(def)} ${isLast ? "ring-2 ring-brand-sky" : ""}`}
                  >
                    {isLast && (
                      <span className="absolute -top-2 right-2.5 rounded-full bg-brand-sky px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-wide text-white">
                        Last used
                      </span>
                    )}
                    {def.icon}
                    {def.label}
                  </button>
                );
              })}

              {hasMore && !showAll && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="w-full rounded-[9px] border border-dashed border-border bg-transparent px-3 py-2 text-[12px] font-semibold text-foreground-muted hover:text-foreground transition-colors"
                >
                  More sign-in options
                </button>
              )}
            </div>
          ) : (
            // OAuth not configured in this build. Solo users can still open a
            // folder; the account itself is a local keypair created in-app.
            <p className="mt-6 max-w-[34ch] text-[12px] text-foreground-muted">
              Account sign-in is not configured in this build. Open your folder
              to pick up where you left off.
            </p>
          )}

          {/* Divider + the solo escape hatch. Hidden when the require-account
              flag retires the no-account path (hideSoloEscape). */}
          {!hideSoloEscape && (
            <>
              <div className="mt-3.5 mb-2.5 flex w-full items-center gap-2 text-[11px] text-foreground-muted">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
              <button
                type="button"
                onClick={onOpenFolder}
                className="w-full rounded-[10px] border border-border bg-surface-sunken px-3 py-2.5 text-[13px] font-bold text-foreground hover:border-foreground-muted transition-colors"
              >
                Open a folder, no account
              </button>
            </>
          )}

          <p className="mt-3 max-w-[34ch] text-[11px] leading-relaxed text-foreground-muted">
            {hideSoloEscape
              ? "The provider you used last floats to the top with the badge."
              : "The provider you used last floats to the top with the badge. Solo users who do not want an account skip login entirely with Open a folder."}
          </p>
        </div>
      </div>
    </LightOnly>
  );
}

export default WelcomeBackSignIn;
