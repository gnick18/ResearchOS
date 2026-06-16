"use client";

// sequence editor master. The standalone "look up an organism" tool. Type an
// organism name or a tax id and see its scientific name, rank, and the major-rank
// lineage (expand for the full chain). Pure client over resolveTaxonomy, no
// sequence involved. Calm empty / loading / error states.
//
// PRIVACY. The only thing sent out is the public organism name or tax id the user
// typed, to NCBI's public taxonomy API. Nothing of the user's own data leaves.
//
// Inline SVG icons (no emoji), <Tooltip> for icon-only controls, LivingPopup
// shell, site typography tokens. No em-dash, no mid-sentence colon.

import { useCallback, useMemo, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";
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
      <path d="M12 20.5V7" />
      <path d="M10.5 20.5h3" />
      <circle cx="12" cy="4.8" r="1.7" />
      <path d="M12 11 7.6 8.4" />
      <circle cx="6.2" cy="7.6" r="1.7" />
      <path d="M12 11 16.4 8.4" />
      <circle cx="17.8" cy="7.6" r="1.7" />
      <path d="M12 15 8 12.9" />
      <circle cx="6.6" cy="12.1" r="1.7" />
      <path d="M12 15 16 12.9" />
      <circle cx="17.4" cy="12.1" r="1.7" />
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
  /** Optional cross-link: open the tree explorer centered on the looked-up
   *  organism. When omitted, the "Explore in tree" affordance is hidden. */
  onExploreInTree?: (taxId: string) => void;
}

export default function TaxonomyLookupDialog({
  open,
  onClose,
  onExploreInTree,
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
    <LivingPopup
      open
      onClose={handleClose}
      closeOnScrimClick={!busy}
      label="Look up an organism"
      selfSize
      showClose={false}
    >
      <div
        className="pointer-events-auto relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface-raised shadow-2xl"
        data-testid="taxonomy-lookup-dialog"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-500/15">
            <TreeIcon className="h-5 w-5 text-sky-600 dark:text-sky-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-foreground">
              Look up an organism
            </h2>
            <p className="text-meta text-foreground-muted">
              See an organism&apos;s taxonomy lineage from NCBI.
            </p>
          </div>
          <Tooltip label="Close">
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              aria-label="Close"
              className="rounded-md p-1.5 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground-muted disabled:opacity-40"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
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
              className="w-full rounded-md border border-border px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-surface-sunken disabled:text-foreground-muted"
            />
          </label>

          <p className="mt-3 text-meta leading-relaxed text-foreground-muted">
            Only the name or tax id you type is sent to NCBI, a public government
            database. Nothing of your own data leaves this app.
          </p>

          {error ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/15 px-3 py-2.5">
              <WarnIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              <p className="text-meta leading-relaxed text-rose-700 dark:text-rose-300">{error}</p>
            </div>
          ) : null}

          {busy ? (
            <div className="mt-4 flex items-center gap-2 text-meta text-foreground-muted">
              <SpinnerIcon className="h-4 w-4 text-sky-500" />
              <span>Looking up on NCBI...</span>
            </div>
          ) : null}

          {result && !busy ? (
            <div className="mt-4 rounded-xl border border-border bg-surface-sunken/60 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="truncate text-body font-semibold text-foreground">
                  {result.name}
                </h3>
                <span className="shrink-0 rounded-full bg-sky-100 dark:bg-sky-500/15 px-2 py-0.5 text-meta font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
                  {rankLabel(result.rank) || "Taxon"}
                </span>
              </div>
              <p className="mt-0.5 text-meta text-foreground-muted">
                taxon {result.taxId}
              </p>

              {major.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-1 text-meta text-foreground-muted">
                  {major.map((node, i) => (
                    <span
                      key={node.taxId}
                      className="inline-flex items-center gap-1"
                    >
                      {i > 0 ? (
                        <span className="text-foreground-muted" aria-hidden="true">
                          ›
                        </span>
                      ) : null}
                      <span>{node.name}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-meta text-foreground-muted">
                  No major-rank lineage is available for this organism.
                </p>
              )}

              {result.lineage.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    aria-expanded={expanded}
                    className="mt-3 text-meta font-medium text-sky-600 dark:text-sky-300 transition-colors hover:text-sky-700"
                  >
                    {expanded ? "Hide full lineage" : "Show full lineage"}
                  </button>
                  {expanded ? (
                    <ol className="mt-2 space-y-0.5 border-l border-border pl-3">
                      {result.lineage.map((node) => (
                        <li
                          key={node.taxId}
                          className="flex items-baseline gap-2 text-meta"
                        >
                          <span className="w-24 shrink-0 text-foreground-muted">
                            {rankLabel(node.rank) || "rank"}
                          </span>
                          <span className="text-foreground">{node.name}</span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </>
              ) : null}

              {onExploreInTree ? (
                <div className="mt-3 border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => onExploreInTree(result.taxId)}
                    className="inline-flex items-center gap-1.5 text-meta font-medium text-sky-600 dark:text-sky-300 transition-colors hover:text-sky-700"
                  >
                    <TreeIcon className="h-3.5 w-3.5" />
                    Explore in tree
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {!result && !busy && !error ? (
            <p className="mt-6 text-center text-meta leading-relaxed text-foreground-muted">
              Type an organism name or a tax id, then look it up to see its
              taxonomy.
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
          <button
            type="button"
            onClick={handleClose}
            className="ros-btn-neutral px-3 py-1.5 text-meta font-medium text-foreground"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleLookup}
            disabled={query.trim() === "" || busy}
            className="ros-btn-raise flex items-center gap-1.5 rounded-md bg-brand-action px-3.5 py-1.5 text-meta font-medium text-white transition-colors hover:bg-brand-action/90 disabled:cursor-not-allowed disabled:opacity-50"
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
    </LivingPopup>
  );
}
