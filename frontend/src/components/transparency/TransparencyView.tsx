/**
 * Body of the public /transparency page.
 *
 * Renders the report produced by `buildTransparencyReport()` (computed at build
 * time, so the page always reflects live ResearchOS source). For each
 * bioinformatic tool it shows what the tool does, the exact module under test, an
 * agreement scatter against the third-party oracles, a per-case comparison table,
 * and the oracle citations with a "reproduce it yourself" pointer.
 *
 * Server component, pure SVG visuals, no client JS. Voice: concept-first, warm,
 * no em-dashes, no emojis, no mid-sentence colons. Every icon is an inline SVG.
 */

import Link from "next/link";

import { buildTransparencyReport } from "@/lib/transparency/run";
import type { DomainReport, OracleRef, TransparencyReport } from "@/lib/transparency/types";

import type { CaseResult } from "@/lib/transparency/types";

import AppFooter from "../AppFooter";
import AlignmentColumns from "./AlignmentColumns";
import CodonTrack from "./CodonTrack";
import FragmentLadder from "./FragmentLadder";
import HomologyMap from "./HomologyMap";
import ParityScatter, { type ParityPoint } from "./ParityScatter";
import StatusPill from "./StatusPill";

/** Stable accent colors per oracle for the scatter + legend. */
const ORACLE_COLOR: Record<string, string> = {
  biopython: "#4f46e5", // indigo
  "biopython-align": "#4f46e5", // indigo
  primer3: "#db2777", // pink
};

function colorFor(id: string): string {
  return ORACLE_COLOR[id] ?? "#0ea5e9";
}

