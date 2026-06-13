/**
 * Body of the public /transparency page.
 *
 * Computes the report with `buildTransparencyReport()` on the server (build
 * time, so the page always reflects live ResearchOS source), renders the header
 * and overall summary, then hands the per-domain data to the client-side
 * `TransparencyTabs` for tabbed display. None of the bioinformatic engines reach
 * the client bundle; only the already-computed numbers and visuals do.
 *
 * Voice: factual, no em-dashes, no emojis, no mid-sentence colons. Every icon is
 * an inline SVG.
 */

import MarketingFooter from "@/components/MarketingFooter";
import MarketingNav from "@/components/MarketingNav";
import Kicker from "@/components/marketing/Kicker";

import { buildTransparencyReport } from "@/lib/transparency/run";
import { agreementCounts } from "@/lib/transparency/summary";
import type { TransparencyReport } from "@/lib/transparency/types";

import DifferencesSpotlight from "./DifferencesSpotlight";
import TransparencyTabs from "./TransparencyTabs";

export default function TransparencyView() {
  const report: TransparencyReport = buildTransparencyReport();
  const counts = agreementCounts(report);
  const nonExact = counts.within + counts.expected + counts.larger;

  return (
    <div className="min-h-screen bg-surface-sunken">
      <div aria-hidden className="brand-rainbow-bg h-2 w-full" />
      <MarketingNav />
      <div className="mx-auto max-w-5xl px-6 py-12">
        <header className="rounded-2xl border border-border bg-surface-raised p-8 shadow-sm sm:p-10">
          <div className="mb-4">
            <Kicker>Method validation</Kicker>
          </div>
          <h1 className="mb-5 text-display font-bold tracking-tight text-foreground sm:text-4xl">
            Validation of bioinformatic calculations against peer-reviewed alternatives
          </h1>
          <p className="max-w-2xl text-body text-foreground-muted">
            ResearchOS performs sequence-analysis and lab calculations client-side. Each calculation
            listed below is evaluated over a fixed set of test inputs and compared against an
            independent reference, a peer-reviewed software package (Biopython, primer3, pydna), a
            published sequence, or the closed-form result of exact algebra. Reference values are pinned
            from the cited sources and reproducible with the listed generator scripts. The comparisons
            are recomputed from source on every commit as an automated test; a result exceeding its
            stated tolerance fails the build.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-2 text-meta">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 px-3 py-1 font-semibold text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-200">
              {counts.exact} exact
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-3 py-1 font-semibold text-foreground-muted">
              {nonExact} within a documented tolerance
            </span>
            {counts.expected > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-3 py-1 font-semibold text-foreground-muted">
                {counts.expected} expected difference{counts.expected === 1 ? "" : "s"}
              </span>
            ) : null}
            {counts.larger > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-500/15 px-3 py-1 font-semibold text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-200">
                {counts.larger} larger difference{counts.larger === 1 ? "" : "s"}
              </span>
            ) : null}
            <span className="text-foreground-muted">across {counts.total} comparisons, recomputed on every commit</span>
          </div>
        </header>

        <div className="mt-6">
          <DifferencesSpotlight report={report} />
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-6 shadow-sm sm:p-8">
          <TransparencyTabs domains={report.domains} />
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}
