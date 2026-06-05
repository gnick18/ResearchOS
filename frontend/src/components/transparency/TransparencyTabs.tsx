"use client";

/**
 * Tabbed body of the /transparency page. One tab per validated domain (Tm,
 * alignment, digest, translation); only the selected domain's panel is shown.
 *
 * The report itself is computed on the server in `TransparencyView` and passed
 * in as plain serializable data, so none of the bioinformatic engines are
 * bundled into the client. This component only holds the active-tab state and
 * renders the already-computed numbers + visuals.
 *
 * Voice: factual, no em-dashes, no emojis, no mid-sentence colons. Every icon is
 * an inline SVG.
 */

import { useState } from "react";

import type { CaseResult, DomainReport, OracleRef } from "@/lib/transparency/types";

import AlignmentColumns from "./AlignmentColumns";
import CodonTrack from "./CodonTrack";
import FragmentLadder from "./FragmentLadder";
import HomologyMap from "./HomologyMap";
import ParityScatter, { type ParityPoint } from "./ParityScatter";
import PropertyTable from "./PropertyTable";
import ScalarMixedTable from "./ScalarMixedTable";
import SequenceMatch from "./SequenceMatch";
import StatusPill from "./StatusPill";

/** Stable accent colors per oracle for the scatter + legend. */
const ORACLE_COLOR: Record<string, string> = {
  biopython: "#4f46e5", // indigo
  "biopython-align": "#4f46e5", // indigo
  "biopython-digest": "#4f46e5", // indigo
  "biopython-translate": "#4f46e5", // indigo
  primer3: "#db2777", // pink
};

function colorFor(id: string): string {
  return ORACLE_COLOR[id] ?? "#0ea5e9";
}

function total(domain: DomainReport): number {
  return domain.totals.pass + domain.totals.warn + domain.totals.fail;
}

function oracleName(oracles: OracleRef[], id: string): string {
  return oracles.find((o) => o.id === id)?.name ?? id;
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
    <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-body font-medium text-gray-800">{c.label}</span>
        <StatusPill status={c.status} exact={c.comparisons.every((cmp) => cmp.delta === 0)} />
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
      {v?.kind === "property-table" ? <PropertyTable rows={v.rows} /> : null}
      {v?.kind === "sequence-match" ? (
        <SequenceMatch method={v.method} length={v.length} matches={v.matches} preview={v.preview} />
      ) : null}

      {/* property-table and sequence-match already show their own numbers; the
          generic footer would duplicate them. Other visuals get the one-liner. */}
      {v?.kind === "property-table" || v?.kind === "sequence-match" ? null : (
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
      )}
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
                  <StatusPill status={cmp.status} exact={cmp.delta === 0} />
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function DomainPanel({ domain }: { domain: DomainReport }) {
  const unit = domain.cases[0]?.comparisons[0]?.tolerance.unit ?? "";
  const hasVisuals = domain.cases.some((c) => c.visual);
  const distinctUnits = new Set(
    domain.cases.flatMap((c) => c.comparisons.map((cmp) => cmp.tolerance.unit)),
  );
  // Scatter only makes sense for a scalar domain sharing one unit; a domain with
  // mixed units (the lab calculators) gets a per-row table instead.
  const mixedUnits = !hasVisuals && distinctUnits.size > 1;
  const oracleStyles = domain.oracles.map((o) => ({ id: o.id, name: o.name, color: colorFor(o.id) }));
  const points: ParityPoint[] = domain.cases.flatMap((c) =>
    c.comparisons.map((cmp) => ({
      ours: cmp.ours,
      theirs: cmp.theirs,
      oracleId: cmp.oracleId,
      label: c.label,
    })),
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-heading font-bold tracking-tight text-gray-900">{domain.title}</h2>
        <StatusPill status={domain.status} label={`${domain.totals.pass}/${total(domain)} comparisons`} />
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
      ) : mixedUnits ? (
        <ScalarMixedTable domain={domain} />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
          <ParityScatter points={points} oracles={oracleStyles} unit={unit} />
          <div className="min-w-0">
            <ScalarTable domain={domain} unit={unit} />
          </div>
        </div>
      )}

      <ul className="mt-6 space-y-2">
        {domain.oracles.map((o) => (
          <OracleCitation key={o.id} oracle={o} />
        ))}
      </ul>
    </div>
  );
}

export default function TransparencyTabs({ domains }: { domains: DomainReport[] }) {
  const [activeId, setActiveId] = useState(domains[0]?.id);
  const active = domains.find((d) => d.id === activeId) ?? domains[0];

  if (!active) return null;

  return (
    <div>
      <div role="tablist" aria-label="Validated calculations" className="flex flex-wrap gap-1 border-b border-gray-200">
        {domains.map((d) => {
          const selected = d.id === active.id;
          return (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveId(d.id)}
              className={`-mb-px flex items-center gap-2 rounded-t-lg border border-b-2 px-4 py-2.5 text-body font-medium transition ${
                selected
                  ? "border-sky-200 border-b-sky-600 bg-sky-50/70 text-sky-700"
                  : "border-transparent border-b-transparent text-gray-500 hover:border-b-gray-300 hover:text-gray-800"
              }`}
            >
              {d.title}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                  selected ? "bg-sky-100 text-sky-700" : "bg-gray-100 text-gray-500"
                }`}
              >
                {d.totals.pass}/{total(d)}
              </span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="pt-10">
        <DomainPanel domain={active} />
      </div>
    </div>
  );
}
