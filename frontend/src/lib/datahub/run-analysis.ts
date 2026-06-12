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
  logisticRegression,
  type LogisticRegressionResult,
  type LogisticCoefficient,
  multipleRegression,
  type MultipleRegressionResult,
  type MultipleRegressionCoefficient,
  kaplanMeier,
  logRank,
  coxPH,
  type CoxCoefficient,
  shapiroWilk,
  bootstrapDiffCI,
  meanDifference,
  fitModel,
  fitGlobal,
  fivePLLogEC50Shift,
  extraSumOfSquaresF,
  aiccCompare,
  getModel,
  type KaplanMeierStep,
  type ModelFitSummary,
  type FTestComparison,
  type AiccComparison,
} from "@/lib/datahub/engine";
import type { FitResult } from "@/lib/datahub/engine/types";
import type { GlobalFitResult } from "@/lib/datahub/engine";
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
import { readParams, globalFitSharedNames } from "@/lib/datahub/analysis-params";
import type { Tail } from "@/lib/datahub/engine/types";
import type { PostHocMethod } from "@/lib/datahub/engine/anova";
import { columnValues, groupColumns } from "@/lib/datahub/column-table";
import { isCellExcluded } from "@/lib/datahub/cell-exclusion";
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
  | "logisticRegression"
  | "doseResponse"
  | "modelComparison"
  | "globalFit"
  | "twoWayAnova"
  | "kaplanMeier"
  | "coxRegression"
  | "multipleRegression";

/** The analysis types that read a Survival table (time + event + group). */
export const SURVIVAL_ANALYSIS_TYPES: AnalysisType[] = [
  "kaplanMeier",
  "coxRegression",
];

/**
 * The analysis types that read an XY table. Most pair the single X with ONE Y;
 * globalFit is the exception (it reads SEVERAL Y datasets at once), so it is
 * offered only when the table has two or more Y columns. See validAnalysisTypes.
 */
