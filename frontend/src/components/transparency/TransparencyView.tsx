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

import { buildTransparencyReport } from "@/lib/transparency/run";
import { agreementCounts } from "@/lib/transparency/summary";
import type { TransparencyReport } from "@/lib/transparency/types";

import DifferencesSpotlight from "./DifferencesSpotlight";
import TransparencyScorecard from "./TransparencyScorecard";
import TransparencyTabs from "./TransparencyTabs";

export default function TransparencyView() {
  const report: TransparencyReport = buildTransparencyReport();
  const counts = agreementCounts(report);

  return (
    <div className="min-h-screen bg-surface-sunken">
      <div aria-hidden className="brand-rainbow-bg h-2 w-full" />
      <MarketingNav />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <TransparencyScorecard counts={counts} />

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
