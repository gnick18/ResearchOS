"use client";

// Standalone researcher profile view (rendered at /researchers/[fingerprint]).
//
// A shareable, public-facing profile presented as a focused, modal-style view:
// a rich profile card floating on a dimmed, soft-blurred backdrop that takes
// over the whole screen. Like /privacy and /open-source it renders WITHOUT the
// AppShell or a connected folder, so a profile URL can be pasted into an email
// and opened by anyone, and there are no app chrome buttons (the floating
// donation / calculator buttons live on AppShell, not here). The profile
// carries no email address, so a public view exposes no contact details.
//
// Publications (section 18) will be auto-pulled from the ORCID public API once
// the "Link ORCID" flow ships. For now, when an ORCID iD is present, we link
// out to the researcher's ORCID record rather than embedding works.
//
// The UW-Madison RISE footer (the AppFooter) is kept at the bottom on purpose.
//
// House style: warm, concept-first. No em-dashes, no emojis, no mid-sentence
// colons. Every icon is an inline SVG. Icon-only affordances use <Tooltip>.

import { useEffect, useState } from "react";

import Link from "next/link";
import Tooltip from "@/components/Tooltip";
import AppFooter from "@/components/AppFooter";
import {
  type PublishedProfile,
  expandFingerprint,
  fetchProfileByFingerprint,
} from "@/lib/sharing/profile";

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

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
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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

