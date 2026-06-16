"use client";

// Standalone shell for the organization admin portals (Department, Institution).
//
// These surfaces are deliberately SEPARATE from the main app: they manage an
// org's plan, roster, and billing, all of which live in Neon, so they need no
// connected folder and no File System Access API. Wrapping them in AppShell (the
// full research-app chrome: nav, notifications, folder context) was wrong, it
// buried a billing portal inside the whole app. This shell gives them their own
// minimal, branded surface on the marketing stage, sign-in gated, openable in any
// browser.
//
// Auth is the NextAuth session (the same email the /api/dept|institution routes
// derive the owner key from), read imperatively via getSession() because the app
// mounts no <SessionProvider> (matches the /dept/join accept page). A logged-out
// visitor sees a sign-in card here, never the create-form 401.
//
// The full portal login (one root OAuth recovery account + a resettable shared
// access code) is a later layer on top of this gate; see the billing-buildout
// handoff. For now it reuses the existing providers (dev-mock on localhost).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState, type ReactNode } from "react";
import { getSession, signIn, signOut } from "next-auth/react";
import Wordmark from "@/components/Wordmark";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import SharingProviderButtons, {
  type SharingProvider,
} from "@/components/sharing/SharingProviderButtons";
import { isOAuthPublishAvailable } from "@/lib/sharing/oauth-availability";

type AuthState = "loading" | "in" | "out";

export interface PortalShellProps {
  /** Short portal label shown in the header pill + gate, e.g. "Department admin". */
  title: string;
  /** One-line description of what the portal manages, shown on the sign-in gate. */
  tagline: string;
  /** Override the gate heading. Defaults to "Sign in to your <title> portal". */
  gateHeading?: string;
  children: ReactNode;
}

export default function PortalShell({
  title,
  tagline,
  gateHeading,
  children,
}: PortalShellProps) {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getSession().then((s) => {
      if (!alive) return;
      const e = s?.user?.email ?? null;
      setEmail(e);
      setAuth(e ? "in" : "out");
    });
    return () => {
      alive = false;
    };
  }, []);

  const callbackUrl =
    typeof window !== "undefined" ? window.location.pathname : "/";

  const onProvider = (provider: SharingProvider) => {
    // The portal gate just needs a verified-email session; signIn directly
    // rather than running the local-account claim flow the wizard uses.
    void signIn(provider, { callbackUrl });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface">
      <MarketingBackdrop tone="soft" />

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Portal header: brand lockup + portal label, no app nav. */}
        <header className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-3 backdrop-blur-sm">
          <Wordmark size="sm" animated={false} className="gap-2" />
          <span className="rounded-full border border-brand-purple/30 bg-brand-purple/10 px-2.5 py-1 text-meta font-bold uppercase tracking-wide text-brand-purple">
            {title}
          </span>
          {auth === "in" && email ? (
            <div className="ml-auto flex items-center gap-2 text-meta text-foreground-muted">
              <span className="hidden sm:inline">{email}</span>
              <button
                type="button"
                onClick={() => void signOut({ callbackUrl: "/" })}
                className="rounded-lg border border-border bg-surface px-2.5 py-1 text-meta font-semibold text-foreground hover:border-brand-action"
              >
                Sign out
              </button>
            </div>
          ) : null}
        </header>

        <main className="relative z-10 mx-auto w-full max-w-4xl flex-1 px-5 py-8">
          {auth === "loading" ? (
            <div className="flex items-center justify-center py-24 text-meta text-foreground-muted">
              Loading your portal&hellip;
            </div>
          ) : auth === "out" ? (
            <SignInGate
              title={title}
              tagline={tagline}
              gateHeading={gateHeading}
              onProvider={onProvider}
            />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

function SignInGate({
  title,
  tagline,
  gateHeading,
  onProvider,
}: {
  title: string;
  tagline: string;
  gateHeading?: string;
  onProvider: (p: SharingProvider) => void;
}) {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <Wordmark size="lg" animated={false} className="justify-center" />
      <span className="mt-4 inline-block rounded-full border border-brand-purple/30 bg-brand-purple/10 px-2.5 py-1 text-meta font-bold uppercase tracking-wide text-brand-purple">
        {title}
      </span>
      <h1 className="mt-4 text-heading font-extrabold tracking-tight text-foreground">
        {gateHeading ?? `Sign in to your ${title.replace(/ admin$/i, "")} portal`}
      </h1>
      <p className="mx-auto mt-1 max-w-sm text-body text-foreground-muted">{tagline}</p>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-6 shadow-lg">
        {isOAuthPublishAvailable() ? (
          <SharingProviderButtons onProvider={onProvider} />
        ) : (
          <p className="text-body text-foreground-muted">
            Sign-in is not configured in this environment yet.
          </p>
        )}
        <p className="mt-3 text-meta text-foreground-muted">
          First sign-in provisions your admin identity. No folder, no file access,
          just the org admin tools.
        </p>
      </div>
    </div>
  );
}
