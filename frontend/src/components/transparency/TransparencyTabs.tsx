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

import { useState, type ReactNode } from "react";

import { domainCounts } from "@/lib/transparency/summary";
import type { CaseResult, DomainReport, OracleRef } from "@/lib/transparency/types";

import AlignmentColumns from "./AlignmentColumns";
import CodonTrack from "./CodonTrack";
import DomainSet from "./DomainSet";
import FragmentLadder from "./FragmentLadder";
import HomologyMap from "./HomologyMap";
import ParityScatter, { type ParityPoint } from "./ParityScatter";
import PhyloFigures from "./PhyloFigures";
import PhyloPublished from "./PhyloPublished";
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
  "native-hmmer": "#7c3aed", // violet
  wallace: "#f59e0b", // amber (context method)
  "gc-rule": "#14b8a6", // teal (context method)
  "genbank-translation": "#0891b2", // cyan (published reference)
  "reference-genome-digest": "#0891b2", // cyan (published reference)
  "published-qpcr": "#0891b2", // cyan (published reference)
  ggtree: "#16a34a", // green (R tree-plotting reference)
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
    <li className="rounded-lg border border-border bg-surface-raised px-4 py-3">
      <div className="flex items-baseline gap-2">
        <span className="inline-block h-2.5 w-2.5 shrink-0 translate-y-[1px] rounded-full" style={{ backgroundColor: colorFor(oracle.id) }} />
        <span className="text-body font-semibold text-foreground">{oracle.name}</span>
        <span className="text-meta text-foreground-muted">v{oracle.version}</span>
      </div>
      <p className="mt-1 font-mono text-meta text-foreground-muted">{oracle.entrypoint}</p>
      <p className="mt-1 text-meta text-foreground-muted">{oracle.citation}</p>
      <p className="mt-1 text-meta text-foreground-muted">
        Reproduce:{" "}
        <span className="font-mono text-foreground-muted">{oracle.generator}</span>
        {oracle.url ? (
          <>
            {" "}
            <a href={oracle.url} target="_blank" rel="noreferrer" className="text-sky-700 dark:text-sky-300 underline-offset-2 hover:underline">
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
    <div className="rounded-xl border border-border bg-surface-raised p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-body font-medium text-foreground">{c.label}</span>
        <StatusPill
          status={c.status}
          exact={c.comparisons.every((cmp) => cmp.delta === 0)}
          kind={
            c.comparisons.find(
              (cmp) => !cmp.informational && (cmp.status === "warn" || cmp.status === "fail"),
            )?.tolerance.kind
          }
        />
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
      {v?.kind === "domain-set" ? (
        <DomainSet domains={v.domains} negativeControl={v.negativeControl} />
      ) : null}
      {v?.kind === "phylo-figures" ? (
        <PhyloFigures
          ggtreeFigure={v.ggtreeFigure}
          matchedTips={v.matchedTips}
          ourTips={v.ourTips}
          tipOrderAgreement={v.tipOrderAgreement}
          depthAgreement={v.depthAgreement}
          pending={v.pending}
        />
      ) : null}
      {v?.kind === "phylo-published" ? (
        <PhyloPublished
          pending={v.pending}
          pendingReason={v.pendingReason}
          source={v.source}
          citation={v.citation}
          recipeSummary={v.recipeSummary}
          toolVersions={v.toolVersions}
          sharedTaxa={v.sharedTaxa}
          rf={v.rf}
          maxRf={v.maxRf}
          normalizedRf={v.normalizedRf}
          cladesRecovered={v.cladesRecovered}
          cladesTotal={v.cladesTotal}
          percentRecovered={v.percentRecovered}
          missingFromOurs={v.missingFromOurs}
          extraInOurs={v.extraInOurs}
          oursNewick={v.oursNewick}
          publishedNewick={v.publishedNewick}
        />
      ) : null}

      {/* property-table, sequence-match and domain-set already show their own
          numbers; the generic footer would duplicate them. Other visuals get the
          one-liner. */}
      {v?.kind === "property-table" || v?.kind === "sequence-match" || v?.kind === "domain-set" || v?.kind === "phylo-figures" || v?.kind === "phylo-published" ? null : (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-meta">
          {c.comparisons.map((cmp) => (
            <span key={`${cmp.oracleId}-${cmp.metric ?? ""}`} className="text-foreground-muted">
              vs {oracleName(domain.oracles, cmp.oracleId)}
              {cmp.metric ? <span className="font-mono"> ({cmp.metric})</span> : null}: ResearchOS{" "}
              <span className="font-mono text-foreground">{cmp.ours}</span>, reference{" "}
              <span className="font-mono text-foreground">{cmp.theirs}</span>{" "}
              <span className="text-foreground-muted">(Δ {cmp.delta} {cmp.tolerance.unit})</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ScalarTable({ domain, unit }: { domain: DomainReport; unit: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-meta">
        <thead>
          <tr className="border-b border-border bg-surface-sunken text-foreground-muted">
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
              <tr key={`${c.id}-${cmp.oracleId}`} className={`border-b border-border last:border-0 ${cmp.informational ? "bg-surface-sunken/60" : ""}`}>
                {ci === 0 ? (
                  <td rowSpan={c.comparisons.length} className="px-3 py-2 align-top">
                    <div className="font-medium text-foreground">{c.label}</div>
                    <div className="mt-0.5 break-all font-mono text-[11px] text-foreground-muted">{c.input}</div>
                  </td>
                ) : null}
                <td className="px-3 py-2 text-foreground-muted">{oracleName(domain.oracles, cmp.oracleId)}</td>
                <td className="px-3 py-2 text-right font-mono text-foreground">{cmp.ours}</td>
                <td className="px-3 py-2 text-right font-mono text-foreground-muted">{cmp.theirs}</td>
                <td className="px-3 py-2 text-right font-mono text-foreground-muted">{cmp.delta}</td>
                <td className="px-3 py-2">
                  {cmp.informational ? (
                    <span className="text-meta text-foreground-muted">context</span>
                  ) : (
                    <StatusPill status={cmp.status} exact={cmp.delta === 0} kind={cmp.tolerance.kind} />
                  )}
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Collapsible detail block, collapsed by default to keep the panel a summary. */
function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-meta font-medium text-foreground-muted hover:border-sky-300 hover:text-sky-700"
        aria-expanded={open}
      >
        {open ? "Hide" : "Show"} {label}
        <Chevron open={open} />
      </button>
      {open ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

/** Small exact / within / flagged summary chips for a domain. */
function DomainSummary({ domain }: { domain: DomainReport }) {
  const c = domainCounts(domain.cases.flatMap((cc) => cc.comparisons));
  const hasInfo = domain.cases.some((cc) => cc.comparisons.some((cmp) => cmp.informational));
  const infoCount = domain.cases.reduce(
    (n, cc) => n + cc.comparisons.filter((cmp) => cmp.informational).length,
    0,
  );
  return (
    <div className="flex flex-wrap items-center gap-2 text-meta">
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-500/15 px-2.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-200">
        {c.exact} exact
      </span>
      {c.within > 0 ? (
        <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700/50 px-2.5 py-0.5 font-semibold text-gray-600 dark:text-gray-300">
          {c.within} within tolerance
        </span>
      ) : null}
      {c.expected > 0 ? (
        <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-700/50 px-2.5 py-0.5 font-semibold text-slate-600 dark:text-slate-300">
          {c.expected} expected difference{c.expected === 1 ? "" : "s"}
        </span>
      ) : null}
      {c.larger > 0 ? (
        <span className="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-500/15 px-2.5 py-0.5 font-semibold text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-200">
          {c.larger} larger difference{c.larger === 1 ? "" : "s"}
        </span>
      ) : null}
      {hasInfo ? <span className="text-foreground-muted">+ {infoCount} cross-method context</span> : null}
    </div>
  );
}

function DomainPanel({ domain }: { domain: DomainReport }) {
  const unit = domain.cases[0]?.comparisons[0]?.tolerance.unit ?? "";
  const hasVisuals = domain.cases.some((c) => c.visual);
  const distinctUnits = new Set(
    domain.cases.flatMap((c) => c.comparisons.map((cmp) => cmp.tolerance.unit)),
  );
  const mixedUnits = !hasVisuals && distinctUnits.size > 1;
  const isScatter = !hasVisuals && !mixedUnits;
  // The scatter plots the gated validations only. Informational cross-method
  // points (the Wallace rule reaches 144 C on the 40-mer) would blow out the axis.
  const scatterOracleIds = new Set<string>();
  const points: ParityPoint[] = domain.cases.flatMap((c) =>
    c.comparisons
      .filter((cmp) => !cmp.informational)
      .map((cmp) => {
        scatterOracleIds.add(cmp.oracleId);
        return { ours: cmp.ours, theirs: cmp.theirs, oracleId: cmp.oracleId, label: c.label };
      }),
  );
  const oracleStyles = domain.oracles
    .filter((o) => scatterOracleIds.has(o.id))
    .map((o) => ({ id: o.id, name: o.name, color: colorFor(o.id) }));
  const gatedTotal = total(domain);

  let detail: ReactNode;
  if (hasVisuals) {
    detail = (
      <div className="grid gap-4 md:grid-cols-2">
        {domain.cases.map((c) => (
          <CaseVisualCard key={c.id} domain={domain} c={c} />
        ))}
      </div>
    );
  } else if (mixedUnits) {
    detail = <ScalarMixedTable domain={domain} />;
  } else {
    detail = <ScalarTable domain={domain} unit={unit} />;
  }

  return (
    <div>
      <h2 className="mb-2 text-heading font-bold tracking-tight text-foreground">{domain.title}</h2>
      <DomainSummary domain={domain} />

      <p className="mb-2 mt-4 max-w-2xl text-body text-foreground-muted">{domain.summary}</p>
      <p className="mb-6 text-meta text-foreground-muted">
        Tested module: <span className="font-mono text-foreground-muted">{domain.impl}</span>
      </p>

      {/* The scatter is the at-a-glance summary for a scalar domain, so it stays
          visible; the per-row tables and per-case cards collapse so the panel
          reads as a summary rather than a wall of verdicts. */}
      {isScatter ? (
        <div className="mb-6 max-w-xl">
          <ParityScatter points={points} oracles={oracleStyles} unit={unit} />
        </div>
      ) : null}

      <Collapsible label={`all ${gatedTotal} comparisons`}>{detail}</Collapsible>

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
      <div role="tablist" aria-label="Validated calculations" className="flex flex-wrap gap-1 border-b border-border">
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
                  ? "border-sky-200 dark:border-sky-500/30 border-b-sky-600 bg-sky-50/70 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300"
                  : "border-transparent border-b-transparent text-foreground-muted hover:border-b-border hover:text-foreground"
              }`}
            >
              {d.title}
              <span
                className={`rounded-full px-1.5 py-0.5 text-meta font-semibold tabular-nums ${
                  selected ? "bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
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
