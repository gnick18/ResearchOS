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

import Link from "next/link";

import { buildTransparencyReport } from "@/lib/transparency/run";
import type { TransparencyReport } from "@/lib/transparency/types";

import AppFooter from "../AppFooter";
import StatusPill from "./StatusPill";
import TransparencyTabs from "./TransparencyTabs";

export default function TransparencyView() {
  const report: TransparencyReport = buildTransparencyReport();
  const total = report.totals.pass + report.totals.warn + report.totals.fail;

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <Link href="/" className="text-body font-medium text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline">
          ← ResearchOS
        </Link>

        <header className="mt-8 mb-12">
          <p className="mb-3 text-body font-semibold uppercase tracking-wide text-sky-600">Method validation</p>
          <h1 className="mb-5 text-display font-bold tracking-tight text-gray-900 sm:text-4xl">
            Validation of bioinformatic calculations against peer-reviewed alternatives
          </h1>
          <p className="max-w-2xl text-body text-gray-600">
            ResearchOS performs sequence-analysis calculations client-side. Each calculation listed
            below is evaluated over a fixed set of test inputs and compared against an established
            peer-reviewed alternative (Biopython, primer3) under matched parameters. Reference values
            are pinned from the cited tool versions and reproducible with the listed generator scripts.
            The comparisons are recomputed from source on every commit as an automated test; a result
            exceeding its stated tolerance fails the build.
          </p>

          <div className="mt-8 inline-flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-5 py-3">
            <StatusPill status={report.status} label={`${report.totals.pass}/${total} comparisons within tolerance`} />
            <span className="text-meta text-gray-500">{report.generatedNote}</span>
          </div>
        </header>

        <TransparencyTabs domains={report.domains} />
      </div>

      <AppFooter />
    </div>
  );
}
