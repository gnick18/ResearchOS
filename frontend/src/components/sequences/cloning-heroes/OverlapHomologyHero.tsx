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
  strong: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-200",
  marginal: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-200",
  weak: "bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-200",
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
                  {aName} <span className="text-foreground-muted">3&apos;</span>
                  <span className="mx-1 text-foreground-muted">|</span>
                  <span className="text-foreground-muted">5&apos;</span> {bName}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-meta font-medium ring-1 ${GRADE_CHIP[grade]}`}
                >
                  {jn.overlapBp} bp / Tm {Number.isFinite(jn.overlapTm) ? `${jn.overlapTm.toFixed(0)} C` : "n/a"}
                </span>
              </div>

              {/* The two strands with the shared overlap band. Fragment A's 3' tail
                  on top, fragment B's 5' head below, the overlap IDENTICAL on both
                  (it is the same homology, same strand, present once at the seam,
                  not a complement). Fixed-width strand tag + context cells anchor
                  the overlap to the SAME column in both rows regardless of the
                  fragment names (which already sit in the header above), so the
                  bases stack and the identity ticks line up base-for-base. */}
              {hasOverlap ? (
                <div className="overflow-x-auto rounded bg-surface-sunken px-2 py-1.5 font-mono text-[11px] leading-relaxed">
                  {/* Fragment A 3' end. Body trails left (…), overlap at the 3' terminus. */}
                  <div className="whitespace-nowrap">
                    <span className="inline-block w-6 shrink-0 pr-1 text-right text-foreground-muted">3&apos;</span>
                    <span className="inline-block w-3 shrink-0 text-right text-foreground-muted">…</span>
                    <span className="bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">{jn.overlapSeq}</span>
                  </div>
                  {/* Identity ticks: every base is shared, so every position matches. */}
                  <div className="whitespace-nowrap text-sky-400 dark:text-sky-500" aria-hidden="true">
                    <span className="inline-block w-6 shrink-0" />
                    <span className="inline-block w-3 shrink-0" />
                    <span>{"│".repeat(jn.overlapSeq.length)}</span>
                  </div>
                  {/* Fragment B 5' end. Overlap at the 5' terminus, body trails right (…). */}
                  <div className="whitespace-nowrap">
                    <span className="inline-block w-6 shrink-0 pr-1 text-right text-foreground-muted">5&apos;</span>
                    <span className="inline-block w-3 shrink-0" />
                    <span className="bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">{jn.overlapSeq}</span>
                    <span className="inline-block w-3 shrink-0 text-foreground-muted">…</span>
                  </div>
                  <div className="mt-1 text-[10px] text-foreground-muted">
                    Shared homology, same strand, present once in the product.
                  </div>
                </div>
              ) : (
                <div className="rounded bg-rose-50 dark:bg-rose-500/15 px-2 py-1 text-meta text-rose-700 dark:text-rose-300">
                  No overlap formed at this junction.
                </div>
              )}

              {jn.warning ? (
                <div className="mt-1.5 flex items-start gap-1.5 text-meta text-amber-700 dark:text-amber-300">
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
