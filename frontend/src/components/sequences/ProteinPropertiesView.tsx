"use client";

// protein analyze bot — the ONE shared result view for the protein-properties
// engine (lib/calculators/protein.ts). It renders the ProtParam-style property
// rows plus the amino-acid composition, and is used behind BOTH doors: the Lab
// calculators "Protein properties" panel tab (CalculatorsButton) and the
// sequence editor's Analyze > Protein properties dialog. Presentational only:
// it takes a ProteinResult (already computed by analyzeProtein) and draws it.
// Keeping the result UI here means the two entry points never drift apart.
//
// No emojis (the project uses inline SVG only), no em-dash, no mid-sentence
// colons in copy. Type tokens (text-meta / text-body / text-title).

import { useMemo } from "react";
import type { ProteinResult } from "@/lib/calculators/protein";
import { formatNum } from "@/lib/calculators/units";

/** A single label / value row inside the result card. */
function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-body text-gray-600">{label}</span>
      <span className="text-title font-semibold text-gray-900 tabular-nums">
        {value}
      </span>
    </div>
  );
}

/**
 * The non-standard-residue notice. ProtParam-style: ambiguous / non-standard
 * letters (X, B, Z, U, O, gaps, internal stops) are reported but excluded from
 * the math. Shown above the card so the reader sees the caveat first. Rendered
 * only when at least one such character was present.
 */
function NonStandardNotice({ chars }: { chars: string[] }) {
  if (chars.length === 0) return null;
  return (
    <p className="text-body text-amber-700 dark:text-amber-300">
      Ignored non-standard residue{chars.length > 1 ? "s" : ""}{" "}
      <span className="font-mono font-semibold">{chars.join(" ")}</span>. Only
      the 20 standard amino acids are included in the math.
    </p>
  );
}

/**
 * The full protein-properties result card (length, MW, pI, extinction, A280,
 * instability, GRAVY, aliphatic index, plus the per-residue composition grid
 * and the methods footnote). Self-contained so the editor dialog can drop it in
 * unchanged. Caller wraps it however it likes; this is just the inner content.
 */
export default function ProteinPropertiesView({
  result,
}: {
  result: ProteinResult;
}) {
  // Composition rows worth showing: only residues actually present, so the
  // table reads like a real ProtParam report rather than 20 mostly-zero lines.
  const presentComposition = useMemo(
    () => result.composition.filter((c) => c.count > 0),
    [result],
  );

  const unstable = result.instabilityIndex > 40;

  return (
    <div className="rounded-xl border border-sky-100 bg-sky-50/60 dark:bg-sky-500/15 p-4">
      <ResultRow label="Length" value={`${result.length} aa`} />
      <ResultRow
        label="Molecular weight"
        value={`${formatNum(result.molecularWeight, 6)} g/mol`}
      />
      <ResultRow
        label="Isoelectric point (pI)"
        value={result.isoelectricPoint.toFixed(2)}
      />
      <ResultRow
        label="Extinction at 280 nm (reduced)"
        value={`${result.extinctionReduced.toLocaleString()} M⁻¹cm⁻¹`}
      />
      <ResultRow
        label="Extinction at 280 nm (cystines)"
        value={`${result.extinctionOxidized.toLocaleString()} M⁻¹cm⁻¹`}
      />
      <ResultRow
        label="A280, 1 g/L (reduced / cystines)"
        value={`${formatNum(result.a280Reduced, 4)} / ${formatNum(result.a280Oxidized, 4)}`}
      />
      <ResultRow
        label="Instability index"
        value={`${formatNum(result.instabilityIndex, 4)} (${unstable ? "unstable" : "stable"})`}
      />
      <ResultRow label="GRAVY" value={formatNum(result.gravy, 4)} />
      <ResultRow
        label="Aliphatic index"
        value={formatNum(result.aliphaticIndex, 4)}
      />

      {presentComposition.length > 0 && (
        <div className="mt-3 pt-3 border-t border-sky-100">
          <p className="text-meta font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Amino-acid composition
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5">
            {presentComposition.map((c) => (
              <div
                key={c.aa}
                className="flex items-baseline justify-between gap-2 text-body"
              >
                <span className="font-mono text-gray-700">{c.aa}</span>
                <span className="tabular-nums text-gray-900">
                  {c.count}{" "}
                  <span className="text-meta text-gray-500">
                    ({formatNum(c.percent, 3)}%)
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-meta text-gray-500">
        Reduced extinction assumes all cysteines are free thiols; the cystine
        figure assumes every pair forms a disulfide. A280 is the absorbance of a
        1 g/L solution. The instability index above 40 predicts a short in-vivo
        half life (Guruprasad 1990); GRAVY is the Kyte-Doolittle grand average
        of hydropathy.
      </p>
    </div>
  );
}

// Re-export the notice so both doors render the same non-standard caveat above
// the card without duplicating the copy.
export { NonStandardNotice };
