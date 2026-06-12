// Shared result and error types for the Data Hub statistics + curve-fitting
// engine. Every public function returns one of these typed shapes. On bad or
// degenerate input the engine returns a result with `ok: false` and a reason
// rather than throwing, so the calling UI can render a clean message.

export type Tail = "two-sided" | "less" | "greater";

export interface EngineError {
  ok: false;
  error: string;
}

export type EngineResult<T> = (T & { ok: true }) | EngineError;

/** Descriptive summary for a single column / group. */
export interface Descriptives {
  n: number;
  mean: number;
  sd: number;
  sem: number;
  variance: number;
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
  /** 95% confidence interval of the mean (Student t based). */
  ci95: [number, number];
  /** Coefficient of variation as a percentage (100 * sd / mean). */
  cvPercent: number;
}

export interface TTestResult {
  test: string;
  statistic: number;
  df: number;
  pValue: number;
  tail: Tail;
  /** Effect size: Cohen's d for t tests, rank-biserial for nonparametric. */
  effectSize: number;
  effectSizeLabel: string;
  /**
   * Hedges' g, the small-sample bias-corrected Cohen's d (g = J * d). Null for
   * the nonparametric rank tests, where the rank-biserial r in effectSize is the
   * reported effect size and no parametric d / g exists.
   */
  hedgesG: number | null;
  /**
   * 95% confidence interval of the STANDARDIZED effect size (Cohen's d) via the
   * noncentral t distribution. This is distinct from ci95, which is the CI of
   * the mean difference. Null for the nonparametric rank tests.
   */
  effectSizeCI95: [number, number] | null;
  /** Confidence interval of the difference in means where defined. */
  ci95: [number, number] | null;
  groupA?: Descriptives;
  groupB?: Descriptives;
}

export interface AnovaTableRow {
  source: string;
  df: number;
  ss: number;
  ms: number;
  /** F only on rows where it is defined (treatment / interaction). */
  f: number | null;
  pValue: number | null;
}

export interface PairwiseComparison {
  groupA: string;
  groupB: string;
  meanDiff: number;
  statistic: number;
  pValue: number;
  /** Multiple-comparison adjusted p-value. */
  pAdjusted: number;
  significant: boolean;
  method: string;
}

/**
 * Effect size for an omnibus ANOVA. eta-squared is the proportion of total
 * variance the grouping explains; omega-squared is its less biased counterpart.
 * Each carries a 95% CI from the noncentral F pivot. For Kruskal-Wallis there
 * are no sums of squares, so we report epsilon-squared (the rank-based analogue)
 * in etaSquared with omegaSquared and both CIs left null and an honest label.
 */
export interface AnovaEffectSize {
  /** "eta-squared" for ANOVA, "epsilon-squared" for Kruskal-Wallis. */
  label: string;
  etaSquared: number;
  omegaSquared: number | null;
  /** 95% CI of eta-squared via the noncentral F pivot; null when not defined. */
  etaSquaredCI95: [number, number] | null;
}

export interface AnovaResult {
  test: string;
  table: AnovaTableRow[];
  /** Overall omnibus F and p (treatment row), surfaced for convenience. */
  statistic: number;
  pValue: number;
  comparisons: PairwiseComparison[];
  /**
   * Omnibus effect size (eta-squared / omega-squared + CI for ANOVA,
   * epsilon-squared for Kruskal-Wallis). Null only when the design cannot define
   * one (for example the two-way table, which is left to its per-effect rows).
   */
  effectSize: AnovaEffectSize | null;
}

/**
 * One-way repeated-measures ANOVA result. Each subject (row) is measured under
 * every within-subject condition, so the design partitions the total variation
 * into a between-subjects term, the condition effect, and the residual error.
 *
 * The uncorrected F / df / p come straight from the classic decomposition. The
 * repeated-measures F is sensitive to a sphericity violation (unequal variances
 * of the pairwise condition differences), so we also report the
 * Greenhouse-Geisser and Huynh-Feldt epsilons and the p-values they imply when
 * the condition and error df are multiplied by epsilon. Partial eta-squared is
 * the share of variance the condition explains after the between-subjects
 * variation is set aside.
 */
