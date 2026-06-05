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
import Tooltip from "@/components/Tooltip";
import ProteinPropertiesView, { NonStandardNotice } from "./ProteinPropertiesView";

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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
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
    <div className="rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2">
      <div className="text-meta font-medium uppercase tracking-wide text-gray-400">
        {label}
      </div>
      <div className="text-title font-semibold text-gray-900 tabular-nums">
        {value}
      </div>
      {sub ? <div className="text-meta text-gray-500 tabular-nums">{sub}</div> : null}
    </div>
  );
}

export default function ProteinPropertiesDrawer({
  feature,
  featureIndex,
  seq,
  readOnly,
  onClose,
  onEditFeature,
}: {
  /** The selected coding feature to analyze. */
  feature: EditFeature;
  /** Its index in doc.features, for the Edit feature action. */
  featureIndex: number;
  /** The molecule's DNA / RNA bases. */
  seq: string;
  /** Hide the Edit feature action on a read-only surface. */
  readOnly: boolean;
  /** Hide the drawer (keeps the feature selected/highlighted). */
  onClose: () => void;
  /** Open the existing edit/info dialog for this feature. */
  onEditFeature: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

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

  const name = feature.name || feature.type || "Feature";
  const typeLabel = (feature.type || "feature").toLowerCase();
  const strandLabel = feature.strand === -1 ? "reverse (−)" : "forward (+)";
  const segs = segmentCount(feature);
  const location = featureLocationLabel(feature);

  return (
    <aside
      data-testid="protein-properties-drawer"
      className="flex h-full shrink-0 flex-col overflow-hidden border-l border-gray-200 bg-white"
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
      <div className="flex items-start gap-2 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-title font-semibold text-gray-900" title={name}>
              {name}
            </h3>
          </div>
          <p className="text-meta text-gray-500">
            {typeLabel} · {strandLabel}
            {segs > 1 ? ` · ${segs} segments` : ""}
          </p>
          <p className="mt-0.5 font-mono text-meta text-gray-600">{location}</p>
        </div>
        <Tooltip label="Close protein properties">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close protein properties"
            className="-mr-1 mt-0.5 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>

      {/* Body. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {result === null ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 text-body text-gray-500">
            Not a clean ORF. This feature does not translate to a standard protein
            sequence, so there is nothing to measure.
          </div>
        ) : (
          <>
            {hasInternalStop ? (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-meta text-amber-700">
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

            {/* Full properties disclosure, collapsed by default. */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="mt-3 flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-body font-medium text-sky-700 transition-colors hover:bg-sky-50"
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

      {/* Footer action: Edit feature (hidden on a read-only surface). */}
      {!readOnly ? (
        <div className="border-t border-gray-100 px-4 py-2.5">
          <button
            type="button"
            onClick={() => onEditFeature(featureIndex)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-body font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <PencilIcon className="h-4 w-4 text-gray-500" />
            Edit feature
          </button>
        </div>
      ) : null}
    </aside>
  );
}

/** Re-export so callers can gate the drawer on the same coding-feature test. */
export { isCodingFeature };
