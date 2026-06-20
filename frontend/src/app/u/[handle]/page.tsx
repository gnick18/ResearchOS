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
// Labs section: behind NEXT_PUBLIC_LAB_SITES (reuses the lab-sites flag) the
// profile shows the researcher's publicly-listed lab memberships, each linking
// to the lab's companion site when one exists. Privacy rule: only LISTED labs
// (directory_labs.listed = true) are shown; unlisted labs are omitted.
//
// No emojis, no em-dashes, no mid-sentence colons.

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import Wordmark from "@/components/Wordmark";
import ProfileAvatar from "@/components/account/ProfileAvatar";
import OrcidPublications from "@/components/researchers/OrcidPublications";
import { Icon, type IconName } from "@/components/icons";
import { SOCIAL_LAYER_ENABLED, LAB_SITES_ENABLED } from "@/lib/social/config";
import type { ProfileLinks } from "@/lib/account/account-profile-validation";
import type { ResearcherLabEntry } from "@/lib/account/researcher-labs";

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

// ---------------------------------------------------------------------------
// Labs section (behind LAB_SITES_ENABLED)
// ---------------------------------------------------------------------------

interface LabsSectionProps {
  labs: ResearcherLabEntry[];
}

function LabsSection({ labs }: LabsSectionProps) {
  if (labs.length === 0) return null;
  return (
    <div className="mt-6">
      <h2 className="mb-3 text-meta font-semibold uppercase tracking-wider text-foreground-muted">
        Labs
      </h2>
      <ul className="space-y-2">
        {labs.map((lab) => {
          const labUrl = lab.slug
            ? `https://${lab.slug}.research-os.com`
            : null;
          const roleLabel = lab.isPi ? "Principal investigator" : "Member";
          const inner = (
            <div className="flex items-center gap-3">
              {/* vial is the standard lab-ware silhouette in the icon registry */}
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-subtle text-foreground-muted">
                <Icon name="vial" className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-body font-medium text-foreground">
                  {lab.name}
                </p>
                <p className="text-meta text-foreground-muted">
                  {roleLabel}
                  {lab.institution ? ` · ${lab.institution}` : ""}
                </p>
              </div>
              {labUrl && (
                <span className="ml-auto shrink-0 text-foreground-muted">
                  <Icon name="share" className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          );

          if (labUrl) {
            return (
              <li key={lab.name}>
                <a
                  href={labUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl border border-border bg-surface px-4 py-3 transition hover:border-brand-action hover:shadow-sm"
                >
                  {inner}
                </a>
              </li>
            );
          }
          return (
            <li key={lab.name}>
              <div className="block rounded-xl border border-border bg-surface px-4 py-3">
                {inner}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function HandleProfilePage() {
  const params = useParams<{ handle: string }>();
  const handle = Array.isArray(params?.handle) ? params.handle[0] : params?.handle;
  const [state, setState] = useState<"loading" | "found" | "missing">("loading");
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [labs, setLabs] = useState<ResearcherLabEntry[]>([]);

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

  // Fetch labs independently so a slow DB join does not block the profile card.
  // Gated on LAB_SITES_ENABLED so the fetch never fires when the flag is off.
  useEffect(() => {
    if (!handle || !LAB_SITES_ENABLED) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(
          `/api/account/public/labs?handle=${encodeURIComponent(handle)}`,
        );
        const data = (await res.json().catch(() => ({ labs: [] }))) as {
          labs?: ResearcherLabEntry[];
        };
        if (!alive) return;
        setLabs(data.labs ?? []);
      } catch {
        // Fail silently: the profile renders without labs rather than erroring.
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
                <Link
                  href="/network"
                  className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-meta font-medium text-foreground-muted transition hover:border-brand-action hover:text-brand-action"
                >
                  Back to the researcher network
                </Link>
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

                {/* Labs section: publicly-listed labs this researcher belongs to.
                    Gated on LAB_SITES_ENABLED; renders nothing when the flag is
                    off or when the researcher has no listed memberships. */}
                {LAB_SITES_ENABLED && <LabsSection labs={labs} />}

                {/* Auto-pulled public works when an ORCID iD is linked. Reuses the
                    same OrcidPublications panel + /api/orcid/works proxy as the
                    directory profile card. */}
                {profile?.links?.orcid && (
                  <div className="mt-6">
                    <OrcidPublications
                      orcid={profile.links.orcid}
                      ownerName={profile.displayName}
                    />
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
          <Link href="/">
            <Wordmark size="sm" animated={false} className="gap-2" />
          </Link>
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
