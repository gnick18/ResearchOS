// Random-intercept linear mixed-effects model (LMM) fit by REML, the
// statsmodels MixedLM default. The data is the row-paired Column table reshaped
// to long form: each row a subject, each selected column a within-subject
// condition. We model
//
//   y_ij = X_ij beta + u_i + e_ij,   u_i ~ N(0, sigma_u^2),  e_ij ~ N(0, sigma_e^2)
//
// where X treatment-codes the condition fixed effect (first condition the
// reference) and u_i is a per-subject random intercept.
//
// For a random-intercept-only model the marginal covariance is block-diagonal,
// one block per group i with n_i observations:
//
//   V_i = sigma_e^2 * I + sigma_u^2 * J = sigma_e^2 * (I + theta * J),  theta = sigma_u^2 / sigma_e^2
//
// where J is the all-ones n_i x n_i matrix. Because V_i depends on the single
// scalar theta, the REML fit is a 1-D optimization: profile out beta (GLS) and
// the residual scale sigma_e^2 analytically at each theta, then maximize the
// profiled restricted log-likelihood over theta >= 0 with a bounded
// golden-section search. No general optimizer is needed.
//
// We never form V_i explicitly. For a block of size m with weights, the
// Sherman-Morrison identity gives the exact action of (I + theta J)^-1:
//
//   (I + theta J)^-1 = I - (theta / (1 + theta m)) * J
//
// so for any vectors a, b in the block,
//
//   a' (I + theta J)^-1 b = a'b - (theta / (1 + theta m)) * (sum a)(sum b)
//
// and the log-determinant of the block is log(1 + theta m). These two facts make
// every quantity below O(total observations) per theta evaluation.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { solveWithInverse } from "./linalg";
import { normalCdf } from "./dists";
import type {
  EngineResult,
  MixedModelFixedEffect,
  MixedModelResult,
} from "./types";

/** A subject's complete-case measurements across the k conditions, in order. */
type SubjectRow = number[];

interface LongRow {
  /** Response value. */
  y: number;
  /** Fixed-effect design row, length p (intercept + dummies). */
  x: number[];
  /** Group (subject) index. */
  group: number;
}

/**
 * The pieces (I + theta J)^-1 lets us accumulate per block, given the design X,
 * the response y, and the group structure. We compute, summed across blocks:
 *   XtVinvX (p x p), XtVinvy (p), ytVinvy (scalar), and sum of log|I + theta J_i|.
 */
function glsAccumulate(
  rows: LongRow[],
  groupSizes: number[],
  theta: number,
  p: number,
): {
  XtVinvX: number[][];
  XtVinvy: number[];
  ytVinvy: number;
  logDet: number;
} {
  const nGroups = groupSizes.length;

  // Per-block running sums. For block g we need sum over its rows of x x',
  // x y, y y, and the column sums sum(x), sum(y).
  const XtVinvX: number[][] = Array.from({ length: p }, () =>
    new Array<number>(p).fill(0),
  );
  const XtVinvy = new Array<number>(p).fill(0);
  let ytVinvy = 0;
  let logDet = 0;

  // Bucket rows by group so each block's column sums are independent.
  const byGroup: LongRow[][] = Array.from({ length: nGroups }, () => []);
  for (const r of rows) byGroup[r.group].push(r);

  for (let g = 0; g < nGroups; g++) {
    const block = byGroup[g];
    const m = block.length;
    if (m === 0) continue;
    const c = theta / (1 + theta * m); // Sherman-Morrison shrinkage scalar.
    logDet += Math.log(1 + theta * m);

    // Plain (identity-metric) sums over the block.
    const sumX = new Array<number>(p).fill(0);
    let sumY = 0;
    for (const r of block) {
      for (let j = 0; j < p; j++) sumX[j] += r.x[j];
      sumY += r.y;
    }

    for (const r of block) {
      for (let i = 0; i < p; i++) {
        XtVinvy[i] += r.x[i] * r.y;
        for (let j = 0; j < p; j++) XtVinvX[i][j] += r.x[i] * r.x[j];
      }
      ytVinvy += r.y * r.y;
    }
    // Subtract the rank-one correction c * (sum a)(sum b).
    for (let i = 0; i < p; i++) {
      XtVinvy[i] -= c * sumX[i] * sumY;
      for (let j = 0; j < p; j++) XtVinvX[i][j] -= c * sumX[i] * sumX[j];
    }
    ytVinvy -= c * sumY * sumY;
  }

  return { XtVinvX, XtVinvy, ytVinvy, logDet };
}

