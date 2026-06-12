// run-analysis.ts
//
// The compute layer for Data Hub Column-table analyses (slice 2). Given an
// AnalysisSpec (the analysis type plus the input column ids) and the current
// table content, this dispatches to the already-validated engine and returns a
// NORMALIZED result the presentation layer (plain-language.ts, show-code.ts,
// ResultsSheet) can render without re-touching the engine result shapes.
//
// We do NOT reimplement any statistics here. We read the finite values out of
// the named columns (via column-table.ts), call the engine, and tag the result
// with the resolved group names + raw value arrays so the Show-the-code snippet
// and the plain-language verdict can reproduce themselves.
//
// Supported this slice (Column tables only):
//   - "unpairedTTest"      two groups, Welch by default
//   - "pairedTTest"        two groups, row-paired
//   - "oneWayAnova"        three or more groups, Tukey post-hoc
//   - "mannWhitneyU"       two independent groups, nonparametric (Welch's fallback)
//   - "wilcoxonSignedRank" two paired groups, nonparametric (paired t fallback)
//   - "kruskalWallis"      three or more groups, nonparametric (ANOVA fallback)
// The three nonparametric kinds are the assumption-failure fallbacks the guided
// wizard recommends, but they are also valid analyses to run directly. Two-way
// ANOVA needs the Grouped table type and is deferred.
//
// No em-dashes, no emojis, no mid-sentence colons.

import {
  oneWayAnova,
  oneWayAnovaFromStats,
  twoWayAnova,
  unpairedTTest,
  unpairedTTestFromStats,
  pairedTTest,
  mannWhitneyU,
  wilcoxonSignedRank,
  kruskalWallis,
  pearson,
  spearman,
  linearRegression,
  kaplanMeier,
  logRank,
  type KaplanMeierStep,
} from "@/lib/datahub/engine";
import type {
  AnovaResult,
  TTestResult,
  CorrelationResult,
  LinearRegressionResult,
} from "@/lib/datahub/engine/types";
import type {
  AnalysisSpec,
  DataHubDocContent,
} from "@/lib/datahub/model/types";
import { readParams } from "@/lib/datahub/analysis-params";
import type { Tail } from "@/lib/datahub/engine/types";
import type { PostHocMethod } from "@/lib/datahub/engine/anova";
import { columnValues, groupColumns } from "@/lib/datahub/column-table";
import {
  isSummaryFormat,
  readGroupSummary,
  summaryGroupIds,
  type GroupSummary,
} from "@/lib/datahub/summary-table";
import { xColumn, xyPairs, yColumns } from "@/lib/datahub/xy-table";
import {
  groupDatasets,
  rowFactorLevels,
  rowLabelColumn,
  twoWayObservations,
} from "@/lib/datahub/grouped-table";
import { survivalGroups, hasSurvivalData } from "@/lib/datahub/survival-table";

/** The analysis types this slice can run. */
export type AnalysisType =
  | "unpairedTTest"
  | "pairedTTest"
  | "oneWayAnova"
  | "mannWhitneyU"
  | "wilcoxonSignedRank"
  | "kruskalWallis"
  | "correlationPearson"
  | "correlationSpearman"
  | "linearRegression"
  | "twoWayAnova"
  | "kaplanMeier";

/** The analysis types that read a Survival table (time + event + group). */
export const SURVIVAL_ANALYSIS_TYPES: AnalysisType[] = ["kaplanMeier"];

/** The analysis types that read an XY table (one X column paired with a Y). */
export const XY_ANALYSIS_TYPES: AnalysisType[] = [
  "correlationPearson",
  "correlationSpearman",
  "linearRegression",
];

/** The analysis types that read a Grouped table (row factor x column groups). */
export const GROUPED_ANALYSIS_TYPES: AnalysisType[] = ["twoWayAnova"];

/** The analysis types that read a Column table (group columns). */
export const COLUMN_ANALYSIS_TYPES: AnalysisType[] = [
  "unpairedTTest",
  "pairedTTest",
  "oneWayAnova",
  "mannWhitneyU",
  "wilcoxonSignedRank",
  "kruskalWallis",
];

/**
 * The analysis types runnable from ENTERED SUMMARY STATS (mean / SD or SEM / n).
 * Only the unpaired t-test and the one-way ANOVA omnibus reconstruct exactly
 * from group summaries. Paired and rank-based tests, correlation, and regression
 * all need the raw replicates (a paired test needs the row pairing, a rank test
 * needs the values to rank), so they are guarded as needs-raw on a summary table.
 */
