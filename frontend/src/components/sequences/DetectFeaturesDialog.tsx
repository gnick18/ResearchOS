"use client";

// feature detect bot — COMMON-FEATURE DETECTOR dialog.
//
// Runs detectFeatures (lib/sequences/feature-detect) on the open DNA sequence
// against TWO bundled feature DBs: the protein DB (protein-features.json), which
// is matched by TRANSLATION (a codon-optimized GFP still flags), and the DNA
// element DB (dna-features.json), which is matched by RAW NUCLEOTIDE alignment
// on both strands (origins, promoters, terminators, regulatory regions). Both
// families merge into one proposed-features list, each row labeled by category.
// Each proposed feature shows name, category, DNA position, strand, and identity;
// the user checks the ones to keep and they are applied through the editor's
// add-feature path in ONE undoable edit. A small "closest known protein per ORF"
// section surfaces protein near-misses without auto-proposing them.
//
// Sibling of AnnotateFromReferenceDialog. Calm, compact layout. Type tokens
// (text-meta / text-body / text-title). Icon-only buttons wrapped in <Tooltip>.
// No emojis (inline SVG only), no em-dashes.

import { useCallback, useEffect, useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";
import type { FeatureDraft } from "@/lib/sequences/feature-edit";
import { colorForType } from "@/lib/sequences/feature-colors";
import {
  detectFeatures,
  type DetectedFeature,
  type ClosestMatch,
  type ReferenceProtein,
  type ReferenceDna,
} from "@/lib/sequences/feature-detect";

export interface DetectFeaturesRequest {
  /** The open document's DNA bases (forward strand). */
  openSeq: string;
  /** Apply the chosen detected features as real features (one undoable edit). */
  onApply: (features: FeatureDraft[]) => void;
  onCancel: () => void;
}

/** The shape of one entry in /feature-db/protein-features.json. */
interface FeatureDbEntry {
  name: string;
  category: string;
  sequenceType: string;
  seq: string;
  source?: string;
  license?: string;
}
interface FeatureDbFile {
  entries: FeatureDbEntry[];
}

/** A detected feature plus its checklist state. */
interface Row {
  feature: DetectedFeature;
  selected: boolean;
}

/** Human label per DB category (protein families + DNA-element families). */
const CATEGORY_LABEL: Record<string, string> = {
  fluorescent_protein: "fluorescent protein",
  resistance_marker: "resistance marker",
  fusion_tag: "fusion tag",
  epitope_tag: "epitope tag",
  origin: "origin",
  promoter: "promoter",
  terminator: "terminator",
  regulatory: "regulatory",
};

/** Map a detected category to the editor's feature `type` so colors/exports are
 *  sensible. Fluorescent proteins and markers are CDS-level; tags are misc; DNA
 *  elements map to their GenBank-style feature types. */
function typeForCategory(category: string): string {
  switch (category) {
    case "fluorescent_protein":
    case "resistance_marker":
      return "CDS";
    case "fusion_tag":
    case "epitope_tag":
      return "misc_feature";
    case "origin":
      return "rep_origin";
    case "promoter":
      return "promoter";
    case "terminator":
      return "terminator";
    case "regulatory":
      return "regulatory";
    default:
      return "misc_feature";
  }
}

export default function DetectFeaturesDialog({
  request,
}: {
  request: DetectFeaturesRequest | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [closest, setClosest] = useState<ClosestMatch[]>([]);
  const [ran, setRan] = useState(false);

  useEffect(() => {
    if (!request) return;
    setRows([]);
    setClosest([]);
    setError(null);
    setRan(false);
    setLoading(true);
    let cancelled = false;
    (async () => {
      try {
        // Fetch both feature DBs in parallel. The protein DB is required; the
        // DNA DB is treated as best-effort (if it 404s the detector still runs
        // the protein path) so an older deploy without it does not hard-fail.
        const [protRes, dnaRes] = await Promise.all([
          fetch("/feature-db/protein-features.json", { cache: "force-cache" }),
          fetch("/feature-db/dna-features.json", { cache: "force-cache" }),
        ]);
        if (!protRes.ok) throw new Error("db");
        const data = (await protRes.json()) as FeatureDbFile;
        if (cancelled) return;
        const refs: ReferenceProtein[] = (data.entries ?? [])
          .filter((e) => e.sequenceType === "protein" && e.seq)
          .map((e) => ({
            name: e.name,
            category: e.category,
            seq: e.seq,
            source: e.source,
            license: e.license,
          }));
        let dnaRefs: ReferenceDna[] = [];
        if (dnaRes.ok) {
          const dnaData = (await dnaRes.json()) as FeatureDbFile;
          dnaRefs = (dnaData.entries ?? [])
            .filter((e) => e.sequenceType === "dna" && e.seq)
            .map((e) => ({
              name: e.name,
              category: e.category,
              seq: e.seq,
              source: e.source,
              license: e.license,
            }));
        }
        const result = detectFeatures(request.openSeq, refs, {}, dnaRefs);
        if (cancelled) return;
        setRows(result.features.map((f) => ({ feature: f, selected: true })));
        setClosest(result.closest);
        setRan(true);
      } catch {
        if (!cancelled) setError("Could not load the common-feature database.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  const toggleRow = useCallback((i: number) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, selected: !r.selected } : r)));
  }, []);

  const allSelected = rows.length > 0 && rows.every((r) => r.selected);
  const toggleAll = useCallback(() => {
    setRows((prev) => {
      const next = !prev.every((r) => r.selected);
      return prev.map((r) => ({ ...r, selected: next }));
    });
  }, []);

  const selectedCount = rows.filter((r) => r.selected).length;

  const apply = useCallback(() => {
    if (!request) return;
    const drafts: FeatureDraft[] = rows
      .filter((r) => r.selected)
      .map((r) => {
        const f = r.feature;
        return {
          name: f.name,
          type: typeForCategory(f.category),
          strand: f.strand,
          start: f.dnaStart,
          end: f.dnaEnd,
        };
      });
    request.onApply(drafts);
  }, [request, rows]);

  // Closest-match rows worth showing: an ORF whose best reference is NOT already
  // a confident proposal (so we surface near-misses, not duplicates of hits).
  const proposedNames = useMemo(
    () => new Set(rows.map((r) => r.feature.name)),
    [rows],
  );
  const closestToShow = useMemo(
    () =>
      closest
        .filter((c) => c.name && !proposedNames.has(c.name) && c.identity > 0)
        .slice(0, 6),
    [closest, proposedNames],
  );

  if (!request) return null;

  return (
    <LivingPopup open onClose={request.onCancel} label="Detect common features" selfSize>
      <div className="pointer-events-auto relative flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-surface-raised shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <ScanIcon className="h-4 w-4 shrink-0 text-sky-500" />
          <h2 className="text-title font-semibold text-foreground">
            Detect common features
          </h2>
          {ran && rows.length > 0 && (
            <span className="ml-auto rounded-full bg-surface-sunken px-2 py-0.5 text-meta font-medium text-foreground-muted">
              {rows.length} found
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-body text-foreground-muted">Scanning the sequence…</p>
          ) : error ? (
            <p className="rounded-md border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/15 px-3 py-2 text-body text-rose-600 dark:text-rose-300">
              {error}
            </p>
          ) : (
            <div className="space-y-4">
              <p className="text-body text-foreground-muted">
                ResearchOS translated every open reading frame on both strands and
                compared each to a library of common protein elements, and aligned
                the raw sequence against common DNA elements (origins, promoters,
                terminators, regulatory regions) on both strands. Pick the ones to
                add as features.
              </p>

              {rows.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-body text-foreground-muted">
                  No common features were detected in this sequence.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center">
                    <span className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
                      Proposed features
                    </span>
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="ml-auto text-meta font-medium text-sky-600 dark:text-sky-300 hover:underline"
                    >
                      {allSelected ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                  <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                    {rows.map((row, i) => (
                      <DetectedRow key={i} row={row} onToggle={() => toggleRow(i)} />
                    ))}
                  </ul>
                </div>
              )}

              {closestToShow.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
                      Closest known protein per ORF
                    </span>
                    <Tooltip label="The single best library match for each substantial open reading frame, shown for context. These are below the confident threshold and are not proposed for adding.">
                      <InfoIcon className="h-3.5 w-3.5 text-foreground-muted" />
                    </Tooltip>
                  </div>
                  <ul className="space-y-1">
                    {closestToShow.map((c, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 rounded-md bg-surface-sunken px-3 py-1.5 text-meta text-foreground-muted"
                      >
                        <span className="font-medium text-foreground">
                          {c.name}
                        </span>
                        <span>{Math.round(c.identity * 100)}% identity</span>
                        <span className="ml-auto text-foreground-muted">
                          ORF {(c.orfStart + 1).toLocaleString()}..
                          {c.orfEnd.toLocaleString()} {c.strand === -1 ? "(−)" : "(+)"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-start gap-2 border-t border-border px-5 py-3">
          <p className="text-meta text-foreground-muted">
            Reference data from FPbase (copyright-free) and UniProt / Swiss-Prot
            (CC BY 4.0), plus standard published epitope-tag sequences. DNA
            elements extracted from NCBI GenBank records (public-domain sequence
            facts).
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={request.onCancel}
              className="rounded-md px-3 py-1.5 text-body font-medium text-foreground-muted hover:bg-surface-sunken"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={apply}
              className="rounded-md bg-brand-action px-3 py-1.5 text-body font-medium text-white hover:bg-brand-action/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add {selectedCount > 0 ? selectedCount : ""} feature
              {selectedCount === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </div>
    </LivingPopup>
  );
}

function DetectedRow({ row, onToggle }: { row: Row; onToggle: () => void }) {
  const f = row.feature;
  const swatch = colorForType(typeForCategory(f.category));
  const pct = Math.round(f.identity * 100);
  const span = `${(f.dnaStart + 1).toLocaleString()}..${f.dnaEnd.toLocaleString()}`;
  const catLabel = CATEGORY_LABEL[f.category] ?? f.category;
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-sunken">
        <input
          type="checkbox"
          checked={row.selected}
          onChange={onToggle}
          className="h-4 w-4 shrink-0 accent-sky-500"
        />
        <span
          className="h-3.5 w-3.5 shrink-0 rounded-sm seq-swatch-border"
          style={{ backgroundColor: swatch }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-body font-medium text-foreground">
              {f.name}
            </span>
            <span className="shrink-0 text-meta text-foreground-muted">{catLabel}</span>
            <span className="shrink-0 text-meta text-foreground-muted">
              {f.strand === -1 ? "(−)" : "(+)"}
            </span>
          </span>
          <span className="block text-meta text-foreground-muted">
            {span} · {pct}% identity
          </span>
        </span>
        {f.kind === "tag" && (
          <Tooltip label="Short epitope tag, matched near-exactly within a reading frame.">
            <span className="shrink-0 rounded-full bg-violet-50 dark:bg-violet-500/15 px-2 py-0.5 text-meta font-medium text-violet-700 dark:text-violet-300">
              tag
            </span>
          </Tooltip>
        )}
        {f.sequenceType === "dna" && (
          <Tooltip label="DNA element, matched by raw-nucleotide alignment on both strands (not by translation).">
            <span className="shrink-0 rounded-full bg-sky-50 dark:bg-sky-500/15 px-2 py-0.5 text-meta font-medium text-sky-700 dark:text-sky-300">
              DNA
            </span>
          </Tooltip>
        )}
      </label>
    </li>
  );
}

// --- ICONS (inline SVG; no emoji / icon-font dependency) --------------------

function ScanIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 12h10" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}