/**
 * The profiled restricted (REML) log-likelihood for a given variance ratio theta.
 * At fixed theta the GLS estimate beta-hat solves (X'V^-1 X) beta = X'V^-1 y with
 * V = sigma_e^2 (block(I + theta J)), and the REML estimate of sigma_e^2 is
 *   s2 = (y - X beta)' Vw^-1 (y - X beta) / (N - p)
 * where Vw = block(I + theta J) is V with sigma_e^2 = 1. The profiled REML
 * objective (up to additive constants independent of theta) is
 *   -2 logL_R = (N - p) * log(s2) + logDet(Vw) + logDet(X' Vw^-1 X)
 * We minimize this; the additive constant is restored once at the optimum so the
 * reported log-likelihood matches statsmodels.
 */
function profiledNeg2RemlCore(
  rows: LongRow[],
  groupSizes: number[],
  theta: number,
  p: number,
  N: number,
): {
  neg2: number;
  beta: number[];
  s2: number;
  invXtVinvX: number[][];
  logDetVw: number;
  logDetXtVinvX: number;
  rss: number;
} | null {
  const { XtVinvX, XtVinvy, ytVinvy, logDet } = glsAccumulate(
    rows,
    groupSizes,
    theta,
    p,
  );
  const solved = solveWithInverse(XtVinvX, XtVinvy);
  if (!solved) return null;
  const beta = solved.solution;
  const invXtVinvX = solved.inverse;

  // RSS in the Vw metric: y'Vw^-1 y - beta' X'Vw^-1 y.
  let betaXtVinvy = 0;
  for (let i = 0; i < p; i++) betaXtVinvy += beta[i] * XtVinvy[i];
  const rss = ytVinvy - betaXtVinvy;
  if (!(rss > 0)) return null;
  const dfResid = N - p;
  const s2 = rss / dfResid;

  // log|X' Vw^-1 X| via the LU-free route: det from the inverse is awkward, so
  // recompute the determinant by reducing XtVinvX directly.
  const logDetXtVinvX = logDeterminant(XtVinvX);
  if (logDetXtVinvX === null) return null;

  const neg2 = dfResid * Math.log(s2) + logDet + logDetXtVinvX;
  return {
    neg2,
    beta,
    s2,
    invXtVinvX,
    logDetVw: logDet,
    logDetXtVinvX,
    rss,
  };
}

/**
 * Log of the determinant of a small positive-definite matrix via Gaussian
 * elimination with partial pivoting. Both matrices we take a log-determinant of
 * (X'X and X' Vw^-1 X) are positive definite, so all pivots are positive and the
 * sum of log|pivot| is the log-determinant. Returns null if a pivot collapses
 * (numerically singular, e.g. collinear conditions).
 */
