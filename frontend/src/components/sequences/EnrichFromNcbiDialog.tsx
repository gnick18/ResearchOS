"use client";

// sequence editor master. The opt-in "Enrich from NCBI" dialog for a sequence.
//
// It resolves the organism for this sequence in order, from the sequence's own parsed
// GenBank ACCESSION, else its ncbi_accession provenance, else a user-typed
// organism name or accession. It PREVIEWS the organism, tax id, and named
// major-rank lineage, then lets the user APPLY. On apply it hands the resolved
// fields and the rewritten GenBank (organism written into the source feature's
// /organism + /db_xref qualifiers) back to the caller, which persists the sidecar
// and the .gb. Preview before any write, never automatic. Mirrors the
// Detect-Features accept pattern.
//
// PRIVACY. Only the public accession or organism the user resolves is sent to
// NCBI's public API. Nothing of the user's own data leaves.
//
// Inline SVG icons (no emoji), <Tooltip> for icon-only controls, LivingPopup
// shell, site typography tokens. No em-dash, no mid-sentence colon.

import { useCallback, useMemo, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";
import {
  resolveTaxonomy,
  previewByAccession,
  majorRanks,
  setSourceOrganismInGenbank,
  sniffAccessionKind,
  NcbiDatasetsError,
  type TaxonomyResult,
} from "@/lib/sequences/ncbi-datasets";
import type { SequenceTaxonNode } from "@/lib/types";

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

/** What the apply hands back to the caller (the editor persists it). */
export interface EnrichResult {
  organism: string;
  taxId?: string;
  lineage: SequenceTaxonNode[];
  /** The sequence's GenBank rewritten with the organism in the source feature. */
  genbank: string;
}

export interface EnrichFromNcbiDialogProps {
  open: boolean;
  onClose: () => void;
  /** The sequence's current GenBank text (the apply rewrites the source feature). */
  genbank: string;
  /** The sequence's own parsed accession (from the GenBank ACCESSION line), if any. */
  parsedAccession?: string | null;
  /** The sequence's ncbi_accession provenance, if it was NCBI-imported. */
  provenanceAccession?: string | null;
  /** Persist the enrichment (sidecar + rewritten .gb). Resolves when written. */
  onApply: (result: EnrichResult) => void | Promise<void>;
}

type Phase = "idle" | "resolving" | "preview" | "applying";

export default function EnrichFromNcbiDialog({
  open,
  onClose,
  genbank,
  parsedAccession,
  provenanceAccession,
  onApply,
}: EnrichFromNcbiDialogProps) {
  // The best identifier we already have for this sequence (parsed accession wins,
  // then provenance). Empty when the sequence carries neither.
  const knownId = useMemo(
    () => (parsedAccession || provenanceAccession || "").trim(),
    [parsedAccession, provenanceAccession],
  );

  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TaxonomyResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const busy = phase === "resolving" || phase === "applying";

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setTyped("");
    setPhase("idle");
    setError(null);
    setResult(null);
    setExpanded(false);
    onClose();
  }, [onClose]);

  // Resolve a tax id / organism for a given query. An accession resolves through
  // the dataset report (which carries the organism + tax id), then we look up the
  // named lineage by tax id; an organism name resolves the taxonomy directly.
  const resolveFor = useCallback(
    async (query: string, signal: AbortSignal): Promise<TaxonomyResult> => {
      const q = query.trim();
      const looksLikeAccession = sniffAccessionKind(q) != null;
      if (looksLikeAccession) {
        const preview = await previewByAccession(q, signal);
        if (!preview.taxId) {
          // Fall back to resolving the organism name the report carried.
          return resolveTaxonomy(preview.organism, { signal });
        }
        const tax = await resolveTaxonomy(preview.taxId, { signal });
        // Prefer the report's organism label when present.
        return preview.organism ? { ...tax, name: preview.organism } : tax;
      }
      return resolveTaxonomy(q, { signal });
    },
    [],
  );

  const handleResolve = useCallback(
    async (query: string) => {
      const q = query.trim();
      if (!q) return;
      setError(null);
      setResult(null);
      setExpanded(false);
      setPhase("resolving");
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const tax = await resolveFor(q, controller.signal);
        setResult(tax);
        setPhase("preview");
      } catch (e) {
        if ((e as Error)?.name === "AbortError") {
          setPhase("idle");
          return;
        }
        setError(
          e instanceof NcbiDatasetsError
            ? e.message
            : "Could not look that up on NCBI. Check your entry and try again.",
        );
        setPhase("idle");
      } finally {
        abortRef.current = null;
      }
    },
    [resolveFor],
  );

  const handleApply = useCallback(async () => {
    if (!result) return;
    setPhase("applying");
    try {
      const lineage: SequenceTaxonNode[] = result.lineage.map((n) => ({
        taxId: n.taxId,
        name: n.name,
        rank: n.rank,
      }));
      const rewritten = setSourceOrganismInGenbank(
        genbank,
        result.name,
        result.taxId,
      );
      await onApply({
        organism: result.name,
        taxId: result.taxId,
        lineage,
        genbank: rewritten,
      });
      handleClose();
    } catch {
      setError("Could not save the enrichment. Try again.");
      setPhase("preview");
    }
  }, [result, genbank, onApply, handleClose]);

  const cancelInFlight = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const major = useMemo(
    () => (result ? majorRanks(result.lineage) : []),
    [result],
  );

  if (!open) return null;

  return (
    <LivingPopup
      open
      onClose={() => {
        if (!busy) handleClose();
      }}
      closeOnScrimClick={!busy}
      label="Enrich from NCBI"
      selfSize
      showClose={false}
    >
      <div
        className="pointer-events-auto relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface-raised shadow-2xl"
        data-testid="enrich-from-ncbi-dialog"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-500/15">
            <TreeIcon className="h-5 w-5 text-sky-600 dark:text-sky-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-foreground">
              Enrich from NCBI
            </h2>
            <p className="text-meta text-foreground-muted">
              Attach this sequence&apos;s organism and taxonomy from NCBI.
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
          {knownId ? (
            <div className="rounded-lg border border-border bg-surface-sunken/60 px-3 py-2.5">
              <p className="text-meta text-foreground-muted">
                This sequence has an accession on NCBI.
              </p>
              <p className="mt-0.5 text-body font-medium text-foreground">
                {knownId}
              </p>
            </div>
          ) : (
            <label className="block">
              <span className="mb-1 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Organism or accession
              </span>
              <input
                type="text"
                value={typed}
                autoFocus
                placeholder="e.g. Homo sapiens, 9606, or NM_007294"
                disabled={busy}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleResolve(typed);
                  }
                }}
                className="w-full rounded-md border border-border px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-surface-sunken disabled:text-foreground-muted"
              />
            </label>
          )}

          <p className="mt-3 text-meta leading-relaxed text-foreground-muted">
            Only the accession or organism is sent to NCBI, a public government
            database. Nothing of your own data leaves this app.
          </p>

          {error ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/15 px-3 py-2.5">
              <WarnIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              <p className="text-meta leading-relaxed text-rose-700 dark:text-rose-300">{error}</p>
            </div>
          ) : null}

          {phase === "resolving" ? (
            <div className="mt-4 flex items-center gap-2 text-meta text-foreground-muted">
              <SpinnerIcon className="h-4 w-4 text-sky-500" />
              <span>Looking up on NCBI...</span>
            </div>
          ) : null}

          {result && (phase === "preview" || phase === "applying") ? (
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
              ) : null}

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

              <p className="mt-3 text-meta leading-relaxed text-foreground-muted">
                Applying writes the organism and taxonomy onto this sequence, and
                into the GenBank source feature so it stays on export.
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
          {busy ? (
            <button
              type="button"
              onClick={cancelInFlight}
              disabled={phase === "applying"}
              className="rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken disabled:opacity-40"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
            >
              Close
            </button>
          )}

          {phase === "preview" && result ? (
            <button
              type="button"
              onClick={handleApply}
              className="flex items-center gap-1.5 rounded-md bg-brand-action px-3.5 py-1.5 text-meta font-medium text-white transition-colors hover:bg-brand-action/90"
            >
              Apply to sequence
            </button>
          ) : phase === "applying" ? (
            <button
              type="button"
              disabled
              className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-1.5 text-meta font-medium text-white opacity-70"
            >
              <SpinnerIcon className="h-4 w-4" />
              Applying...
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleResolve(knownId || typed)}
              disabled={(knownId || typed.trim()) === "" || phase === "resolving"}
              className="flex items-center gap-1.5 rounded-md bg-brand-action px-3.5 py-1.5 text-meta font-medium text-white transition-colors hover:bg-brand-action/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "resolving" ? (
                <>
                  <SpinnerIcon className="h-4 w-4" />
                  Looking up...
                </>
              ) : (
                "Look up"
              )}
            </button>
          )}
        </div>
      </div>
    </LivingPopup>
  );
}
