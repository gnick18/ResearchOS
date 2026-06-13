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
  type NormalizedRocAuc,
  type NormalizedMultipleRegression,
  type NormalizedModelComparison,
  type NormalizedRegression,
  type NormalizedResult,
  type NormalizedRmAnova,
  type NormalizedMixedModel,
  type NormalizedSurvival,
  type NormalizedCoxRegression,
  type NormalizedGrubbsOutlier,
  type NormalizedContingency,
  type NormalizedNestedTTest,
  type NormalizedNestedAnova,
  type NormalizedTTest,
  type NormalizedTwoWayAnova,
} from "@/lib/datahub/run-analysis";
import {
  formatP,
  plainLanguageSummary,
  workedExample,
  learnMoreTopic,
} from "@/lib/datahub/plain-language";
import Link from "next/link";
import { BeakerBotMark } from "@/components/animations/BeakerBotMark";
import { showCode } from "@/lib/datahub/show-code";
import { chainCode, type ContentResolver } from "@/lib/datahub/chain-code";
import { resultToText } from "@/lib/datahub/result-text";
import CodePanel from "@/components/datahub/CodePanel";
import StyledSelect from "@/components/datahub/StyledSelect";
import {
  paramSchema,
  resolveDynamicSchema,
  readParams,
  type ParamField,
} from "@/lib/datahub/analysis-params";
import { survivalGroups } from "@/lib/datahub/survival-table";

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

/**
 * Nested t-test table. The group contrast (the second group minus the first) is
 * the nested t-test, with its SE / z / p / 95% interval, plus the group means and
 * the two variance components. The verdict rests on the subgroups as the unit of
 * replication, so the technical replicates are not pseudo-replicated.
 */
function NestedTTestTable({ r }: { r: NormalizedNestedTTest }) {
  const [a, b] = r.groupNames;
  return (
    <>
      <KeyValueTable
        testid="results-nested-ttest-table"
        rows={[
          { label: `Mean (${a})`, value: num(r.groupMeans[0], 4) },
          { label: `Mean (${b})`, value: num(r.groupMeans[1], 4) },
          {
            label: `Difference (${b} minus ${a})`,
            value: num(r.estimate, 4),
          },
          { label: "Standard error", value: num(r.standardError, 4) },
          { label: "z", value: num(r.z, 3) },
          { label: "p", value: formatP(r.pValue) },
          { label: "95% CI of difference", value: ciText(r.ci95) },
        ]}
      />
      <KeyValueTable
        testid="results-nested-ttest-variance-table"
        rows={[
          {
            label: "Between-subgroup variance (sigma_u^2)",
            value: num(r.subgroupVariance, 4),
          },
          {
            label: "Within-subgroup variance (sigma_e^2)",
            value: num(r.residualVariance, 4),
          },
          { label: "REML log-likelihood", value: num(r.remlLogLikelihood, 3) },
          { label: "Subgroups", value: num(r.subgroups, 0) },
          { label: "Replicate observations", value: num(r.observations, 0) },
        ]}
      />
      <p className="mt-2 max-w-xl text-meta text-foreground-muted">
        The difference is tested by a random-intercept mixed model, so the
        subgroup-to-subgroup variation is accounted for and the technical
        replicates are not pseudo-replicated. The between-subgroup variance is the
        spread of subgroup baselines; the within-subgroup variance is the leftover
        scatter among replicates. Fit by REML, the same method statsmodels MixedLM
        uses.
      </p>
    </>
  );
}

/**
 * Nested one-way ANOVA table. The classic nested-ANOVA table (Groups, Subgroups
 * within groups, Replicates within subgroups) with the group F tested against the
 * subgroup-within-group mean square, plus the two variance components. A balanced
 * design uses the exact classic F; an unbalanced one falls back to the mixed model
 * (flagged below the table).
 */
