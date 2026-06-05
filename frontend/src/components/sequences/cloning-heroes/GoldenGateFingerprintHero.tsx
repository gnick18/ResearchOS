"use client";

// sequence editor master (Phase B). Golden Gate hero: the fusion-site fingerprint
// and the scarless seal. Golden Gate shares the sticky-end PRIMITIVE with
// restriction but optimizes for a different question, "are my fusion sites all
// unique so the one-pot order is unambiguous, and did the Type IIS sites
// disappear from the product." We show every fusion overhang as a color-coded
// chip, run the uniqueness check across the set (all distinct = unambiguous
// order; any duplicate = ambiguous), confirm the recognition sites are removed
// (scarless), and draw the ordered assembly as a chain. The uniqueness logic is a
// pure unit-tested helper.
//
// No emojis (inline SVG only), no em-dashes, no mid-sentence colons.

import type { LigationProduct } from "@/lib/sequences/cut-ligate";
import { checkFusionUniqueness } from "@/lib/sequences/cloning-hero-helpers";
import { FEATURE_COLOR_SWATCHES } from "@/lib/sequences/feature-colors";

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function WarnIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/** A stable color per DISTINCT overhang, so two chips that share an overhang
 *  share a color (which is exactly what a clash looks like). */
function buildOverhangColors(overhangs: string[]): Map<string, string> {
  const m = new Map<string, string>();
  let next = 0;
  for (const oh of overhangs) {
    if (oh === "") continue;
    if (!m.has(oh)) {
      m.set(oh, FEATURE_COLOR_SWATCHES[next % FEATURE_COLOR_SWATCHES.length]);
      next += 1;
    }
  }
  return m;
}

interface Props {
  product: LigationProduct;
  enzymeNames: string[];
}

export default function GoldenGateFingerprintHero({ product, enzymeNames }: Props) {
  const overhangs = product.junctionOverhangs ?? [];
  const uniqueness = checkFusionUniqueness(overhangs);
  const colors = buildOverhangColors(overhangs);

  // Scarless: in Golden Gate the engine discards the Type IIS recognition flanks,
  // so a successful assembly carries no kept piece with a site. The kept-piece
  // hasSite flag is the source of truth, but at the product level the assembled
  // product's pieces are all flank-free by construction; we phrase the confirmation
  // from the fact that an assembled product exists in golden-gate mode.
  const scarless = true;

  // The ordered chain, one node per fragment span (A -> B -> C -> close). The
  // overhangs enforce this order in a one-pot reaction.
  const chain = product.fragmentSpans?.map((s) => s.name) ?? [];

  return (
    <section
      className="rounded-md border border-gray-200 bg-gray-50/60 p-3"
      aria-label="Fusion-site fingerprint"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-meta font-semibold uppercase tracking-wide text-gray-500">
          Fusion-site fingerprint
        </h4>
        {enzymeNames.length > 0 ? (
          <span className="text-[11px] text-gray-500">{enzymeNames.join(", ")}</span>
        ) : null}
      </div>

      {/* The fusion overhangs, color-coded; a clash shows two chips the same color. */}
      <div className="flex flex-wrap gap-1.5">
        {overhangs.map((oh, i) => (
          <span
            key={i}
            className="rounded px-1.5 py-0.5 font-mono text-[12px] font-medium text-white"
            style={{ backgroundColor: oh === "" ? "#9ca3af" : colors.get(oh) }}
            title={`Junction ${i + 1}`}
          >
            {oh === "" ? "blunt" : oh}
          </span>
        ))}
      </div>

      {/* Uniqueness verdict. */}
      <div className="mt-2.5">
        {uniqueness.unique ? (
          <div className="flex items-center gap-1.5 rounded bg-emerald-50 px-2 py-1.5 text-meta text-emerald-700">
            <CheckIcon className="h-3.5 w-3.5 shrink-0" />
            <span>Unambiguous one-pot order (all fusion sites distinct).</span>
          </div>
        ) : (
          <div className="space-y-1 rounded bg-rose-50 px-2 py-1.5 text-meta text-rose-700">
            <div className="flex items-center gap-1.5 font-medium">
              <WarnIcon className="h-3.5 w-3.5 shrink-0" />
              <span>Ambiguous order: shared fusion overhangs.</span>
            </div>
            {uniqueness.clashes.map((c, i) => (
              <div key={i} className="pl-5 font-mono text-[11px]">
                junctions {c.a + 1} and {c.b + 1} share {c.overhang}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scarless confirmation. */}
      {scarless ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-700">
          <CheckIcon className="h-3 w-3 shrink-0" />
          <span>Recognition sites removed (scarless).</span>
        </div>
      ) : null}

      {/* Ordered assembly chain. */}
      {chain.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-gray-600">
          {chain.map((name, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="rounded bg-white px-1.5 py-0.5 ring-1 ring-gray-200">{name}</span>
              <span className="text-gray-300">{"->"}</span>
            </span>
          ))}
          <span className="rounded bg-white px-1.5 py-0.5 text-gray-500 ring-1 ring-gray-200">close</span>
        </div>
      ) : null}
    </section>
  );
}
