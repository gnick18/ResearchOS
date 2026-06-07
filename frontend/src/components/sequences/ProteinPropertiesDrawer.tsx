"use client";

// sequence editor master — RIGHT-DOCKED PROTEIN-PROPERTIES DRAWER.
//
// When a CODING feature (CDS / gene / mat_peptide / sig_peptide) is selected on
// the map or in the sequence view, this slim panel slides in from the right with
// that feature's protein calculations. It is a FLEX SIBLING of the viewer column,
// so opening it reflows SeqViz narrower rather than covering the map.
//
// It reuses the SAME engine + view as the Analyze dialog and the calculators tab:
//   - translateFeature (shared, lib/sequences/feature-protein) for DNA -> peptide,
//   - analyzeProtein (lib/calculators/protein) for the numbers,
//   - ProteinPropertiesView for the full expanded card.
// No protein math or translation is reimplemented here.
//
// Read-only analysis surface. The only action is "Edit feature", which calls the
// editor's existing openEditFeature, and it is hidden when readOnly.
//
// No emojis (inline SVG only), no em-dash, no mid-sentence colons in copy. Type
// tokens (text-meta / text-body / text-title) throughout.

import { useMemo, useState } from "react";
import { analyzeProtein } from "@/lib/calculators/protein";
import { formatNum } from "@/lib/calculators/units";
import type { EditFeature } from "@/lib/sequences/edit-model";
import {
  featureLocationLabel,
  isCodingFeature,
  segmentCount,
  translateFeature,
  trimTrailingStop,
} from "@/lib/sequences/feature-protein";
import type { FeatureDraft } from "@/lib/sequences/feature-edit";
import {
  domainsForCds,
  familyColor,
  type DomainBlock,
} from "@/lib/sequences/domain-features";
import type { DomainHit } from "@/lib/sequences/interproscan";
import Tooltip from "@/components/Tooltip";
import ProteinPropertiesView, { NonStandardNotice } from "./ProteinPropertiesView";
import ProteinDomainBar from "./ProteinDomainBar";
import DomainAnnotationPanel from "./DomainAnnotationPanel";

/** Fixed drawer width. Wide enough for the four stats + the composition grid on
 *  expand, narrow enough to leave the map readable when reflowed. */
export const PROTEIN_DRAWER_WIDTH = 320;

function CloseIcon({ className }: { className?: string }) {
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
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
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
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
    </svg>
  );
}

function ChevronIcon({ open, className }: { open: boolean; className?: string }) {
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
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms" }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** One compact labeled stat in the at-a-glance row. */
function GlanceStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-sky-100 bg-sky-50/60 dark:bg-sky-500/15 px-3 py-2">
      <div className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
        {label}
      </div>
      <div className="text-title font-semibold text-foreground tabular-nums">
        {value}
      </div>
      {sub ? <div className="text-meta text-foreground-muted tabular-nums">{sub}</div> : null}
    </div>
  );
}