function NestedAnovaTable({ r }: { r: NormalizedNestedAnova }) {
  return (
    <>
      <table
        className="w-full border-collapse text-body tabular-nums"
        data-testid="results-nested-anova-table"
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
                {Number.isFinite(row.ss) ? num(row.ss, 2) : "-"}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {row.df}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {Number.isFinite(row.ms) ? num(row.ms, 2) : "-"}
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
      <KeyValueTable
        testid="results-nested-anova-variance-table"
        rows={[
          {
            label: "Between-subgroup variance",
            value: num(r.subgroupVariance, 4),
          },
          {
            label: "Within-subgroup variance (residual)",
            value: num(r.residualVariance, 4),
          },
          { label: "Subgroups", value: num(r.subgroups, 0) },
          { label: "Replicate observations", value: num(r.observations, 0) },
        ]}
      />
      <p className="mt-2 max-w-xl text-meta text-foreground-muted">
        The group effect is tested against the subgroup-to-subgroup mean square,
        not the replicate scatter, so the technical replicates are not
        pseudo-replicated.{" "}
        {r.balanced
          ? "This balanced design uses the exact classic random-effects F."
          : "This unbalanced design falls back to a random-intercept mixed model, where the classic balanced F is not exact."}
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

function RocCurveTable({ r }: { r: NormalizedRocAuc }) {
  // The AUC band a clinician reads against (excellent / good / fair / poor).
  const band =
    r.auc >= 0.9
      ? "excellent"
      : r.auc >= 0.8
        ? "good"
        : r.auc >= 0.7
          ? "fair"
          : r.auc > 0.6
            ? "poor"
            : "near chance";
  return (
    <>
      <KeyValueTable
        testid="results-roc-summary-table"
        rows={[
          { label: "AUC", value: num(r.auc, 4) },
          { label: "AUC accuracy band", value: band },
          { label: "AUC standard error", value: num(r.aucStandardError, 4) },
          {
            label: "95% CI of AUC",
            value: ciText([r.aucCiLow, r.aucCiHigh]),
          },
          {
            label: "Optimal threshold (Youden's J)",
            value: Number.isFinite(r.youdenThreshold)
              ? num(r.youdenThreshold, 4)
              : "-",
          },
          {
            label: "Sensitivity at threshold",
            value: num(r.youdenSensitivity, 4),
          },
          {
            label: "Specificity at threshold",
            value: num(r.youdenSpecificity, 4),
          },
          { label: "Positives (Y = 1)", value: num(r.nPositive, 0) },
          { label: "Negatives (Y = 0)", value: num(r.nNegative, 0) },
          { label: "Rows (n)", value: num(r.n, 0) },
        ]}
      />
      <table
        className="mt-3 w-full border-collapse text-body tabular-nums"
        data-testid="results-roc-curve-table"
      >
        <thead>
          <tr className="text-meta uppercase tracking-wide text-foreground-muted">
            <th className="border-b border-border px-3 py-1.5 text-right">
              Threshold
            </th>
            <th className="border-b border-border px-3 py-1.5 text-right">
              FPR (1 - specificity)
            </th>
            <th className="border-b border-border px-3 py-1.5 text-right">
              TPR (sensitivity)
            </th>
          </tr>
        </thead>
        <tbody>
          {r.points.map((p, i) => (
            <tr key={i}>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {Number.isFinite(p.threshold) ? num(p.threshold, 4) : "+inf"}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(p.fpr, 4)}
              </td>
              <td className="border-b border-border px-3 py-1.5 text-right">
                {num(p.tpr, 4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 max-w-xl text-meta text-foreground-muted">
        The ROC curve plots the true positive rate against the false positive
        rate as the decision threshold sweeps from strict to lenient. The area
        under it (AUC) is the chance a random positive case outscores a random
        negative one, so 0.5 is a coin flip and 1.0 is a perfect separator. The
        Youden cut point is the single threshold that maximizes sensitivity plus
        specificity.
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
 * The Grubbs outlier screen, one block per column. Each block shows the column's
 * original n, the per-step G and critical value (one row per pass of the sweep),
 * which value each pass examined and whether it was flagged, and the cleaned n
 * after the flagged points are removed.
 */
function GrubbsOutlierTable({ r }: { r: NormalizedGrubbsOutlier }) {
  return (
    <div className="flex flex-col gap-4" data-testid="results-grubbs-table">
      {r.columns.map((col) => {
        const flaggedSteps = col.result.steps.filter((s) => s.flagged);
        return (
          <div key={col.columnId}>
            <h4 className="text-body font-semibold text-foreground">
              {col.name}
            </h4>
            <table className="mt-1 w-full border-collapse text-body tabular-nums">
              <thead>
                <tr className="text-meta uppercase tracking-wide text-foreground-muted">
                  <th className="border-b border-border px-3 py-1.5 text-left">
                    Pass
                  </th>
                  <th className="border-b border-border px-3 py-1.5 text-right">
                    n
                  </th>
                  <th className="border-b border-border px-3 py-1.5 text-right">
                    Value
                  </th>
                  <th className="border-b border-border px-3 py-1.5 text-right">
                    Row
                  </th>
                  <th className="border-b border-border px-3 py-1.5 text-right">
                    G
                  </th>
                  <th className="border-b border-border px-3 py-1.5 text-right">
                    G critical
                  </th>
                  <th className="border-b border-border px-3 py-1.5 text-right">
                    Outlier
                  </th>
                </tr>
              </thead>
              <tbody>
                {col.result.steps.map((s) => (
                  <tr key={s.step}>
                    <td className="border-b border-border px-3 py-1.5 text-foreground">
                      {s.step}
                    </td>
                    <td className="border-b border-border px-3 py-1.5 text-right">
                      {num(s.n, 0)}
                    </td>
                    <td className="border-b border-border px-3 py-1.5 text-right">
                      {num(s.value, 4)}
                    </td>
                    <td className="border-b border-border px-3 py-1.5 text-right">
                      {num(s.rowIndex + 1, 0)}
                    </td>
                    <td className="border-b border-border px-3 py-1.5 text-right">
                      {num(s.g, 4)}
                    </td>
                    <td className="border-b border-border px-3 py-1.5 text-right">
                      {num(s.gCritical, 4)}
                    </td>
                    <td className="border-b border-border px-3 py-1.5 text-right">
                      {s.flagged ? "Yes" : "No"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-meta text-foreground-muted">
              {flaggedSteps.length === 0
                ? `No outliers flagged. n stays at ${col.result.n}.`
                : `${flaggedSteps.length} ${
                    flaggedSteps.length === 1 ? "outlier" : "outliers"
                  } flagged (${col.result.outlierValues
                    .map((v) => num(v, 4))
                    .join(", ")}). Cleaned n is ${col.result.cleanedN}.`}
            </p>
          </div>
        );
      })}
      <p className="max-w-xl text-meta text-foreground-muted">
        Grubbs flags the single most extreme value when its distance from the
        mean, in sample standard deviations (the G statistic), is larger than the
        critical value for this sample size at alpha {num(r.alpha, 2)}.{" "}
        {r.iterative
          ? "The iterative sweep removes a flagged value and tests again on what remains, so each pass is a new row above."
          : "Only the single most extreme value is tested (single-pass mode)."}{" "}
        A flagged value is a candidate for review, not an automatic deletion.
      </p>
    </div>
  );
}

/** One R x C count matrix rendered with row / column labels and the margins. */
function ContingencyMatrixTable({
  title,
  rowLabels,
  colLabels,
  matrix,
  digits,
  testid,
}: {
  title: string;
  rowLabels: string[];
  colLabels: string[];
  matrix: number[][];
  digits: number;
  testid: string;
}) {
  const colTotals = colLabels.map((_, j) =>
    matrix.reduce((s, row) => s + (row[j] ?? 0), 0),
  );
  const grand = colTotals.reduce((s, v) => s + v, 0);
  return (
    <div>
      <h4 className="text-body font-semibold text-foreground">{title}</h4>
      <table
        className="mt-1 w-full border-collapse text-body tabular-nums"
        data-testid={testid}
      >
        <thead>
          <tr className="text-meta uppercase tracking-wide text-foreground-muted">
            <th className="border-b border-border px-3 py-1.5 text-left" />
            {colLabels.map((c, j) => (
              <th key={j} className="border-b border-border px-3 py-1.5 text-right">
                {c}
              </th>
            ))}
            <th className="border-b border-border px-3 py-1.5 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <td className="border-b border-border px-3 py-1.5 text-left font-medium text-foreground">
                {rowLabels[i]}
              </td>
              {row.map((v, j) => (
                <td
                  key={j}
                  className="border-b border-border px-3 py-1.5 text-right text-foreground"
                >
                  {num(v, digits)}
                </td>
              ))}
              <td className="border-b border-border px-3 py-1.5 text-right text-foreground-muted">
                {num(
                  row.reduce((s, v) => s + v, 0),
                  digits,
                )}
              </td>
            </tr>
          ))}
          <tr className="text-foreground-muted">
            <td className="px-3 py-1.5 text-left font-medium">Total</td>
            {colTotals.map((t, j) => (
              <td key={j} className="px-3 py-1.5 text-right">
                {num(t, digits)}
              </td>
            ))}
            <td className="px-3 py-1.5 text-right">{num(grand, digits)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ratioRow(label: string, m: NormalizedContingency["oddsRatio"]) {
  if (!m) return null;
  return (
    <tr>
      <td className="border-b border-border px-3 py-1.5 text-foreground">
        {label}
        {m.corrected ? " (0.5 continuity correction)" : ""}
      </td>
      <td className="border-b border-border px-3 py-1.5 text-right text-foreground">
        {num(m.estimate, 3)}
      </td>
      <td className="border-b border-border px-3 py-1.5 text-right text-foreground-muted">
        {num(m.ciLow, 3)} to {num(m.ciHigh, 3)}
      </td>
    </tr>
  );
}

function ContingencyTables({ r }: { r: NormalizedContingency }) {
  const is2x2 = r.rows === 2 && r.cols === 2;
  const chiLabel = is2x2 && r.yatesApplied ? "Chi-square (Yates)" : "Chi-square";
  const chi = is2x2 && r.yatesApplied ? r.yatesChiSquare : r.chiSquare;
  const p = is2x2 && r.yatesApplied ? r.yatesPValue : r.pValue;
  return (
    <div className="flex flex-col gap-4" data-testid="results-contingency-table">
      <table className="w-full border-collapse text-body tabular-nums">
        <tbody>
          <tr>
            <td className="border-b border-border px-3 py-1.5 text-foreground">
              {chiLabel}
            </td>
            <td className="border-b border-border px-3 py-1.5 text-right text-foreground">
              {num(chi, 3)}
            </td>
            <td className="border-b border-border px-3 py-1.5 text-right text-foreground-muted">
              df {r.df}, {formatP(p)}
            </td>
          </tr>
          {is2x2 && (
            <>
              <tr>
                <td className="border-b border-border px-3 py-1.5 text-foreground">
                  {r.yatesApplied
                    ? "Chi-square (uncorrected)"
                    : "Chi-square (Yates-corrected)"}
                </td>
                <td className="border-b border-border px-3 py-1.5 text-right text-foreground">
                  {num(r.yatesApplied ? r.chiSquare : r.yatesChiSquare, 3)}
                </td>
                <td className="border-b border-border px-3 py-1.5 text-right text-foreground-muted">
                  {formatP(r.yatesApplied ? r.pValue : r.yatesPValue)}
                </td>
              </tr>
              <tr>
                <td className="border-b border-border px-3 py-1.5 text-foreground">
                  Fisher exact p (two-sided)
                </td>
                <td className="border-b border-border px-3 py-1.5 text-right text-foreground">
                  {formatP(r.fisherPValue)}
                </td>
                <td className="border-b border-border px-3 py-1.5 text-right" />
              </tr>
              {ratioRow("Relative risk", r.relativeRisk)}
              {ratioRow("Odds ratio", r.oddsRatio)}
            </>
          )}
          <tr>
            <td className="px-3 py-1.5 text-foreground-muted">
              Smallest expected count
            </td>
            <td className="px-3 py-1.5 text-right text-foreground-muted">
              {num(r.minExpected, 2)}
            </td>
            <td className="px-3 py-1.5 text-right text-foreground-muted">
              n = {r.n}
            </td>
          </tr>
        </tbody>
      </table>

      <ContingencyMatrixTable
        title="Observed counts"
        rowLabels={r.rowLabels}
        colLabels={r.colLabels}
        matrix={r.observed}
        digits={0}
        testid="results-contingency-observed"
      />
      <ContingencyMatrixTable
        title="Expected counts (under independence)"
        rowLabels={r.rowLabels}
        colLabels={r.colLabels}
        matrix={r.expected}
        digits={2}
        testid="results-contingency-expected"
      />

      <p className="max-w-xl text-meta text-foreground-muted">
        The chi-square test compares the observed counts with the counts expected
        if the two factors were independent.{" "}
        {r.minExpected < 5
          ? is2x2
            ? `An expected count is below 5 (${num(
                r.minExpected,
                1,
              )}), so lean on Fisher's exact p rather than the chi-square here.`
            : `An expected count is below 5 (${num(
                r.minExpected,
                1,
              )}), so the chi-square approximation is less reliable. Consider pooling sparse categories.`
          : "Every expected count is at least 5, so the chi-square approximation is reliable."}{" "}
        {is2x2 &&
          "Relative risk and odds ratio read the first row as exposed and the first column as the event."}
      </p>
    </div>
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
    case "rocCurve":
      return [
        {
          id: "tabular",
          label: "Tabular results",
          render: () => <RocCurveTable r={result} />,
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
    case "grubbsOutlier":
      return [
        {
          id: "tabular",
          label: "Tabular results",
          render: () => <GrubbsOutlierTable r={result} />,
        },
      ];
    case "contingency":
      return [
        {
          id: "tabular",
          label: "Tabular results",
          render: () => <ContingencyTables r={result} />,
        },
      ];
    case "nestedTTest":
      return [
        {
          id: "tabular",
          label: "Tabular results",
          render: () => <NestedTTestTable r={result} />,
        },
      ];
    case "nestedOneWayAnova":
      return [
        {
          id: "tabular",
          label: "Tabular results",
          render: () => <NestedAnovaTable r={result} />,
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
  const stored = readParams(spec);
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
        {fields.map((field) => {
          // A dynamic field (the Cox reference arm) has no stored value until the
          // user picks one, so fall back to the resolved field default (the first
          // arm) rather than the empty static default.
          const value =
            stored[field.key] !== undefined && stored[field.key] !== ""
              ? stored[field.key]
              : field.default;
          return (
            <ParamRow
              key={field.key}
              field={field}
              value={value}
              onChange={(v) => onParamChange(field.key, v)}
            />
          );
        })}
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
  // affordance is hidden rather than opening an empty panel. The Cox reference
  // arm is a dynamic-option field, so its dropdown is filled from the open
  // survival table's arm labels here.
  const paramFields = useMemo(() => {
    if (spec.type !== "coxRegression") return paramSchema(spec.type);
    const armOptions = survivalGroups(content)
      .filter((g) => g.observations.length > 0)
      .map((g) => ({ value: g.name, label: g.name }));
    return resolveDynamicSchema(spec.type, { referenceGroup: armOptions });
  }, [spec.type, content]);
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
  // BeakerBot's interpretation box. The verdict is always present; the worked
  // example and the learn-more link are additive and only render when they have
  // something to say (workedExample / learnMoreTopic return null otherwise), so
  // the box never shows an empty green callout or a dangling link.
  const worked = workedExample(result);
  const learnMore = learnMoreTopic(result);

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
          className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-3"
          data-testid="results-verdict"
        >
          {/* Header bar: BeakerBot mark + "BeakerBot's read on this result", so
              the interpretation reads as a tip from the mascot rather than an
              anonymous box. The box keeps its sky accent. */}
          <div
            className="mb-2 flex items-center gap-1.5 text-meta font-semibold text-accent"
            data-testid="results-verdict-header"
          >
            <BeakerBotMark className="h-4 w-4 shrink-0" />
            BeakerBot&apos;s read on this result
          </div>

          <p className="text-body text-foreground">
            {plainLanguageSummary(result)}
          </p>

          {worked ? (
            // The "for your numbers" callout, a soft success tint with a left
            // border so it reads as a concrete worked example distinct from the
            // verdict above. Only renders when workedExample returns a sentence.
            <p
              className="mt-3 rounded-r border-l-2 border-green-600/50 bg-green-500/10 px-3 py-2 text-meta text-foreground"
              data-testid="results-worked-example"
            >
              <span className="font-semibold">For your numbers: </span>
              {worked}
            </p>
          ) : null}

          {learnMore ? (
            <Link
              href={learnMore.href}
              className="mt-3 inline-flex items-center gap-0.5 text-meta font-semibold text-accent hover:underline"
              data-testid="results-learn-more"
            >
              {learnMore.label}
              <Icon name="chevronRight" className="h-3.5 w-3.5" />
            </Link>
          ) : null}
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