export const SUMMARY_ANALYSIS_TYPES: AnalysisType[] = [
  "unpairedTTest",
  "oneWayAnova",
];

/** Whether an analysis type can run from entered summary statistics. */
export function summaryCanRun(type: AnalysisType): boolean {
  return SUMMARY_ANALYSIS_TYPES.includes(type);
}

/** A resolved input group: the column id, its display name, and its values. */
export interface RunGroup {
  columnId: string;
  name: string;
  values: number[];
}

/**
 * A normalized two-group result. Covers the parametric t-tests (unpaired Welch,
 * paired) AND their nonparametric rank-based counterparts (Mann-Whitney U for
 * independent groups, Wilcoxon signed-rank for paired), which the engine returns
 * in the same TTestResult shape. A rank test has no df and no CI of the
 * difference, so those carry NaN / null and the sheet renders a dash.
 */
export interface NormalizedTTest {
  kind: "ttest";
  type:
    | "unpairedTTest"
    | "pairedTTest"
    | "mannWhitneyU"
    | "wilcoxonSignedRank";
  /** Engine label, e.g. "Welch's t-test" or "Mann-Whitney U (rank-sum)". */
  test: string;
  /** True for the rank-based nonparametric tests (no df, no CI of difference). */
  nonparametric: boolean;
  /** The resolved tail used for the test, so the code snippet matches the run. */
  tail: Tail;
  /** Resolved variance assumption (unpaired t only; null for the others). */
  variance: "welch" | "student" | null;
  groups: [RunGroup, RunGroup];
  statistic: number;
  df: number;
  pValue: number;
  effectSize: number;
  effectSizeLabel: string;
  /** Hedges' g (bias-corrected d), or null for the rank tests. */
  hedgesG: number | null;
  /** 95% CI of the standardized effect (d/dz) via noncentral t, or null. */
  effectSizeCI95: [number, number] | null;
  ci95: [number, number] | null;
  meanA: number;
  meanB: number;
  meanDiff: number;
}

/**
 * A normalized multi-group result. Covers one-way ANOVA (with Tukey comparisons)
 * AND the nonparametric Kruskal-Wallis (with Dunn comparisons), which the engine
 * returns in the same AnovaResult shape. For Kruskal-Wallis the F column carries
 * the H statistic and SS / MS are NaN (a rank test has no sums of squares).
 */
export interface NormalizedAnova {
  kind: "anova";
  type: "oneWayAnova" | "kruskalWallis";
  test: string;
  /** True for Kruskal-Wallis (rank-based, no sums of squares). */
  nonparametric: boolean;
  /**
   * The resolved post-hoc family used for the comparisons. Kruskal-Wallis is
   * always Dunn (the engine has no choice there), one-way ANOVA reflects the
   * chosen family so the code snippet and the comparisons table agree.
   */
  postHoc: PostHocMethod;
  groups: RunGroup[];
  statistic: number;
  pValue: number;
  /** dfBetween / dfWithin, read off the table for the F(df1, df2) display. */
  dfBetween: number;
  dfWithin: number;
  table: AnovaResult["table"];
  comparisons: AnovaResult["comparisons"];
  /**
   * Omnibus effect size (eta-squared + omega-squared + CI for ANOVA,
   * epsilon-squared for Kruskal-Wallis), straight from the engine. Null when the
   * design defines none.
   */
  effectSize: AnovaResult["effectSize"];
}

/**
 * A normalized correlation result. Covers Pearson (the linear-association r) and
 * Spearman (the rank-based rho, robust to non-normality and monotone but
 * nonlinear relationships). Both come back in the same CorrelationResult shape,
 * so this normalizes the coefficient label, the resolved X / Y names, and the
 * raw paired values that reproduce the snippet.
 */
export interface NormalizedCorrelation {
  kind: "correlation";
  type: "correlationPearson" | "correlationSpearman";
  /** "pearson" or "spearman", straight from the engine. */
  method: CorrelationResult["method"];
  /** The coefficient symbol to print ("r" for Pearson, "rho" for Spearman). */
  coefficientLabel: string;
  xName: string;
  yName: string;
  x: number[];
  y: number[];
  n: number;
  coefficient: number;
  statistic: number;
  df: number;
  pValue: number;
  ci95: [number, number];
  /** Coefficient of determination r^2, the share of variance explained. */
  rSquared: number;
  /** 95% CI of r^2, from squaring the sorted coefficient CI bounds. */
  rSquaredCI95: [number, number];
}

