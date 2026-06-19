"use client";

/**
 * Rail + panel body of the /transparency page. A sticky grouped left rail
 * (TransparencyRail) switches between validated domains, and a single
 * summary-first panel renders the active one.
 *
 * The report itself is computed on the server in `TransparencyView` and passed
 * in as plain serializable data, so none of the bioinformatic engines are
 * bundled into the client. This component only holds the active-domain state and
 * renders the already-computed numbers + visuals.
 *
 * Panel order is summary-first: a plain-language verdict header, the domain
 * summary plus a quiet tested-module line, the signature visual, then the full
 * per-case table behind a "Show all" disclosure, then the references in a
 * de-emphasized block at the very bottom.
 *
 * Voice: factual, no em-dashes, no emojis, no mid-sentence colons. The only
 * inline SVGs here are the ExternalIcon and Chevron helpers (baseline holds 2).
 */

import { useState, type ReactNode } from "react";

import { domainCounts, type AgreementCounts } from "@/lib/transparency/summary";
import type { CaseResult, DomainReport, OracleRef, ScalarComparison } from "@/lib/transparency/types";

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
import TransparencyRail from "./TransparencyRail";

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
          mode={v.mode}
          pass={v.pass}
          recoveryFloor={v.recoveryFloor}
          supportCutoff={v.supportCutoff}
          wellSupportedMissed={v.wellSupportedMissed}
          weaklySupportedMissed={v.weaklySupportedMissed}
          maxMissingSupport={v.maxMissingSupport}
          missingFromOurs={v.missingFromOurs}
          missingSupports={v.missingSupports}
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
    <>
      {/* Desktop table — hidden on phones */}
      <div className="hidden sm:block overflow-x-auto rounded-xl border border-border">
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

      {/* Phone stacked cards — visible below sm */}
      <div className="sm:hidden space-y-3">
        {domain.cases.map((c) => (
          <div key={c.id} className="rounded-xl border border-border bg-surface-raised p-4">
            <div className="mb-2">
              <div className="font-medium text-foreground">{c.label}</div>
              {c.input ? <div className="mt-0.5 break-all font-mono text-[11px] text-foreground-muted">{c.input}</div> : null}
            </div>
            {c.comparisons.map((cmp) => (
              <div key={`${c.id}-${cmp.oracleId}-mobile`} className={`mt-2 rounded-lg border border-border p-3 text-meta ${cmp.informational ? "bg-surface-sunken/60" : "bg-surface-sunken"}`}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-foreground-muted">{oracleName(domain.oracles, cmp.oracleId)}</span>
                  {cmp.informational ? (
                    <span className="text-foreground-muted">context</span>
                  ) : (
                    <StatusPill status={cmp.status} exact={cmp.delta === 0} kind={cmp.tolerance.kind} />
                  )}
                </div>
                <div className="grid grid-cols-3 gap-x-2 text-center">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-foreground-muted">Ours</div>
                    <div className="font-mono text-foreground">{cmp.ours}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-foreground-muted">Ref</div>
                    <div className="font-mono text-foreground-muted">{cmp.theirs}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-foreground-muted">Δ ({unit})</div>
                    <div className="font-mono text-foreground-muted">{cmp.delta}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
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
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-meta font-medium text-foreground-muted hover:border-brand-action/40 hover:text-brand-action"
        aria-expanded={open}
      >
        {open ? "Hide" : "Show"} {label}
        <Chevron open={open} />
      </button>
      {open ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

/**
 * One plain-language verdict for the domain, derived from the gated counts. The
 * pill leads the panel so the reader gets the conclusion before any numbers.
 */
function domainVerdict(counts: AgreementCounts): { label: string; tone: "exact" | "tolerance" | "flagged" } {
  if (counts.larger > 0) return { label: "Differences flagged", tone: "flagged" };
  if (counts.within > 0 || counts.expected > 0) return { label: "Within documented tolerance", tone: "tolerance" };
  return { label: "All comparisons exact", tone: "exact" };
}

function VerdictChip({ counts }: { counts: AgreementCounts }) {
  const verdict = domainVerdict(counts);
  const style =
    verdict.tone === "exact"
      ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-200"
      : verdict.tone === "flagged"
        ? "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-200"
        : "bg-surface-sunken text-foreground-muted ring-border";
  const dot =
    verdict.tone === "exact" ? "bg-emerald-500" : verdict.tone === "flagged" ? "bg-amber-500" : "bg-foreground-muted";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-meta font-semibold ring-1 ring-inset ${style}`}
    >
      <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />
      {verdict.label}
    </span>
  );
}

/**
 * The single most representative gated comparison for a scalar domain, rendered
 * below as a readable pair instead of a six-column table. Prefers a non-exact
 * case (so the reader sees a real number-to-number agreement) and falls back to
 * the first gated comparison.
 */
function representativeComparison(
  domain: DomainReport,
): { label: string; oracleName: string; ours: number; theirs: number; unit: string; delta: number; exact: boolean } | null {
  let fallback: { c: CaseResult; cmp: ScalarComparison } | null = null;
  let nonExact: { c: CaseResult; cmp: ScalarComparison } | null = null;
  for (const c of domain.cases) {
    for (const cmp of c.comparisons) {
      if (cmp.informational) continue;
      if (!fallback) fallback = { c, cmp };
      if (!nonExact && cmp.delta !== 0) nonExact = { c, cmp };
    }
  }
  const pick = nonExact ?? fallback;
  if (!pick) return null;
  return {
    label: pick.c.label,
    oracleName: oracleName(domain.oracles, pick.cmp.oracleId),
    ours: pick.cmp.ours,
    theirs: pick.cmp.theirs,
    unit: pick.cmp.tolerance.unit,
    delta: pick.cmp.delta,
    exact: pick.cmp.delta === 0,
  };
}

/** De-emphasized references block, collapsed by default at the foot of a panel. */
function References({ oracles }: { oracles: OracleRef[] }) {
  return (
    <details className="group mt-8 border-t border-border pt-5">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-meta font-medium text-foreground-muted transition hover:text-foreground [&::-webkit-details-marker]:hidden">
        References ({oracles.length})
        <span aria-hidden className="font-mono transition-transform group-open:rotate-90">
          &rsaquo;
        </span>
      </summary>
      <ul className="mt-4 space-y-2">
        {oracles.map((o) => (
          <OracleCitation key={o.id} oracle={o} />
        ))}
      </ul>
    </details>
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

  const counts = domainCounts(domain.cases.flatMap((cc) => cc.comparisons));
  const rep = isScatter ? representativeComparison(domain) : null;
  const hasInfo = domain.cases.some((cc) => cc.comparisons.some((cmp) => cmp.informational));
  const infoCount = domain.cases.reduce(
    (n, cc) => n + cc.comparisons.filter((cmp) => cmp.informational).length,
    0,
  );

  return (
    <div>
      {/* (a) Verdict header: title + one plain-language status chip. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-heading font-bold tracking-tight text-brand-ink">{domain.title}</h2>
        <VerdictChip counts={counts} />
      </div>

      {/* (b) Summary sentence + quiet tested-module line. */}
      <p className="mt-3 max-w-2xl text-body text-foreground-muted">{domain.summary}</p>
      <p className="mt-2 text-meta text-foreground-muted">
        Tested module <span className="font-mono text-foreground-muted">{domain.impl}</span>
      </p>

      {/* A single readable representative comparison for scalar domains, so the
          summary view shows a real number-to-number agreement without a table. */}
      {rep ? (
        <p className="mt-4 text-body text-foreground">
          <span className="text-foreground-muted">{rep.label}</span>
          {"  "}
          <span className="font-mono text-foreground">ResearchOS {rep.ours} {rep.unit}</span>
          <span className="text-foreground-muted"> {rep.exact ? "=" : "≈"} </span>
          <span className="font-mono text-foreground">{rep.oracleName} {rep.theirs} {rep.unit}</span>
          {!rep.exact ? (
            <span className="text-foreground-muted"> (Δ {rep.delta} {rep.unit})</span>
          ) : null}
        </p>
      ) : null}

      {/* (c) The signature visual stays prominent. For scalar domains that is the
          agreement scatter; visual and mixed-unit domains carry their own
          picture inside the disclosure below. */}
      {isScatter ? (
        <div className="mt-6 max-w-xl">
          <ParityScatter points={points} oracles={oracleStyles} unit={unit} />
        </div>
      ) : null}

      {hasInfo ? (
        <p className="mt-4 text-meta text-foreground-muted">
          Plus {infoCount} cross-method context comparison{infoCount === 1 ? "" : "s"}, shown for
          reference and not counted toward the totals.
        </p>
      ) : null}

      {/* (d) The full per-case table stays behind the disclosure. */}
      <div className="mt-6">
        <Collapsible label={`all ${gatedTotal} comparisons`}>{detail}</Collapsible>
      </div>

      {/* (e) De-emphasized references at the very bottom. */}
      <References oracles={domain.oracles} />
    </div>
  );
}

export default function TransparencyTabs({ domains }: { domains: DomainReport[] }) {
  const [activeId, setActiveId] = useState(domains[0]?.id);
  const active = domains.find((d) => d.id === activeId) ?? domains[0];

  if (!active) return null;

  return (
    <div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-8">
      <aside className="md:sticky md:top-6 md:self-start">
        <TransparencyRail domains={domains} activeId={active.id} onSelect={setActiveId} />
      </aside>

      <div role="tabpanel" className="min-w-0">
        <DomainPanel domain={active} />
      </div>
    </div>
  );
}
