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

import { useEffect, useMemo, useState } from "react";
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
  type NormalizedDoseResponse,
  type NormalizedGlobalFit,
  type NormalizedLogisticRegression,
  type NormalizedMultipleRegression,
  type NormalizedModelComparison,
  type NormalizedRegression,
  type NormalizedResult,
  type NormalizedRmAnova,
  type NormalizedMixedModel,
  type NormalizedSurvival,
  type NormalizedCoxRegression,
  type NormalizedTTest,
  type NormalizedTwoWayAnova,
} from "@/lib/datahub/run-analysis";
import { formatP, plainLanguageSummary } from "@/lib/datahub/plain-language";
import { showCode } from "@/lib/datahub/show-code";
import { chainCode, type ContentResolver } from "@/lib/datahub/chain-code";
import { resultToText } from "@/lib/datahub/result-text";
import CodePanel from "@/components/datahub/CodePanel";
import StyledSelect from "@/components/datahub/StyledSelect";
import {
  paramSchema,
  readParams,
  type ParamField,
} from "@/lib/datahub/analysis-params";

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
      {r.effectSize ? <AnovaEffectSizeTable es={r.effectSize} /> : null}
    </>
  );
}

/**
 * Omnibus effect size for an ANOVA / Kruskal-Wallis. eta-squared (or
 * epsilon-squared for the rank test) is the share of variance the grouping
 * explains, so the reader sees how big the difference is, not just whether it is
 * significant. omega-squared and the CI appear only when defined.
 */
function AnovaEffectSizeTable({ es }: { es: NormalizedAnova["effectSize"] }) {
  if (!es) return null;
  const rows: { label: string; value: string }[] = [
    { label: es.label, value: num(es.etaSquared, 3) },
  ];
  if (es.etaSquaredCI95) {
    rows.push({ label: `95% CI of ${es.label}`, value: ciText(es.etaSquaredCI95) });
  }
  if (es.omegaSquared !== null && Number.isFinite(es.omegaSquared)) {
    rows.push({ label: "omega-squared", value: num(es.omegaSquared, 3) });
  }
  return <KeyValueTable rows={rows} testid="results-anova-effectsize-table" />;
}

/**
 * One-way repeated-measures ANOVA table. The condition row carries the F and the
 * uncorrected p; below the table the sphericity corrections (Greenhouse-Geisser
 * and Huynh-Feldt epsilon + corrected p) and partial eta-squared are shown, so a
 * sphericity violation does not quietly change the verdict.
 */
function RmAnovaStatsTable({ r }: { r: NormalizedRmAnova }) {
  const esRows: { label: string; value: string }[] = [
    { label: "Partial eta-squared", value: num(r.partialEtaSquared, 3) },
    {
      label: "Greenhouse-Geisser epsilon",
      value: num(r.greenhouseGeisserEpsilon, 3),
    },
    {
      label: "p (Greenhouse-Geisser)",
      value: formatP(r.pGreenhouseGeisser),
    },
    { label: "Huynh-Feldt epsilon", value: num(r.huynhFeldtEpsilon, 3) },
    { label: "p (Huynh-Feldt)", value: formatP(r.pHuynhFeldt) },
  ];
  return (
    <>
      <table
        className="w-full border-collapse text-body tabular-nums"
        data-testid="results-rmanova-table"
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
        Each row is one subject measured under every condition. The condition row
        carries the effect F and its uncorrected p. The Greenhouse-Geisser and
        Huynh-Feldt corrections below adjust the p when the sphericity assumption
        (equal variances of the pairwise condition differences) is in doubt.
      </p>
      <KeyValueTable rows={esRows} testid="results-rmanova-corrections-table" />
    </>
  );
}

