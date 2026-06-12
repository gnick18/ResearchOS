// Ordinary least squares MULTIPLE linear regression (D5). Fits
// y = b0 + b1*x1 + b2*x2 + ... + bk*xk by the normal equations
// (X'X) b = X'y, then reuses (X'X)^-1 as the coefficient covariance (scaled by
// the residual variance sigma^2). Written for any k predictors.
//
// Matches GraphPad Prism's "Multiple linear regression". Reports each
// coefficient (the intercept and every slope) with its standard error, t
// statistic, two-sided p-value (Student t, df = n - k - 1), and 95% CI; the
// overall fit (R-squared, adjusted R-squared, the residual standard error sigma,
// the overall F statistic on (k, n - k - 1) df with its p-value, and the
// log-likelihood); the standardized (beta) coefficients; and the per-predictor
// variance inflation factor (VIF) as a multicollinearity readout.
//
// The OLS solution is closed-form and deterministic, so it is pinned at tight
// tolerances against statsmodels.api.OLS in the transparency suite.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { tCritTwoSided, tPValue, fPValue } from "./dists";
import { solveWithInverse } from "./linalg";
import type { EngineResult } from "./types";
import { mean as meanOf } from "./util";

export interface MultipleRegressionCoefficient {
  /** Term name, e.g. "Intercept" or a predictor column name. */
  name: string;
  /** Estimated coefficient. */
  estimate: number;
  /** Standard error, sqrt(sigma^2 * (X'X)^-1_jj). */
  standardError: number;
  /** t statistic, estimate / standardError. */
  t: number;
  /** Two-sided Student-t p-value on df = n - k - 1. */
  pValue: number;
  /** 95% CI, estimate +/- t_crit * SE. */
  ci95: [number, number];
  /**
   * Standardized (beta) coefficient. The intercept has no standardized form
   * (its standardized value is 0 by construction), so it is reported as NaN.
   */
  standardizedBeta: number;
  /**
   * Variance inflation factor for this predictor (NaN for the intercept). VIF_j
   * = 1 / (1 - R_j^2), where R_j^2 is from regressing predictor j on the other
   * predictors. 1 means no collinearity; large values flag redundant predictors.
   */
  vif: number;
}

export interface MultipleRegressionResult {
  n: number;
  /** Number of predictors (k), not counting the intercept. */
  nPredictors: number;
  /** Intercept then each slope, in order. coefficients[0] is the intercept. */
  coefficients: MultipleRegressionCoefficient[];
  /** The intercept coefficient (coefficients[0]), surfaced for convenience. */
  intercept: MultipleRegressionCoefficient;
  /** The slope coefficients (coefficients[1..]). */
  slopes: MultipleRegressionCoefficient[];
  /** Coefficient of determination R-squared. */
  rSquared: number;
  /** Adjusted R-squared, 1 - (1 - R2)*(n - 1)/(n - k - 1). */
  adjRSquared: number;
  /** Residual standard error sigma = sqrt(SSE / (n - k - 1)). */
  residualSE: number;
  /** Overall F statistic for H0 that all slopes are zero. */
  fStatistic: number;
  /** Numerator df of the overall F, namely k. */
  fDfNum: number;
  /** Denominator df of the overall F, namely n - k - 1. */
  fDfDen: number;
  /** p-value of the overall F. */
  fPValue: number;
  /** Maximized Gaussian log-likelihood of the fit. */
  logLikelihood: number;
  /** Residual sum of squares (SSE). */
  sse: number;
  /** Total sum of squares (SST). */
  sst: number;
  /** Fitted y for each kept row. */
  fitted: number[];
  /** Residual for each kept row. */
  residuals: number[];
}

/** Sample standard deviation (n - 1 denominator) of a finite array. */
function sampleSd(values: number[], m: number): number {
  const n = values.length;
  if (n < 2) return NaN;
  let s = 0;
  for (const v of values) {
    const d = v - m;
    s += d * d;
  }
  return Math.sqrt(s / (n - 1));
}

/**
 * R-squared of one predictor regressed on the OTHER predictors (with an
 * intercept), used for the VIF. Returns NaN when the auxiliary fit is singular
 * (a predictor perfectly explained by the others), which the caller maps to an
 * infinite VIF readout.
 */
function auxRSquared(columns: number[][], target: number, n: number): number {
  const others: number[][] = [];
  for (let j = 0; j < columns.length; j++) {
    if (j !== target) others.push(columns[j]);
  }
  const p = others.length + 1; // intercept + the other predictors
  const yCol = columns[target];
  const myT = meanOf(yCol);
  // Design with a leading 1; build X'X and X'y.
  const XtX: number[][] = Array.from({ length: p }, () =>
    new Array<number>(p).fill(0),
  );
  const Xty = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) {
    const row = [1, ...others.map((c) => c[i])];
    for (let a = 0; a < p; a++) {
      Xty[a] += row[a] * yCol[i];
      for (let b = a; b < p; b++) XtX[a][b] += row[a] * row[b];
    }
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
  const solved = solveWithInverse(XtX, Xty);
  if (!solved) return NaN;
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    let yhat = solved.solution[0];
    for (let j = 0; j < others.length; j++) yhat += solved.solution[j + 1] * others[j][i];
    const r = yCol[i] - yhat;
    sse += r * r;
    const d = yCol[i] - myT;
    sst += d * d;
  }
  return sst === 0 ? NaN : 1 - sse / sst;
}

/**
 * Fit OLS multiple linear regression. Each row of `predictors` is one
 * observation's k predictor values; `y` is the response. A constant intercept is
 * always added. Rows with any non-finite predictor or y are dropped.
 */
