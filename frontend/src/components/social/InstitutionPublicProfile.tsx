"use client";

// Public /institution/[slug] profile (social layer, Phase B foundation / B1).
//
// The public, login-free institution page (distinct from the sign-in-gated
// /institution admin portal): institution name, branding, departments, and the
// LinkedIn-style listed-member directory. Built on the same marketing chrome as
// /network and /library.
//
// FOUNDATION STATE: the member directory + canonical institution data come from
// Popup's not-yet-built /api/directory/institution (B2). Until it ships, the page
// resolves a best-effort name from the slug and shows a calm "coming online"
// placeholder for the directory. It lights up with zero change here when the
// endpoint lands. Gated behind NEXT_PUBLIC_SOCIAL_LAYER (the route 404s when off).
//
// Every glyph is the shared <Icon> (the icon-guard forbids new inline SVG).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import Link from "next/link";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import Reveal from "@/components/marketing/Reveal";
import Kicker from "@/components/marketing/Kicker";
import { Icon } from "@/components/icons";
import { compactFingerprint } from "@/lib/sharing/profile";
import {
  DirectoryUnavailable,
  fetchPublicInstitution,
  humanizeInstitutionSlug,
  type PublicInstitution,
} from "@/lib/social/institution";
import { type PublicResearcher } from "@/lib/social/public-search";

type Status = "loading" | "found" | "missing" | "unavailable" | "error";

function MemberCard({ member }: { member: PublicResearcher }) {
  return (
    <Link
      href={`/researchers/${compactFingerprint(member.fingerprint)}`}
      className="flex items-start gap-3 rounded-xl border border-border bg-surface-raised p-4 transition-colors hover:border-brand-action/40 hover:bg-brand-action/[0.04]"
    >
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-action/10 text-brand-action">
        <Icon name="users" className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-semibold text-foreground">
            {member.displayName}
          </span>
          {member.verifiedDomain && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-meta font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Icon name="check" className="h-3 w-3" />
              {member.verifiedDomain}
            </span>
          )}
        </div>
        {member.affiliation && (
          <p className="mt-0.5 text-meta text-foreground-muted">{member.affiliation}</p>
        )}
      </div>
    </Link>
  );
}

export default function InstitutionPublicProfile({ slug }: { slug: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [inst, setInst] = useState<PublicInstitution | null>(null);

  useEffect(() => {
    if (!slug) {
      setStatus("missing");
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const found = await fetchPublicInstitution(slug);
        if (!alive) return;
        if (found) {
          setInst(found);
          setStatus("found");
        } else {
          setStatus("missing");
        }
      } catch (err) {
        if (!alive) return;
        setStatus(err instanceof DirectoryUnavailable ? "unavailable" : "error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  // Name to show: the resolved canonical name when found, else a best-effort
  // humanized slug (clearly a fallback while the directory comes online).
  const displayName = inst?.name ?? humanizeInstitutionSlug(slug);

  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <MarketingNav />

      <section className="relative overflow-hidden">
        <MarketingBackdrop tone="vivid" />
        <div className="relative z-10 mx-auto max-w-4xl px-6 pb-8 pt-14 sm:pt-20">
          {status === "missing" ? (
            <div className="mx-auto max-w-lg rounded-2xl border border-border bg-surface p-8 text-center shadow-lg">
              <h1 className="text-title font-bold text-foreground">Institution not found</h1>
              <p className="mt-2 text-meta text-foreground-muted">
                No institution page exists for that address yet.
              </p>
              <Link
                href="/network"
                className="mt-4 inline-block text-meta font-medium text-brand-action underline-offset-2 hover:underline"
              >
                Go to the researcher network
              </Link>
            </div>
          ) : (
            <>
              <Reveal className="flex justify-center">
                <Kicker>Institution</Kicker>
              </Reveal>
              <Reveal as="div" delay={60}>
                <div className="mt-4 flex flex-col items-center text-center">
                  {inst?.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={inst.logoUrl}
                      alt={`${displayName} logo`}
                      className="mb-4 h-16 w-16 rounded-xl object-contain"
                    />
                  ) : (
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-brand-action/10 text-brand-action">
                      <Icon name="labTree" className="h-8 w-8" />
                    </div>
                  )}
                  <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
                    {displayName}
                  </h1>
                  {inst?.domain && (
                    <p className="mt-2 text-body text-foreground-muted">{inst.domain}</p>
                  )}
                  {typeof inst?.memberCount === "number" && inst.memberCount > 0 && (
                    <p className="mt-1 text-meta text-foreground-muted">
                      {inst.memberCount} listed{" "}
                      {inst.memberCount === 1 ? "researcher" : "researchers"}
                    </p>
                  )}
                </div>
              </Reveal>

              {inst && inst.departments.length > 0 && (
                <Reveal as="div" delay={120}>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    {inst.departments.map((d) => (
                      <span
                        key={d}
                        className="rounded-full border border-border px-3 py-1 text-meta text-foreground-muted"
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                </Reveal>
              )}
            </>
          )}
        </div>
      </section>

      {/* Member directory */}
      {status !== "missing" && (
        <section className="relative">
          <div className="mx-auto max-w-4xl px-6 pb-16">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              Researchers at {displayName}
            </h2>

            {status === "loading" && (
              <p className="text-meta text-foreground-muted">Loading&hellip;</p>
            )}

            {status === "error" && (
              <p className="text-meta text-red-600 dark:text-red-300">
                Could not reach the directory. Check your connection and try again.
              </p>
            )}

            {status === "unavailable" && (
              <div className="rounded-2xl border border-dashed border-border bg-surface-raised p-8 text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-action/10 text-brand-action">
                  <Icon name="users" className="h-5 w-5" />
                </div>
                <p className="text-body font-medium text-foreground">
                  The member directory is coming online
                </p>
                <p className="mx-auto mt-1 max-w-md text-meta leading-relaxed text-foreground-muted">
                  Listed researchers at this institution will appear here, opt-in
                  only, with their name, affiliation, and verified domain, never an
                  email address.
                </p>
              </div>
            )}

            {status === "found" && inst && inst.members.length === 0 && (
              <p className="text-body text-foreground-muted">
                No researchers here have listed themselves in the directory yet.
              </p>
            )}

            {status === "found" && inst && inst.members.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {inst.members.map((m) => (
                  <MemberCard key={m.fingerprint} member={m} />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <MarketingFooter />
    </div>
  );
}