function MixedModelTable({ r }: { r: NormalizedMixedModel }) {
  const reference = r.conditionLabels[0];
  return (
    <>
      <table
        className="w-full border-collapse text-body tabular-nums"
        data-testid="results-mixed-model-table"
      >
        <thead>
          <tr className="text-meta uppercase tracking-wide text-foreground-muted">
            <th className="border-b border-border px-3 py-1.5 text-left">Term</th>
            <th className="border-b border-border px-3 py-1.5 text-right">Estimate</th>
            <th className="border-b border-border px-3 py-1.5 text-right">SE</th>
            <th className="border-b border-border px-3 py-1.5 text-right">z</th>
            <th className="border-b border-border px-3 py-1.5 text-right">p</th>
            <th className="border-b border-border px-3 py-1.5 text-right">95% CI</th>
          </tr>
        </thead>
        <tbody>
          {r.fixedEffects.map((c) => (
            <tr key={c.name}>
              <td className="border-b border-border px-3 py-1.5 text-foreground">
                {c.name}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(c.estimate, 4)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(c.standardError, 4)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(c.z, 3)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {formatP(c.pValue)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {ciText([c.ciLow, c.ciHigh])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <KeyValueTable
        testid="results-mixed-model-variance-table"
        rows={[
          {
            label: "Between-subject variance (sigma_u^2)",
            value: num(r.groupVariance, 4),
          },
          {
            label: "Residual variance (sigma_e^2)",
            value: num(r.residualVariance, 4),
          },
          { label: "REML log-likelihood", value: num(r.remlLogLikelihood, 3) },
          { label: "Subjects (groups)", value: num(r.subjects, 0) },
          { label: "Observations", value: num(r.observations, 0) },
        ]}
      />
      <p className="mt-2 max-w-xl text-meta text-foreground-muted">
        The intercept is the mean response in the reference condition (
        {reference}). Each other row is that condition minus the reference, with a
        Wald z, p, and 95% interval. The random intercept lets each subject have
        their own baseline, so the between-subject variance is the spread of those
        baselines and the residual variance is the leftover within-subject scatter.
        Fit by REML, the same method statsmodels MixedLM uses.
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
    // Distribution-free bootstrap CI of the difference, an additive robust
    // companion to the parametric CI above. Shown whenever the engine computed
    // one (the raw-data parametric t-tests). The label notes when normality
    // looked shaky, since that is exactly when this interval is the more honest
    // one to read.
    ...(r.bootstrapCI95
      ? [
          {
            label: r.normalityShaky
              ? "Bootstrap 95% CI of the difference (normality looks shaky, prefer this)"
              : "Bootstrap 95% CI of the difference",
            value: ciText(r.bootstrapCI95),
          },
        ]
      : []),
    { label: r.effectSizeLabel, value: num(r.effectSize) },
    // Standardized effect size CI plus Hedges' g. The rank tests report only the
    // rank-biserial r above (no parametric d / g / noncentral-t CI exists), so
    // these rows appear only for the parametric t tests.
    ...(r.effectSizeCI95
      ? [
          {
            label: `95% CI of ${r.effectSizeLabel}`,
            value: ciText(r.effectSizeCI95),
          },
        ]
      : []),
    ...(r.hedgesG !== null && Number.isFinite(r.hedgesG)
      ? [{ label: "Hedges' g", value: num(r.hedgesG) }]
      : []),
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
        { label: "R-squared", value: num(r.rSquared, 3) },
        { label: "95% CI of R-squared", value: ciText(r.rSquaredCI95) },
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

function LogisticRegressionTable({
  r,
}: {
  r: NormalizedLogisticRegression;
}) {
  return (
    <>
      <table
        className="w-full border-collapse text-body tabular-nums"
        data-testid="results-logistic-coefficients-table"
      >
        <thead>
          <tr className="text-meta uppercase tracking-wide text-foreground-muted">
            <th className="border-b border-border px-3 py-1.5 text-left">Term</th>
            <th className="border-b border-border px-3 py-1.5 text-right">Estimate</th>
            <th className="border-b border-border px-3 py-1.5 text-right">SE</th>
            <th className="border-b border-border px-3 py-1.5 text-right">z</th>
            <th className="border-b border-border px-3 py-1.5 text-right">p</th>
            <th className="border-b border-border px-3 py-1.5 text-right">95% CI</th>
          </tr>
        </thead>
        <tbody>
          {[r.intercept, r.slope].map((c) => (
            <tr key={c.name}>
              <td className="border-b border-border px-3 py-1.5 text-foreground">
                {c.name === "Intercept" ? "Intercept" : `Slope (${c.name})`}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(c.estimate, 4)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(c.standardError, 4)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(c.z, 3)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {formatP(c.pValue)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {ciText(c.ci95)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <KeyValueTable
        testid="results-logistic-fit-table"
        rows={[
          { label: "Odds ratio (per unit X)", value: num(r.oddsRatio, 4) },
          { label: "95% CI of odds ratio", value: ciText(r.oddsRatioCI95) },
          { label: "X at P=0.5", value: num(r.xAtHalf, 4) },
          { label: "McFadden pseudo-R-squared", value: num(r.mcFaddenR2, 4) },
          { label: "Log-likelihood", value: num(r.logLikelihood, 3) },
          { label: "Null log-likelihood", value: num(r.nullLogLikelihood, 3) },
          {
            label: "ROC AUC",
            value: Number.isFinite(r.auc) ? num(r.auc, 4) : "-",
          },
          { label: "Iterations", value: num(r.iterations, 0) },
          { label: "Rows (n)", value: num(r.n, 0) },
        ]}
      />
      <p className="mt-2 max-w-xl text-meta text-foreground-muted">
        The odds ratio is exp(slope), the multiplicative change in the odds of
        Y=1 for each one-unit rise in X. An odds ratio of 1 means X carries no
        information. X at P=0.5 is the value where the model predicts an even
        chance, the dose-response style midpoint.
      </p>
    </>
  );
}

function MultipleRegressionTable({
  r,
}: {
  r: NormalizedMultipleRegression;
}) {
  return (
    <>
      <table
        className="w-full border-collapse text-body tabular-nums"
        data-testid="results-multiple-regression-coefficients-table"
      >
        <thead>
          <tr className="text-meta uppercase tracking-wide text-foreground-muted">
            <th className="border-b border-border px-3 py-1.5 text-left">Term</th>
            <th className="border-b border-border px-3 py-1.5 text-right">Estimate</th>
            <th className="border-b border-border px-3 py-1.5 text-right">SE</th>
            <th className="border-b border-border px-3 py-1.5 text-right">t</th>
            <th className="border-b border-border px-3 py-1.5 text-right">p</th>
            <th className="border-b border-border px-3 py-1.5 text-right">95% CI</th>
            <th className="border-b border-border px-3 py-1.5 text-right">Std. beta</th>
            <th className="border-b border-border px-3 py-1.5 text-right">VIF</th>
          </tr>
        </thead>
        <tbody>
          {r.coefficients.map((c) => (
            <tr key={c.name}>
              <td className="border-b border-border px-3 py-1.5 text-foreground">
                {c.name}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(c.estimate, 4)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(c.standardError, 4)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(c.t, 3)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {formatP(c.pValue)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {ciText(c.ci95)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {Number.isFinite(c.standardizedBeta)
                  ? num(c.standardizedBeta, 3)
                  : "-"}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {Number.isFinite(c.vif) ? num(c.vif, 2) : "inf"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <KeyValueTable
        testid="results-multiple-regression-fit-table"
        rows={[
          { label: "R-squared", value: num(r.rSquared, 4) },
          { label: "Adjusted R-squared", value: num(r.adjRSquared, 4) },
          { label: "Residual SE (sigma)", value: num(r.residualSE, 4) },
          {
            label: `Overall F (${r.fDfNum}, ${r.fDfDen})`,
            value: num(r.fStatistic, 3),
          },
          { label: "Overall F p", value: formatP(r.fPValue) },
          { label: "Log-likelihood", value: num(r.logLikelihood, 3) },
          { label: "Predictors (k)", value: num(r.nPredictors, 0) },
          { label: "Rows (n)", value: num(r.n, 0) },
        ]}
      />
      <p className="mt-2 max-w-xl text-meta text-foreground-muted">
        Each slope is the change in {r.yName} for a one-unit rise in that
        predictor while the others are held constant. The standardized beta puts
        the slopes on a common scale for comparison. VIF flags
        multicollinearity, where a value above about 5 to 10 means a predictor is
        largely explained by the others, which inflates its standard error.
      </p>
    </>
  );
}

/**
 * Format a concentration (EC50 and friends) compactly. A dose can span many
 * orders of magnitude, so we use scientific notation outside a comfortable
 * fixed-point band and trim the readable middle to 4 significant figures.
 */
function conc(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "-";
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-3 || a >= 1e4)) return x.toExponential(3);
  return Number(x.toPrecision(4)).toString();
}

/** A concentration CI rendered "a to b" with the same compact formatting. */
function concCI(ci: [number, number] | null | undefined): string {
  if (!ci || !Number.isFinite(ci[0]) || !Number.isFinite(ci[1])) return "-";
  return `${conc(ci[0])} to ${conc(ci[1])}`;
}

function DoseResponseTable({ r }: { r: NormalizedDoseResponse }) {
  const rows = [
    { label: "Model", value: r.modelLabel },
    { label: "EC50 / IC50", value: conc(r.ec50) },
    { label: "95% CI of EC50", value: concCI(r.ec50CI95) },
    { label: "Hill slope", value: num(r.hillSlope.value, 3) },
    { label: "95% CI of Hill slope", value: ciText(r.hillSlope.ci95) },
    { label: "Top", value: num(r.top.value, 3) },
    { label: "95% CI of Top", value: ciText(r.top.ci95) },
    { label: "Bottom", value: num(r.bottom.value, 3) },
    { label: "95% CI of Bottom", value: ciText(r.bottom.ci95) },
  ];
  if (r.asymmetryS) {
    rows.push({ label: "Asymmetry (S)", value: num(r.asymmetryS.value, 3) });
    rows.push({ label: "95% CI of S", value: ciText(r.asymmetryS.ci95) });
  }
  rows.push({ label: "R-squared", value: num(r.rSquared, 4) });
  rows.push({ label: "Points (n)", value: num(r.n, 0) });
  return (
    <>
      <KeyValueTable testid="results-dose-response-table" rows={rows} />
      <p className="mt-2 max-w-xl text-meta text-foreground-muted">
        The EC50 (the IC50 for an inhibition curve) is the dose at the
        half-maximal response, fit on log(dose). Its confidence interval is
        asymmetric in dose units because the fit is symmetric in log space.
      </p>
    </>
  );
}

function ModelComparisonTable({ r }: { r: NormalizedModelComparison }) {
  const lines = [r.simpler, r.complex];
  return (
    <>
      <table
        className="w-full border-collapse text-body tabular-nums"
        data-testid="results-model-comparison-table"
      >
        <thead>
          <tr className="text-meta uppercase tracking-wide text-foreground-muted">
            <th className="border-b border-border px-3 py-1.5 text-left">Model</th>
            <th className="border-b border-border px-3 py-1.5 text-right">Params</th>
            <th className="border-b border-border px-3 py-1.5 text-right">SS</th>
            <th className="border-b border-border px-3 py-1.5 text-right">R-squared</th>
            <th className="border-b border-border px-3 py-1.5 text-right">AICc</th>
            <th className="border-b border-border px-3 py-1.5 text-right">AICc delta</th>
            <th className="border-b border-border px-3 py-1.5 text-right">Probability</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((m) => {
            const preferred = m.id === r.aicc.preferredId;
            return (
              <tr key={m.id} className={preferred ? "bg-accent-soft" : ""}>
                <td className="border-b border-border px-3 py-1.5 text-foreground">
                  {m.label}
                  {preferred ? " (preferred)" : ""}
                </td>
                <td className="border-b border-border px-3 py-1.5 text-right">
                  {m.nParams}
                </td>
                <td className="border-b border-border px-3 py-1.5 text-right">
                  {num(m.ssr, 3)}
                </td>
                <td className="border-b border-border px-3 py-1.5 text-right">
                  {num(m.rSquared, 4)}
                </td>
                <td className="border-b border-border px-3 py-1.5 text-right">
                  {num(m.aicc, 2)}
                </td>
                <td className="border-b border-border px-3 py-1.5 text-right">
                  {num(m.aiccDelta, 2)}
                </td>
                <td className="border-b border-border px-3 py-1.5 text-right">
                  {num(m.aiccProbability, 4)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <KeyValueTable
        testid="results-model-comparison-verdict"
        rows={[
          { label: "AICc prefers", value: r.aicc.preferredLabel },
          {
            label: "Evidence ratio",
            value: Number.isFinite(r.aicc.evidenceRatio)
              ? `${num(r.aicc.evidenceRatio, 2)} x`
              : "-",
          },
          ...(r.fTest
            ? [
                {
                  label: "Extra-sum-of-squares F",
                  value: `F(${r.fTest.dfNumerator}, ${r.fTest.dfDenominator}) = ${num(
                    r.fTest.f,
                    3,
                  )}`,
                },
                { label: "F-test p", value: formatP(r.fTest.pValue) },
                { label: "F-test prefers", value: r.fTest.preferredLabel },
              ]
            : [{ label: "F test", value: "not nested, AICc only" }]),
          { label: "Points (n)", value: num(r.n, 0) },
        ]}
      />
      <p className="mt-2 max-w-xl text-meta text-foreground-muted">
        The lower AICc is preferred, and the probabilities say how likely each
        model is the better description. For nested models the
        extra-sum-of-squares F test says whether the extra parameters earn their
        keep at alpha 0.05.
      </p>
    </>
  );
}

function GlobalFitTable({ r }: { r: NormalizedGlobalFit }) {
  return (
    <>
      <KeyValueTable
        testid="results-global-fit-model"
        rows={[{ label: "Model", value: r.modelLabel }]}
      />
      {/* Shared parameters: one fitted value + CI for every curve. */}
      <table
        className="mt-4 w-full max-w-md border-collapse text-body tabular-nums"
        data-testid="results-global-fit-shared-table"
      >
        <thead>
          <tr className="text-meta uppercase tracking-wide text-foreground-muted">
            <th className="border-b border-border px-3 py-1.5 text-left">
              Shared parameter
            </th>
            <th className="border-b border-border px-3 py-1.5 text-right">
              Value
            </th>
            <th className="border-b border-border px-3 py-1.5 text-right">
              95% CI
            </th>
          </tr>
        </thead>
        <tbody>
          {r.sharedParams.map((p) => (
            <tr key={p.name}>
              <td className="border-b border-border px-3 py-1.5 text-foreground">
                {p.name}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(p.value, 3)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {ciText(p.ci95)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Local EC50 per curve: the readout the global fit exists to compare. */}
      <table
        className="mt-4 w-full border-collapse text-body tabular-nums"
        data-testid="results-global-fit-local-table"
      >
        <thead>
          <tr className="text-meta uppercase tracking-wide text-foreground-muted">
            <th className="border-b border-border px-3 py-1.5 text-left">
              Curve
            </th>
            <th className="border-b border-border px-3 py-1.5 text-right">
              EC50 / IC50
            </th>
            <th className="border-b border-border px-3 py-1.5 text-right">
              95% CI of EC50
            </th>
          </tr>
        </thead>
        <tbody>
          {r.localParams.map((lp) => (
            <tr key={lp.datasetLabel}>
              <td className="border-b border-border px-3 py-1.5 text-foreground">
                {lp.datasetLabel}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {conc(lp.ec50)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {concCI(lp.ec50CI95)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <KeyValueTable
        testid="results-global-fit-stats"
        rows={[
          { label: "Global R-squared", value: num(r.rSquared, 4) },
          { label: "Total residual SS", value: num(r.ssrTotal, 3) },
          { label: "Datasets", value: num(r.nDatasets, 0) },
          { label: "Total points", value: num(r.nTotal, 0) },
          { label: "Total parameters", value: num(r.nParams, 0) },
        ]}
      />
      <p className="mt-2 max-w-xl text-meta text-foreground-muted">
        One curve shape is fit to every dataset at once. The shared parameters
        take a single value across all curves while each curve keeps its own
        EC50, so the EC50s are directly comparable. The global R-squared pools
        every point of every curve about one mean.
      </p>
    </>
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

      {r.gehanBreslowWilcoxon && (
        <table
          className="mt-4 w-full max-w-md border-collapse text-body tabular-nums"
          data-testid="results-gehan-table"
        >
          <tbody>
            <tr>
              <td className="border-b border-border px-3 py-1.5 text-foreground-muted">
                Gehan-Breslow-Wilcoxon chi-square
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right text-foreground">
                {num(r.gehanBreslowWilcoxon.chiSquare)}
              </td>
            </tr>
            <tr>
              <td className="border-b border-border px-3 py-1.5 text-foreground-muted">
                df
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right text-foreground">
                {r.gehanBreslowWilcoxon.df}
              </td>
            </tr>
            <tr>
              <td className="border-b border-border px-3 py-1.5 text-foreground-muted">
                p
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right text-foreground">
                {formatP(r.gehanBreslowWilcoxon.pValue)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <p className="mt-2 max-w-xl text-meta text-foreground-muted">
        Median survival is the time the survival curve crosses 50 percent. The
        log-rank test compares the whole curves, not just the medians. The
        Gehan-Breslow-Wilcoxon test is the same comparison with more weight on
        early time points, so it is more sensitive to early differences.
      </p>
    </>
  );
}

function CoxRegressionTable({ r }: { r: NormalizedCoxRegression }) {
  return (
    <>
      <table
        className="w-full border-collapse text-body tabular-nums"
        data-testid="results-cox-coefficients-table"
      >
        <thead>
          <tr className="text-meta uppercase tracking-wide text-foreground-muted">
            <th className="border-b border-border px-3 py-1.5 text-left">Term</th>
            <th className="border-b border-border px-3 py-1.5 text-right">Coef</th>
            <th className="border-b border-border px-3 py-1.5 text-right">SE</th>
            <th className="border-b border-border px-3 py-1.5 text-right">z</th>
            <th className="border-b border-border px-3 py-1.5 text-right">p</th>
            <th className="border-b border-border px-3 py-1.5 text-right">
              Hazard ratio
            </th>
            <th className="border-b border-border px-3 py-1.5 text-right">95% CI</th>
          </tr>
        </thead>
        <tbody>
          {r.coefficients.map((c) => (
            <tr key={c.name}>
              <td className="border-b border-border px-3 py-1.5 text-foreground">
                {c.name}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(c.coef, 4)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(c.se, 4)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(c.z, 3)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {formatP(c.pValue)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(c.hazardRatio, 4)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {`${num(c.hrCiLow, 3)} to ${num(c.hrCiHigh, 3)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <KeyValueTable
        testid="results-cox-fit-table"
        rows={[
          { label: "Concordance", value: num(r.concordance, 4) },
          { label: "Log-likelihood", value: num(r.logLikelihood, 3) },
          { label: "Null log-likelihood", value: num(r.nullLogLikelihood, 3) },
          {
            label: "Likelihood-ratio chi-square",
            value: `${num(r.lrChiSquare, 3)} (df ${r.lrDf})`,
          },
          { label: "Likelihood-ratio p", value: formatP(r.lrPValue) },
          { label: "Events", value: num(r.events, 0) },
          { label: "Rows (n)", value: num(r.n, 0) },
        ]}
      />
      <p className="mt-2 max-w-xl text-meta text-foreground-muted">
        The hazard ratio is exp(coef), the relative rate of the event for the
        comparison arm versus the reference. A ratio above 1 means a higher
        hazard, below 1 a lower one, and a ratio of 1 means no difference.
        Concordance is the share of comparable subject pairs the model ranks in
        the right order, where 0.5 is a coin flip and 1 is perfect.
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
    case "rmAnova":
      return [
        {
          id: "anova",
          label: "ANOVA table",
          render: () => <RmAnovaStatsTable r={result} />,
        },
      ];
    case "mixedModel":
      return [
        {
          id: "tabular",
          label: "Tabular results",
          render: () => <MixedModelTable r={result} />,
        },
      ];
    case "survival":
      return [
        {
          id: "survival",
          label: "Survival table",
          render: () => <SurvivalTables r={result} />,
        },
      ];
    case "coxRegression":
      return [
        {
          id: "tabular",
          label: "Tabular results",
          render: () => <CoxRegressionTable r={result} />,
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
    case "logisticRegression":
      return [
        {
          id: "tabular",
          label: "Tabular results",
          render: () => <LogisticRegressionTable r={result} />,
        },
      ];
    case "multipleRegression":
      return [
        {
          id: "tabular",
          label: "Tabular results",
          render: () => <MultipleRegressionTable r={result} />,
        },
      ];
    case "doseResponse":
      return [
        {
          id: "tabular",
          label: "Tabular results",
          render: () => <DoseResponseTable r={result} />,
        },
      ];
    case "modelComparison":
      return [
        {
          id: "tabular",
          label: "Tabular results",
          render: () => <ModelComparisonTable r={result} />,
        },
      ];
    case "globalFit":
      return [
        {
          id: "tabular",
          label: "Tabular results",
          render: () => <GlobalFitTable r={result} />,
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

/**
 * A two-or-three-way segmented control (the Seg idiom from the graph editor),
 * used for the short option sets (Tail, Variance) where every choice should be
 * visible at a glance rather than hidden behind a dropdown.
 */
function Seg({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border border-border"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`px-2.5 py-1 text-meta font-medium transition-colors ${
              i > 0 ? "border-l border-border" : ""
            } ${
              active
                ? "bg-accent-soft text-accent"
                : "bg-surface-raised text-foreground-muted hover:bg-surface-sunken"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** One labeled parameter row: the control plus its why-line underneath. */
function ParamRow({
  field,
  value,
  onChange,
}: {
  field: ParamField;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div data-testid={`results-param-${field.key}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-meta font-semibold text-foreground">
          {field.label}
        </span>
        {field.control === "seg" ? (
          <Seg
            value={value}
            options={field.options}
            onChange={onChange}
            ariaLabel={field.label}
          />
        ) : (
          <StyledSelect
            value={value}
            options={field.options}
            onChange={onChange}
            ariaLabel={field.label}
            className="min-w-[11rem]"
          />
        )}
      </div>
      <p className="mt-1 max-w-xl text-[11px] leading-snug text-foreground-muted">
        {field.why}
      </p>
    </div>
  );
}

/**
 * The inline parameters editor. Renders the schema for the current analysis
 * type as controls; an edit re-runs the result live (the sheet recomputes on
 * the next render), so there is no Apply button and never a soft-lock. A subtle
 * cue states that edits re-run live, the same promise the data-link cue makes.
 */
function ParametersPanel({
  spec,
  fields,
  onParamChange,
}: {
  spec: AnalysisSpec;
  fields: ParamField[];
  onParamChange: (key: string, value: string) => void;
}) {
  const values = readParams(spec);
  return (
    <div
      className="rounded-lg border border-border bg-surface-raised"
      data-testid="results-params-panel"
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-sunken px-3.5 py-2">
        <Icon name="gauge" className="h-3 w-3 text-foreground" />
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-foreground">
          Test options
        </h3>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-foreground-muted">
          <Icon name="refresh" className="h-3 w-3" />
          Edits re-run live
        </span>
      </div>
      <div className="flex flex-col gap-3.5 px-3.5 py-3">
        {fields.map((field) => (
          <ParamRow
            key={field.key}
            field={field}
            value={values[field.key]}
            onChange={(v) => onParamChange(field.key, v)}
          />
        ))}
      </div>
    </div>
  );
}

export default function ResultsSheet({
  spec,
  content,
  title,
  onNewAnalysis,
  onGraphResult,
  onChangeAnalysis,
  onParamChange,
  resolveContent,
}: {
  spec: AnalysisSpec;
  content: DataHubDocContent;
  /** The analysis's display title (from the rail). */
  title: string;
  /**
   * Resolve any table's raw stored content by id, so the Code export can walk
   * this analysis's source-table lineage and emit the WHOLE chain (base table
   * to transforms to this analysis). When absent, the Code panel falls back to
   * the single-step analysis snippet (the pre-lineage behavior).
   */
  resolveContent?: ContentResolver;
  /** Open the chooser to run another analysis on this same table. */
  onNewAnalysis?: () => void;
  /** Turn this result into a figure (opens the New graph dialog on the table). */
  onGraphResult?: () => void;
  /** Re-pick the test (opens the chooser), a different move than editing the
   *  current test's options. */
  onChangeAnalysis?: () => void;
  /** Persist one editable parameter (tail, variance, post-hoc) and re-run. When
   *  absent, the Parameters affordance is hidden. */
  onParamChange?: (key: string, value: string) => void;
}) {
  const [showingCode, setShowingCode] = useState(false);
  const [showingParams, setShowingParams] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  // Transient "Copied" flash for the Export action.
  const [copied, setCopied] = useState(false);

  // The editable options for this analysis type. Some types (correlation,
  // regression, Kruskal-Wallis) have none, in which case the Parameters
  // affordance is hidden rather than opening an empty panel.
  const paramFields = paramSchema(spec.type);
  const canEditParams = Boolean(onParamChange) && paramFields.length > 0;

  // Always recompute from the live content so an edit to a replicate is
  // reflected. The page restamps the stored cache separately.
  const outcome = useMemo(() => runAnalysis(spec, content), [spec, content]);

  // The lineage-aware Code export: the whole chain from the source table's base
  // data through every transform to this analysis. It is async (it resolves the
  // source tables by id), so it is computed into state when the Code panel is
  // open and the inputs change. Without a resolver we fall back to the single
  // analysis snippet (the pre-lineage behavior, still correct).
  const [chainSource, setChainSource] = useState<string>("");
  useEffect(() => {
    if (!showingCode) return;
    if (!resolveContent) {
      setChainSource(outcome.ok ? showCode(outcome) : "");
      return;
    }
    let active = true;
    void chainCode(
      { kind: "analysis", tableId: content.meta.id, content, analysis: spec },
      resolveContent,
    ).then((code) => {
      if (active) setChainSource(code);
    });
    return () => {
      active = false;
    };
  }, [showingCode, resolveContent, spec, content, outcome]);

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
              primary: true,
              tooltip: "Make a figure, with the significance bars from this test.",
              testId: "datahub-results-graph",
            },
          ]
        : []),
    ],
    [
      ...(canEditParams
        ? [
            {
              icon: "gauge" as const,
              label: showingParams ? "Hide options" : "Test options",
              onClick: () => setShowingParams((v) => !v),
              tooltip:
                "Change how this test runs, like a one-sided tail or the post-hoc family. The result re-runs as you edit.",
              testId: "datahub-results-params",
            },
          ]
        : []),
      {
        icon: "copy" as const,
        label: copied ? "Copied" : "Export",
        onClick: handleExport,
        tooltip: "Copy the results as text to paste into a spreadsheet or note.",
        testId: "datahub-results-export",
      },
      {
        icon: "file" as const,
        label: showingCode ? "Hide code" : "Code",
        onClick: () => setShowingCode((v) => !v),
        tooltip:
          "Show the open-source code that reproduces this result, so you can rerun it in a notebook.",
        testId: "datahub-results-code",
      },
      ...(onChangeAnalysis
        ? [
            {
              icon: "refresh" as const,
              label: "Change analysis",
              onClick: onChangeAnalysis,
              tooltip:
                "Re-pick the test entirely. To tweak how the current test runs, use Test options.",
              testId: "datahub-results-change",
            },
          ]
        : []),
    ],
  ];

  // The parameters panel, rendered in both the success and the failure paths so
  // a researcher can always reach the options (and back out by hiding them);
  // never a soft-lock. onParamChange is guaranteed defined here by canEditParams.
  const paramsPanel =
    showingParams && canEditParams && onParamChange ? (
      <div className="mb-4" data-testid="results-params">
        <ParametersPanel
          spec={spec}
          fields={paramFields}
          onParamChange={onParamChange}
        />
      </div>
    ) : null;

  if (!outcome.ok) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="datahub-results-sheet">
        {/* Pinned header: title row above the toolbar, matching the data-table
            panel and GraphEditor layout. */}
        <div className="flex items-center gap-2 px-5 pb-2 pt-4">
          <h1 className="text-title font-semibold text-foreground">{title}</h1>
        </div>
        <WorkspaceToolbar testId="datahub-results-toolbar" groups={toolbarGroups} />
        <div className="min-h-0 flex-1 overflow-auto px-5 pb-5 pt-4">
          {paramsPanel}
          {outcome.needsRaw ? (
            // A summary table cannot run this test because the raw replicates are
            // not stored. Show a calm, specific explanation and the one move that
            // unblocks it (switch the table format), not a generic error.
            <div
              className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3.5 py-3 dark:border-amber-500/40 dark:bg-amber-500/10"
              data-testid="results-needs-raw"
            >
              <Icon
                name="alert"
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300"
              />
              <div>
                <p className="text-body font-medium text-foreground">
                  This test needs raw replicate values
                </p>
                <p className="mt-1 text-meta text-foreground-muted">
                  The table holds entered summary stats (mean, spread, n), which
                  support the unpaired t-test and the one-way ANOVA. A paired,
                  rank-based, correlation, or regression test needs the original
                  measurements. Switch the table to Replicates from its Format
                  control to run it.
                </p>
              </div>
            </div>
          ) : (
            <p className="rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground-muted">
              This analysis cannot run on the current table. {outcome.error}
            </p>
          )}
        </div>
      </div>
    );
  }

  const result: NormalizedResult = outcome;
  // The Code panel shows the lineage-aware chain (state, async). Until it
  // resolves, fall back to the single-step analysis snippet so the panel never
  // flashes empty.
  const code = chainSource || showCode(result);
  const current = tabs[safeTab];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="datahub-results-sheet">
      {/* Pinned header: title + live-link cue sit above the toolbar, matching
          the data-table panel (title row then toolbar) and GraphEditor layout.
          The cue is subtle -- no colored pill -- matching GraphEditor's treatment. */}
      <div className="flex items-center gap-2 px-5 pb-2 pt-4">
        <h1 className="text-title font-semibold text-foreground">{title}</h1>
        <Tooltip label="The result recomputes whenever you change a number in the table, so it never falls out of date.">
          <span
            className="inline-flex items-center gap-1 text-[11px] text-foreground-muted"
            data-testid="results-live-cue"
          >
            <Icon name="refresh" className="h-3 w-3" />
            Updates live from the table
          </span>
        </Tooltip>
      </div>

      <WorkspaceToolbar testId="datahub-results-toolbar" groups={toolbarGroups} />

      <div className="min-h-0 flex-1 overflow-auto px-5 pb-5 pt-4">
        {paramsPanel}
        <div
          className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-body text-foreground"
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

        {showingCode && (
          <div className="mt-5" data-testid="results-code">
            <CodePanel
              code={code}
              caption="This reproduces the result from the base table, loading the data and running every transform before the analysis, so you can paste it into a notebook and get the same numbers rather than trust a black box."
              testId="results-code-panel"
            />
          </div>
        )}
      </div>
    </div>
  );
}