/**
 * A normalized linear-regression result (ordinary least squares y = a + b x),
 * with the slope and intercept plus their standard errors and confidence
 * intervals, R-squared, and the residual standard error. The raw paired values
 * are carried so the Show-the-code snippet reproduces the on-screen numbers.
 */
export interface NormalizedRegression {
  kind: "regression";
  type: "linearRegression";
  xName: string;
  yName: string;
  x: number[];
  y: number[];
  n: number;
  slope: number;
  intercept: number;
  rSquared: number;
  slopeSE: number;
  interceptSE: number;
  slopeCI95: [number, number];
  interceptCI95: [number, number];
  residualSE: number;
}

/**
 * A normalized two-way ANOVA result. The full ANOVA table (factor A, factor B,
 * interaction, error, total) plus the three effect F / p values pulled out for
 * the plain-language verdict, the resolved factor names, and any Tukey post-hoc
 * comparisons on the column factor. Comes from the engine's twoWayAnova.
 */
export interface NormalizedTwoWayAnova {
  kind: "twoWayAnova";
  type: "twoWayAnova";
  /** The row factor name (the row-label column) and the column factor name. */
  factorAName: string;
  factorBName: string;
  /** Which factor's marginal means were compared, or "none" when skipped. */
  postHocFactor: "A" | "B" | "none";
  table: AnovaResult["table"];
  comparisons: AnovaResult["comparisons"];
  fA: number;
  pA: number;
  fB: number;
  pB: number;
  fInteraction: number;
  pInteraction: number;
}

/** One arm of a normalized survival result: its Kaplan-Meier curve + median. */
export interface NormalizedSurvivalGroup {
  name: string;
  n: number;
  events: number;
  median: number | null;
  steps: KaplanMeierStep[];
}

/**
 * A normalized survival result. One Kaplan-Meier curve per group (steps +
 * median), plus the log-rank comparison when there are two or more groups. From
 * the engine's kaplanMeier + logRank.
 */
export interface NormalizedSurvival {
  kind: "survival";
  type: "kaplanMeier";
  groups: NormalizedSurvivalGroup[];
  /** The log-rank test across the groups, or null with fewer than two groups. */
  logRank: {
    chiSquare: number;
    df: number;
    pValue: number;
    perGroup: { name: string; observed: number; expected: number }[];
  } | null;
}

export type NormalizedResult =
  | NormalizedTTest
  | NormalizedAnova
  | NormalizedCorrelation
  | NormalizedRegression
  | NormalizedTwoWayAnova
  | NormalizedSurvival;

/** A failed run carries the engine (or resolver) reason so the UI can show it. */
export interface RunFailure {
  ok: false;
  error: string;
  /**
   * True when the failure is specifically that the table holds entered summary
   * stats but the chosen test needs raw replicate values (a paired / rank-based
   * test, correlation, or regression). The UI shows a friendly "switch the table
   * to Replicates to run it" message for this case rather than a generic error.
   */
  needsRaw?: boolean;
}

export type RunOutcome =
  | ({ ok: true } & NormalizedResult)
  | RunFailure;

/**
 * Read the input column ids out of a spec. We store them under inputs.columnIds
 * (an ordered string[]); a defensive parse keeps a malformed spec from throwing.
 */
export function specColumnIds(spec: AnalysisSpec): string[] {
  const raw = (spec.inputs as { columnIds?: unknown }).columnIds;
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  return [];
}

/**
 * Resolve a spec's input column ids into named value groups, reading the finite
 * numbers out of each column. Unknown column ids are dropped. The display name
 * is the column's current name so a later rename flows through on re-run.
 */
export function resolveGroups(
  content: DataHubDocContent,
  columnIds: string[],
): RunGroup[] {
  const byId = new Map(groupColumns(content).map((c) => [c.id, c.name]));
  const out: RunGroup[] = [];
  for (const id of columnIds) {
    const name = byId.get(id);
    if (name === undefined) continue;
    out.push({ columnId: id, name, values: columnValues(content, id) });
  }
  return out;
}

