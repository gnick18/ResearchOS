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
import Tooltip from "@/components/Tooltip";
import WorkspaceToolbar, {
  type ToolbarGroup,
} from "@/components/datahub/WorkspaceToolbar";
import type {
  AnalysisSpec,
  DataHubDocContent,
} from "@/lib/datahub/model/types";
import {
  runAnalysis,
  type NormalizedAnova,
  type NormalizedCorrelation,
  type NormalizedRegression,
  type NormalizedResult,
  type NormalizedSurvival,
  type NormalizedTTest,
  type NormalizedTwoWayAnova,
} from "@/lib/datahub/run-analysis";
import { formatP, plainLanguageSummary } from "@/lib/datahub/plain-language";
import { showCode } from "@/lib/datahub/show-code";
import { resultToText } from "@/lib/datahub/result-text";

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

function AnovaStatsTable({ r }: { r: NormalizedAnova }) {
  return (
    <>
      <table
        className="w-full border-collapse text-body tabular-nums"
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
      <p className="mt-2 text-meta text-foreground-muted">
        SS is the sum of squares, df the degrees of freedom, MS the mean square,
        and F the ratio the p-value comes from.
      </p>
    </>
  );
}

function ComparisonsTable({
  comparisons,
  testid,
}: {
  comparisons: NormalizedAnova["comparisons"];
  testid: string;
}) {
  return (
    <>
      <p className="text-meta text-foreground-muted">
        Every pair, with the family-wise error rate held at 0.05.
      </p>
      <table
        className="mt-2 w-full border-collapse text-body tabular-nums"
        data-testid={testid}
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
          {comparisons.map((c) => (
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
        p&lt;0.0001. These asterisks drop straight onto a graph as significance
        brackets.
      </p>
    </>
  );
}

function TTestTable({ r }: { r: NormalizedTTest }) {
  // A rank test reports its own statistic (U or W) with no df and no CI of the
  // difference, so the table shows the right statistic label and drops the
  // parametric-only rows rather than printing a dash next to "t" and "df".
  const statLabel = r.nonparametric
    ? r.test.startsWith("Wilcoxon")
      ? "W"
      : "U"
    : "t";
  const rows: { label: string; value: string }[] = [
    { label: "Test", value: r.test },
    { label: `Mean (${r.groups[0].name})`, value: num(r.meanA) },
    { label: `Mean (${r.groups[1].name})`, value: num(r.meanB) },
    { label: "Difference of means", value: num(r.meanDiff) },
    { label: statLabel, value: num(r.statistic) },
    ...(r.nonparametric
      ? []
      : [
          { label: "df", value: num(r.df, r.df % 1 === 0 ? 0 : 2) },
        ]),
    { label: "p", value: formatP(r.pValue) },
    ...(r.nonparametric
      ? []
      : [
          {
            label: "95% CI of difference",
            value: r.ci95 ? `${num(r.ci95[0])} to ${num(r.ci95[1])}` : "-",
          },
        ]),
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

function ciText(ci: [number, number] | null | undefined): string {
  if (!ci || !Number.isFinite(ci[0]) || !Number.isFinite(ci[1])) return "-";
  return `${num(ci[0])} to ${num(ci[1])}`;
}

function KeyValueTable({
  rows,
  testid,
}: {
  rows: { label: string; value: string }[];
  testid: string;
}) {
  return (
    <table
      className="mt-4 w-full max-w-md border-collapse text-body tabular-nums"
      data-testid={testid}
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

function CorrelationTable({ r }: { r: NormalizedCorrelation }) {
  const sym = r.coefficientLabel;
  return (
    <KeyValueTable
      testid="results-correlation-table"
      rows={[
        { label: "Method", value: r.method === "spearman" ? "Spearman rank" : "Pearson" },
        { label: `Coefficient (${sym})`, value: num(r.coefficient, 3) },
        { label: "95% CI of " + sym, value: ciText(r.ci95) },
        { label: "t", value: num(r.statistic) },
        { label: "df", value: num(r.df, 0) },
        { label: "p", value: formatP(r.pValue) },
        { label: "Pairs (n)", value: num(r.n, 0) },
      ]}
    />
  );
}

function RegressionTable({ r }: { r: NormalizedRegression }) {
  return (
    <KeyValueTable
      testid="results-regression-table"
      rows={[
        { label: "Slope", value: num(r.slope, 4) },
        { label: "Slope SE", value: num(r.slopeSE, 4) },
        { label: "95% CI of slope", value: ciText(r.slopeCI95) },
        { label: "Intercept", value: num(r.intercept, 4) },
        { label: "Intercept SE", value: num(r.interceptSE, 4) },
        { label: "95% CI of intercept", value: ciText(r.interceptCI95) },
        { label: "R-squared", value: num(r.rSquared, 4) },
        { label: "Residual SE", value: num(r.residualSE, 4) },
        { label: "Pairs (n)", value: num(r.n, 0) },
      ]}
    />
  );
}

function TwoWayAnovaStatsTable({ r }: { r: NormalizedTwoWayAnova }) {
  return (
    <>
      <table
        className="w-full border-collapse text-body tabular-nums"
        data-testid="results-twoway-table"
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
                {row.f === null ? "" : num(row.f, 2)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {row.pValue === null ? "" : formatP(row.pValue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-meta text-foreground-muted">
        Factor A is the row label, Factor B is the column group, and the
        interaction tests whether the effect of one depends on the other.
      </p>
    </>
  );
}

function SurvivalTables({ r }: { r: NormalizedSurvival }) {
  const medianText = (m: number | null) => (m === null ? "not reached" : num(m, 1));
  return (
    <>
      <table
        className="mt-4 w-full max-w-lg border-collapse text-body tabular-nums"
        data-testid="results-survival-table"
      >
        <thead>
          <tr className="text-meta uppercase tracking-wide text-foreground-muted">
            <th className="border-b border-border px-3 py-1.5 text-left">Group</th>
            <th className="border-b border-border px-3 py-1.5 text-right">Subjects</th>
            <th className="border-b border-border px-3 py-1.5 text-right">Events</th>
            <th className="border-b border-border px-3 py-1.5 text-right">
              Median survival
            </th>
          </tr>
        </thead>
        <tbody>
          {r.groups.map((g) => (
            <tr key={g.name}>
              <td className="border-b border-border px-3 py-1.5 text-foreground">
                {g.name}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {g.n}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {g.events}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {medianText(g.median)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {r.logRank && (
        <table
          className="mt-4 w-full max-w-md border-collapse text-body tabular-nums"
          data-testid="results-logrank-table"
        >
          <tbody>
            <tr>
              <td className="border-b border-border px-3 py-1.5 text-foreground-muted">
                Log-rank chi-square
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right text-foreground">
                {num(r.logRank.chiSquare)}
              </td>
            </tr>
            <tr>
              <td className="border-b border-border px-3 py-1.5 text-foreground-muted">
                df
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right text-foreground">
                {r.logRank.df}
              </td>
            </tr>
            <tr>
              <td className="border-b border-border px-3 py-1.5 text-foreground-muted">
                p
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right text-foreground">
                {formatP(r.logRank.pValue)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <p className="mt-2 max-w-xl text-meta text-foreground-muted">
        Median survival is the time the survival curve crosses 50 percent. The
        log-rank test compares the whole curves, not just the medians.
      </p>
    </>
  );
}

/**
 * The result tabs for one normalized result. Only tabs that actually have
 * content are returned, so a t-test shows a single "Tabular results" tab while a
 * one-way ANOVA splits into the ANOVA table and (when there are pairs) Multiple
 * comparisons. This mirrors the way Prism subpages a result, instead of stacking
 * every table down the page.
 */
function resultTabs(result: NormalizedResult): {
  id: string;
  label: string;
  render: () => React.ReactNode;
}[] {
  switch (result.kind) {
    case "anova": {
      const tabs = [
        {
          id: "anova",
          label: "ANOVA table",
          render: () => <AnovaStatsTable r={result} />,
        },
      ];
      if (result.comparisons.length > 0) {
        tabs.push({
          id: "comparisons",
          label: "Multiple comparisons",
          render: () => (
            <ComparisonsTable
              comparisons={result.comparisons}
              testid="results-tukey-table"
            />
          ),
        });
      }
      return tabs;
    }
    case "twoWayAnova": {
      const tabs = [
        {
          id: "anova",
          label: "ANOVA table",
          render: () => <TwoWayAnovaStatsTable r={result} />,
        },
      ];
      if (result.comparisons.length > 0) {
        tabs.push({
          id: "comparisons",
          label: "Multiple comparisons",
          render: () => (
            <ComparisonsTable
              comparisons={result.comparisons}
              testid="results-twoway-tukey-table"
            />
          ),
        });
      }
      return tabs;
    }
    case "survival":
      return [
        {
          id: "survival",
          label: "Survival table",
          render: () => <SurvivalTables r={result} />,
        },
      ];
    case "correlation":
      return [
        {
          id: "tabular",
          label: "Tabular results",
          render: () => <CorrelationTable r={result} />,
        },
      ];
    case "regression":
      return [
        {
          id: "tabular",
          label: "Tabular results",
          render: () => <RegressionTable r={result} />,
        },
      ];
    default:
      return [
        {
          id: "tabular",
          label: "Tabular results",
          render: () => <TTestTable r={result} />,
        },
      ];
  }
}

export default function ResultsSheet({
  spec,
  content,
  title,
  onNewAnalysis,
  onGraphResult,
  onChangeAnalysis,
}: {
  spec: AnalysisSpec;
  content: DataHubDocContent;
  /** The analysis's display title (from the rail). */
  title: string;
  /** Open the chooser to run another analysis on this same table. */
  onNewAnalysis?: () => void;
  /** Turn this result into a figure (opens the New graph dialog on the table). */
  onGraphResult?: () => void;
  /** Re-pick the test (opens the chooser). Full parameter editing is a later
   *  phase, so for now this swaps the chosen analysis. */
  onChangeAnalysis?: () => void;
}) {
  const [showingCode, setShowingCode] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  // Transient "Copied" flash for the Export action.
  const [copied, setCopied] = useState(false);

  // Always recompute from the live content so an edit to a replicate is
  // reflected. The page restamps the stored cache separately.
  const outcome = useMemo(() => runAnalysis(spec, content), [spec, content]);

  const tabs = useMemo(
    () => (outcome.ok ? resultTabs(outcome) : []),
    [outcome],
  );
  // Clamp the active tab so a data edit that drops a tab (e.g. comparisons
  // disappearing) never strands the selection past the end of the list.
  const safeTab = Math.min(activeTab, Math.max(tabs.length - 1, 0));

  // Copy the visible result tables as tab-separated text, the same data the
  // tables show. Pastes cleanly into a spreadsheet or a note.
  const handleExport = async () => {
    if (!outcome.ok) return;
    try {
      await navigator.clipboard.writeText(resultToText(outcome));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const toolbarGroups: ToolbarGroup[] = [
    [
      ...(onNewAnalysis
        ? [
            {
              icon: "plus" as const,
              label: "New analysis",
              onClick: onNewAnalysis,
              tooltip: "Run another test on this same table.",
              testId: "datahub-results-new-analysis",
            },
          ]
        : []),
      ...(onGraphResult
        ? [
            {
              icon: "chart" as const,
              label: "Graph this result",
              onClick: onGraphResult,
              tooltip: "Make a figure, with the significance bars from this test.",
              testId: "datahub-results-graph",
            },
          ]
        : []),
    ],
    [
      {
        icon: "copy" as const,
        label: copied ? "Copied" : "Export",
        onClick: handleExport,
        tooltip: "Copy the results as text to paste into a spreadsheet or note.",
        testId: "datahub-results-export",
      },
      ...(onChangeAnalysis
        ? [
            {
              icon: "refresh" as const,
              label: "Change analysis",
              onClick: onChangeAnalysis,
              tooltip: "Re-pick the test. Editing the test options comes later.",
              testId: "datahub-results-change",
            },
          ]
        : []),
    ],
  ];

  if (!outcome.ok) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="datahub-results-sheet">
        <WorkspaceToolbar testId="datahub-results-toolbar" groups={toolbarGroups} />
        <div className="min-h-0 flex-1 overflow-auto px-5 pb-5 pt-4">
          <h1 className="text-title font-semibold text-foreground">{title}</h1>
          <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground-muted">
            This analysis cannot run on the current table. {outcome.error}
          </p>
        </div>
      </div>
    );
  }

  const result: NormalizedResult = outcome;
  const code = showCode(result);
  const current = tabs[safeTab];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="datahub-results-sheet">
      <WorkspaceToolbar testId="datahub-results-toolbar" groups={toolbarGroups} />

      <div className="min-h-0 flex-1 overflow-auto px-5 pb-5 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-title font-semibold text-foreground">{title}</h1>
          <Tooltip label="The result recomputes whenever you change a number in the table, so it never falls out of date.">
            <span
              className="flex items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent"
              data-testid="results-live-cue"
            >
              <Icon name="refresh" className="h-3 w-3" />
              Updates live from the table
            </span>
          </Tooltip>
        </div>

        <div
          className="mt-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-body text-foreground"
          data-testid="results-verdict"
        >
          {plainLanguageSummary(result)}
        </div>

        {/* Underline tab row (mockup style). Only tabs with content render, so a
            simple test shows a single tab and never an empty subpage. */}
        <div
          className="mt-4 flex gap-1 border-b border-border"
          role="tablist"
          data-testid="results-tabs"
        >
          {tabs.map((tab, i) => {
            const on = i === safeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActiveTab(i)}
                data-testid={`results-tab-${tab.id}`}
                className={`-mb-px border-b-2 px-3 py-2 text-meta font-semibold transition-colors ${
                  on
                    ? "border-accent text-accent"
                    : "border-transparent text-foreground-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4">{current ? current.render() : null}</div>

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
    </div>
  );
}
