"use client";

// Standalone researcher profile page body (rendered at /researchers/[fingerprint]).
//
// A shareable, public-facing profile: name, affiliation with a verified-domain
// badge, ORCID, and the key fingerprint. Like /privacy and /open-source it
// renders WITHOUT the AppShell or a connected folder, so a profile URL can be
// pasted into an email and opened by anyone. The profile carries no email
// address, so a public view exposes no contact details.
//
// Publications (section 18) will be auto-pulled from the ORCID public API once
// the "Link ORCID" flow ships. For now, when an ORCID iD is present, we link
// out to the researcher's ORCID record rather than embedding works.
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
// Page chrome (matches /privacy and /open-source)
// ---------------------------------------------------------------------------

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link
            href="/researchers"
            className="text-body font-medium text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline"
          >
            Researcher directory
          </Link>
          <Link
            href="/"
            className="text-body font-medium text-sky-700 underline-offset-2 hover:text-sky-900 hover:underline"
          >
            Back to the app
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        {children}
      </main>
      <AppFooter />
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
      <PageShell>
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-sky-600" />
        </div>
      </PageShell>
    );
  }

  // Not found
  if (profile === null) {
    return (
      <PageShell>
        <div className="space-y-3 py-10 text-center">
          <h1 className="text-heading font-semibold text-gray-900">
            Profile not found
          </h1>
          <p className="text-body text-gray-600">
            No researcher has published a profile for that fingerprint. The link
            may be old, or they have not joined the directory.
          </p>
          <Link
            href="/researchers"
            className="inline-block text-body font-medium text-sky-700 underline-offset-2 hover:underline"
          >
            Browse the researcher directory
          </Link>
        </div>
      </PageShell>
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
    <PageShell>
      {/* Header card */}
      <section className="rounded-2xl border border-gray-200 bg-white p-8">
        <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left sm:gap-6">
          <div className="mb-4 flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-sky-50 text-2xl font-bold text-sky-600 sm:mb-0">
            {initials(profile.displayName)}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
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
              <p className="text-title text-gray-600">{profile.affiliation}</p>
            )}

            {profile.affiliationDomain && (
              <p className="text-meta text-gray-400">
                Verified via {profile.affiliationDomain}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Details */}
      <section className="mt-6 space-y-6">
        {/* ORCID / publications */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-3 text-title font-semibold text-gray-900">
            Research
          </h2>
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
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-1 text-title font-semibold text-gray-900">
            Identity fingerprint
          </h2>
          <p className="mb-3 text-meta text-gray-500 leading-relaxed">
            Confirm these characters with the person out of band before you send
            them research, so you know you are reaching the right identity.
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

        {/* How to send */}
        <p className="text-meta text-gray-400 leading-relaxed">
          To send research to this person, open any note, method, experiment,
          project, or sequence and use its Share button. Sharing is end to end
          encrypted, and this profile never exposes an email address.
        </p>
      </section>
    </PageShell>
  );
}
