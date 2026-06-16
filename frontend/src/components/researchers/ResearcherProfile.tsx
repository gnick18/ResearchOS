"use client";

// Standalone researcher profile page (rendered at /researchers/[fingerprint]).
//
// This is the shareable, direct-link fallback: a clean light page with the
// profile card centered and the funding acknowledgment footer at the bottom. It
// renders WITHOUT the AppShell or a connected folder, so the URL can be pasted
// into an email and opened by anyone, and it exposes no email address.
//
// Inside the app, profiles open as a living popup over the current page instead
// (see ResearcherProfileModal); this page is what a cold, external visitor sees.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";

import Link from "next/link";
import AppFooter from "@/components/AppFooter";
import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import ProfileCard from "./ProfileCard";
import { SOCIAL_LAYER_ENABLED } from "@/lib/social/config";
import {
  type PublishedProfile,
  fetchProfileByFingerprint,
} from "@/lib/sharing/profile";

function PageShell({ children }: { children: React.ReactNode }) {
  // Social layer (Phase A): the public researcher-network hub links here, so the
  // shareable profile shares the /library + /u marketing chrome. Flag-off keeps
  // the original standalone shell, byte-for-byte unchanged.
  if (SOCIAL_LAYER_ENABLED) {
    return (
      <div className="min-h-dvh bg-surface text-foreground">
        <MarketingNav />
        <section className="relative overflow-hidden">
          <MarketingBackdrop tone="soft" />
          <div className="relative z-10 mx-auto flex w-full max-w-lg flex-col px-4 pb-16 pt-10">
            <Link
              href="/network"
              className="mb-4 inline-flex items-center text-meta font-medium text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
            >
              Back to the researcher network
            </Link>
            {children}
          </div>
        </section>
        <MarketingFooter />
      </div>
    );
  }
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-100 to-slate-50 text-foreground">
      <header className="border-b border-border bg-surface-raised/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link
            href="/researchers"
            className="text-body font-medium text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
          >
            Researcher directory
          </Link>
          <Link
            href="/"
            className="text-body font-medium text-sky-700 dark:text-sky-300 underline-offset-2 hover:text-sky-900 hover:underline"
          >
            Back to the app
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-10">
        {children}
      </main>
      <AppFooter />
    </div>
  );
}

export default function ResearcherProfile({
  compactFingerprint,
}: {
  compactFingerprint: string;
}) {
  const [profile, setProfile] = useState<PublishedProfile | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    fetchProfileByFingerprint(compactFingerprint).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [compactFingerprint]);

  if (profile === undefined) {
    return (
      <PageShell>
        <div className="flex flex-1 items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-sky-500" />
        </div>
      </PageShell>
    );
  }

  if (profile === null) {
    return (
      <PageShell>
        <div className="mt-6 rounded-2xl bg-surface-overlay border border-border p-8 text-center shadow-xl ring-1 ring-black/5">
          <h1 className="text-heading font-semibold text-foreground">
            Profile not found
          </h1>
          <p className="mt-2 text-body text-foreground-muted leading-relaxed">
            No researcher has published a profile for that fingerprint. The link
            may be old, or they have not joined the directory.
          </p>
          <Link
            href="/researchers"
            className="mt-4 inline-block text-body font-medium text-sky-700 dark:text-sky-300 underline-offset-2 hover:underline"
          >
            Browse the researcher directory
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <ProfileCard profile={profile} />
    </PageShell>
  );
}
