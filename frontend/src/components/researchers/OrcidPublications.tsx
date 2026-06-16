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
import { orderWorks, markOwnerInContributors } from "@/lib/orcid/works";

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

/**
 * Renders a work's author list with the profile owner's name bold + brand
 * colored. Long lists collapse to the first AUTHORS_SHOWN names plus a
 * "+N more", but the owner is always kept visible so the highlight never hides.
 */
function AuthorList({
  contributors,
  ownerOrcid,
  ownerName,
}: {
  contributors: OrcidWork["contributors"];
  ownerOrcid: string;
  ownerName?: string | null;
}) {
  if (!contributors || contributors.length === 0) return null;

  const marked = markOwnerInContributors(contributors, ownerOrcid, ownerName);

  let shown = marked.slice(0, AUTHORS_SHOWN);
  // If the owner is past the cap, surface it so the highlight is never hidden.
  if (!shown.some((c) => c.isOwner)) {
    const owner = marked.find((c) => c.isOwner);
    if (owner) shown = [...marked.slice(0, AUTHORS_SHOWN - 1), owner];
  }
  const extra = marked.length - shown.length;

  return (
    <p className="text-meta text-gray-500">
      {shown.map((c, i) => (
        <span key={`${c.name}-${i}`}>
          {i > 0 && ", "}
          {c.isOwner ? (
            <span className="font-semibold text-sky-700">{c.name}</span>
          ) : (
            c.name
          )}
        </span>
      ))}
      {extra > 0 && <span>{`, and ${extra} more`}</span>}
    </p>
  );
}

const SHOWN = 8;

// How many authors to print before collapsing the rest into "+N more". The
// owner is always kept visible even when it would fall past this cap.
const AUTHORS_SHOWN = 6;

export default function OrcidPublications({
  orcid,
  ownerName,
  pinnedWorks = [],
  hiddenWorks = [],
}: {
  orcid: string;
  ownerName?: string | null;
  pinnedWorks?: string[];
  hiddenWorks?: string[];
}) {
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

  // Apply pin/hide ordering before slicing.
  const ordered = orderWorks(works, pinnedWorks, hiddenWorks);

  // No visible works after applying filters, render nothing.
  if (ordered.length === 0) return null;

  const shown = ordered.slice(0, SHOWN);
  const extra = ordered.length - shown.length;

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
                  className="inline-flex items-start gap-1 text-body font-medium text-sky-700 hover:underline underline-offset-2"
                >
                  <span>{w.title}</span>
                  <ExternalIcon className="mt-1 h-3 w-3 shrink-0 text-sky-400" />
                </a>
              ) : (
                <span className="text-body font-medium text-gray-800">
                  {w.title}
                </span>
              )}
              <AuthorList
                contributors={w.contributors}
                ownerOrcid={orcid}
                ownerName={ownerName}
              />
              {meta && <p className="text-meta text-gray-500">{meta}</p>}
              {w.doi && (
                <a
                  href={`https://doi.org/${w.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-meta text-gray-400 hover:text-sky-600 hover:underline underline-offset-2"
                >
                  doi.org/{w.doi}
                </a>
              )}
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
