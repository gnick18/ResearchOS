"use client";

// ResultsSheet (Data Hub slice 2). Renders one stored analysis the way the
// mockup lays it out: a plain-language verdict first, then the stats table
// (ANOVA SS / df / MS / F / p, or the t-test statistic / df / p / CI), then the
// Tukey pairwise table with significance asterisks when present, and a
// Show-the-code toggle that reveals the reproducible Python.
//
// The sheet recomputes from the current table content on render (so an edit to a
// replicate is reflected without a manual re-run); the page also restamps the
// stored resultCache. If the data no longer supports the test, a calm message
// replaces the tables.
//
// House style: <Icon> only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import type {
  AnalysisSpec,
  DataHubDocContent,
} from "@/lib/datahub/model/types";
import {
  runAnalysis,
  type NormalizedAnova,
  type NormalizedResult,
  type NormalizedTTest,
} from "@/lib/datahub/run-analysis";
import { formatP, plainLanguageSummary } from "@/lib/datahub/plain-language";
import { showCode } from "@/lib/datahub/show-code";

/** GraphPad-style significance stars from an adjusted p-value. */
function stars(p: number): string {
  if (!Number.isFinite(p)) return "ns";
  if (p < 0.0001) return "****";
  if (p < 0.001) return "***";
  if (p < 0.01) return "**";
  if (p < 0.05) return "*";
  return "ns";
}

function num(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "-";
  return x.toFixed(digits);
}

function AnovaTables({ r }: { r: NormalizedAnova }) {
  return (
    <>
      <table
        className="mt-4 w-full border-collapse text-body tabular-nums"
        data-testid="results-anova-table"
      >
        <thead>
          <tr className="text-meta uppercase tracking-wide text-foreground-muted">
            <th className="border-b border-border px-3 py-1.5 text-left">Source</th>
            <th className="border-b border-border px-3 py-1.5 text-right">SS</th>
            <th className="border-b border-border px-3 py-1.5 text-right">df</th>
            <th className="border-b border-border px-3 py-1.5 text-right">MS</th>
            <th className="border-b border-border px-3 py-1.5 text-right">F</th>
            <th className="border-b border-border px-3 py-1.5 text-right">p</th>
          </tr>
        </thead>
        <tbody>
          {r.table.map((row) => (
            <tr key={row.source}>
              <td className="border-b border-border px-3 py-1.5 text-foreground">
                {row.source}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(row.ss, 1)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {row.df}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {Number.isFinite(row.ms) ? num(row.ms, 1) : "-"}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {row.f === null ? "" : num(row.f, 1)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {row.pValue === null ? "" : formatP(row.pValue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {r.comparisons.length > 0 && (
        <>
          <h3 className="mt-5 text-body font-semibold text-foreground">
            Tukey multiple comparisons
          </h3>
          <p className="mt-0.5 text-meta text-foreground-muted">
            Every pair, with the family-wise error rate held at 0.05.
          </p>
          <table
            className="mt-2 w-full border-collapse text-body tabular-nums"
            data-testid="results-tukey-table"
          >
            <thead>
              <tr className="text-meta uppercase tracking-wide text-foreground-muted">
                <th className="border-b border-border px-3 py-1.5 text-left">
                  Comparison
                </th>
                <th className="border-b border-border px-3 py-1.5 text-right">
                  Mean diff
                </th>
                <th className="border-b border-border px-3 py-1.5 text-right">
                  Adj. p
                </th>
                <th className="border-b border-border px-3 py-1.5 text-center">
                  Summary
                </th>
              </tr>
            </thead>
            <tbody>
              {r.comparisons.map((c) => (
                <tr key={`${c.groupA}:${c.groupB}`}>
                  <td className="border-b border-border px-3 py-1.5 text-foreground">
                    {c.groupA} vs {c.groupB}
                  </td>
                  <td className="border-b border-border px-3 py-1.5 text-right">
                    {num(c.meanDiff, 1)}
                  </td>
                  <td className="border-b border-border px-3 py-1.5 text-right">
                    {formatP(c.pAdjusted)}
                  </td>
                  <td className="border-b border-border px-3 py-1.5 text-center font-semibold text-accent">
                    {stars(c.pAdjusted)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-meta text-foreground-muted">
            ns = not significant, * p&lt;0.05, ** p&lt;0.01, *** p&lt;0.001, ****
            p&lt;0.0001. These asterisks drop straight onto a graph as
            significance brackets.
          </p>
        </>
      )}
    </>
  );
}

function TTestTable({ r }: { r: NormalizedTTest }) {
  const rows: { label: string; value: string }[] = [
    { label: "Test", value: r.test },
    { label: `Mean (${r.groups[0].name})`, value: num(r.meanA) },
    { label: `Mean (${r.groups[1].name})`, value: num(r.meanB) },
    { label: "Difference of means", value: num(r.meanDiff) },
    { label: "t", value: num(r.statistic) },
    { label: "df", value: num(r.df, r.df % 1 === 0 ? 0 : 2) },
    { label: "p", value: formatP(r.pValue) },
    {
      label: "95% CI of difference",
      value: r.ci95 ? `${num(r.ci95[0])} to ${num(r.ci95[1])}` : "-",
    },
    { label: r.effectSizeLabel, value: num(r.effectSize) },
  ];
  return (
    <table
      className="mt-4 w-full max-w-md border-collapse text-body tabular-nums"
      data-testid="results-ttest-table"
    >
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td className="border-b border-border px-3 py-1.5 text-foreground-muted">
              {row.label}
            </td>
            <td className="border-b border-border px-3 py-1.5 text-right text-foreground">
              {row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ResultsSheet({
  spec,
  content,
  title,
}: {
  spec: AnalysisSpec;
  content: DataHubDocContent;
  /** The analysis's display title (from the rail). */
  title: string;
}) {
  const [showingCode, setShowingCode] = useState(false);

  // Always recompute from the live content so an edit to a replicate is
  // reflected. The page restamps the stored cache separately.
  const outcome = useMemo(() => runAnalysis(spec, content), [spec, content]);

  if (!outcome.ok) {
    return (
      <div data-testid="datahub-results-sheet">
        <h1 className="text-title font-semibold text-foreground">{title}</h1>
        <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground-muted">
          This analysis cannot run on the current table. {outcome.error}
        </p>
      </div>
    );
  }

  const result: NormalizedResult = outcome;
  const code = showCode(result);

  return (
    <div data-testid="datahub-results-sheet">
      <h1 className="text-title font-semibold text-foreground">{title}</h1>

      <div
        className="mt-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-body text-foreground"
        data-testid="results-verdict"
      >
        {plainLanguageSummary(result)}
      </div>

      {result.kind === "anova" ? (
        <AnovaTables r={result} />
      ) : (
        <TTestTable r={result} />
      )}

      <button
        type="button"
        onClick={() => setShowingCode((v) => !v)}
        className="mt-5 flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
        data-testid="results-show-code-toggle"
      >
        <Icon name="file" className="h-3.5 w-3.5" />
        {showingCode ? "Hide the code" : "Show the code"}
      </button>

      {showingCode && (
        <>
          <pre
            className="mt-2 overflow-auto rounded-lg border border-border bg-surface-sunken p-3 text-meta leading-relaxed text-foreground"
            data-testid="results-code"
          >
            <code>{code}</code>
          </pre>
          <p className="mt-2 max-w-xl text-meta text-foreground-muted">
            Every analysis can show the exact open-source code that reproduces
            it, so you can paste it into a notebook and get the same numbers
            rather than trust a black box.
          </p>
        </>
      )}
    </div>
  );
}
