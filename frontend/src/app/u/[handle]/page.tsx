"use client";

// Cloud-accounts Phase 1 (Chunk B): the public @handle profile page.
//
// /u/<handle> is a public, shareable, login-free profile (the LinkedIn-style URL
// for a ResearchOS account). It renders on the brand stage and needs no folder
// and no session; it is in the folderless bypass set in providers.tsx.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import Wordmark from "@/components/Wordmark";
import ProfileAvatar from "@/components/account/ProfileAvatar";

interface PublicProfile {
  handle: string;
  displayName: string | null;
  affiliation: string | null;
  avatarUrl: string | null;
}

export default function HandleProfilePage() {
  const params = useParams<{ handle: string }>();
  const handle = Array.isArray(params?.handle) ? params.handle[0] : params?.handle;
  const [state, setState] = useState<"loading" | "found" | "missing">("loading");
  const [profile, setProfile] = useState<PublicProfile | null>(null);

  useEffect(() => {
    if (!handle) {
      setState("missing");
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/account/public?handle=${encodeURIComponent(handle)}`);
        const data = (await res.json().catch(() => ({}))) as {
          found?: boolean;
          profile?: PublicProfile;
        };
        if (!alive) return;
        if (data.found && data.profile) {
          setProfile(data.profile);
          setState("found");
        } else {
          setState("missing");
        }
      } catch {
        if (alive) setState("missing");
      }
    })();
    return () => {
      alive = false;
    };
  }, [handle]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface">
      <MarketingBackdrop tone="soft" />
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center px-5 py-3">
          <a href="/">
            <Wordmark size="sm" animated={false} className="gap-2" />
          </a>
        </header>
        <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-5 py-10">
          {state === "loading" ? (
            <p className="mx-auto text-meta text-foreground-muted">Loading&hellip;</p>
          ) : state === "missing" ? (
            <div className="mx-auto rounded-2xl border border-border bg-surface p-8 text-center shadow-lg">
              <h1 className="text-title font-bold text-foreground">Profile not found</h1>
              <p className="mt-2 text-meta text-foreground-muted">
                There is no ResearchOS account at <b>@{handle}</b>.
              </p>
            </div>
          ) : (
            <div className="mx-auto w-full rounded-2xl border border-border bg-surface p-8 text-center shadow-lg">
              <ProfileAvatar
                avatarUrl={profile?.avatarUrl ?? null}
                name={profile?.displayName ?? profile?.handle}
                sizePx={64}
                className="mx-auto"
              />
              <h1 className="mt-4 text-heading font-extrabold tracking-tight text-foreground">
                {profile?.displayName ?? `@${profile?.handle}`}
              </h1>
              <p className="text-body font-semibold text-brand-purple">@{profile?.handle}</p>
              {profile?.affiliation && (
                <p className="mt-1 text-body text-foreground-muted">{profile.affiliation}</p>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