export const XY_ANALYSIS_TYPES: AnalysisType[] = [
  "correlationPearson",
  "correlationSpearman",
  "linearRegression",
  "logisticRegression",
  "doseResponse",
  "modelComparison",
  "globalFit",
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
  "multipleRegression",
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
  /**
   * Distribution-free bootstrap 95% CI of the mean difference (BCa, fixed seed),
   * an additive robust companion to the parametric ci95 above. Computed only on
   * the raw-data parametric t-tests (unpaired / paired), since the rank tests are
   * already the nonparametric path and the from-stats path has no replicates to
   * resample. Null when not computed. This does NOT redefine ci95 (the parametric
   * mean-difference CI) and is not stored anywhere; it is a render-time readout.
   */
  bootstrapCI95: [number, number] | null;
  /**
   * True when a Shapiro-Wilk check on the group(s) flags a departure from
   * normality, so the sheet can foreground the bootstrap CI as the more honest
   * interval. Advisory only; the test still runs as chosen.
   */
  normalityShaky: boolean;
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
 * A normalized simple logistic-regression result (Prism's "Simple logistic
 * regression"). Fits P(Y=1) = 1 / (1 + exp(-(b0 + b1*x))) by maximum likelihood
 * (IRLS) on one continuous X and one binary Y. Reports the intercept and slope
 * (each with SE, Wald z, two-sided normal p, and a log-odds 95% CI), the odds
 * ratio exp(b1) with its 95% CI, the model fit (log-likelihood, null
 * log-likelihood, McFadden pseudo-R-squared, iterations), the X at P=0.5
 * (-b0/b1, the dose-response-style readout Prism shows), and the ROC AUC of the
 * fitted probabilities. The raw values are carried so the code snippet reproduces
 * the numbers.
 */
export interface NormalizedLogisticRegression {
  kind: "logisticRegression";
  type: "logisticRegression";
  xName: string;
  yName: string;
  x: number[];
  y: number[];
  n: number;
  intercept: LogisticCoefficient;
  slope: LogisticCoefficient;
  oddsRatio: number;
  oddsRatioCI95: [number, number];
  logLikelihood: number;
  nullLogLikelihood: number;
  mcFaddenR2: number;
  /** The X where P = 0.5, namely -b0/b1. Labeled "X at P=0.5" in the UI. */
  xAtHalf: number;
  /** Area under the ROC curve of the fitted probabilities. */
  auc: number;
  iterations: number;
}

/**
 * A normalized multiple linear regression result (Prism's "Multiple linear
 * regression"). Fits y = b0 + b1*x1 + ... + bk*xk by ordinary least squares on
 * one Y column and two or more predictor columns of a Column table. Reports each
 * coefficient (intercept and every slope) with its SE, t, two-sided Student-t p,
 * 95% CI, standardized beta, and VIF; plus the overall fit (R-squared, adjusted
 * R-squared, residual standard error sigma, the overall F with its df and p, and
 * the log-likelihood). The raw Y and predictor matrix are carried so the code
 * snippet reproduces the numbers.
 */
export interface NormalizedMultipleRegression {
  kind: "multipleRegression";
  type: "multipleRegression";
  /** The Y (response) column name. */
  yName: string;
  /** The predictor column names, in coefficient order. */
  predictorNames: string[];
  /** The response values for the kept rows. */
  y: number[];
  /** One row per kept observation, each a predictor vector (length k). */
  predictors: number[][];
  n: number;
  nPredictors: number;
  coefficients: MultipleRegressionCoefficient[];
  intercept: MultipleRegressionCoefficient;
  slopes: MultipleRegressionCoefficient[];
  rSquared: number;
  adjRSquared: number;
  residualSE: number;
  fStatistic: number;
  fDfNum: number;
  fDfDen: number;
  fPValue: number;
  logLikelihood: number;
}

/** One fitted curve parameter with its standard error and 95% CI. */
export interface DoseResponseParam {
  name: string;
  value: number;
  standardError: number;
  ci95: [number, number];
}

/**
 * A normalized dose-response result (the signature pharmacology fit). Fits a 4PL
 * (default) or 5PL (asymmetric) logistic to log(dose) vs response and reports the
 * EC50 / IC50 with its 95% CI, the Hill slope, the Top and Bottom plateaus (each
 * with a CI), and R-squared, the Prism-familiar readout set.
 *
 * THE EC50 CI TRANSFORM. The fitter estimates a t-based CI on the logEC50 in log
 * space (symmetric there). Since EC50 = 10^logEC50True, the linear-space CI is
 * [10^lo, 10^hi], which is ASYMMETRIC about the EC50 point estimate (the upper
 * arm is longer). For the 5PL the logEC50 PARAMETER is not the half-max logEC50,
 * so the CI is shifted to the true half-max logEC50 before exponentiating, using
 * the same closed-form offset the engine derives (see fivePLLogEC50Shift). For the
 * 4PL the offset is 0 and logEC50True == logEC50.
 */
export interface NormalizedDoseResponse {
  kind: "doseResponse";
  type: "doseResponse";
  /** "logistic4pl" (symmetric) or "logistic5pl" (asymmetric). */
  model: "logistic4pl" | "logistic5pl";
  /** Human model label, e.g. "4-parameter logistic (variable slope)". */
  modelLabel: string;
  xName: string;
  yName: string;
  x: number[];
  y: number[];
  n: number;
  /** EC50 = IC50 at the true half-maximal response (linear-dose units). */
  ec50: number;
  /** Asymmetric 95% CI of the EC50 in linear-dose units ([10^lo, 10^hi]). */
  ec50CI95: [number, number];
  /** The half-max logEC50 the EC50 is 10^ of (== logEC50 param for 4PL). */
  logEC50: number;
  /** Hill slope, Top, Bottom (each name + value + SE + CI), in display order. */
  hillSlope: DoseResponseParam;
  top: DoseResponseParam;
  bottom: DoseResponseParam;
  /** The 5PL asymmetry exponent S, or null for the 4PL. */
  asymmetryS: DoseResponseParam | null;
  rSquared: number;
  /** Residual degrees of freedom n - p, so the report can show the fit basis. */
  df: number;
}

/** One model's summary line inside a normalized comparison result. */
export interface ModelComparisonLine {
  /** Stable model id (e.g. "logistic4pl"). */
  id: string;
  /** Human model label. */
  label: string;
  /** Number of fitted parameters. */
  nParams: number;
  /** Residual sum of squares at the converged fit. */
  ssr: number;
  /** R-squared of the fit, a familiar goodness-of-fit readout. */
  rSquared: number;
  /** AICc value (small-sample-corrected Akaike Information Criterion). */
  aicc: number;
  /** AICc minus the best (0 for the preferred model). */
  aiccDelta: number;
  /** Akaike weight: probability this model is the better of the two. */
  aiccProbability: number;
}

/**
 * A normalized model-comparison result (the Prism "Compare models" capability).
 * Fits TWO curve models to the SAME XY data and reports both methods Prism uses:
 *
 *   - The extra-sum-of-squares F test for NESTED models (the simpler model is a
 *     special case of the complex one), with F, the two df, p, and the model it
 *     prefers at alpha = 0.05. Only emitted when the user marks the pair nested.
 *   - AICc for either nested or non-nested pairs, with each model's AICc, the
 *     difference, the Akaike weights (probability each model is correct), and the
 *     preferred model.
 *
 * Both readouts come from real fit output (residual sum of squares + parameter
 * count) via the engine's compare module, not a reimplementation here.
 */
export interface NormalizedModelComparison {
  kind: "modelComparison";
  type: "modelComparison";
  xName: string;
  yName: string;
  x: number[];
  y: number[];
  n: number;
  /** The simpler model (fewer parameters) and the more complex model. */
  simpler: ModelComparisonLine;
  complex: ModelComparisonLine;
  /** True when the user asserted the pair is nested (enables the F test). */
  nested: boolean;
  /** The extra-sum-of-squares F test, or null when the pair is not nested. */
  fTest: {
    f: number;
    dfNumerator: number;
    dfDenominator: number;
    pValue: number;
    /** Human label of the model the F test prefers at alpha = 0.05. */
    preferredLabel: string;
    preferredId: string;
    alpha: number;
  } | null;
  /** The AICc verdict (always present). */
  aicc: {
    /** Human label of the lower-AICc model. */
    preferredLabel: string;
    preferredId: string;
    /** Absolute AICc difference between the two models. */
    deltaAbs: number;
    /** Evidence ratio of the preferred over the other model. */
    evidenceRatio: number;
  };
}

/** One shared parameter of a global fit: a single value + SE + CI for all curves. */
export interface GlobalSharedParam {
  name: string;
  value: number;
  standardError: number;
  ci95: [number, number];
}

/** One curve's local parameter (e.g. its own EC50): value + SE + CI + the EC50. */
export interface GlobalLocalParam {
  /** The dataset (Y column) label this local value belongs to. */
  datasetLabel: string;
  /** The fitted logEC50 parameter value + its SE and (log-space) CI. */
  logEC50: number;
  logEC50SE: number;
  logEC50CI95: [number, number];
  /** EC50 = 10^logEC50True (linear dose), and its asymmetric CI [10^lo, 10^hi]. */
  ec50: number;
  ec50CI95: [number, number];
}

/**
 * A normalized GLOBAL (shared-parameter) fit result (Prism "global fitting").
 * Fits ONE dose-response curve form (4PL default, 5PL optional) to SEVERAL Y
 * datasets at once. Each parameter is either SHARED across all curves (one value
 * fit globally) or LOCAL (fit per curve). The signature case shares the Hill
 * slope and the Top / Bottom plateaus and keeps the EC50 (logEC50) local, so the
 * EC50s can be compared with every curve held to a common shape.
 *
 * THE EC50 CI TRANSFORM is the same as the single dose-response fit. The fitter
 * estimates a t-based CI on each curve's logEC50 in log space (symmetric there);
 * EC50 = 10^logEC50True, so the linear-dose CI is [10^lo, 10^hi], asymmetric about
 * the EC50 point. For the 5PL the logEC50 parameter is shifted to the true half-max
 * by the closed-form offset before exponentiating (the same fivePLLogEC50Shift the
 * single fit uses); for the 4PL the offset is 0.
 */
export interface NormalizedGlobalFit {
  kind: "globalFit";
  type: "globalFit";
  /** "logistic4pl" (symmetric) or "logistic5pl" (asymmetric). */
  model: "logistic4pl" | "logistic5pl";
  modelLabel: string;
  /** The shared `share` preset, for the show-code / plain-language reproduction. */
  share: string;
  xName: string;
  /** The Y dataset (column) names, in fit order. */
  datasetNames: string[];
  /** The shared X grid (each curve reads its own finite pairs off this X). */
  /** The raw (x, y) arrays per curve, so the sheet can plot and the code can rerun. */
  curves: { name: string; x: number[]; y: number[] }[];
  /** Shared parameters (Hill / Top / Bottom by default), one value each. */
  sharedParams: GlobalSharedParam[];
  /** Local parameters, one EC50 (+ logEC50) per curve. */
  localParams: GlobalLocalParam[];
  /** Number of curves fit together. */
  nDatasets: number;
  /** Total finite points across all curves. */
  nTotal: number;
  /** Total free parameters in the global vector. */
  nParams: number;
  /** Total residual sum of squares across all curves. */
  ssrTotal: number;
  /** Global R-squared 1 - SS_res_total/SS_tot_total (pooled over every point). */
  rSquared: number;
  /** Total residual degrees of freedom N_total - P. */
  df: number;
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

/**
 * A normalized Cox proportional hazards result. One coefficient per covariate
 * (the Data Hub surfaces the single arm-indicator covariate, Treatment vs
 * Control), plus the overall fit summary. From the engine's coxPH.
 */
export interface NormalizedCoxRegression {
  kind: "coxRegression";
  type: "coxRegression";
  n: number;
  events: number;
  coefficients: CoxCoefficient[];
  logLikelihood: number;
  nullLogLikelihood: number;
  lrChiSquare: number;
  lrDf: number;
  lrPValue: number;
  concordance: number;
}

export type NormalizedResult =
  | NormalizedTTest
  | NormalizedAnova
  | NormalizedCorrelation
  | NormalizedRegression
  | NormalizedLogisticRegression
  | NormalizedMultipleRegression
  | NormalizedDoseResponse
  | NormalizedModelComparison
  | NormalizedGlobalFit
  | NormalizedTwoWayAnova
  | NormalizedSurvival
  | NormalizedCoxRegression;

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
      // Dose-response needs more than its 4 (4PL) or 5 (5PL) parameters to fit,
      // but the precise point-count guard lives in the run (the engine rejects an
      // underdetermined fit cleanly), so the type is offered whenever an XY pairing
      // exists. The default 4PL is the listed-first XY analysis after regression.
      // Global fitting is the one XY analysis that reads SEVERAL Y datasets, so it
      // is offered only once the table has two or more Y columns to share across.
      const hasMultipleY = yColumns(content).length >= 2;
      return XY_ANALYSIS_TYPES.filter(
        (t) => t !== "globalFit" || hasMultipleY,
      );
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
    // Multiple regression treats one column as Y and the rest as predictors, so
    // it needs at least 3 columns (a Y plus 2 predictors).
    out.push("multipleRegression");
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

/** Pull one fitted parameter (value + SE + CI) out of a FitResult by name. */
function fitParam(fit: FitResult, name: string): DoseResponseParam {
  const p = fit.parameters.find((q) => q.name === name);
  return {
    name,
    value: p?.value ?? NaN,
    standardError: p?.standardError ?? NaN,
    ci95: p?.ci95 ?? [NaN, NaN],
  };
}

/**
 * Fit a dose-response curve (4PL default, 5PL optional) to the resolved XY pairs
 * and normalize the EC50 / Hill / Top / Bottom / R-squared readouts.
 *
 * THE EC50 CI. The fitter reports a symmetric t-based CI on the logEC50 parameter
 * in log space. EC50 = 10^logEC50True, so the linear-dose CI is [10^lo, 10^hi],
 * which is asymmetric about the EC50 point estimate. For the 5PL the logEC50
 * PARAMETER is not the half-max logEC50, so the log-space CI is shifted by the
 * closed-form half-max offset (fivePLLogEC50Shift) before exponentiating; for the
 * 4PL that offset is 0. This reuses the fitter's already-computed covariance, it
 * does not re-derive any standard errors.
 */
function runDoseResponse(
  spec: AnalysisSpec,
  xName: string,
  yName: string,
  x: number[],
  y: number[],
): RunOutcome {
  const model =
    (readParams(spec).model as "logistic4pl" | "logistic5pl" | undefined) ??
    "logistic4pl";
  const fit = fitModel(model, x, y);
  if (!fit.ok) return { ok: false, error: fit.error };
  const res = fit as FitResult & { ok: true };

  const logParam = res.parameters.find((p) => p.name === "logEC50");
  if (!logParam) {
    return { ok: false, error: "Dose-response fit produced no logEC50." };
  }
  // The half-max offset is 0 for the 4PL and the closed-form 5PL correction for
  // the 5PL. The same offset translates both the point estimate and the CI bounds
  // from the raw logEC50 parameter to the true half-max logEC50, so the EC50 CI
  // is the exponentiated, shifted, t-based interval (asymmetric in linear dose).
  const sValue = model === "logistic5pl" ? (res.values.S ?? NaN) : NaN;
  const shift =
    model === "logistic5pl"
      ? fivePLLogEC50Shift(res.values.HillSlope ?? NaN, sValue)
      : 0;
  const logEC50True = logParam.value + shift;
  const ec50 = Math.pow(10, logEC50True);
  const ciLo = Math.pow(10, logParam.ci95[0] + shift);
  const ciHi = Math.pow(10, logParam.ci95[1] + shift);
  // Exponentiation preserves order, so [10^lo, 10^hi] is already sorted; guard a
  // degenerate (non-finite) CI by falling back to NaNs the sheet renders as a dash.
  const ec50CI95: [number, number] =
    Number.isFinite(ciLo) && Number.isFinite(ciHi) ? [ciLo, ciHi] : [NaN, NaN];

  return {
    ok: true,
    kind: "doseResponse",
    type: "doseResponse",
    model,
    modelLabel: res.modelLabel,
    xName,
    yName,
    x,
    y,
    n: x.length,
    ec50,
    ec50CI95,
    logEC50: logEC50True,
    hillSlope: fitParam(res, "HillSlope"),
    top: fitParam(res, "Top"),
    bottom: fitParam(res, "Bottom"),
    asymmetryS: model === "logistic5pl" ? fitParam(res, "S") : null,
    rSquared: res.rSquared,
    df: res.df,
  };
}

/**
 * Compare two curve models fit to the same XY pairs (the Prism "Compare models"
 * capability). Reads the two model ids and the nested flag from the spec params,
 * fits each model through the SAME engine the dose-response analysis uses, and
 * hands the residual sum of squares + parameter counts to the engine's compare
 * module for the extra-sum-of-squares F test (nested pairs only) and AICc (always).
 *
 * The two models are ordered by parameter count so the F test always treats the
 * model with fewer parameters as the "simpler" one regardless of pick order. A
 * tie in parameter count disables the F test (the F test needs the complex model
 * to spend strictly more parameters) while AICc still reports a verdict.
 */
function runModelComparison(
  spec: AnalysisSpec,
  xName: string,
  yName: string,
  x: number[],
  y: number[],
): RunOutcome {
  const p = readParams(spec);
  const idA = (p.modelA as string | undefined) ?? "logistic4pl";
  const idB = (p.modelB as string | undefined) ?? "logistic5pl";
  const nested = (p.nested as string | undefined) === "yes";
  if (idA === idB) {
    return { ok: false, error: "Pick two different models to compare." };
  }
  const modelA = getModel(idA);
  const modelB = getModel(idB);
  if (!modelA || !modelB) {
    return { ok: false, error: "Pick two models the fitter knows." };
  }
  const fitA = fitModel(idA, x, y);
  if (!fitA.ok) return { ok: false, error: `${modelA.label}: ${fitA.error}` };
  const fitB = fitModel(idB, x, y);
  if (!fitB.ok) return { ok: false, error: `${modelB.label}: ${fitB.error}` };
  const n = x.length;

  // Order by parameter count so the F test always sees the simpler model first.
  // A tie keeps the user's order but disables the F test below.
  const sumA: ModelFitSummary = {
    id: idA,
    label: modelA.label,
    ssr: fitA.ssr,
    nParams: modelA.paramNames.length,
    n,
  };
  const sumB: ModelFitSummary = {
    id: idB,
    label: modelB.label,
    ssr: fitB.ssr,
    nParams: modelB.paramNames.length,
    n,
  };
  const [simple, complex] =
    sumA.nParams <= sumB.nParams ? [sumA, sumB] : [sumB, sumA];
  const fitById: Record<string, typeof fitA & { ok: true }> = {
    [idA]: fitA as typeof fitA & { ok: true },
    [idB]: fitB as typeof fitB & { ok: true },
  };

  const labelOf = (id: string): string =>
    id === simple.id ? simple.label : complex.label;

  const line = (s: ModelFitSummary, aiccLine: AiccComparison["models"][number]): ModelComparisonLine => ({
    id: s.id,
    label: s.label,
    nParams: s.nParams,
    ssr: s.ssr,
    rSquared: fitById[s.id].rSquared,
    aicc: aiccLine.aicc,
    aiccDelta: aiccLine.delta,
    aiccProbability: aiccLine.probability,
  });

  const aiccResult = aiccCompare([simple, complex]);
  const aiccLineOf = (id: string) =>
    aiccResult.models.find((m) => m.id === id)!;

  // The F test only runs for a nested pair with a strict parameter increase.
  const canFTest = nested && complex.nParams > simple.nParams;
  let fTest: NormalizedModelComparison["fTest"] = null;
  if (canFTest) {
    const f: FTestComparison = extraSumOfSquaresF(simple, complex);
    fTest = {
      f: f.f,
      dfNumerator: f.dfNumerator,
      dfDenominator: f.dfDenominator,
      pValue: f.pValue,
      preferredLabel: labelOf(f.preferredId),
      preferredId: f.preferredId,
      alpha: f.alpha,
    };
  }

  return {
    ok: true,
    kind: "modelComparison",
    type: "modelComparison",
    xName,
    yName,
    x,
    y,
    n,
    simpler: line(simple, aiccLineOf(simple.id)),
    complex: line(complex, aiccLineOf(complex.id)),
    nested,
    fTest,
    aicc: {
      preferredLabel: labelOf(aiccResult.preferredId),
      preferredId: aiccResult.preferredId,
      deltaAbs: Math.abs(
        aiccLineOf(simple.id).aicc - aiccLineOf(complex.id).aicc,
      ),
      evidenceRatio: aiccResult.evidenceRatio,
    },
  };
}

/**
 * Run a GLOBAL (shared-parameter) dose-response fit across SEVERAL Y datasets at
 * once. Unlike the single-Y XY analyses, this reads every Y column on the table
 * (each its own finite (x, y) pairs against the shared X), so it resolves its own
 * datasets rather than going through resolveXY. The `share` preset is expanded to
 * the explicit shared-parameter list; every other model parameter is fit local
 * (one value per curve). Both readouts Prism reports come straight out of the
 * engine's fitGlobal: each shared parameter's single value + SE + CI, and each
 * curve's local EC50 (transformed from the logEC50 CI exactly as the single
 * dose-response fit does), plus the global R-squared and the fit stats.
 */
function runGlobalFit(
  content: DataHubDocContent,
  spec: AnalysisSpec,
): RunOutcome {
  const xCol = xColumn(content);
  if (!xCol) {
    return { ok: false, error: "Global fitting needs an X column." };
  }
  const yCols = yColumns(content);
  if (yCols.length < 2) {
    return {
      ok: false,
      error: "Global fitting needs at least 2 Y datasets to share parameters across.",
    };
  }

  const params = readParams(spec);
  const model =
    (params.model as "logistic4pl" | "logistic5pl" | undefined) ?? "logistic4pl";
  const sharedNames = globalFitSharedNames(params.share ?? "hill-top-bottom");

  // Resolve each Y column into its own finite (x, y) dataset against the shared X.
  const datasets = yCols.map((c) => {
    const pairs = xyPairs(content, c.id);
    return { label: c.name, x: pairs.x, y: pairs.y };
  });

  const fit = fitGlobal(model, datasets, sharedNames);
  if (!fit.ok) return { ok: false, error: fit.error };
  const res = fit as GlobalFitResult & { ok: true };

  // Shared parameters: pass the engine's single value + SE + CI straight through,
  // in the model's declared order (Bottom, Top, HillSlope, [S]).
  const sharedParams: GlobalSharedParam[] = res.parameters
    .filter((p) => p.shared)
    .map((p) => ({
      name: p.name,
      value: p.value,
      standardError: p.standardError,
      ci95: p.ci95,
    }));

  // The 5PL half-max shift translates each curve's logEC50 parameter to its true
  // half-max logEC50. It depends on that curve's Hill slope and S, which may be
  // shared (one value) or local (per curve). Resolve each per curve so the shift
  // is correct whether or not Hill is shared (S is shared in every EC50-local
  // preset). For the 4PL the shift is 0.
  const sharedValue = (name: string): number | undefined =>
    res.parameters.find((p) => p.name === name && p.shared)?.value;
  const localValue = (name: string, label: string): number | undefined =>
    res.parameters.find(
      (p) => p.name === name && !p.shared && p.datasetLabel === label,
    )?.value;
  const curveValue = (name: string, label: string): number =>
    sharedValue(name) ?? localValue(name, label) ?? NaN;
  const shiftFor = (label: string): number =>
    model === "logistic5pl"
      ? fivePLLogEC50Shift(curveValue("HillSlope", label), curveValue("S", label))
      : 0;

  // Local EC50 per curve, transformed from the logEC50 CI exactly as runDoseResponse.
  const localParams: GlobalLocalParam[] = res.parameters
    .filter((p) => p.name === "logEC50" && !p.shared)
    .map((p) => {
      const shift = shiftFor(p.datasetLabel ?? "");
      const logEC50True = p.value + shift;
      const ec50 = Math.pow(10, logEC50True);
      const ciLo = Math.pow(10, p.ci95[0] + shift);
      const ciHi = Math.pow(10, p.ci95[1] + shift);
      const ec50CI95: [number, number] =
        Number.isFinite(ciLo) && Number.isFinite(ciHi) ? [ciLo, ciHi] : [NaN, NaN];
      return {
        datasetLabel: p.datasetLabel ?? "",
        logEC50: logEC50True,
        logEC50SE: p.standardError,
        logEC50CI95: [p.ci95[0] + shift, p.ci95[1] + shift],
        ec50,
        ec50CI95,
      };
    });

  return {
    ok: true,
    kind: "globalFit",
    type: "globalFit",
    model,
    modelLabel: res.modelLabel,
    share: params.share ?? "hill-top-bottom",
    xName: xCol.name,
    datasetNames: res.datasetLabels,
    curves: datasets.map((d) => ({ name: d.label, x: d.x, y: d.y })),
    sharedParams,
    localParams,
    nDatasets: res.nDatasets,
    nTotal: res.nTotal,
    nParams: res.nParams,
    ssrTotal: res.ssrTotal,
    rSquared: res.rSquared,
    df: res.df,
  };
}

/** Run a correlation or linear regression on the resolved XY pairs. */
function runXYAnalysis(
  type: AnalysisType,
  content: DataHubDocContent,
  spec: AnalysisSpec,
): RunOutcome {
  // Global fitting reads SEVERAL Y datasets, so it resolves its own inputs before
  // the single-Y resolveXY (which would otherwise reject when no single Y is set).
  if (type === "globalFit") {
    return runGlobalFit(content, spec);
  }

  const resolved = resolveXY(content, spec);
  if (!resolved) {
    return {
      ok: false,
      error: "Pick an X column and a Y column on this XY table.",
    };
  }
  const { xName, yName, x, y } = resolved;

  if (type === "doseResponse") {
    return runDoseResponse(spec, xName, yName, x, y);
  }

  if (type === "modelComparison") {
    return runModelComparison(spec, xName, yName, x, y);
  }

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

  if (type === "logisticRegression") {
    // Simple logistic regression is the k=1 case of the engine's IRLS fit; pass
    // a single-predictor design matrix and the binary Y. The engine drops any row
    // whose Y is not 0/1, so a stray value cannot corrupt the maximum-likelihood fit.
    const r = logisticRegression(x.map((xv) => [xv]), y, [xName]);
    if (!r.ok) return { ok: false, error: r.error };
    const res = r as LogisticRegressionResult & { ok: true };
    return {
      ok: true,
      kind: "logisticRegression",
      type,
      xName,
      yName,
      x,
      y,
      n: res.n,
      intercept: res.intercept,
      slope: res.slope,
      oddsRatio: res.oddsRatio,
      oddsRatioCI95: res.oddsRatioCI95,
      logLikelihood: res.logLikelihood,
      nullLogLikelihood: res.nullLogLikelihood,
      mcFaddenR2: res.mcFaddenR2,
      xAtHalf: res.xAtHalf,
      auc: res.auc,
      iterations: res.iterations,
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

/**
 * Read one cell as a finite number, or null. Mirrors columnValues' parse (a
 * numeric cell, or a numeric-looking string), but per row so the caller can keep
 * rows aligned across columns. An excluded cell reads as null (treated absent).
 */
function numericCell(
  content: DataHubDocContent,
  rowId: string,
  columnId: string,
): number | null {
  if (isCellExcluded(content, rowId, columnId)) return null;
  const v = content.rows.find((r) => r.id === rowId)?.cells[columnId];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Run a multiple linear regression. The spec stores the Y column id first and
 * the predictor column ids after it (inputs.columnIds = [yId, x1Id, x2Id, ...]).
 * We read the columns row by row and keep only rows where the Y and EVERY
 * predictor are finite, so the design matrix stays aligned. The engine fits OLS
 * via the normal equations.
 */
function runMultipleRegression(
  content: DataHubDocContent,
  spec: AnalysisSpec,
): RunOutcome {
  const ids = specColumnIds(spec);
  if (ids.length < 3) {
    return {
      ok: false,
      error: "Multiple regression needs a Y column and at least 2 predictors.",
    };
  }
  const byId = new Map(groupColumns(content).map((c) => [c.id, c.name]));
  const yId = ids[0];
  const xIds = ids.slice(1);
  if (!byId.has(yId) || !xIds.every((id) => byId.has(id))) {
    return { ok: false, error: "Pick a Y column and 2 or more predictor columns." };
  }
  const yName = byId.get(yId) as string;
  const predictorNames = xIds.map((id) => byId.get(id) as string);

  // Build row-aligned Y and predictor matrix, dropping any row with a missing or
  // non-finite Y or predictor (listwise deletion, what Prism and statsmodels do).
  const y: number[] = [];
  const predictors: number[][] = [];
  for (const row of content.rows) {
    const yv = numericCell(content, row.id, yId);
    if (yv === null) continue;
    const xs = xIds.map((id) => numericCell(content, row.id, id));
    if (xs.some((v) => v === null)) continue;
    y.push(yv);
    predictors.push(xs as number[]);
  }

  const r = multipleRegression(predictors, y, predictorNames);
  if (!r.ok) return { ok: false, error: r.error };
  const res = r as MultipleRegressionResult & { ok: true };
  return {
    ok: true,
    kind: "multipleRegression",
    type: "multipleRegression",
    yName,
    predictorNames,
    y,
    predictors,
    n: res.n,
    nPredictors: res.nPredictors,
    coefficients: res.coefficients,
    intercept: res.intercept,
    slopes: res.slopes,
    rSquared: res.rSquared,
    adjRSquared: res.adjRSquared,
    residualSE: res.residualSE,
    fStatistic: res.fStatistic,
    fDfNum: res.fDfNum,
    fDfDen: res.fDfDen,
    fPValue: res.fPValue,
    logLikelihood: res.logLikelihood,
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

/**
 * Run a Cox proportional hazards regression on a Survival table. The single
 * covariate is the arm indicator. The first arm in the table is the reference
 * (covariate 0); each later arm gets covariate 1, so exp(coef) is that arm's
 * hazard ratio versus the reference. With one arm there is nothing to compare.
 */
function runCoxAnalysis(content: DataHubDocContent): RunOutcome {
  const groups = survivalGroups(content).filter(
    (g) => g.observations.length > 0,
  );
  if (groups.length < 2) {
    return {
      ok: false,
      error: "Cox regression needs two arms (a reference and a comparison).",
    };
  }
  // First arm is the reference (indicator 0); the second arm is the comparison
  // (indicator 1). The covariate is named for the comparison arm.
  const reference = groups[0].name;
  const comparison = groups[1].name;
  const rows = [
    ...groups[0].observations.map((o) => ({
      time: o.time,
      event: o.event,
      covariates: [0],
    })),
    ...groups[1].observations.map((o) => ({
      time: o.time,
      event: o.event,
      covariates: [1],
    })),
  ];
  const covariateName = `${comparison} vs ${reference}`;
  const res = coxPH(rows, [covariateName]);
  if (!res.ok) return { ok: false, error: res.error };

  return {
    ok: true,
    kind: "coxRegression",
    type: "coxRegression",
    n: res.n,
    events: res.events,
    coefficients: res.coefficients,
    logLikelihood: res.logLikelihood,
    nullLogLikelihood: res.nullLogLikelihood,
    lrChiSquare: res.lrChiSquare,
    lrDf: res.lrDf,
    lrPValue: res.lrPValue,
    concordance: res.concordance,
  };
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
    // No raw replicates in the from-stats path, so there is nothing to resample;
    // the bootstrap CI is honestly null and the normality flag is left false.
    bootstrapCI95: null,
    normalityShaky: false,
    meanA: a.mean,
    meanB: b.mean,
    meanDiff: a.mean - b.mean,
  };
}

/**
 * Advisory normality check for the parametric t-tests, reusing the engine's
 * Shapiro-Wilk. WHY this shape: for the UNPAIRED test the t assumption is on each
 * group, so we flag when EITHER group departs from normal; for the PAIRED test
 * the assumption is on the within-pair differences, so we test those. A
 * conservative alpha of 0.05 matches the Report Card convention. Any group too
 * small for Shapiro-Wilk (n < 3) or a degenerate fit returns "not shaky", since
 * we will not cry wolf on a sample we cannot judge.
 */
function isNormalityShaky(
  a: number[],
  b: number[],
  type: "unpairedTTest" | "pairedTTest",
): boolean {
  const failsNormality = (values: number[]): boolean => {
    const sw = shapiroWilk(values, 0.05);
    return sw.ok ? !sw.pass : false;
  };
  if (type === "pairedTTest") {
    if (a.length !== b.length) return false;
    const diffs = a.map((v, i) => v - b[i]);
    return failsNormality(diffs);
  }
  return failsNormality(a) || failsNormality(b);
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
    type === "linearRegression" ||
    type === "logisticRegression" ||
    type === "doseResponse" ||
    type === "modelComparison" ||
    type === "globalFit"
  ) {
    return runXYAnalysis(type, content, spec);
  }

  if (type === "twoWayAnova") {
    return runTwoWayAnalysis(content, spec);
  }

  if (type === "kaplanMeier") {
    return runSurvivalAnalysis(content);
  }

  if (type === "coxRegression") {
    return runCoxAnalysis(content);
  }

  if (type === "multipleRegression") {
    return runMultipleRegression(content, spec);
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
    const nonparametric =
      type === "mannWhitneyU" || type === "wilcoxonSignedRank";
    // Additive bootstrap CI of the mean difference for the PARAMETRIC raw-data t
    // tests only. WHY only those: the rank tests already ARE the nonparametric
    // path, so a bootstrap there would be redundant, and the bootstrap needs raw
    // replicates which only this path has. A FIXED seed keeps a given table's CI
    // stable across re-runs. The normality flag below tells the sheet when to
    // foreground it, but it is reported either way as a robust companion CI.
    const parametric = type === "unpairedTTest" || type === "pairedTTest";
    const bootstrapCI95 = parametric
      ? bootstrapDiffCI(a.values, b.values, meanDifference, {
          B: 2000,
          alpha: 0.05,
          method: "bca",
          seed: 0x5eed,
        })?.ci ?? null
      : null;
    const normalityShaky = parametric
      ? isNormalityShaky(a.values, b.values, type)
      : false;
    return {
      ok: true,
      kind: "ttest",
      type,
      test: res.test,
      nonparametric,
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
      bootstrapCI95,
      normalityShaky,
      meanA,
      meanB,
      meanDiff: meanA - meanB,
    };
  }

  return { ok: false, error: `Unsupported analysis type "${spec.type}".` };
}
