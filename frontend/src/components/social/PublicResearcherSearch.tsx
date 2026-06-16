"use client";

// Public, login-free researcher search for the /network hub (social layer A2).
//
// Mirrors the in-app ResearcherSearch UX but reads the PUBLIC, harvest-safe
// directory endpoint (lib/social/public-search.ts -> Popup's
// /api/directory/public-search) instead of the session-gated /search. Results
// are listed-only and carry NO email. Each card links to the shareable profile
// at /researchers/<fingerprint>.
//
// Until Popup ships the endpoint a 404 surfaces as a calm "coming online" note,
// not an error, so the hub is publishable now and lights up when the route lands.
//
// Every glyph is the shared <Icon> (the icon-guard forbids new inline SVG).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useRef, useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { compactFingerprint } from "@/lib/sharing/profile";
import {
  DirectorySearchUnavailable,
  MIN_QUERY_LENGTH,
  searchResearchersPublic,
  type PublicResearcher,
} from "@/lib/social/public-search";

type Status =
  | "idle"
  | "searching"
  | "done"
  | "unavailable"
  | "error";

function ResultCard({ result }: { result: PublicResearcher }) {
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

  const compact = compactFingerprint(result.fingerprint);

  return (
    <div className="relative flex items-start gap-3 rounded-xl border border-border bg-surface-raised p-4 transition-colors hover:border-brand-action/40 hover:bg-brand-action/[0.04]">
      {/* Stretched link covers the card so a click anywhere (except the copy
          button) opens the shareable profile. */}
      <Link
        href={`/researchers/${compact}`}
        className="absolute inset-0 z-0 rounded-xl"
        aria-label={`View ${result.displayName}'s profile`}
      />

      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-action/10 text-brand-action">
        <Icon name="users" className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-semibold text-foreground">
            {result.displayName}
          </span>
          {result.verifiedDomain && (
            <Tooltip
              label={`Institutional login verified, this person signed in with a ${result.verifiedDomain} account`}
              placement="top"
            >
              <span className="relative z-10 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-meta font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                <Icon name="check" className="h-3 w-3" />
                {result.verifiedDomain}
              </span>
            </Tooltip>
          )}
        </div>

        {result.affiliation && (
          <p className="text-body text-foreground-muted">{result.affiliation}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
          {result.orcid && (
            <a
              href={`https://orcid.org/${result.orcid}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="relative z-10 inline-flex items-center gap-1 text-meta font-medium text-foreground-muted hover:text-brand-action"
            >
              <Icon name="reference" className="h-3.5 w-3.5" /> ORCID
            </a>
          )}
          <span className="truncate font-mono text-meta text-foreground-muted">
            {result.fingerprint}
          </span>
          <Tooltip label="Copy fingerprint" placement="top">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void copyFingerprint();
              }}
              className="relative z-10 shrink-0 text-foreground-muted hover:text-foreground"
              aria-label="Copy fingerprint"
            >
              {copied ? (
                <span className="text-meta text-emerald-600 dark:text-emerald-300">
                  Copied
                </span>
              ) : (
                <Icon name="copy" className="h-3.5 w-3.5" />
              )}
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

export default function PublicResearcherSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicResearcher[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setStatus("idle");
      return;
    }
    setStatus("searching");
    try {
      const found = await searchResearchersPublic(trimmed);
      setResults(found);
      setStatus("done");
    } catch (err) {
      setResults([]);
      setStatus(err instanceof DirectorySearchUnavailable ? "unavailable" : "error");
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
      <div className="relative">
        <Icon
          name="search"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
        />
        <input
          type="search"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Name or institution, e.g. Sarah or UW-Madison"
          className="w-full rounded-xl border border-border bg-surface-raised py-3 pl-10 pr-3 text-body text-foreground placeholder-foreground-muted focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/20"
        />
      </div>

      {status === "searching" && (
        <p className="text-meta text-foreground-muted">Searching&hellip;</p>
      )}

      {status === "error" && (
        <p className="text-meta text-red-600 dark:text-red-300">
          Could not reach the directory. Check your connection and try again.
        </p>
      )}

      {status === "unavailable" && (
        <p className="text-meta text-foreground-muted leading-relaxed">
          Public researcher search is coming online shortly. In the meantime you
          can still open a profile directly from a shared link.
        </p>
      )}

      {status === "done" && results.length === 0 && (
        <p className="text-body text-foreground-muted">
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

      {status === "idle" && (
        <p className="text-meta text-foreground-muted leading-relaxed">
          Search finds researchers who have opted in to the directory. Results
          show their name, institution, and key fingerprint, never an email
          address. Use the fingerprint to confirm you have the right person.
        </p>
      )}
    </div>
  );
}
