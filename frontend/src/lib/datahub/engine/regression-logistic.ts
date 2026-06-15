// Binary logistic regression fit by maximum likelihood via iteratively
// reweighted least squares (IRLS / Newton-Raphson on the log-likelihood). Models
// P(Y=1) = 1 / (1 + exp(-(b0 + b1*x1 + ... + bk*xk))). The solver is written for
// k predictors so multiple logistic regression can reuse it later; the Data Hub
// surfaces SIMPLE logistic regression (one predictor) as the first-class analysis.
//
// Matches GraphPad Prism's "Simple logistic regression". Reports each coefficient
// with its standard error (from the inverse Fisher information at the MLE), a Wald
// z and two-sided normal p-value, the odds ratio exp(b1) with its 95% CI, the
// log-likelihood, McFadden pseudo-R-squared, the iteration count, the X at P=0.5
// (-b0/b1, what Prism reports for dose-response-style logistic data), and the AUC
// of the fitted probabilities (cheap and deterministic from the fit).
//
// Deterministic given the data and the standard zero start, so it is pinned at
// tight tolerances against statsmodels.api.Logit in the transparency suite.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { normalCdf, normalQuantile } from "./dists";
import { solveWithInverse } from "./linalg";
import type { EngineResult } from "./types";

export interface LogisticCoefficient {
  /** Term name, e.g. "Intercept" or the X column name. */
  name: string;
  /** Estimated coefficient (log-odds scale). */
  estimate: number;
  /** Standard error from the inverse Fisher information at the MLE. */
  standardError: number;
  /** Wald z statistic, estimate / standardError. */
  z: number;
  /** Two-sided p-value from the standard normal. */
  pValue: number;
  /** 95% Wald CI on the log-odds scale, estimate +/- 1.96*SE. */
  ci95: [number, number];
}

export interface LogisticRegressionResult {
  n: number;
  /** Number of predictors (k); 1 for simple logistic regression. */
  nPredictors: number;
  /** Intercept then each slope, in order. coefficients[0] is the intercept. */
  coefficients: LogisticCoefficient[];
  /** The intercept coefficient (coefficients[0]), surfaced for convenience. */
  intercept: LogisticCoefficient;
  /** The single slope for simple logistic regression (coefficients[1]). */
  slope: LogisticCoefficient;
  /** Odds ratio for the slope, exp(b1). */
  oddsRatio: number;
  /** 95% CI of the odds ratio, exp(b1 +/- 1.96*SE). */
  oddsRatioCI95: [number, number];
  /** Maximized log-likelihood of the fitted model. */
  logLikelihood: number;
  /** Log-likelihood of the intercept-only (null) model. */
  nullLogLikelihood: number;
  /** McFadden pseudo-R-squared, 1 - LL_model / LL_null. */
  mcFaddenR2: number;
  /** The x where P = 0.5, namely -b0/b1. Labeled "X at P=0.5" in the UI. */
  xAtHalf: number;
  /** Area under the ROC curve of the fitted probabilities (Mann-Whitney form). */
  auc: number;
  /** Fitted P(Y=1) for each row. */
  fitted: number[];
  /** IRLS iterations to convergence. */
  iterations: number;
  /**
   * Which estimator produced the fit. "mle" is the standard maximum-likelihood
   * IRLS (Newton-Raphson) path used for well-behaved data. "firth" means the data
   * were completely or quasi-completely separable, so the MLE had no finite
   * maximum and the engine fell back to Firth's penalized likelihood (Jeffreys
   * prior), which keeps the estimates large but finite and stable.
   */
  method: "mle" | "firth";
}