export interface RmAnovaResult {
  test: string;
  table: AnovaTableRow[];
  /** Uncorrected condition F and p, surfaced for convenience. */
  statistic: number;
  pValue: number;
  /** k conditions, n subjects (complete cases only after listwise dropping). */
  conditions: number;
  subjects: number;
  /** Uncorrected condition and error degrees of freedom. */
  dfConditions: number;
  dfError: number;
  /** SS_conditions / (SS_conditions + SS_error). */
  partialEtaSquared: number;
  /** Greenhouse-Geisser epsilon and the p with df scaled by it. */
  greenhouseGeisserEpsilon: number;
  pGreenhouseGeisser: number;
  /** Huynh-Feldt epsilon and the p with df scaled by it. */
  huynhFeldtEpsilon: number;
  pHuynhFeldt: number;
  /** Per-condition mean across subjects, in condition order. */
  conditionMeans: number[];
  conditionLabels: string[];
}

/** One fixed-effect coefficient from a linear mixed model. */
export interface MixedModelFixedEffect {
  /** Term name. The intercept is "(Intercept)", each non-reference condition is
   * its column name (treatment-coded against the first condition). */
  name: string;
  estimate: number;
  /** Standard error from the inverse fixed-effect information at the optimum. */
  standardError: number;
  /** Wald z = estimate / standardError. */
  z: number;
  /** Two-sided normal p-value for z. */
  pValue: number;
  /** 95% Wald confidence interval, estimate +/- 1.96 * SE. */
  ciLow: number;
  ciHigh: number;
}

/**
 * A random-intercept linear mixed model fit by REML. The data is the row-paired
 * Column table reshaped to long form (response y, a treatment-coded categorical
 * fixed effect for condition, and a random intercept grouped by subject). The
 * fixed-effect coefficients and their SEs are stable across implementations; the
 * variance components and the REML log-likelihood come from a numeric optimum and
 * can wobble slightly between implementations.
 */
export interface MixedModelResult {
  test: string;
  fixedEffects: MixedModelFixedEffect[];
  /** Between-subject variance sigma_u^2 (the random-intercept variance). */
  groupVariance: number;
  /** Residual variance sigma_e^2. */
  residualVariance: number;
  /** Restricted (REML) log-likelihood at the optimum. */
  remlLogLikelihood: number;
  /** Number of groups (subjects) and total observations after listwise dropping. */
  groups: number;
  observations: number;
  /** The condition (column) names in order; the first is the reference level. */
  conditionLabels: string[];
}

export interface CorrelationResult {
  method: "pearson" | "spearman";
  n: number;
  /** Correlation coefficient (r or rho). */
  coefficient: number;
  statistic: number;
  df: number;
  pValue: number;
  ci95: [number, number];
  /** Coefficient of determination r^2, the share of variance explained. */
  rSquared: number;
  /**
   * 95% CI of r^2, obtained by squaring the (sorted) Fisher-z CI bounds of the
   * coefficient. When the coefficient CI straddles zero the lower r^2 bound is
   * clamped to 0, since r^2 cannot be negative.
   */
  rSquaredCI95: [number, number];
}

export interface LinearRegressionResult {
  n: number;
  slope: number;
  intercept: number;
  rSquared: number;
  slopeSE: number;
  interceptSE: number;
  slopeCI95: [number, number];
  interceptCI95: [number, number];
  /** Residual standard error (sqrt of MSE). */
  residualSE: number;
  residuals: number[];
  /** Predicted y at each x. */
  fitted: number[];
}

export interface AssumptionResult {
  test: string;
  statistic: number;
  pValue: number;
  /** True when the assumption holds (p >= alpha). */
  pass: boolean;
  alpha: number;
  note?: string;
}

// --- Nonlinear curve fitting ---

export interface FitParameter {
  name: string;
  value: number;
  standardError: number;
  ci95: [number, number];
}

export interface FitResult {
  modelId: string;
  modelLabel: string;
  parameters: FitParameter[];
  /** Convenience map name -> fitted value. */
  values: Record<string, number>;
  rSquared: number;
  adjustedRSquared: number;
  /** Sum of squared residuals at the solution. */
  ssr: number;
  /** Residual degrees of freedom n - p. */
  df: number;
  residuals: number[];
  fitted: number[];
  iterations: number;
  /** Derived readouts such as EC50/IC50, populated per model. */
  derived?: Record<string, number>;
}
