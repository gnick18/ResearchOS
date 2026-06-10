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

export interface AnovaResult {
  test: string;
  table: AnovaTableRow[];
  /** Overall omnibus F and p (treatment row), surfaced for convenience. */
  statistic: number;
  pValue: number;
  comparisons: PairwiseComparison[];
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