function CloseIcon({ className }: { className?: string }) {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function FingerprintIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 10a2 2 0 0 0-2 2c0 1.5.5 3 .5 3" />
      <path d="M8.5 8.5A5 5 0 0 1 17 12c0 1 0 2 .5 3.5" />
      <path d="M6.3 11a8 8 0 0 1 .5-3" />
      <path d="M7 16.5c-.5-1-.5-2.5-.5-3.5" />
      <path d="M14 13c0 2 .5 3.5 1 4.5" />
      <path d="M10 17c.3 1 .5 1.7 1 2.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ---------------------------------------------------------------------------
// Full-screen dimmed + blurred backdrop shell
// ---------------------------------------------------------------------------

function BackdropShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 overflow-y-auto">
      {/* Dimmed, soft-blurred backdrop. The colored blobs sit behind a blur +
          dark scrim so the whole field reads as a focused, dimmed surface. */}
      <div className="fixed inset-0 -z-10 bg-slate-900">
        <div className="absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-sky-500/25 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-[28rem] w-[28rem] rounded-full bg-indigo-500/25 blur-3xl" />
        <div className="absolute left-1/3 top-1/2 h-72 w-72 rounded-full bg-violet-500/15 blur-3xl" />
        <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-2xl" />
      </div>

      {/* Close affordance, top-right of the field (modal style). */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-center justify-between px-5 py-4">
        <Link
          href="/researchers"
          className="pointer-events-auto text-meta font-medium text-white/70 underline-offset-2 transition-colors hover:text-white hover:underline"
        >
          Researcher directory
        </Link>
        <Tooltip label="Back to the app" placement="bottom">
          <Link
            href="/"
            aria-label="Close profile"
            className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
          >
            <CloseIcon className="h-5 w-5" />
          </Link>
        </Tooltip>
      </div>

      {/* Centered content column */}
      <div className="relative z-10 flex min-h-full flex-col items-center px-4 pb-10 pt-16 sm:pt-20">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ResearcherProfile({
  compactFingerprint,
}: {
  compactFingerprint: string;
}) {
  const [profile, setProfile] = useState<PublishedProfile | null | undefined>(
    undefined,
  ); // undefined = loading
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchProfileByFingerprint(compactFingerprint).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [compactFingerprint]);

  // Loading
  if (profile === undefined) {
    return (
      <BackdropShell>
        <div className="flex flex-1 items-center justify-center py-24">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
        </div>
      </BackdropShell>
    );
  }

  // Not found
  if (profile === null) {
    return (
      <BackdropShell>
        <div className="mt-10 w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl ring-1 ring-black/5">
          <h1 className="text-heading font-semibold text-gray-900">
            Profile not found
          </h1>
          <p className="mt-2 text-body text-gray-600 leading-relaxed">
            No researcher has published a profile for that fingerprint. The link
            may be old, or they have not joined the directory.
          </p>
          <Link
            href="/researchers"
            className="mt-4 inline-block text-body font-medium text-sky-700 underline-offset-2 hover:underline"
          >
            Browse the researcher directory
          </Link>
        </div>
      </BackdropShell>
    );
  }

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
    <BackdropShell>
      {/* The floating profile card */}
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
        {/* Cover band */}
        <div className="relative h-28 bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500 sm:h-32">
          <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_20%_20%,white,transparent_45%),radial-gradient(circle_at_80%_60%,white,transparent_40%)]" />
        </div>

        {/* Identity header, avatar overlaps the cover */}
        <div className="px-6 pb-6 sm:px-8 sm:pb-8">
          <div className="-mt-12 mb-4 flex items-end gap-4 sm:-mt-14">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-3xl font-bold text-sky-600 ring-4 ring-white sm:h-28 sm:w-28">
              {initials(profile.displayName)}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-display font-bold tracking-tight text-gray-900">
              {profile.displayName}
            </h1>
            {profile.affiliationDomain && (
              <Tooltip
                label={`Institutional login verified at ${profile.affiliationDomain}`}
                placement="top"
              >
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-meta font-medium text-emerald-700">
                  <BadgeCheckIcon className="h-3.5 w-3.5" />
                  Verified
                </span>
              </Tooltip>
            )}
          </div>

          {profile.affiliation && (
            <p className="mt-1 text-title text-gray-700">{profile.affiliation}</p>
          )}
          {profile.affiliationDomain && (
            <p className="mt-0.5 text-meta text-gray-400">
              Verified via {profile.affiliationDomain}
            </p>
          )}

          {/* Detail rows */}
          <div className="mt-6 space-y-3">
            {/* Research / ORCID */}
            <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-4">
              <p className="mb-1 text-meta font-semibold uppercase tracking-wide text-gray-400">
                Research
              </p>
              {profile.orcid ? (
                <a
                  href={`https://orcid.org/${profile.orcid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-body text-sky-700 hover:underline underline-offset-2"
                >
                  <span className="font-mono">{profile.orcid}</span>
                  <span className="text-gray-400">View publications on ORCID</span>
                  <ExternalIcon className="h-3.5 w-3.5 text-gray-400" />
                </a>
              ) : (
                <p className="text-body text-gray-500">
                  This researcher has not linked an ORCID iD yet.
                </p>
              )}
            </div>

            {/* Fingerprint */}
            <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-4">
              <div className="mb-1 flex items-center gap-1.5 text-gray-400">
                <FingerprintIcon className="h-4 w-4" />
                <p className="text-meta font-semibold uppercase tracking-wide">
                  Identity fingerprint
                </p>
              </div>
              <p className="mb-2 text-meta text-gray-500 leading-relaxed">
                Confirm these characters with the person out of band before you
                send them research, so you know you are reaching the right
                identity.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-body tracking-wide text-gray-800">
                  {displayFingerprint}
                </span>
                <Tooltip label="Copy fingerprint" placement="top">
                  <button
                    type="button"
                    onClick={copyFingerprint}
                    className="inline-flex items-center gap-1 text-meta text-sky-600 hover:text-sky-700"
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

          {/* How to send */}
          <p className="mt-5 text-meta text-gray-400 leading-relaxed">
            To send research to this person, open any note, method, experiment,
            project, or sequence and use its Share button. Sharing is end to end
            encrypted, and this profile never exposes an email address.
          </p>
        </div>
      </div>

      {/* UW-Madison RISE footer, kept at the bottom on a tinted panel so it
          reads cleanly against the dimmed backdrop. */}
      <div className="mt-8 w-full max-w-2xl overflow-hidden rounded-2xl bg-white/95 shadow-xl ring-1 ring-black/5">
        <AppFooter />
      </div>
    </BackdropShell>
  );
}