/**
 * Which analysis types are valid for the current table. A Column table offers
 * the group comparisons (by group count); an XY table offers correlation and
 * linear regression once it has an X column and at least one Y column. The
 * nonparametric kinds match the same group counts as their parametric peers, so
 * a wizard fallback always has a runnable target.
 */
export function validAnalysisTypes(content: DataHubDocContent): AnalysisType[] {
  if (content.meta.table_type === "xy") {
    if (xColumn(content) && yColumns(content).length >= 1) {
      return [...XY_ANALYSIS_TYPES];
    }
    return [];
  }
  if (content.meta.table_type === "grouped") {
    // Two-way ANOVA needs at least two row-factor levels and two column groups.
    if (rowFactorLevels(content).length >= 2 && groupDatasets(content).length >= 2) {
      return [...GROUPED_ANALYSIS_TYPES];
    }
    return [];
  }
  if (content.meta.table_type === "survival") {
    return hasSurvivalData(content) ? [...SURVIVAL_ANALYSIS_TYPES] : [];
  }
  // A Column table in a summary entry format offers only the summary-compatible
  // tests, gated by the number of entered groups (2+ for the unpaired t, 3+ for
  // the one-way ANOVA). The paired and rank-based tests need raw replicates.
  if (isSummaryFormat(content.meta.entryFormat)) {
    const g = summaryGroupIds(content).length;
    const out: AnalysisType[] = [];
    if (g >= 2) out.push("unpairedTTest");
    if (g >= 3) out.push("oneWayAnova");
    return out;
  }
  const k = groupColumns(content).length;
  const out: AnalysisType[] = [];
  if (k >= 2) {
    out.push("unpairedTTest", "pairedTTest", "mannWhitneyU", "wilcoxonSignedRank");
  }
  if (k >= 3) {
    out.push("oneWayAnova", "kruskalWallis");
  }
  return out;
}

/**
 * Resolve an XY analysis spec into its X / Y names and finite paired values. The
 * spec stores the Y column id in inputs.columnIds[0]; the X column is the
 * table's single role-"x" column, resolved live so a rename flows through.
 */
function resolveXY(
  content: DataHubDocContent,
  spec: AnalysisSpec,
): { xName: string; yName: string; x: number[]; y: number[] } | null {
  const xCol = xColumn(content);
  if (!xCol) return null;
  const yId = specColumnIds(spec)[0];
  const yCol = yColumns(content).find((c) => c.id === yId);
  if (!yCol) return null;
  const pairs = xyPairs(content, yCol.id);
  return { xName: xCol.name, yName: yCol.name, x: pairs.x, y: pairs.y };
}

/** Run a correlation or linear regression on the resolved XY pairs. */
function runXYAnalysis(
  type: AnalysisType,
  content: DataHubDocContent,
  spec: AnalysisSpec,
): RunOutcome {
  const resolved = resolveXY(content, spec);
  if (!resolved) {
    return {
      ok: false,
      error: "Pick an X column and a Y column on this XY table.",
    };
  }
  const { xName, yName, x, y } = resolved;

  if (type === "linearRegression") {
    const r = linearRegression(x, y);
    if (!r.ok) return { ok: false, error: r.error };
    const res = r as LinearRegressionResult & { ok: true };
    return {
      ok: true,
      kind: "regression",
      type,
      xName,
      yName,
      x,
      y,
      n: res.n,
      slope: res.slope,
      intercept: res.intercept,
      rSquared: res.rSquared,
      slopeSE: res.slopeSE,
      interceptSE: res.interceptSE,
      slopeCI95: res.slopeCI95,
      interceptCI95: res.interceptCI95,
      residualSE: res.residualSE,
    };
  }

  const r =
    type === "correlationSpearman" ? spearman(x, y) : pearson(x, y);
  if (!r.ok) return { ok: false, error: r.error };
  const res = r as CorrelationResult & { ok: true };
  return {
    ok: true,
    kind: "correlation",
    type: type === "correlationSpearman" ? "correlationSpearman" : "correlationPearson",
    method: res.method,
    coefficientLabel: res.method === "spearman" ? "rho" : "r",
    xName,
    yName,
    x,
    y,
    n: res.n,
    coefficient: res.coefficient,
    statistic: res.statistic,
    df: res.df,
    pValue: res.pValue,
    ci95: res.ci95,
    rSquared: res.rSquared,
    rSquaredCI95: res.rSquaredCI95,
  };
}

