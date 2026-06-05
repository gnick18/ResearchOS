"use client";

// Publications panel on a researcher profile (section 18.1).
//
// When a profile has an ORCID iD, this auto-pulls the researcher's public works
// from the ORCID Public API (through our /api/orcid/works proxy, since ORCID is
// not CORS-open) and renders them. Read-only, no token storage. Renders nothing
// when there are no public works, so the card stays clean.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Inline SVG.

import { useEffect, useState } from "react";

import {
  type OrcidWork,
  fetchOrcidPublications,
} from "@/lib/sharing/profile";

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

const SHOWN = 8;

export default function OrcidPublications({ orcid }: { orcid: string }) {
  const [works, setWorks] = useState<OrcidWork[] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchOrcidPublications(orcid).then((w) => {
      if (!cancelled) setWorks(w);
    });
    return () => {
      cancelled = true;
    };
  }, [orcid]);

  // Loading.
  if (works === undefined) {
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-4">
        <p className="mb-1 text-meta font-semibold uppercase tracking-wide text-gray-400">
          Publications
        </p>
        <p className="text-meta text-gray-400">Loading from ORCID...</p>
      </div>
    );
  }

  // No public works, render nothing so the card stays clean.
  if (works.length === 0) return null;

  const shown = works.slice(0, SHOWN);
  const extra = works.length - shown.length;

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-4">
      <p className="mb-2 text-meta font-semibold uppercase tracking-wide text-gray-400">
        Publications
      </p>
      <ul className="space-y-2.5">
        {shown.map((w) => {
          const meta = [w.journal, w.year].filter(Boolean).join(" · ");
          return (
            <li key={w.putCode} className="leading-snug">
              {w.url ? (
                <a
                  href={w.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-body font-medium text-sky-700 hover:underline underline-offset-2"
                >
                  {w.title}
                </a>
              ) : (
                <span className="text-body font-medium text-gray-800">
                  {w.title}
                </span>
              )}
              {meta && <p className="text-meta text-gray-500">{meta}</p>}
            </li>
          );
        })}
      </ul>
      {extra > 0 && (
        <a
          href={`https://orcid.org/${orcid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-meta text-gray-400 hover:text-gray-600"
        >
          and {extra} more on ORCID
          <ExternalIcon className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
