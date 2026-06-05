"use client";

// sequence editor master. The standalone "look up an organism" tool. Type an
// organism name or a tax id and see its scientific name, rank, and the major-rank
// lineage (expand for the full chain). Pure client over resolveTaxonomy, no
// sequence involved. Calm empty / loading / error states.
//
// PRIVACY. The only thing sent out is the public organism name or tax id the user
// typed, to NCBI's public taxonomy API. Nothing of the user's own data leaves.
//
// Inline SVG icons (no emoji), <Tooltip> for icon-only controls, useEscapeToClose,
// site typography tokens. No em-dash, no mid-sentence colon.

import { useCallback, useMemo, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import {
  resolveTaxonomy,
  majorRanks,
  NcbiDatasetsError,
  type TaxonomyResult,
} from "@/lib/sequences/ncbi-datasets";

function svgBase(className?: string) {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };
}

function TreeIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M8.5 6.8 15.5 11M8.5 17.2 15.5 13" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)} className={`animate-spin ${className ?? ""}`}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function WarnIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function rankLabel(rank: string): string {
  if (!rank) return "";
  return rank.charAt(0).toUpperCase() + rank.slice(1);
}

export interface TaxonomyLookupDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function TaxonomyLookupDialog({
  open,
  onClose,
}: TaxonomyLookupDialogProps) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TaxonomyResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setQuery("");
    setBusy(false);
    setError(null);
    setResult(null);
    setExpanded(false);
    onClose();
  }, [onClose]);

  useEscapeToClose(handleClose, open);

  const handleLookup = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setError(null);
    setResult(null);
    setExpanded(false);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const tax = await resolveTaxonomy(q, { signal: controller.signal });
      setResult(tax);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setError(
        e instanceof NcbiDatasetsError
          ? e.message
          : "Could not look that up on NCBI. Check your entry and try again.",
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [query]);

  const major = useMemo(
    () => (result ? majorRanks(result.lineage) : []),
    [result],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="taxonomy-lookup-dialog"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={busy ? undefined : handleClose}
      />
      <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100">
            <TreeIcon className="h-5 w-5 text-sky-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-gray-900">
              Look up an organism
            </h2>
            <p className="text-meta text-gray-500">
              See an organism&apos;s taxonomy lineage from NCBI.
            </p>
          </div>
          <Tooltip label="Close">
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              aria-label="Close"
              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-meta font-medium uppercase tracking-wide text-gray-400">
              Organism or tax id
            </span>
            <input
              type="text"
              value={query}
              autoFocus
              placeholder="e.g. Escherichia coli (or a tax id like 9606)"
              disabled={busy}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleLookup();
                }
              }}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-body text-gray-900 placeholder:text-gray-300 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </label>

          <p className="mt-3 text-meta leading-relaxed text-gray-400">
            Only the name or tax id you type is sent to NCBI, a public government
            database. Nothing of your own data leaves this app.
          </p>

          {error ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
              <WarnIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              <p className="text-meta leading-relaxed text-rose-700">{error}</p>
            </div>
          ) : null}

          {busy ? (
            <div className="mt-4 flex items-center gap-2 text-meta text-gray-500">
              <SpinnerIcon className="h-4 w-4 text-sky-500" />
              <span>Looking up on NCBI...</span>
            </div>
          ) : null}

          {result && !busy ? (
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="truncate text-body font-semibold text-gray-900">
                  {result.name}
                </h3>
                <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-meta font-medium uppercase tracking-wide text-sky-700">
                  {rankLabel(result.rank) || "Taxon"}
                </span>
              </div>
              <p className="mt-0.5 text-meta text-gray-400">
                taxon {result.taxId}
              </p>

              {major.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-1 text-meta text-gray-600">
                  {major.map((node, i) => (
                    <span
                      key={node.taxId}
                      className="inline-flex items-center gap-1"
                    >
                      {i > 0 ? (
                        <span className="text-gray-300" aria-hidden="true">
                          ›
                        </span>
                      ) : null}
                      <span>{node.name}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-meta text-gray-400">
                  No major-rank lineage is available for this organism.
                </p>
              )}

              {result.lineage.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    aria-expanded={expanded}
                    className="mt-3 text-meta font-medium text-sky-600 transition-colors hover:text-sky-700"
                  >
                    {expanded ? "Hide full lineage" : "Show full lineage"}
                  </button>
                  {expanded ? (
                    <ol className="mt-2 space-y-0.5 border-l border-gray-200 pl-3">
                      {result.lineage.map((node) => (
                        <li
                          key={node.taxId}
                          className="flex items-baseline gap-2 text-meta"
                        >
                          <span className="w-24 shrink-0 text-gray-400">
                            {rankLabel(node.rank) || "rank"}
                          </span>
                          <span className="text-gray-700">{node.name}</span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          {!result && !busy && !error ? (
            <p className="mt-6 text-center text-meta leading-relaxed text-gray-400">
              Type an organism name or a tax id, then look it up to see its
              taxonomy.
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3.5">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-meta font-medium text-gray-700 transition-colors hover:bg-gray-100"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleLookup}
            disabled={query.trim() === "" || busy}
            className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-1.5 text-meta font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <>
                <SpinnerIcon className="h-4 w-4" />
                Looking up...
              </>
            ) : (
              "Look up"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
