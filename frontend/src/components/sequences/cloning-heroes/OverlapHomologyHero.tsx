"use client";

// sequence editor master (Phase B). Overlap (Gibson / NEBuilder) hero: the
// homology junctions. The Gibson user's question is "did my overlaps form, are
// they specific, and will they anneal at the reaction temperature." Per junction
// we draw fragment A's 3' tail over fragment B's 5' head with the shared overlap
// highlighted as a band across both rows, the bp + Tm labelled and the Tm chip
// color-graded (green at/above the anneal temp, amber marginal, red too weak).
// Pure presentation; all logic (Tm grading) lives in cloning-hero-helpers.
//
// No emojis (inline SVG only), no em-dashes, no mid-sentence colons.

import type { Junction, FragmentPrimers } from "@/lib/sequences/cloning";
import { gradeOverlapTm, type TmGrade } from "@/lib/sequences/cloning-hero-helpers";

function WarnIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

const GRADE_CHIP: Record<TmGrade, string> = {
  strong: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  marginal: "bg-amber-50 text-amber-700 ring-amber-200",
  weak: "bg-rose-50 text-rose-700 ring-rose-200",
};

interface Props {
  junctions: Junction[];
  /** Per-fragment primer rows, used only for the fragment names at each seam. */
  primers: FragmentPrimers[];
  /** Reaction anneal temperature; the Tm chip is graded against it. */
  annealTargetTm: number;
}

export default function OverlapHomologyHero({ junctions, primers, annealTargetTm }: Props) {
  if (junctions.length === 0) return null;
  const nameOf = (i: number) => primers[i]?.fragmentName ?? `Fragment ${i + 1}`;

  return (
    <section
      className="rounded-md border border-border bg-surface-sunken/60 p-3"
      aria-label="Homology junctions"
    >
      <h4 className="mb-2 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
        Homology junctions ({junctions.length})
      </h4>
      <div className="space-y-2.5">
        {junctions.map((jn, i) => {
          const grade = gradeOverlapTm(jn.overlapTm, annealTargetTm);
          const aName = nameOf(jn.fragmentIndex);
          const bName = nameOf(jn.nextFragmentIndex);
          const hasOverlap = jn.overlapBp > 0 && jn.overlapSeq.length > 0;
          return (
            <div key={i} className="rounded-md border border-border bg-surface-raised p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-meta font-medium text-foreground">
                  {aName} <span className="text-foreground-muted">3'</span>
                  <span className="mx-1 text-foreground-muted">|</span>
                  <span className="text-foreground-muted">5'</span> {bName}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-meta font-medium ring-1 ${GRADE_CHIP[grade]}`}
                >
                  {jn.overlapBp} bp / Tm {Number.isFinite(jn.overlapTm) ? `${jn.overlapTm.toFixed(0)} C` : "n/a"}
                </span>
              </div>

              {/* The two strands with the shared overlap band. Fragment A's 3' tail
                  on top, fragment B's 5' head below, the overlap identical on both
                  (it is the same homology, present once at the seam). */}
              {hasOverlap ? (
                <div className="overflow-x-auto rounded bg-surface-sunken px-2 py-1.5 font-mono text-[11px] leading-relaxed">
                  <div className="flex items-center gap-1 whitespace-nowrap text-foreground-muted">
                    <span className="text-foreground-muted">{aName} 3'</span>
                    <span className="text-foreground-muted">…</span>
                    <span className="rounded-sm bg-sky-100 px-0.5 text-sky-800">{jn.overlapSeq}</span>
                  </div>
                  <div className="flex items-center gap-1 whitespace-nowrap text-foreground-muted">
                    <span className="text-foreground-muted">{bName} 5'</span>
                    <span className="rounded-sm bg-sky-100 px-0.5 text-sky-800">{jn.overlapSeq}</span>
                    <span className="text-foreground-muted">…</span>
                  </div>
                </div>
              ) : (
                <div className="rounded bg-rose-50 px-2 py-1 text-meta text-rose-700">
                  No overlap formed at this junction.
                </div>
              )}

              {jn.warning ? (
                <div className="mt-1.5 flex items-start gap-1.5 text-meta text-amber-700">
                  <WarnIcon className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{jn.warning}</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