function ExternalIcon() {
  return (
    <svg
      className="ml-0.5 inline-block h-3 w-3 align-[-1px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

function OracleCitation({ oracle }: { oracle: OracleRef }) {
  return (
    <li className="rounded-lg border border-gray-200 bg-gray-50/60 px-4 py-3">
      <div className="flex items-baseline gap-2">
        <span className="inline-block h-2.5 w-2.5 shrink-0 translate-y-[1px] rounded-full" style={{ backgroundColor: colorFor(oracle.id) }} />
        <span className="text-body font-semibold text-gray-900">{oracle.name}</span>
        <span className="text-meta text-gray-400">v{oracle.version}</span>
      </div>
      <p className="mt-1 font-mono text-meta text-gray-600">{oracle.entrypoint}</p>
      <p className="mt-1 text-meta text-gray-500">{oracle.citation}</p>
      <p className="mt-1 text-meta text-gray-400">
        Reproduce:{" "}
        <span className="font-mono text-gray-500">{oracle.generator}</span>
        {oracle.url ? (
          <>
            {" "}
            <a href={oracle.url} target="_blank" rel="noreferrer" className="text-sky-700 underline-offset-2 hover:underline">
              docs
              <ExternalIcon />
            </a>
          </>
        ) : null}
      </p>
    </li>
  );
}

/** A case rendered as its signature visual (alignment columns, homology map). */
function CaseVisualCard({ domain, c }: { domain: DomainReport; c: CaseResult }) {
  const v = c.visual;
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-body font-medium text-gray-800">{c.label}</span>
        <StatusPill status={c.status} />
      </div>

      {v?.kind === "alignment-columns" ? (
        <AlignmentColumns alignedA={v.alignedA} alignedB={v.alignedB} mode={v.mode} />
      ) : null}
      {v?.kind === "homology-map" ? (
        <HomologyMap aLen={v.aLen} bLen={v.bLen} region={v.region} />
      ) : null}
      {v?.kind === "fragment-ladder" ? (
        <FragmentLadder ours={v.ours} theirs={v.theirs} enzymes={v.enzymes} />
      ) : null}
      {v?.kind === "codon-track" ? (
        <CodonTrack codons={v.codons} ours={v.ours} theirs={v.theirs} />
      ) : null}

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-meta">
        {c.comparisons.map((cmp) => (
          <span key={cmp.oracleId} className="text-gray-500">
            vs {oracleName(domain.oracles, cmp.oracleId)}: ResearchOS{" "}
            <span className="font-mono text-gray-800">{cmp.ours}</span>, reference{" "}
            <span className="font-mono text-gray-700">{cmp.theirs}</span>{" "}
            <span className="text-gray-400">(Δ {cmp.delta} {cmp.tolerance.unit})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ScalarTable({ domain, unit }: { domain: DomainReport; unit: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-left text-meta">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
            <th className="px-3 py-2 font-semibold">Case</th>
            <th className="px-3 py-2 font-semibold">Reference</th>
            <th className="px-3 py-2 text-right font-semibold">ResearchOS</th>
            <th className="px-3 py-2 text-right font-semibold">Reference</th>
            <th className="px-3 py-2 text-right font-semibold">Δ ({unit})</th>
            <th className="px-3 py-2 font-semibold">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {domain.cases.map((c) =>
            c.comparisons.map((cmp, ci) => (
              <tr key={`${c.id}-${cmp.oracleId}`} className="border-b border-gray-100 last:border-0">
                {ci === 0 ? (
                  <td rowSpan={c.comparisons.length} className="px-3 py-2 align-top">
                    <div className="font-medium text-gray-800">{c.label}</div>
                    <div className="mt-0.5 break-all font-mono text-[11px] text-gray-400">{c.input}</div>
                  </td>
                ) : null}
                <td className="px-3 py-2 text-gray-600">{oracleName(domain.oracles, cmp.oracleId)}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-800">{cmp.ours}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-600">{cmp.theirs}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-500">{cmp.delta}</td>
                <td className="px-3 py-2">
                  <StatusPill status={cmp.status} />
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function DomainSection({ domain }: { domain: DomainReport }) {
  const unit = domain.cases[0]?.comparisons[0]?.tolerance.unit ?? "";
  const hasVisuals = domain.cases.some((c) => c.visual);
  const oracleStyles = domain.oracles.map((o) => ({ id: o.id, name: o.name, color: colorFor(o.id) }));
  const points: ParityPoint[] = domain.cases.flatMap((c) =>
    c.comparisons.map((cmp) => ({
      ours: cmp.ours,
      theirs: cmp.theirs,
      oracleId: cmp.oracleId,
      label: c.label,
    })),
  );
  const total = domain.totals.pass + domain.totals.warn + domain.totals.fail;

  return (
    <section id={domain.id} className="scroll-mt-20 border-t border-gray-100 pt-12">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-heading font-bold tracking-tight text-gray-900">{domain.title}</h2>
        <StatusPill status={domain.status} label={`${domain.totals.pass}/${total} comparisons`} />
      </div>

      <p className="mb-2 max-w-2xl text-body text-gray-600">{domain.summary}</p>
      <p className="mb-6 text-meta text-gray-400">
        Tested module: <span className="font-mono text-gray-500">{domain.impl}</span>
      </p>

      {hasVisuals ? (
        <div className="grid gap-4 md:grid-cols-2">
          {domain.cases.map((c) => (
            <CaseVisualCard key={c.id} domain={domain} c={c} />
          ))}
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
          <ParityScatter points={points} oracles={oracleStyles} unit={unit} />
          <div className="min-w-0">
            <ScalarTable domain={domain} unit={unit} />
          </div>
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {domain.oracles.map((o) => (
          <OracleCitation key={o.id} oracle={o} />
        ))}
      </ul>
    </section>
  );
}

function oracleName(oracles: OracleRef[], id: string): string {
  return oracles.find((o) => o.id === id)?.name ?? id;
}

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

        <nav className="mb-10 flex flex-wrap gap-2">
          {report.domains.map((d) => (
            <a
              key={d.id}
              href={`#${d.id}`}
              className="rounded-full border border-gray-200 px-3 py-1 text-meta font-medium text-gray-600 hover:border-sky-300 hover:text-sky-700"
            >
              {d.title}
            </a>
          ))}
        </nav>

        <div className="space-y-4">
          {report.domains.map((d) => (
            <DomainSection key={d.id} domain={d} />
          ))}
        </div>
      </div>

      <AppFooter />
    </div>
  );
}
