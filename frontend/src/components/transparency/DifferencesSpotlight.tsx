import { collectDifferences, hasMethodContext, type Difference } from "@/lib/transparency/summary";
import type { TransparencyReport } from "@/lib/transparency/types";

/**
 * The honest centerpiece of the page: the few comparisons where ResearchOS is
 * NOT identical to the reference. The genuinely flagged cases (an approximate
 * method, or a faithful port that drifted past parity) are shown in full. The
 * many small within-tolerance offsets are NOT relisted here, because every
 * per-case number already lives in that method's own comparison table, so this
 * panel summarizes them in one line instead of reprinting hundreds of rows.
 *
 * Server component, pure markup. Voice: factual, no em-dashes, no emojis.
 */

function DiffRow({ d }: { d: Difference }) {
  // A flagged TIGHT case is a faithful port that drifted past parity, worth the
  // amber "Larger difference" alarm. A flagged LOOSE case is an
  // approximate-by-design method whose offset is expected, so it reads as a calm
  // "Expected difference", not an alarm.
  const larger = d.level === "flagged" && d.kind === "tight";
  const row = larger ? "border-amber-200 dark:border-amber-500/30 bg-amber-50/70" : "border-border bg-surface-raised";
  const badge = larger
    ? "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300"
    : "bg-surface-sunken text-foreground-muted";
  const badgeText = larger ? "Larger difference" : "Expected difference";
  return (
    <li className={`rounded-lg border px-4 py-3 ${row}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-body font-medium text-foreground">
          {d.domainTitle}
          <span className="text-foreground-muted"> · {d.caseLabel}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-meta font-semibold ${badge}`}>{badgeText}</span>
      </div>
      <p className="mt-1 text-meta text-foreground-muted">
        vs {d.oracleName}: ResearchOS <span className="font-mono text-foreground">{d.ours}</span>, reference{" "}
        <span className="font-mono text-foreground">{d.theirs}</span>{" "}
        <span className="font-mono text-foreground-muted">(Δ {d.delta} {d.unit})</span>
      </p>
      <p className="mt-1 text-meta text-foreground-muted">{d.reason}</p>
    </li>
  );
}

export default function DifferencesSpotlight({ report }: { report: TransparencyReport }) {
  const diffs = collectDifferences(report);
  const showMethod = hasMethodContext(report);

  const flagged = diffs.filter((d) => d.level === "flagged");
  const withinCount = diffs.length - flagged.length;

  return (
    <section className="rounded-2xl border border-border bg-surface-raised p-6 shadow-sm sm:p-8">
      <h2 className="text-heading font-bold tracking-tight text-foreground">Where ResearchOS differs</h2>
      <p className="mt-2 max-w-2xl text-body text-foreground-muted">
        Where a published algorithm exists, ResearchOS implements that same algorithm and the test
        verifies it reproduces the reference to the digit. The only non-identical cases are the ones
        called out here, each a known, documented difference.
      </p>

      {diffs.length === 0 ? (
        <p className="mt-4 text-body text-foreground-muted">No differences to report.</p>
      ) : (
        <>
          {flagged.length > 0 ? (
            <ul className="mt-5 space-y-2">
              {flagged.map((d, i) => (
                <DiffRow key={`${d.domainId}-${d.caseLabel}-${d.oracleName}-${i}`} d={d} />
              ))}
            </ul>
          ) : (
            <p className="mt-5 text-body text-foreground-muted">
              No flagged differences. Every non-identical comparison is a small offset that stays
              inside its documented tolerance.
            </p>
          )}

          {withinCount > 0 ? (
            <p className="mt-4 max-w-2xl text-meta text-foreground-muted">
              {withinCount} further comparison{withinCount === 1 ? "" : "s"} differ only by a last-digit
              amount that stays inside each method's documented tolerance, the kind of rounding offset
              two correct implementations produce. The exact per-case numbers are in each method's
              comparison table, nothing is hidden.
            </p>
          ) : null}
        </>
      )}

      {showMethod ? (
        <p className="mt-5 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-meta text-foreground-muted">
          Separately, the melting-temperature method shows the simpler Wallace and GC-percent rules as
          context. Those are different methods, not a target to match, so they diverge from
          nearest-neighbor by several degrees and are labelled as context, not counted toward the totals.
        </p>
      ) : null}
    </section>
  );
}
