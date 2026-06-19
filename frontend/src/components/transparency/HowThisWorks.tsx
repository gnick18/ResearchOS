/**
 * Quiet "How this works" disclosure that carries the full methodology paragraph
 * below the trust scorecard, so the page leads with the result and keeps the
 * method one click away.
 *
 * Uses the native details/summary element so it needs no client JavaScript and
 * no inline SVG (the marker is a CSS-drawn caret via the marker pseudo-element),
 * which keeps it a server component and clear of the icon ratchet.
 *
 * Voice: factual, no em-dashes, no emojis, no mid-sentence colons.
 */

export default function HowThisWorks() {
  return (
    <details className="group rounded-xl border border-border bg-surface-sunken">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-meta font-semibold text-foreground-muted transition hover:text-foreground [&::-webkit-details-marker]:hidden">
        How this works
        <span
          aria-hidden
          className="font-mono text-foreground-muted transition-transform group-open:rotate-90"
        >
          &rsaquo;
        </span>
      </summary>
      <p className="max-w-2xl px-4 pb-4 text-meta leading-relaxed text-foreground-muted">
        ResearchOS performs sequence-analysis and lab calculations on your device. Each calculation is
        evaluated over a fixed set of test inputs and compared against an independent reference, a
        peer-reviewed software package (Biopython, primer3, pydna, scipy, ggtree), a published sequence,
        or the closed-form result of exact algebra. Reference values are pinned from the cited sources
        and reproducible with the listed generator scripts. The comparisons are recomputed from source on
        every commit as an automated test, and a result exceeding its stated tolerance fails the build.
      </p>
    </details>
  );
}