/** Logistic sigmoid, numerically guarded against overflow for large |z|. */
function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Area under the ROC curve via the Mann-Whitney U identity (ties at 0.5). */
function rocAuc(probs: number[], y: number[]): number {
  let pos = 0;
  let neg = 0;
  for (const yi of y) {
    if (yi === 1) pos++;
    else neg++;
  }
  if (pos === 0 || neg === 0) return NaN;
  // Rank the predicted probabilities, average-ranking ties, then apply the
  // rank-sum form AUC = (R_pos - pos*(pos+1)/2) / (pos*neg).
  const idx = probs.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const ranks = new Array<number>(probs.length);
  let k = 0;
  while (k < idx.length) {
    let j = k;
    while (j + 1 < idx.length && idx[j + 1].p === idx[k].p) j++;
    const avg = (k + j) / 2 + 1; // 1-based average rank over the tie block
    for (let t = k; t <= j; t++) ranks[idx[t].i] = avg;
    k = j + 1;
  }
  let rankSumPos = 0;
  for (let i = 0; i < y.length; i++) if (y[i] === 1) rankSumPos += ranks[i];
  return (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

/**
 * Firth penalized-likelihood logistic fit (Jeffreys-prior bias reduction). Used
 * as a fallback when the plain maximum-likelihood IRLS does not converge, which
 * is the signature of complete or quasi-complete separation (the MLE runs off to
 * infinity, but the Firth estimate stays finite). The modified score adds the
 * Jeffreys term U*(b)_a = sum_i x_ia [ (y_i - mu_i) + h_i (0.5 - mu_i) ], where
 * h_i is the i-th hat-matrix diagonal under the IRLS weights. The Newton step
 * reuses the Fisher information H = X^T W X, so the standard errors the caller
 * reads off (X^T W X)^-1 at the Firth estimate match R's logistf and the Python
 * firthlogist package (the transparency gate pins them).
 *
 * `design` already includes the leading intercept column. Returns the converged
 * coefficients and the iteration count, or null when the information matrix is
 * singular at some step (a genuinely unidentified model).
 */
function firthNewton(
  design: number[][],
  Y: number[],
  p: number,
  n: number,
  maxIterations: number,
  tol: number,
): { beta: number[]; iterations: number } | null {
  const beta = new Array<number>(p).fill(0);
  // Cap each Newton component so a far-from-solution step under separation cannot
  // overshoot. The penalized score has a unique finite root, so capping only
  // shapes the path, never the destination.
  const maxStep = 5;
  let iterations = 0;
  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;
    const mu = new Array<number>(n);
    const w = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let eta = 0;
      for (let j = 0; j < p; j++) eta += design[i][j] * beta[j];
      const mi = sigmoid(eta);
      mu[i] = mi;
      w[i] = Math.max(mi * (1 - mi), 1e-10);
    }
    // Fisher information H = X^T W X.
    const H: number[][] = Array.from({ length: p }, () =>
      new Array<number>(p).fill(0),
    );
    for (let i = 0; i < n; i++) {
      const xi = design[i];
      for (let a = 0; a < p; a++) {
        const wxa = w[i] * xi[a];
        for (let b = a; b < p; b++) H[a][b] += wxa * xi[b];
      }
    }
    for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
    const inv = solveWithInverse(H, new Array<number>(p).fill(0));
    if (!inv) return null;
    const Iinv = inv.inverse;
    // Hat-matrix diagonal h_i = w_i * x_i^T Iinv x_i.
    const h = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const xi = design[i];
      let q = 0;
      for (let a = 0; a < p; a++) {
        let row = 0;
        for (let b = 0; b < p; b++) row += Iinv[a][b] * xi[b];
        q += xi[a] * row;
      }
      h[i] = w[i] * q;
    }
    // Modified (Firth) score U*_a = sum_i x_ia [ (y_i - mu_i) + h_i (0.5 - mu_i) ].
    const U = new Array<number>(p).fill(0);
    for (let i = 0; i < n; i++) {
      const adj = Y[i] - mu[i] + h[i] * (0.5 - mu[i]);
      const xi = design[i];
      for (let a = 0; a < p; a++) U[a] += xi[a] * adj;
    }
    // Newton step delta = Iinv U, capped per component.
    let maxDelta = 0;
    for (let a = 0; a < p; a++) {
      let d = 0;
      for (let b = 0; b < p; b++) d += Iinv[a][b] * U[b];
      if (d > maxStep) d = maxStep;
      else if (d < -maxStep) d = -maxStep;
      beta[a] += d;
      const ad = Math.abs(d);
      if (ad > maxDelta) maxDelta = ad;
    }
    if (maxDelta < tol) break;
  }
  return { beta, iterations };
}

