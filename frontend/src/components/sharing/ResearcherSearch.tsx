"use client";

// Researcher directory search panel (section 17 of the cross-boundary sharing
// proposal). Lets a user with a verified sharing identity search for other
// researchers by name or institution. Results show name, affiliation, a
// verified-domain badge, and the key fingerprint for out-of-band confirmation.
//
// This is a DISCOVERY surface, not a send surface. Search tells you who is on
// ResearchOS and lets you confirm their fingerprint. Sending to a found
// researcher still requires their email in the usual send flow (the search
// result never exposes an email address). Wiring search results directly into
// the send flow (by passing pre-resolved key material) is a follow-up once the
// backend routes are live and verified.
//
// Search requires an active OAuth session (the server 401s otherwise), so this
// component is only rendered when the sharing identity status is "ready".
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Every icon is
// an inline SVG. Icon-only affordances use <Tooltip>, never native title=.

import { useCallback, useRef, useState } from "react";

import Tooltip from "@/components/Tooltip";
import { type ProfileSearchResult, searchResearchers } from "@/lib/sharing/profile";

// ---------------------------------------------------------------------------
// Icons (inline SVG, house style)
// ---------------------------------------------------------------------------

function SearchIcon({ className }: { className?: string }) {
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
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

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

// ---------------------------------------------------------------------------
// Result card
// ---------------------------------------------------------------------------

function ResultCard({ result }: { result: ProfileSearchResult }) {
  const [copied, setCopied] = useState(false);
  const copyFingerprint = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(result.fingerprint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, [result.fingerprint]);

  return (
    <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4">
      {/* Avatar placeholder */}
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-500">
        <UserIcon className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        {/* Name + verified badge */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-semibold text-gray-900">
            {result.displayName}
          </span>
          {result.affiliationDomain && (
            <Tooltip
              label={`Institutional login verified — this person signed in with a ${result.affiliationDomain} account`}
              placement="top"
            >
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-meta font-medium text-emerald-700">
                <BadgeCheckIcon className="h-3 w-3" />
                {result.affiliationDomain}
              </span>
            </Tooltip>
          )}
        </div>

        {/* Affiliation */}
        {result.affiliation && (
          <p className="text-body text-gray-600">{result.affiliation}</p>
        )}

        {/* Fingerprint */}
        <div className="flex items-center gap-2 pt-0.5">
          <span className="truncate font-mono text-meta text-gray-400">
            {result.fingerprint}
          </span>
          <Tooltip label="Copy fingerprint" placement="top">
            <button
              type="button"
              onClick={copyFingerprint}
              className="shrink-0 text-gray-400 hover:text-gray-600"
              aria-label="Copy fingerprint"
            >
              {copied ? (
                <span className="text-meta text-emerald-600">Copied</span>
              ) : (
                <CopyIcon className="h-3.5 w-3.5" />
              )}
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ResearcherSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const found = await searchResearchers(trimmed);
      setResults(found);
      setSearched(true);
    } catch {
      setError("Could not reach the directory. Check your connection.");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setQuery(v);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void runSearch(v), 350);
    },
    [runSearch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        void runSearch(query);
      }
    },
    [query, runSearch],
  );

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Name or institution, e.g. Sarah or UW-Madison"
          className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-body text-gray-900 placeholder-gray-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
        />
      </div>

      {/* Status */}
      {searching && (
        <p className="text-meta text-gray-500">Searching…</p>
      )}

      {error && (
        <p className="text-meta text-red-600">{error}</p>
      )}

      {/* Results */}
      {!searching && searched && results.length === 0 && (
        <p className="text-body text-gray-500">
          No researchers found for that name or institution.
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r) => (
            <ResultCard key={r.fingerprint} result={r} />
          ))}
        </div>
      )}

      {/* Discovery note */}
      {!searching && !searched && (
        <p className="text-meta text-gray-400 leading-relaxed">
          Search finds researchers who have opted in to the directory. Results
          show their name, institution, and key fingerprint, never an email
          address. Use the fingerprint to confirm you are sending to the right
          person.
        </p>
      )}
    </div>
  );
}