function tableRow(table: AnovaResult["table"], source: string) {
  return table.find((r) => r.source === source);
}

/** Run Kaplan-Meier per group plus a log-rank test on a Survival table. */
function runSurvivalAnalysis(content: DataHubDocContent): RunOutcome {
  const groups = survivalGroups(content).filter(
    (g) => g.observations.length > 0,
  );
  if (groups.length === 0) {
    return {
      ok: false,
      error: "Enter a Time and an Event (1 or 0) for each subject first.",
    };
  }
  const normGroups: NormalizedSurvivalGroup[] = [];
  for (const g of groups) {
    const km = kaplanMeier(g.observations);
    if (!km.ok) return { ok: false, error: km.error };
    normGroups.push({
      name: g.name,
      n: km.n,
      events: km.events,
      median: km.median,
      steps: km.steps,
    });
  }

  let lr: NormalizedSurvival["logRank"] = null;
  if (groups.length >= 2) {
    const r = logRank(groups);
    if (r.ok) {
      lr = {
        chiSquare: r.chiSquare,
        df: r.df,
        pValue: r.pValue,
        perGroup: r.groups.map((x) => ({
          name: x.name,
          observed: x.observed,
          expected: x.expected,
        })),
      };
    }
  }

  return { ok: true, kind: "survival", type: "kaplanMeier", groups: normGroups, logRank: lr };
}

/** Run a two-way ANOVA on a Grouped table's flattened observations. */
function runTwoWayAnalysis(
  content: DataHubDocContent,
  spec: AnalysisSpec,
): RunOutcome {
  const observations = twoWayObservations(content);
  if (observations.length === 0) {
    return {
      ok: false,
      error: "Label each row and fill the group replicates before running a two-way ANOVA.",
    };
  }
  // "B" is the default (matches the prior hardcoded behavior); "none" drops the
  // post-hoc comparisons by not passing a factor to the engine.
  const factorChoice = readParams(spec).postHocFactor as
    | "A"
    | "B"
    | "none"
    | undefined;
  const postHocFactor: "A" | "B" | "none" = factorChoice ?? "B";
  const r = twoWayAnova(
    observations,
    postHocFactor === "none" ? {} : { postHocFactor },
  );
  if (!r.ok) return { ok: false, error: r.error };
  const rowA = tableRow(r.table, "Factor A");
  const rowB = tableRow(r.table, "Factor B");
  const rowI = tableRow(r.table, "Interaction");
  return {
    ok: true,
    kind: "twoWayAnova",
    type: "twoWayAnova",
    factorAName: rowLabelColumn(content)?.name || "Row factor",
    factorBName: "Group",
    postHocFactor,
    table: r.table,
    comparisons: r.comparisons,
    fA: rowA?.f ?? NaN,
    pA: rowA?.pValue ?? NaN,
    fB: rowB?.f ?? NaN,
    pB: rowB?.pValue ?? NaN,
    fInteraction: rowI?.f ?? NaN,
    pInteraction: rowI?.pValue ?? NaN,
  };
}

/**
 * Resolve a spec's input ids into entered group summaries on a summary-format
 * Column table. The ids are dataset ids (the group identity in summary mode);
 * unknown ids and groups missing a mean / SD / SEM / n are dropped. The display
 * name is the group's current name so a rename flows through on re-run.
 */
