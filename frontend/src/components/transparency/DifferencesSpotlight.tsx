import { collectDifferences, hasMethodContext, type Difference } from "@/lib/transparency/summary";
import type { TransparencyReport } from "@/lib/transparency/types";

/**
 * The honest centerpiece of the page: instead of burying the few genuine
 * differences under 140+ green verdicts, this panel lists every comparison where
 * ResearchOS is NOT identical to the reference, with the size of the difference
 * and the reason for it. Larger, flagged differences come first.
 *
 * Server component, pure markup. Voice: factual, no em-dashes, no emojis.
 */

function DiffRow({ d }: { d: Difference }) {
  // Three readings, not two. A flagged TIGHT case is a faithful port that
  // drifted past parity, which is genuinely worth the amber "Larger difference"
  // alarm. A flagged LOOSE case is an approximate-by-design method (e.g. the
  // seed-and-extend homology finder) whose offset from an exact tool is
  // expected, so it reads as a calm "Expected difference", not an alarm.
  const tone =
    d.level === "flagged"
      ? d.kind === "tight"
        ? "larger"
        : "expected"
      : "within";
  const row =
    tone === "larger"
      ? "border-amber-200 dark:border-amber-500/30 bg-amber-50/70"
      : "border-border bg-surface-raised";
  const badge =
    tone === "larger"
      ? "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300"
      : tone === "expected"
        ? "bg-surface-sunken text-foreground-muted"
        : "bg-surface-sunken text-foreground-muted";
  const badgeText =
    tone === "larger"
      ? "Larger difference"
      : tone === "expected"
        ? "Expected difference"
        : "Within tolerance";
  return (
    <li className={`rounded-lg border px-4 py-3 ${row}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-body font-medium text-foreground">
          {d.domainTitle}
          <span className="text-foreground-muted"> · {d.caseLabel}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-meta font-semibold ${badge}`}>
          {badgeText}
        </span>
      </div>
      <p className="mt-1 text-meta text-foreground-muted">
        vs {d.oracleName}: ResearchOS{" "}
        <span className="font-mono text-foreground">{d.ours}</span>, reference{" "}
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

  return (
    <section className="rounded-2xl border border-border bg-surface-raised p-6 shadow-sm sm:p-8">
      <h2 className="text-heading font-bold tracking-tight text-foreground">Where ResearchOS differs</h2>
      <p className="mt-2 max-w-2xl text-body text-foreground-muted">
        Most comparisons are identical to the reference, because where a published algorithm exists
        ResearchOS implements that same algorithm and the test verifies it reproduces it to the digit.
        The cases below are the ones that are not identical. Each is a known, documented difference,
        either a small offset from an independent tool or an expected limitation of an approximate
        method. Nothing here is hidden; this is the full list.
      </p>

      {diffs.length === 0 ? (
        <p className="mt-4 text-body text-foreground-muted">No differences to report.</p>
      ) : (
        <ul className="mt-5 space-y-2">
          {diffs.map((d, i) => (
            <DiffRow key={`${d.domainId}-${d.caseLabel}-${d.oracleName}-${i}`} d={d} />
          ))}
        </ul>
      )}

      {showMethod ? (
        <p className="mt-5 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-meta text-foreground-muted">
          Separately, the melting-temperature tab shows the simpler Wallace and GC-percent rules as
          context. Those are different methods, not a target to match, and they diverge from
          nearest-neighbor by several degrees (the Wallace rule is unbounded and reaches an unphysical
          value on the 40-mer). They are labelled as context and do not count toward the totals.
        </p>
      ) : null}

      <p className="mt-4 text-meta text-foreground-muted">
        Protein parameters and restriction digests reproduce Biopython exactly on standard inputs. The
        only behavioral difference is non-standard residues and codes, which ResearchOS excludes from
        the calculation while Biopython rejects the sequence outright.
      </p>
    </section>
  );
}
