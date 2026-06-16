"use client";

// Cloud-accounts Phase 1 (Chunk B): the public @handle profile page.
//
// /u/<handle> is a public, shareable, login-free profile (the LinkedIn-style URL
// for a ResearchOS account). It renders on the brand stage and needs no folder
// and no session; it is in the folderless bypass set in providers.tsx.
//
// Social layer (Phase A1): behind NEXT_PUBLIC_SOCIAL_LAYER the page renders to
// library parity (MarketingNav + MarketingFooter chrome, plus the bio and typed
// links that the /api/account/public payload already returns). With the flag off
// it renders the original thin card, byte-for-byte unchanged.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import Wordmark from "@/components/Wordmark";
import ProfileAvatar from "@/components/account/ProfileAvatar";
import { Icon, type IconName } from "@/components/icons";
import { SOCIAL_LAYER_ENABLED } from "@/lib/social/config";
import type { ProfileLinks } from "@/lib/account/account-profile-validation";

interface PublicProfile {
  handle: string;
  displayName: string | null;
  affiliation: string | null;
  avatarUrl: string | null;
  bio?: string | null;
  links?: ProfileLinks | null;
}

function linkItems(
  links: ProfileLinks | null | undefined,
): { icon: IconName; label: string; href: string }[] {
  if (!links) return [];
  const items: { icon: IconName; label: string; href: string }[] = [];
  if (links.orcid) {
    items.push({ icon: "reference", label: "ORCID", href: `https://orcid.org/${links.orcid}` });
  }
  if (links.researchgate) {
    items.push({ icon: "book", label: "ResearchGate", href: links.researchgate });
  }
  if (links.website) {
    items.push({ icon: "share", label: "Website", href: links.website });
  }
  return items;
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

  // ---- Library-parity layout (social layer on) --------------------------------
  if (SOCIAL_LAYER_ENABLED) {
    const links = linkItems(profile?.links);
    return (
      <div className="min-h-dvh bg-surface text-foreground">
        <MarketingNav />
        <section className="relative overflow-hidden">
          <MarketingBackdrop tone="soft" />
          <div className="relative z-10 mx-auto w-full max-w-2xl px-6 pb-16 pt-12 sm:pt-16">
            {state === "loading" ? (
              <p className="py-20 text-center text-meta text-foreground-muted">
                Loading&hellip;
              </p>
            ) : state === "missing" ? (
              <div className="mx-auto mt-8 rounded-2xl border border-border bg-surface p-8 text-center shadow-lg">
                <h1 className="text-title font-bold text-foreground">Profile not found</h1>
                <p className="mt-2 text-meta text-foreground-muted">
                  There is no ResearchOS account at <b>@{handle}</b>.
                </p>
              </div>
            ) : (
              <div className="mx-auto mt-4 w-full rounded-2xl border border-border bg-surface p-8 shadow-lg">
                <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left">
                  <ProfileAvatar
                    avatarUrl={profile?.avatarUrl ?? null}
                    name={profile?.displayName ?? profile?.handle}
                    sizePx={84}
                    className="shrink-0"
                  />
                  <div className="mt-4 min-w-0 sm:ml-6 sm:mt-0">
                    <h1 className="text-heading font-extrabold tracking-tight text-foreground">
                      {profile?.displayName ?? `@${profile?.handle}`}
                    </h1>
                    <p className="text-body font-semibold text-brand-purple">
                      @{profile?.handle}
                    </p>
                    {profile?.affiliation && (
                      <p className="mt-1 text-body text-foreground-muted">
                        {profile.affiliation}
                      </p>
                    )}
                  </div>
                </div>

                {profile?.bio && (
                  <p className="mt-6 whitespace-pre-line text-pretty text-body leading-relaxed text-foreground">
                    {profile.bio}
                  </p>
                )}

                {links.length > 0 && (
                  <div className="mt-6 flex flex-wrap gap-2">
                    {links.map((l) => (
                      <a
                        key={l.label}
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-meta font-medium text-foreground-muted transition hover:border-brand-action hover:text-brand-action"
                      >
                        <Icon name={l.icon} className="h-3.5 w-3.5" /> {l.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
        <MarketingFooter />
      </div>
    );
  }

  // ---- Original thin layout (social layer off, byte-identical) ----------------
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