/**
 * Fit binary logistic regression. Each row of `predictors` is one observation's
 * X values (length k); for simple logistic regression pass a single-column matrix.
 * `y` must be binary (0 or 1). A constant intercept term is always added.
 */
export function logisticRegression(
  predictors: number[][],
  y: ArrayLike<number>,
  predictorNames?: string[],
  maxIterations = 50,
  tol = 1e-10,
): EngineResult<LogisticRegressionResult> {
  // Keep only rows where y and every predictor are finite, and y is 0 or 1.
  const X: number[][] = [];
  const Y: number[] = [];
  const len = Math.min(predictors.length, y.length);
  for (let i = 0; i < len; i++) {
    const row = predictors[i];
    const yv = y[i];
    if (!Array.isArray(row)) continue;
    if (typeof yv !== "number" || (yv !== 0 && yv !== 1)) continue;
    if (!row.every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    X.push(row);
    Y.push(yv);
  }
  const n = X.length;
  if (n === 0) {
    return { ok: false, error: "No rows with a finite X and a binary (0/1) Y." };
  }
  const k = X[0].length;
  if (k < 1) return { ok: false, error: "Need at least one predictor column." };
  if (!X.every((r) => r.length === k)) {
    return { ok: false, error: "Every observation must have the same predictors." };
  }
  const p = k + 1; // parameters including the intercept
  if (n < p + 1) {
    return { ok: false, error: `Need at least ${p + 1} rows to fit ${p} parameters.` };
  }
  const ones = Y.reduce((s, v) => s + v, 0);
  if (ones === 0 || ones === n) {
    return { ok: false, error: "Y must contain both 0s and 1s to fit a model." };
  }

  // Design matrix with a leading 1 for the intercept.
  const design: number[][] = X.map((r) => [1, ...r]);

  // IRLS / Newton-Raphson. beta starts at zero (the statsmodels default start),
  // which makes the MLE deterministic and matches the pinned reference fit.
  const beta = new Array<number>(p).fill(0);
  let iterations = 0;
  let lastInverse: number[][] | null = null;
  let converged = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;
    // mu_i = sigmoid(eta_i); W_i = mu_i (1 - mu_i).
    const mu = new Array<number>(n);
    const w = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let eta = 0;
      for (let j = 0; j < p; j++) eta += design[i][j] * beta[j];
      const mi = sigmoid(eta);
      mu[i] = mi;
      // Floor the weight so a near-perfect fit does not make the Hessian singular.
      w[i] = Math.max(mi * (1 - mi), 1e-10);
    }
    // Gradient g = X^T (y - mu); Fisher information H = X^T W X.
    const g = new Array<number>(p).fill(0);
    const H: number[][] = Array.from({ length: p }, () =>
      new Array<number>(p).fill(0),
    );
    for (let i = 0; i < n; i++) {
      const resid = Y[i] - mu[i];
      const xi = design[i];
      for (let a = 0; a < p; a++) {
        g[a] += xi[a] * resid;
        const wxa = w[i] * xi[a];
        for (let b = a; b < p; b++) H[a][b] += wxa * xi[b];
      }
    }
    for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];

    const solved = solveWithInverse(H, g);
    if (!solved) {
      // Singular information, the hallmark of perfect separation. Abandon the MLE
      // and hand off to the Firth penalized fit below (converged stays false).
      break;
    }
    lastInverse = solved.inverse;
    let maxStep = 0;
    for (let j = 0; j < p; j++) {
      beta[j] += solved.solution[j];
      const s = Math.abs(solved.solution[j]);
      if (s > maxStep) maxStep = s;
    }
    if (maxStep < tol) {
      converged = true;
      break;
    }
  }

  // When the plain MLE did not converge (complete or quasi-complete separation
  // gives the likelihood no finite maximum) fall back to Firth's penalized
  // likelihood, which always has a finite maximum and yields large-but-stable
  // estimates. Well-behaved data converge above and never reach this branch, so
  // their pinned MLE results are unchanged.
  let method: "mle" | "firth" = "mle";
  if (!converged) {
    const firth = firthNewton(design, Y, p, n, 1000, tol);
    if (!firth) {
      return {
        ok: false,
        error: "Logistic fit did not converge within the iteration limit.",
      };
    }
    for (let j = 0; j < p; j++) beta[j] = firth.beta[j];
    iterations = firth.iterations;
    method = "firth";
  }

  // Covariance is the inverse Fisher information at the final estimate. Recompute
  // it at the final beta so the standard errors use the converged weights, not the
  // last step. For the Firth fit this is sqrt(diag((X^T W X)^-1)) at the Firth
  // estimate, the same Wald SE R logistf / firthlogist report.
  {
    const H: number[][] = Array.from({ length: p }, () =>
      new Array<number>(p).fill(0),
    );
    for (let i = 0; i < n; i++) {
      let eta = 0;
      for (let j = 0; j < p; j++) eta += design[i][j] * beta[j];
      const mi = sigmoid(eta);
      const wi = Math.max(mi * (1 - mi), 1e-12);
      const xi = design[i];
      for (let a = 0; a < p; a++) {
        const wxa = wi * xi[a];
        for (let b = a; b < p; b++) H[a][b] += wxa * xi[b];
      }
    }
    for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
    const inv = solveWithInverse(H, new Array<number>(p).fill(0));
    if (inv) lastInverse = inv.inverse;
  }

  if (!lastInverse) {
    return {
      ok: false,
      error: "Logistic fit did not converge within the iteration limit.",
    };
  }

  // Fitted probabilities and the maximized log-likelihood.
  const fitted = new Array<number>(n);
  let logLik = 0;
  for (let i = 0; i < n; i++) {
    let eta = 0;
    for (let j = 0; j < p; j++) eta += design[i][j] * beta[j];
    const mi = sigmoid(eta);
    fitted[i] = mi;
    const clamped = Math.min(Math.max(mi, 1e-15), 1 - 1e-15);
    logLik += Y[i] === 1 ? Math.log(clamped) : Math.log(1 - clamped);
  }

  // Null (intercept-only) log-likelihood at the base rate pbar = ones / n.
  const pbar = ones / n;
  const nullLogLik = ones * Math.log(pbar) + (n - ones) * Math.log(1 - pbar);
  const mcFaddenR2 = nullLogLik === 0 ? NaN : 1 - logLik / nullLogLik;

  const names = ["Intercept"];
  for (let j = 0; j < k; j++) {
    names.push(predictorNames?.[j] ?? `x${j + 1}`);
  }
  const z975 = normalQuantile(0.975); // ~1.959964
  const coefficients: LogisticCoefficient[] = [];
  for (let j = 0; j < p; j++) {
    const est = beta[j];
    const variance = lastInverse[j][j];
    const se = variance > 0 ? Math.sqrt(variance) : NaN;
    const z = se > 0 ? est / se : NaN;
    // Two-sided normal p-value, 2 * (1 - Phi(|z|)).
    const pVal = Number.isFinite(z) ? 2 * (1 - normalCdf(Math.abs(z))) : NaN;
    coefficients.push({
      name: names[j],
      estimate: est,
      standardError: se,
      z,
      pValue: pVal,
      ci95: [est - z975 * se, est + z975 * se],
    });
  }

  const intercept = coefficients[0];
  const slope = coefficients[1];
  const oddsRatio = Math.exp(slope.estimate);
  const oddsRatioCI95: [number, number] = [
    Math.exp(slope.ci95[0]),
    Math.exp(slope.ci95[1]),
  ];
  const xAtHalf =
    slope.estimate !== 0 ? -intercept.estimate / slope.estimate : NaN;
  const auc = rocAuc(fitted, Y);

  return {
    ok: true,
    n,
    nPredictors: k,
    coefficients,
    intercept,
    slope,
    oddsRatio,
    oddsRatioCI95,
    logLikelihood: logLik,
    nullLogLikelihood: nullLogLik,
    mcFaddenR2,
    xAtHalf,
    auc,
    fitted,
    iterations,
    method,
  };
}