export default function ProteinPropertiesDrawer({
  feature,
  featureIndex,
  seq,
  features,
  readOnly,
  onClose,
  onEditFeature,
  onAddDomains,
  onSelectDomain,
  onScanResults,
}: {
  /** The selected coding feature to analyze. */
  feature: EditFeature;
  /** Its index in doc.features, for the Edit feature action. */
  featureIndex: number;
  /** The molecule's DNA / RNA bases. */
  seq: string;
  /** The molecule's full feature list, so the Domains section can find the
   *  `domain` features overlapping this CDS and project them into aa space. The
   *  index into this list is the real doc.features index onSelectDomain needs. */
  features: EditFeature[];
  /** Hide the Edit feature action on a read-only surface. */
  readOnly: boolean;
  /** Hide the drawer (keeps the feature selected/highlighted). */
  onClose: () => void;
  /** Open the existing edit/info dialog for this feature. */
  onEditFeature: (index: number) => void;
  /** Apply accepted domain hits as features in ONE undoable edit. Omitted on a
   *  read-only surface, which hides the "Annotate domains" action. */
  onAddDomains?: (drafts: FeatureDraft[]) => void;
  /** Select + scroll a domain's DNA feature on the map (cross-link from the bar's
   *  click). Receives the feature's index in `features`. */
  onSelectDomain?: (featureIndex: number) => void;
  /**
   * Phase 5 (results as artifacts). Fired when a domain scan COMPLETES, so the
   * editor can persist a domains artifact (the hit list + the feature scanned).
   * Best-effort, omitted on a read-only surface (no scan there).
   */
  onScanResults?: (
    hits: DomainHit[],
    source: "ebi" | "local" | "curated",
  ) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // LIVE PREVIEW: the annotate review reports its current candidate hits up here,
  // so the bar can draw them PENDING (before the user accepts). Cleared when the
  // review closes or the user accepts (the accepted ones become features and the
  // bar shows them solid via `features`).
  const [candidateHits, setCandidateHits] = useState<DomainHit[]>([]);

  // Respect the OS reduced-motion preference: no slide-in transition when set.
  const reducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Translate the feature (strand + exon joins), trim a trailing stop, analyze.
  // analyzeProtein returns null for an empty translation or one with no standard
  // residues; an internal stop is reported (not a clean ORF) but still computed.
  const { result, aa } = useMemo(() => {
    const translated = trimTrailingStop(translateFeature(seq, feature));
    return { result: analyzeProtein(translated), aa: translated };
  }, [seq, feature]);

  // "Not a clean ORF" when the translation carries an internal stop (a * before
  // the end), which usually means the wrong frame / range rather than a protein.
  const hasInternalStop = aa.replace(/\*+$/, "").includes("*");

  // The protein length the bar draws in residue coordinates (the trimmed peptide,
  // minus any trailing stop, so it matches the protein the panel submits).
  const aaLength = aa.replace(/\*+$/, "").length;

  // ACCEPTED domains: the `domain`-type features overlapping this CDS, projected
  // into aa space (stored aa_range note, fallback inverse-map). The bar draws them
  // solid + clickable.
  const acceptedDomains = useMemo<DomainBlock[]>(
    () => (aaLength > 0 ? domainsForCds(feature, features, aaLength) : []),
    [feature, features, aaLength],
  );

  // CANDIDATE domains (in-review): map the panel's reported hits straight to aa
  // blocks (the hit already carries 1-based residues). featureIndex -1 marks them
  // as not-yet-a-feature, so the bar draws them pending + highlight-only.
  const candidateBlocks = useMemo<DomainBlock[]>(
    () =>
      candidateHits.map((h) => {
        const aaStart = Math.max(1, Math.min(h.start, aaLength || h.end));
        const aaEnd = Math.max(aaStart, Math.min(h.end, aaLength || h.end));
        return {
          name: h.name || h.accession,
          accession: h.accession,
          aaStart,
          aaEnd,
          color: familyColor(h.accession, h.name || ""),
          score: h.score,
          evalue: h.evalue,
          featureIndex: -1,
        };
      }),
    [candidateHits, aaLength],
  );

  const name = feature.name || feature.type || "Feature";
  const typeLabel = (feature.type || "feature").toLowerCase();
  const strandLabel = feature.strand === -1 ? "reverse (−)" : "forward (+)";
  const segs = segmentCount(feature);
  const location = featureLocationLabel(feature);

  return (
    <aside
      data-testid="protein-properties-drawer"
      className="flex h-full shrink-0 flex-col overflow-hidden border-l border-border bg-surface-raised"
      style={{
        width: PROTEIN_DRAWER_WIDTH,
        animation: reducedMotion ? undefined : "protein-drawer-in 160ms ease-out",
      }}
    >
      {/* keyframes for the slide-in; skipped entirely under reduced motion. */}
      {!reducedMotion ? (
        <style>{`@keyframes protein-drawer-in {
          from { transform: translateX(16px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }`}</style>
      ) : null}

      {/* Header: feature identity, compact + read-only. */}
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-title font-semibold text-foreground" title={name}>
              {name}
            </h3>
          </div>
          <p className="text-meta text-foreground-muted">
            {typeLabel} · {strandLabel}
            {segs > 1 ? ` · ${segs} segments` : ""}
          </p>
          <p className="mt-0.5 font-mono text-meta text-foreground-muted">{location}</p>
        </div>
        <Tooltip label="Close protein properties">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close protein properties"
            className="-mr-1 mt-0.5 rounded-md p-1 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground-muted"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>

      {/* Body. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {result === null ? (
          <div className="rounded-lg border border-dashed border-border bg-surface-sunken p-3 text-body text-foreground-muted">
            Not a clean ORF. This feature does not translate to a standard protein
            sequence, so there is nothing to measure.
          </div>
        ) : (
          <>
            {hasInternalStop ? (
              <div className="mb-3 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 p-2.5 text-meta text-amber-700 dark:text-amber-300">
                Not a clean ORF. The translation has an internal stop, so this may
                be the wrong frame or range. The numbers below cover the standard
                residues only.
              </div>
            ) : null}

            {/* At-a-glance: Length, MW, pI, Extinction / A280. */}
            <div className="grid grid-cols-2 gap-2">
              <GlanceStat label="Length" value={`${result.length} aa`} />
              <GlanceStat
                label="Mol. weight"
                value={`${formatNum(result.molecularWeight / 1000, 4)} kDa`}
                sub={`${formatNum(result.molecularWeight, 2)} Da`}
              />
              <GlanceStat
                label="Isoelectric pt"
                value={result.isoelectricPoint.toFixed(2)}
                sub="pI"
              />
              <GlanceStat
                label="Ext / A280"
                value={result.extinctionReduced.toLocaleString()}
                sub={`A280 ${formatNum(result.a280Reduced, 3)}`}
              />
            </div>

            <div className="mt-3">
              <NonStandardNotice chars={result.nonStandardChars} />
            </div>

            {/* DOMAINS — the CDD-style protein bar. Sits between the at-a-glance
                stats and the Full-properties / Annotate-domains actions, so the
                flow reads properties, the domains you have, the action to find
                more. Accepted domains draw solid (click to select the DNA feature
                on the map); in-review candidates from the annotate panel draw
                pending so the user previews what accepting would add. */}
            <div className="mt-4">
              <h4 className="mb-1.5 text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Domains
              </h4>
              <ProteinDomainBar
                aaLength={aaLength}
                domains={acceptedDomains}
                candidates={candidateBlocks}
                onSelectDomain={onSelectDomain}
              />
            </div>

            {/* Full properties disclosure, collapsed by default. */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="mt-3 flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-body font-medium text-sky-700 dark:text-sky-300 transition-colors hover:bg-sky-50 dark:hover:bg-sky-500/20"
            >
              <ChevronIcon open={expanded} className="h-4 w-4" />
              Full properties
            </button>
            {expanded ? (
              <div className="mt-1">
                <ProteinPropertiesView result={result} />
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Footer actions: Annotate domains + Edit feature (hidden on a read-only
          surface). The domain action submits this CDS's translated protein to
          EBI InterProScan (opt-in, reviewed before adding). It is disabled when
          the feature does not translate to a clean protein (empty translation or
          an internal stop), since there is nothing valid to submit. */}
      {!readOnly ? (
        <div className="space-y-2 border-t border-border px-4 py-2.5">
          {onAddDomains ? (
            <DomainAnnotationPanel
              // Key by the feature identity so selecting a different CDS remounts
              // the panel fresh (idle, no stale results / in-flight job leaking).
              key={`${feature.type}|${feature.start}|${feature.end}|${feature.strand ?? 1}|${feature.name}`}
              feature={feature}
              protein={aa.replace(/\*+$/, "")}
              seqLength={seq.length}
              disabled={result === null || hasInternalStop}
              disabledReason={
                result === null
                  ? "This feature does not translate to a protein, so there is nothing to search."
                  : "This translation has an internal stop, so it is not a clean protein to search."
              }
              onAddDomains={onAddDomains}
              // LIVE PREVIEW: the panel reports its current review candidates up
              // here so the bar can draw them pending; clears on accept / close.
              onCandidatesChange={setCandidateHits}
              // Phase 5: a completed scan persists a domains artifact upstream.
              onResults={onScanResults}
            />
          ) : null}
          <button
            type="button"
            onClick={() => onEditFeature(featureIndex)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-raised px-3 py-1.5 text-body font-medium text-foreground transition-colors hover:bg-surface-sunken"
          >
            <PencilIcon className="h-4 w-4 text-foreground-muted" />
            Edit feature
          </button>
        </div>
      ) : null}
    </aside>
  );
}

/** Re-export so callers can gate the drawer on the same coding-feature test. */
export { isCodingFeature };