function logDeterminant(A: number[][]): number | null {
  const n = A.length;
  const m = A.map((row) => row.slice());
  let logDet = 0;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(m[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m[r][col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best < 1e-14) return null;
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    const pv = m[col][col];
    logDet += Math.log(Math.abs(pv));
    for (let r = col + 1; r < n; r++) {
      const factor = m[r][col] / pv;
      if (factor === 0) continue;
      for (let j = col; j < n; j++) m[r][j] -= factor * m[col][j];
    }
  }
  return logDet;
}

/**
 * Golden-section minimization of f on [lo, hi]. The profiled REML objective in
 * theta is smooth and (for a single variance component) unimodal on the
 * nonnegative ratio, so a bounded golden-section search converges without a
 * general optimizer. Returns the minimizing theta.
 */
function goldenSectionMin(
  f: (x: number) => number,
  lo: number,
  hi: number,
  tol: number,
  maxIter: number,
): number {
  const gr = (Math.sqrt(5) - 1) / 2; // ~0.618
  let a = lo;
  let b = hi;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < maxIter && b - a > tol; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - gr * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + gr * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

/**
 * Fit the random-intercept LMM by REML. `subjects` are the complete-case rows of
 * the Column table (each an array of the k condition measurements in
 * `conditionLabels` order, the same shape the repeated-measures ANOVA reads).
 * The condition is treatment-coded with the first label as the reference, so the
 * fixed effects are the intercept (reference-condition mean) and one coefficient
 * per non-reference condition (its difference from the reference). The random
 * intercept groups by subject (the row index).
 */
export function randomInterceptModel(
  subjects: SubjectRow[],
  conditionLabels?: string[],
): EngineResult<MixedModelResult> {
  const complete = subjects.filter(
    (r) => r.length > 0 && r.every((v) => Number.isFinite(v)),
  );
  const nSubjects = complete.length;
  if (nSubjects < 2) {
    return { ok: false, error: "Need at least 2 subjects with complete data." };
  }
  const k = complete[0].length;
  if (k < 2) {
    return { ok: false, error: "Need at least 2 conditions." };
  }
  if (!complete.every((r) => r.length === k)) {
    return {
      ok: false,
      error: "Every subject must have the same number of conditions.",
    };
  }

  const labels =
    conditionLabels && conditionLabels.length === k
      ? conditionLabels
      : Array.from({ length: k }, (_, i) => `C${i + 1}`);

  // Build the long-form design. p = 1 intercept + (k - 1) condition dummies.
  const p = k;
  const rows: LongRow[] = [];
  for (let s = 0; s < nSubjects; s++) {
    for (let j = 0; j < k; j++) {
      const x = new Array<number>(p).fill(0);
      x[0] = 1; // intercept
      if (j > 0) x[j] = 1; // treatment dummy for condition j (reference is j === 0)
      rows.push({ y: complete[s][j], x, group: s });
    }
  }
  const groupSizes = new Array<number>(nSubjects).fill(k);
  const N = rows.length;
  if (N - p <= 0) {
    return { ok: false, error: "Not enough observations to fit the model." };
  }

  // Optimize theta = sigma_u^2 / sigma_e^2 over a generous nonnegative range. The
  // upper bound is loose; the objective flattens well before it for these designs.
  const objective = (theta: number): number => {
    const core = profiledNeg2RemlCore(rows, groupSizes, theta, p, N);
    return core ? core.neg2 : Number.POSITIVE_INFINITY;
  };
  const thetaHat = goldenSectionMin(objective, 0, 1e4, 1e-10, 500);

  const core = profiledNeg2RemlCore(rows, groupSizes, thetaHat, p, N);
  if (!core) {
    return { ok: false, error: "The mixed model failed to converge." };
  }
  const { beta, s2, invXtVinvX, logDetVw, logDetXtVinvX } = core;

  // Variance components. sigma_e^2 = s2 (the REML residual scale); the
  // random-intercept variance is theta * sigma_e^2.
  const residualVariance = s2;
  const groupVariance = thetaHat * s2;

  // Fixed-effect covariance is sigma_e^2 * (X' Vw^-1 X)^-1.
  const fixedEffects: MixedModelFixedEffect[] = [];
  for (let i = 0; i < p; i++) {
    const se = Math.sqrt(Math.max(0, s2 * invXtVinvX[i][i]));
    const est = beta[i];
    const z = se > 0 ? est / se : NaN;
    const pValue = Number.isFinite(z)
      ? 2 * (1 - normalCdf(Math.abs(z)))
      : NaN;
    const half = 1.959963984540054 * se; // z_{0.975}
    fixedEffects.push({
      name: i === 0 ? "(Intercept)" : labels[i],
      estimate: est,
      standardError: se,
      z,
      pValue,
      ciLow: est - half,
      ciHigh: est + half,
    });
  }

  // REML log-likelihood, on the statsmodels MixedLM convention so the reported
  // value matches the oracle. The restricted log-likelihood is
  //   logL_R = -0.5 * [ (N - p) * log(2 pi s2) + (N - p) + logDetVw + logDetXtVinvX ]
  // The (N - p) term is the score-equation residual at the REML scale (RSS / s2 =
  // N - p by construction), logDetVw = sum_i log|I + theta J_i| is the marginal
  // log-determinant at unit residual scale, and logDetXtVinvX = log|X' Vw^-1 X| is
  // the REML correction for estimating the p fixed effects. Verified to match
  // statsmodels 0.14 MixedLM.llf on the REPEATED fixture to within the
  // variance-component optimizer wobble.
  const dfResid = N - p;
  const remlLogLikelihood =
    -0.5 *
    (dfResid * Math.log(2 * Math.PI * s2) +
      dfResid +
      logDetVw +
      logDetXtVinvX);

  return {
    ok: true,
    test: "Random-intercept linear mixed model (REML)",
    fixedEffects,
    groupVariance,
    residualVariance,
    remlLogLikelihood,
    groups: nSubjects,
    observations: N,
    conditionLabels: labels,
  };
}
