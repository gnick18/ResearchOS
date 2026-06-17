"use client";

// The researcher profile card body. Shared by the in-app popup
// (ResearcherProfileModal) and the standalone /researchers/[fingerprint] page,
// so both render an identical card: a gradient cover band, a large avatar
// overlapping it, the name with a verified-institution badge, an ORCID /
// research panel, and the copyable identity fingerprint.
//
// Pure presentation, no data fetching. The caller passes a loaded profile.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Inline SVG
// icons. Icon-only affordances use <Tooltip>.

import { useState } from "react";

import Tooltip from "@/components/Tooltip";
import { type PublishedProfile, expandFingerprint } from "@/lib/sharing/profile";
import OrcidPublications from "./OrcidPublications";

function BadgeCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ProfileCard({
  profile,
}: {
  profile: PublishedProfile;
}) {
  const [copied, setCopied] = useState(false);
  const displayFingerprint = expandFingerprint(profile.fingerprint);

  const copyFingerprint = async () => {
    try {
      await navigator.clipboard.writeText(displayFingerprint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-surface-overlay border border-border ros-popup-card-shadow ring-1 ring-black/5">
      {/* Cover band */}
      <div className="relative h-24 bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500 sm:h-28">
        <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_20%_20%,white,transparent_45%),radial-gradient(circle_at_80%_60%,white,transparent_40%)]" />
      </div>

      <div className="px-6 pb-6 sm:px-8 sm:pb-7">
        {/* Avatar overlapping the cover */}
        <div className="-mt-12 mb-3 flex sm:-mt-14">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-sky-50 dark:bg-sky-500/15 text-3xl font-bold text-sky-600 dark:text-sky-300 ring-4 ring-white sm:h-28 sm:w-28">
            {initials(profile.displayName)}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-display font-bold tracking-tight text-foreground">
            {profile.displayName}
          </h1>
          {profile.affiliationDomain && (
            <Tooltip
              label={`Institutional login verified at ${profile.affiliationDomain}`}
              placement="top"
            >
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/15 px-2.5 py-1 text-meta font-medium text-emerald-700 dark:text-emerald-300">
                <BadgeCheckIcon className="h-3.5 w-3.5" />
                Verified
              </span>
            </Tooltip>
          )}
        </div>

        {profile.affiliation && (
          <p className="mt-1 text-title text-foreground">{profile.affiliation}</p>
        )}
        {profile.affiliationDomain && (
          <p className="mt-0.5 text-meta text-foreground-muted">
            Verified via {profile.affiliationDomain}
          </p>
        )}

        <div className="mt-5 space-y-3">
          {/* Research / ORCID */}
          <div className="rounded-xl border border-border bg-surface-sunken/70 p-4">
            <p className="mb-1 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
              Research
            </p>
            {profile.orcid ? (
              <a
                href={`https://orcid.org/${profile.orcid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-body text-sky-700 dark:text-sky-300 hover:underline underline-offset-2"
              >
                <span className="font-mono">{profile.orcid}</span>
                <span className="text-foreground-muted">View publications on ORCID</span>
                <ExternalIcon className="h-3.5 w-3.5 text-foreground-muted" />
              </a>
            ) : (
              <p className="text-body text-foreground-muted">
                This researcher has not linked an ORCID iD yet.
              </p>
            )}
          </div>

          {/* Auto-pulled public works when an ORCID iD is linked (section 18.1). */}
          {profile.orcid && (
            <OrcidPublications
              orcid={profile.orcid}
              ownerName={profile.displayName}
              hiddenWorks={profile.hiddenWorks}
              pinnedWorks={profile.pinnedWorks}
            />
          )}

          {/* Fingerprint */}
          <div className="rounded-xl border border-border bg-surface-sunken/70 p-4">
            <p className="mb-1 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
              Identity fingerprint
            </p>
            <p className="mb-2 text-meta text-foreground-muted leading-relaxed">
              Confirm these characters with the person out of band before you
              send them research, so you know you are reaching the right
              identity.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-body tracking-wide text-foreground">
                {displayFingerprint}
              </span>
              <Tooltip label="Copy fingerprint" placement="top">
                <button
                  type="button"
                  onClick={copyFingerprint}
                  className="inline-flex items-center gap-1 text-meta text-sky-600 dark:text-sky-300 hover:text-sky-700"
                >
                  {copied ? (
                    "Copied"
                  ) : (
                    <>
                      <CopyIcon className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </Tooltip>
            </div>
          </div>
        </div>

        <p className="mt-5 text-meta text-foreground-muted leading-relaxed">
          To send research to this person, open any note, method, experiment,
          project, or sequence and use its Share button. A one-time send is
          encrypted end to end, so only the recipient can open it. Live real-time
          collaboration is different, it keeps a synced copy on our servers so
          edits sync instantly. This profile never exposes an email address.
        </p>
      </div>
    </div>
  );
}