export function resolveSummaryGroups(
  content: DataHubDocContent,
  groupIds: string[],
): GroupSummary[] {
  const out: GroupSummary[] = [];
  for (const id of groupIds) {
    const s = readGroupSummary(content, id);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Run a summary-compatible analysis (unpaired t-test, one-way ANOVA omnibus) from
 * ENTERED SUMMARY STATS. Tests that cannot run from a summary return a clear
 * needs-raw failure rather than a wrong number. The summary's spread is converted
 * to an SD for the engine (SEM * sqrt(n) when the table stores SEM).
 */
function runSummaryAnalysis(
  type: AnalysisType,
  content: DataHubDocContent,
  spec: AnalysisSpec,
): RunOutcome {
  if (!summaryCanRun(type)) {
    return {
      ok: false,
      needsRaw: true,
      error:
        "This test needs raw replicate data. The table holds entered summary "
        + "stats (mean, spread, n), which support only the unpaired t-test and "
        + "the one-way ANOVA. Switch the table to replicates to run this test.",
    };
  }

  // The spread the table stores; convert SEM to SD for the engine (SD = SEM * sqrt(n)).
  const toSD = (s: GroupSummary): number | null => {
    if (s.spread === null) return null;
    if (s.spreadKind === "sem") {
      if (s.n === null || s.n < 1) return null;
      return s.spread * Math.sqrt(s.n);
    }
    return s.spread;
  };

  const groups = resolveSummaryGroups(content, specColumnIds(spec));

  if (type === "oneWayAnova") {
    if (groups.length < 3) {
      return { ok: false, error: "One-way ANOVA needs at least 3 groups." };
    }
    const stats = groups.map((g) => ({
      mean: g.mean ?? NaN,
      sd: toSD(g) ?? NaN,
      n: g.n ?? NaN,
    }));
    const r = oneWayAnovaFromStats(stats);
    if (!r.ok) return { ok: false, error: r.error };
    const between = tableRow(r.table, "Between groups");
    const within = tableRow(r.table, "Within groups");
    // Map back to named RunGroups so the sheet can still label each group. The
    // raw values are unknown from a summary, so values[] is empty.
    const runGroups: RunGroup[] = groups.map((g) => ({
      columnId: g.datasetId,
      name: g.name,
      values: [],
    }));
    return {
      ok: true,
      kind: "anova",
      type: "oneWayAnova",
      test: r.test,
      nonparametric: false,
      // Post-hoc is not computable from summary stats; the engine returns no
      // comparisons and the post-hoc family is reported as none.
      postHoc: "none",
      groups: runGroups,
      statistic: r.statistic,
      pValue: r.pValue,
      dfBetween: between?.df ?? groups.length - 1,
      dfWithin: within?.df ?? NaN,
      table: r.table,
      comparisons: r.comparisons,
      effectSize: r.effectSize,
    };
  }

  // Unpaired t-test from two group summaries.
  if (groups.length < 2) {
    return { ok: false, error: "A two-group test needs exactly 2 groups." };
  }
  const [a, b] = groups;
  const sdA = toSD(a);
  const sdB = toSD(b);
  if (
    a.mean === null ||
    b.mean === null ||
    sdA === null ||
    sdB === null ||
    a.n === null ||
    b.n === null
  ) {
    return {
      ok: false,
      error: "Enter a mean, a spread, and an n for both groups.",
    };
  }
  const p = readParams(spec);
  const tail = (p.tail as Tail | undefined) ?? "two-sided";
  const variance = (p.variance as "welch" | "student" | undefined) ?? "welch";
  const r = unpairedTTestFromStats({
    mean1: a.mean,
    sd1: sdA,
    n1: a.n,
    mean2: b.mean,
    sd2: sdB,
    n2: b.n,
    tail,
    variance,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const aGroup: RunGroup = { columnId: a.datasetId, name: a.name, values: [] };
  const bGroup: RunGroup = { columnId: b.datasetId, name: b.name, values: [] };
  return {
    ok: true,
    kind: "ttest",
    type: "unpairedTTest",
    test: r.test,
    nonparametric: false,
    tail,
    variance,
    groups: [aGroup, bGroup],
    statistic: r.statistic,
    df: r.df,
    pValue: r.pValue,
    effectSize: r.effectSize,
    effectSizeLabel: r.effectSizeLabel,
    hedgesG: r.hedgesG,
    effectSizeCI95: r.effectSizeCI95,
    ci95: r.ci95,
    meanA: a.mean,
    meanB: b.mean,
    meanDiff: a.mean - b.mean,
  };
}

/**
 * Run one analysis spec against the current table content and return a
 * normalized result (or a typed failure). Pure: no I/O, no Loro, no commit. The
 * caller stores the returned normalized result back into the spec's resultCache.
 */
export function runAnalysis(
  spec: AnalysisSpec,
  content: DataHubDocContent,
): RunOutcome {
  const type = spec.type as AnalysisType;

  if (
    type === "correlationPearson" ||
    type === "correlationSpearman" ||
    type === "linearRegression"
  ) {
    return runXYAnalysis(type, content, spec);
  }

  if (type === "twoWayAnova") {
    return runTwoWayAnalysis(content, spec);
  }

  if (type === "kaplanMeier") {
    return runSurvivalAnalysis(content);
  }

  // A Column table in a summary entry format dispatches the summary-compatible
  // tests through the from-stats engine paths; unsupported tests return a clear
  // needs-raw failure. Empty / "replicates" falls through to the raw path below,
  // which is byte-identical to before this branch existed.
  if (
    content.meta.table_type === "column" &&
    isSummaryFormat(content.meta.entryFormat)
  ) {
    return runSummaryAnalysis(type, content, spec);
  }

  const groups = resolveGroups(content, specColumnIds(spec));

  if (type === "oneWayAnova" || type === "kruskalWallis") {
    if (groups.length < 3) {
      const label =
        type === "kruskalWallis" ? "Kruskal-Wallis" : "One-way ANOVA";
      return { ok: false, error: `${label} needs at least 3 groups.` };
    }
    const data: Record<string, number[]> = {};
    for (const g of groups) data[g.name] = g.values;
    // One-way ANOVA reads its post-hoc family from the spec ("tukey" default,
    // matching the prior hardcode); Kruskal-Wallis has no choice (Dunn always),
    // so its post-hoc field is reported as Dunn for the snippet/label.
    const postHoc: PostHocMethod =
      type === "kruskalWallis"
        ? "tukey"
        : ((readParams(spec).postHoc as PostHocMethod | undefined) ?? "tukey");
    const r =
      type === "kruskalWallis"
        ? kruskalWallis(data)
        : oneWayAnova(data, { postHoc });
    if (!r.ok) return { ok: false, error: r.error };
    const between = tableRow(r.table, "Between groups");
    const within = tableRow(r.table, "Within groups");
    return {
      ok: true,
      kind: "anova",
      type,
      test: r.test,
      nonparametric: type === "kruskalWallis",
      postHoc,
      groups,
      statistic: r.statistic,
      pValue: r.pValue,
      dfBetween: between?.df ?? groups.length - 1,
      dfWithin: within?.df ?? NaN,
      table: r.table,
      comparisons: r.comparisons,
      effectSize: r.effectSize,
    };
  }

  if (
    type === "unpairedTTest" ||
    type === "pairedTTest" ||
    type === "mannWhitneyU" ||
    type === "wilcoxonSignedRank"
  ) {
    if (groups.length < 2) {
      return { ok: false, error: "A two-group test needs exactly 2 groups." };
    }
    const [a, b] = groups;
    // All four two-group tests honor a tail; only the unpaired t exposes the
    // variance assumption. Defaults ("two-sided", "welch") reproduce the prior
    // hardcoded behavior for an empty params bag.
    const p = readParams(spec);
    const tail = (p.tail as Tail | undefined) ?? "two-sided";
    const variance =
      type === "unpairedTTest"
        ? ((p.variance as "welch" | "student" | undefined) ?? "welch")
        : null;
    let r: ReturnType<typeof unpairedTTest>;
    switch (type) {
      case "pairedTTest":
        r = pairedTTest(a.values, b.values, { tail });
        break;
      case "mannWhitneyU":
        r = mannWhitneyU(a.values, b.values, { tail });
        break;
      case "wilcoxonSignedRank":
        r = wilcoxonSignedRank(a.values, b.values, { tail });
        break;
      default:
        r = unpairedTTest(a.values, b.values, {
          tail,
          variance: variance ?? "welch",
        });
    }
    if (!r.ok) return { ok: false, error: r.error };
    const res = r as TTestResult & { ok: true };
    const meanA = res.groupA?.mean ?? NaN;
    const meanB = res.groupB?.mean ?? NaN;
    return {
      ok: true,
      kind: "ttest",
      type,
      test: res.test,
      nonparametric:
        type === "mannWhitneyU" || type === "wilcoxonSignedRank",
      tail,
      variance,
      groups: [a, b],
      statistic: res.statistic,
      df: res.df,
      pValue: res.pValue,
      effectSize: res.effectSize,
      effectSizeLabel: res.effectSizeLabel,
      hedgesG: res.hedgesG,
      effectSizeCI95: res.effectSizeCI95,
      ci95: res.ci95,
      meanA,
      meanB,
      meanDiff: meanA - meanB,
    };
  }

  return { ok: false, error: `Unsupported analysis type "${spec.type}".` };
}