export function multipleRegression(
  predictors: number[][],
  y: ArrayLike<number>,
  predictorNames?: string[],
): EngineResult<MultipleRegressionResult> {
  // Keep only rows where y and every predictor are finite.
  const X: number[][] = [];
  const Y: number[] = [];
  const len = Math.min(predictors.length, y.length);
  for (let i = 0; i < len; i++) {
    const row = predictors[i];
    const yv = y[i];
    if (!Array.isArray(row)) continue;
    if (typeof yv !== "number" || !Number.isFinite(yv)) continue;
    if (!row.every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    X.push(row);
    Y.push(yv);
  }
  const n = X.length;
  if (n === 0) {
    return { ok: false, error: "No rows with a finite Y and finite predictors." };
  }
  const k = X[0].length;
  if (k < 2) {
    return { ok: false, error: "Multiple regression needs at least 2 predictors." };
  }
  if (!X.every((r) => r.length === k)) {
    return { ok: false, error: "Every observation must have the same predictors." };
  }
  const p = k + 1; // parameters including the intercept
  if (n < p + 1) {
    return {
      ok: false,
      error: `Need at least ${p + 1} rows to fit ${p} parameters (n > k + 1).`,
    };
  }

  // Predictor columns (length n each), used for VIF and standardized betas.
  const columns: number[][] = Array.from({ length: k }, (_, j) =>
    X.map((r) => r[j]),
  );

  // Normal equations: build X'X and X'y with the intercept as the leading term.
  const XtX: number[][] = Array.from({ length: p }, () =>
    new Array<number>(p).fill(0),
  );
  const Xty = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) {
    const row = [1, ...X[i]];
    const yi = Y[i];
    for (let a = 0; a < p; a++) {
      Xty[a] += row[a] * yi;
      for (let b = a; b < p; b++) XtX[a][b] += row[a] * row[b];
    }
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];

  const solved = solveWithInverse(XtX, Xty);
  if (!solved) {
    return {
      ok: false,
      error: "Predictors are collinear; the design matrix is singular.",
    };
  }
  const beta = solved.solution; // length p, beta[0] is the intercept
  const invXtX = solved.inverse;

  // Fitted values, residuals, SSE, SST.
  const my = meanOf(Y);
  const fitted = new Array<number>(n);
  const residuals = new Array<number>(n);
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    let yhat = beta[0];
    for (let j = 0; j < k; j++) yhat += beta[j + 1] * X[i][j];
    fitted[i] = yhat;
    const r = Y[i] - yhat;
    residuals[i] = r;
    sse += r * r;
    const d = Y[i] - my;
    sst += d * d;
  }

  const dfResid = n - p; // n - k - 1
  const sigma2 = sse / dfResid;
  const residualSE = Math.sqrt(sigma2);
  const rSquared = sst === 0 ? NaN : 1 - sse / sst;
  const adjRSquared =
    sst === 0 ? NaN : 1 - (1 - rSquared) * ((n - 1) / dfResid);

  // Overall F for H0 that every slope is zero, on (k, n - k - 1) df.
  const fDfNum = k;
  const fDfDen = dfResid;
  const fStatistic =
    sst === 0 || rSquared >= 1
      ? Infinity
      : (rSquared / fDfNum) / ((1 - rSquared) / fDfDen);
  const fp = Number.isFinite(fStatistic)
    ? fPValue(fStatistic, fDfNum, fDfDen)
    : 0;

  // Gaussian log-likelihood at the MLE sigma^2 = SSE / n (statsmodels convention).
  const sigma2Mle = sse / n;
  const logLikelihood =
    -0.5 * n * (Math.log(2 * Math.PI) + Math.log(sigma2Mle) + 1);

  // Standard deviation of y, for standardized betas.
  const sdY = sampleSd(Y, my);

  const names = ["Intercept"];
  for (let j = 0; j < k; j++) names.push(predictorNames?.[j] ?? `x${j + 1}`);

  const tCrit = tCritTwoSided(0.05, dfResid);
  const coefficients: MultipleRegressionCoefficient[] = [];
  for (let j = 0; j < p; j++) {
    const est = beta[j];
    const variance = sigma2 * invXtX[j][j];
    const se = variance > 0 ? Math.sqrt(variance) : NaN;
    const tStat = se > 0 ? est / se : NaN;
    const pVal = Number.isFinite(tStat)
      ? tPValue(tStat, dfResid, "two-sided")
      : NaN;
    let standardizedBeta = NaN;
    let vif = NaN;
    if (j >= 1) {
      const colMean = meanOf(columns[j - 1]);
      const sdX = sampleSd(columns[j - 1], colMean);
      standardizedBeta =
        sdY > 0 && Number.isFinite(sdX) ? est * (sdX / sdY) : NaN;
      const rj2 = auxRSquared(columns, j - 1, n);
      vif = Number.isFinite(rj2) ? (rj2 >= 1 ? Infinity : 1 / (1 - rj2)) : Infinity;
    }
    coefficients.push({
      name: names[j],
      estimate: est,
      standardError: se,
      t: tStat,
      pValue: pVal,
      ci95: [est - tCrit * se, est + tCrit * se],
      standardizedBeta,
      vif,
    });
  }

  return {
    ok: true,
    n,
    nPredictors: k,
    coefficients,
    intercept: coefficients[0],
    slopes: coefficients.slice(1),
    rSquared,
    adjRSquared,
    residualSE,
    fStatistic,
    fDfNum,
    fDfDen,
    fPValue: fp,
    logLikelihood,
    sse,
    sst,
    fitted,
    residuals,
  };
}
