// Survival analysis: the Kaplan-Meier product-limit estimator and the log-rank
// test. Authored here (no @stdlib survival package is in the dependency set) and
// pinned in the test suite against R's survival package and lifelines on the
// classic aml / leukemia dataset, so the numbers match the references bench
// scientists already trust.
//
// Conventions. An observation is a (time, event) pair where event = 1 means the
// event was observed at that time and event = 0 means the subject was right
// censored (still event-free when last seen). Times must be non-negative and
// finite; anything else is dropped.
//
// Kaplan-Meier. At each distinct event time t, with n at risk (time >= t) and d
// events, the survival drops by the factor (1 - d/n). Greenwood's formula gives
// the variance of the estimate. The median survival is the first time the curve
// falls to or below 0.5.
//
// Log-rank. Across the pooled event times, each group's observed events are
// compared with the events expected under the null that every group shares one
// survival curve. The test statistic is a quadratic form in (observed minus
// expected) with the hypergeometric variance-covariance, chi-square with
// (groups - 1) degrees of freedom. For two groups this reduces to the familiar
// (O1 - E1)^2 / V.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { Matrix, pseudoInverse } from "ml-matrix";

import { chiSquarePValue, normalQuantile, normalPValue } from "./dists";
import { solveWithInverse } from "./linalg";
import type { EngineResult } from "./types";

/** One survival observation: a time and whether the event was observed (1) or
 *  the subject was right censored (0). */
export interface SurvivalObservation {
  time: number;
  event: number;
}

/** One step of the Kaplan-Meier curve, at a distinct event time. */
export interface KaplanMeierStep {
  time: number;
  /** Number at risk just before this time (time >= t). */
  atRisk: number;
  /** Events observed at this time. */
  events: number;
  /** Censored at this time (reduce the at-risk set but cause no step down). */
  censored: number;
  /** The product-limit survival estimate just after this time. */
  survival: number;
  /** Greenwood standard error of the survival estimate. */
  se: number;
  /** Pointwise 95% confidence interval for the survival estimate (clamped 0..1). */
  ciLow: number;
  ciHigh: number;
}

export interface KaplanMeierResult {
  /** Total observations used. */
  n: number;
  /** Total events observed (the rest are censored). */
  events: number;
  /** The step-down points of the curve, in increasing time. */
  steps: KaplanMeierStep[];
  /** The median survival time (first time survival <= 0.5), or null when the
   *  curve never reaches 0.5. */
  median: number | null;
}

/** Per-group observed vs expected events from the log-rank computation. */
export interface LogRankGroup {
  name: string;
  n: number;
  observed: number;
  expected: number;
}

export interface LogRankResult {
  test: string;
  chiSquare: number;
  df: number;
  pValue: number;
  groups: LogRankGroup[];
}

/** Keep only finite, non-negative times; coerce event to 1 (observed) or 0. */
function cleanObservations(obs: SurvivalObservation[]): SurvivalObservation[] {
  const out: SurvivalObservation[] = [];
  for (const o of obs) {
    if (typeof o.time !== "number" || !Number.isFinite(o.time) || o.time < 0) {
      continue;
    }
    out.push({ time: o.time, event: o.event === 1 ? 1 : 0 });
  }
  return out;
}

/**
 * The Kaplan-Meier product-limit estimator for one group. Returns the survival
 * curve steps (one per distinct event time), the Greenwood standard errors and
 * pointwise 95% intervals, and the median survival time.
 */
export function kaplanMeier(
  observations: SurvivalObservation[],
): EngineResult<KaplanMeierResult> {
  const obs = cleanObservations(observations);
  const n = obs.length;
  if (n === 0) {
    return { ok: false, error: "No finite survival observations." };
  }

  // Distinct event times (times with at least one observed event), increasing.
  const eventTimes = [
    ...new Set(obs.filter((o) => o.event === 1).map((o) => o.time)),
  ].sort((a, b) => a - b);

  const z = normalQuantile(0.975, 0, 1);
  let survival = 1;
  let greenwoodSum = 0; // running sum of d / (n (n - d))
  let median: number | null = null;
  const steps: KaplanMeierStep[] = [];

  for (const t of eventTimes) {
    const atRisk = obs.filter((o) => o.time >= t).length;
    const events = obs.filter((o) => o.time === t && o.event === 1).length;
    const censored = obs.filter((o) => o.time === t && o.event === 0).length;
    if (atRisk === 0) continue;
    survival *= 1 - events / atRisk;
    if (atRisk - events > 0) {
      greenwoodSum += events / (atRisk * (atRisk - events));
    }
    const se = survival * Math.sqrt(greenwoodSum);
    const ciLow = Math.max(0, survival - z * se);
    const ciHigh = Math.min(1, survival + z * se);
    steps.push({ time: t, atRisk, events, censored, survival, se, ciLow, ciHigh });
    if (median === null && survival <= 0.5) median = t;
  }

  return {
    ok: true,
    n,
    events: obs.filter((o) => o.event === 1).length,
    steps,
    median,
  };
}

/**
 * The log-rank test comparing two or more survival curves. Each group is a named
 * set of (time, event) observations. Returns the chi-square statistic, its
 * degrees of freedom (groups - 1), the p-value, and the per-group observed vs
 * expected events. Uses the hypergeometric variance-covariance and a reduced
 * quadratic form, so it is correct for any number of groups.
 */
export function logRank(
  groups: { name: string; observations: SurvivalObservation[] }[],
): EngineResult<LogRankResult> {
  const g = groups.length;
  if (g < 2) {
    return { ok: false, error: "Log-rank needs at least 2 groups." };
  }
  const cleaned = groups.map((grp) => ({
    name: grp.name,
    obs: cleanObservations(grp.observations),
  }));
  if (cleaned.some((grp) => grp.obs.length === 0)) {
    return { ok: false, error: "Every group needs at least one observation." };
  }

  const allObs = cleaned.flatMap((grp) => grp.obs);
  const eventTimes = [
    ...new Set(allObs.filter((o) => o.event === 1).map((o) => o.time)),
  ].sort((a, b) => a - b);

  const observed = new Array(g).fill(0);
  const expected = new Array(g).fill(0);
  // Variance-covariance accumulator (g x g).
  const V: number[][] = Array.from({ length: g }, () => new Array(g).fill(0));

  for (const t of eventTimes) {
    const nTotal = allObs.filter((o) => o.time >= t).length;
    const dTotal = allObs.filter((o) => o.time === t && o.event === 1).length;
    if (nTotal <= 1 || dTotal === 0) continue;
    const nk = cleaned.map((grp) => grp.obs.filter((o) => o.time >= t).length);
    const dk = cleaned.map(
      (grp) => grp.obs.filter((o) => o.time === t && o.event === 1).length,
    );
    // Common factor for the hypergeometric variance at this time.
    const c = (dTotal * (nTotal - dTotal)) / (nTotal - 1);
    for (let k = 0; k < g; k++) {
      observed[k] += dk[k];
      expected[k] += (nk[k] * dTotal) / nTotal;
      const pk = nk[k] / nTotal;
      V[k][k] += c * pk * (1 - pk);
      for (let l = k + 1; l < g; l++) {
        const pl = nk[l] / nTotal;
        const cov = -c * pk * pl;
        V[k][l] += cov;
        V[l][k] += cov;
      }
    }
  }

  // Reduced quadratic form: drop the last group (the covariance matrix has rank
  // g - 1). chi2 = u_r^T V_r^{-1} u_r over the first g - 1 groups.
  const dim = g - 1;
  const u: number[] = [];
  for (let k = 0; k < dim; k++) u.push(observed[k] - expected[k]);
  const Vr: number[][] = [];
  for (let k = 0; k < dim; k++) {
    Vr.push(V[k].slice(0, dim));
  }

  let chiSquare: number;
  try {
    const uVec = new Matrix([u]); // 1 x dim
    const VrInv = pseudoInverse(new Matrix(Vr)); // dim x dim
    const q = uVec.mmul(VrInv).mmul(uVec.transpose()); // 1 x 1
    chiSquare = q.get(0, 0);
  } catch {
    return { ok: false, error: "Log-rank variance matrix is singular." };
  }
  if (!Number.isFinite(chiSquare) || chiSquare < 0) chiSquare = 0;

  const pValue = chiSquarePValue(chiSquare, dim);

  return {
    ok: true,
    test: "Log-rank test",
    chiSquare,
    df: dim,
    pValue,
    groups: cleaned.map((grp, k) => ({
      name: grp.name,
      n: grp.obs.length,
      observed: observed[k],
      expected: expected[k],
    })),
  };
}

export interface GehanBreslowWilcoxonGroup {
  name: string;
  n: number;
  /** Gehan-weighted observed events (sum of w_j d_kj). */
  observed: number;
  /** Gehan-weighted expected events (sum of w_j n_kj d_j / n_j). */
  expected: number;
}

export interface GehanBreslowWilcoxonResult {
  test: string;
  chiSquare: number;
  df: number;
  pValue: number;
  groups: GehanBreslowWilcoxonGroup[];
}

/**
 * The Gehan-Breslow-Wilcoxon test comparing two or more survival curves. This is
 * the same observed-minus-expected machinery as the log-rank test, but each
 * event time's contribution is weighted by w_j, the total number at risk across
 * all groups at that time. Because w_j is large early (when the risk sets are
 * full) and shrinks as subjects fail or censor, the test gives early deaths more
 * weight than the standard log-rank, which weights every event time equally. So
 * it is more sensitive to early separation of the curves. GraphPad Prism reports
 * both statistics on the Kaplan-Meier comparison.
 *
 * Returns the chi-square statistic, its degrees of freedom (groups - 1), the
 * p-value, and the per-group Gehan-weighted observed vs expected events. Uses the
 * hypergeometric variance-covariance scaled by w_j^2 and a reduced quadratic
 * form, so it is correct for any number of groups.
 */
export function gehanBreslowWilcoxon(
  groups: { name: string; observations: SurvivalObservation[] }[],
): EngineResult<GehanBreslowWilcoxonResult> {
  const g = groups.length;
  if (g < 2) {
    return {
      ok: false,
      error: "Gehan-Breslow-Wilcoxon needs at least 2 groups.",
    };
  }
  const cleaned = groups.map((grp) => ({
    name: grp.name,
    obs: cleanObservations(grp.observations),
  }));
  if (cleaned.some((grp) => grp.obs.length === 0)) {
    return { ok: false, error: "Every group needs at least one observation." };
  }

  const allObs = cleaned.flatMap((grp) => grp.obs);
  const eventTimes = [
    ...new Set(allObs.filter((o) => o.event === 1).map((o) => o.time)),
  ].sort((a, b) => a - b);

  const observed = new Array(g).fill(0);
  const expected = new Array(g).fill(0);
  // Variance-covariance accumulator (g x g), scaled by the Gehan weight squared.
  const V: number[][] = Array.from({ length: g }, () => new Array(g).fill(0));

  for (const t of eventTimes) {
    const nTotal = allObs.filter((o) => o.time >= t).length;
    const dTotal = allObs.filter((o) => o.time === t && o.event === 1).length;
    if (nTotal <= 1 || dTotal === 0) continue;
    // Gehan weight at this time is the total number at risk.
    const w = nTotal;
    const nk = cleaned.map((grp) => grp.obs.filter((o) => o.time >= t).length);
    const dk = cleaned.map(
      (grp) => grp.obs.filter((o) => o.time === t && o.event === 1).length,
    );
    // Common factor for the hypergeometric variance at this time, weighted by
    // w^2 (the weight applies to the observed-minus-expected difference, so it
    // squares into the variance).
    const c = (w * w * dTotal * (nTotal - dTotal)) / (nTotal - 1);
    for (let k = 0; k < g; k++) {
      observed[k] += w * dk[k];
      expected[k] += w * (nk[k] * dTotal) / nTotal;
      const pk = nk[k] / nTotal;
      V[k][k] += c * pk * (1 - pk);
      for (let l = k + 1; l < g; l++) {
        const pl = nk[l] / nTotal;
        const cov = -c * pk * pl;
        V[k][l] += cov;
        V[l][k] += cov;
      }
    }
  }

  // Reduced quadratic form: drop the last group (the covariance matrix has rank
  // g - 1). chi2 = u_r^T V_r^{-1} u_r over the first g - 1 groups.
  const dim = g - 1;
  const u: number[] = [];
  for (let k = 0; k < dim; k++) u.push(observed[k] - expected[k]);
  const Vr: number[][] = [];
  for (let k = 0; k < dim; k++) {
    Vr.push(V[k].slice(0, dim));
  }

  let chiSquare: number;
  try {
    const uVec = new Matrix([u]); // 1 x dim
    const VrInv = pseudoInverse(new Matrix(Vr)); // dim x dim
    const q = uVec.mmul(VrInv).mmul(uVec.transpose()); // 1 x 1
    chiSquare = q.get(0, 0);
  } catch {
    return {
      ok: false,
      error: "Gehan-Breslow-Wilcoxon variance matrix is singular.",
    };
  }
  if (!Number.isFinite(chiSquare) || chiSquare < 0) chiSquare = 0;

  const pValue = chiSquarePValue(chiSquare, dim);

  return {
    ok: true,
    test: "Gehan-Breslow-Wilcoxon test",
    chiSquare,
    df: dim,
    pValue,
    groups: cleaned.map((grp, k) => ({
      name: grp.name,
      n: grp.obs.length,
      observed: observed[k],
      expected: expected[k],
    })),
  };
}

// Cox proportional hazards regression.
//
// We fit the semiparametric Cox model by maximizing the Efron partial
// log-likelihood with Newton-Raphson. Efron is lifelines' CoxPHFitter default
// tie handling, so the coefficients match that reference on tied event times
// (which the classic leukemia dataset has many of). The baseline hazard is left
// unspecified; only the regression coefficients (log hazard ratios) are
// estimated.
//
// For a single covariate the Data Hub passes the arm indicator (Treatment = 1,
// Control = 0), so exp(coef) is the treatment-vs-control hazard ratio. The
// solver itself is general over k covariates.
//
// Efron partial log-likelihood. Order subjects by time. At each distinct event
// time t with d tied events, let R be the risk set (time >= t) and D the tied
// events. Efron replaces the single risk-set denominator with d denominators,
// the l-th removing a fraction l/d of the tied events' weight (l = 0 .. d - 1),
// which approximates the exact tied-data likelihood far better than Breslow.
// The gradient and the observed information (negative Hessian) follow from the
// fractionally weighted risk-set means at each Efron step.

/** One Cox covariate row: its covariate vector and event indicator at a time. */
export interface CoxObservation {
  time: number;
  event: number;
  /** Covariate values for this subject, one per predictor. */
  covariates: number[];
}

/** A fitted Cox coefficient for one covariate. */
export interface CoxCoefficient {
  name: string;
  /** The coefficient (log hazard ratio). */
  coef: number;
  /** Standard error from the inverse observed information at the MLE. */
  se: number;
  /** z = coef / se. */
  z: number;
  /** Two-sided normal p-value. */
  pValue: number;
  /** Hazard ratio exp(coef). */
  hazardRatio: number;
  /** 95% Wald confidence interval for the hazard ratio. */
  hrCiLow: number;
  hrCiHigh: number;
}

export interface CoxResult {
  test: string;
  /** Observations used (rows dropped for missing/invalid time or event). */
  n: number;
  /** Events observed (the rest are right censored). */
  events: number;
  coefficients: CoxCoefficient[];
  /** Maximized partial log-likelihood at the fitted coefficients. */
  logLikelihood: number;
  /** Partial log-likelihood of the null model (all coefficients zero). */
  nullLogLikelihood: number;
  /** Likelihood-ratio statistic 2 (ll - nullLl) vs the null model. */
  lrChiSquare: number;
  /** Degrees of freedom of the LR test (number of covariates). */
  lrDf: number;
  lrPValue: number;
  /** Harrell's concordance (c-index) over comparable pairs. */
  concordance: number;
  /** Newton-Raphson iterations run before convergence. */
  iterations: number;
}

/** Keep rows with finite, non-negative time and a finite covariate vector. */
function cleanCoxRows(rows: CoxObservation[]): CoxObservation[] {
  const out: CoxObservation[] = [];
  for (const r of rows) {
    if (typeof r.time !== "number" || !Number.isFinite(r.time) || r.time < 0) {
      continue;
    }
    if (!r.covariates.every((v) => typeof v === "number" && Number.isFinite(v))) {
      continue;
    }
    out.push({
      time: r.time,
      event: r.event === 1 ? 1 : 0,
      covariates: r.covariates.slice(),
    });
  }
  return out;
}

/**
 * The Breslow partial log-likelihood, its gradient, and the observed
 * information matrix at a coefficient vector. Subjects are walked from the
 * latest time to the earliest so the risk-set running sums build up
 * incrementally.
 */
function coxPartial(
  rows: CoxObservation[],
  beta: number[],
): { ll: number; grad: number[]; info: number[][] } {
  const p = beta.length;
  // Process distinct times from largest to smallest; the risk set only grows.
  const order = [...rows].sort((a, b) => b.time - a.time);
  let ll = 0;
  const grad = new Array<number>(p).fill(0);
  const info: number[][] = Array.from({ length: p }, () =>
    new Array<number>(p).fill(0),
  );

  // Running risk-set accumulators (subjects with time >= current time).
  let riskSum = 0; // sum of exp(eta)
  const riskX = new Array<number>(p).fill(0); // sum of exp(eta) * x
  const riskXX: number[][] = Array.from({ length: p }, () =>
    new Array<number>(p).fill(0),
  ); // sum of exp(eta) * x x'

  let i = 0;
  while (i < order.length) {
    const t = order[i].time;
    // Add every subject at this time to the risk set first, and separately
    // accumulate the tied EVENTS at this time (Efron mixes the tied events back
    // out of the risk set in fractional steps).
    let j = i;
    let dEvents = 0;
    const sumEventX = new Array<number>(p).fill(0); // sum of x over the d events
    let tieSum = 0; // sum of exp(eta) over the d events
    const tieX = new Array<number>(p).fill(0); // sum of exp(eta) * x over events
    const tieXX: number[][] = Array.from({ length: p }, () =>
      new Array<number>(p).fill(0),
    );
    while (j < order.length && order[j].time === t) {
      const x = order[j].covariates;
      let eta = 0;
      for (let a = 0; a < p; a++) eta += beta[a] * x[a];
      const w = Math.exp(eta);
      riskSum += w;
      for (let a = 0; a < p; a++) {
        riskX[a] += w * x[a];
        for (let b = 0; b < p; b++) riskXX[a][b] += w * x[a] * x[b];
      }
      if (order[j].event === 1) {
        dEvents += 1;
        for (let a = 0; a < p; a++) {
          sumEventX[a] += x[a];
          tieX[a] += w * x[a];
          for (let b = 0; b < p; b++) tieXX[a][b] += w * x[a] * x[b];
        }
        tieSum += w;
      }
      j += 1;
    }

    if (dEvents > 0 && riskSum > 0) {
      // Efron's tie handling (lifelines' CoxPHFitter default). Each of the d
      // tied events sees a risk-set denominator with a fraction l/d of the tied
      // events' weight removed, l = 0 .. d - 1.
      let etaEventSum = 0;
      for (let a = 0; a < p; a++) etaEventSum += beta[a] * sumEventX[a];
      ll += etaEventSum;

      for (let l = 0; l < dEvents; l++) {
        const f = l / dEvents;
        const denom = riskSum - f * tieSum;
        if (denom <= 0) continue;
        ll -= Math.log(denom);
        // Fractionally adjusted first and second moments at this Efron step.
        const num1 = new Array<number>(p).fill(0);
        for (let a = 0; a < p; a++) num1[a] = riskX[a] - f * tieX[a];
        const mean = new Array<number>(p).fill(0);
        for (let a = 0; a < p; a++) mean[a] = num1[a] / denom;
        for (let a = 0; a < p; a++) {
          grad[a] -= mean[a];
          for (let b = 0; b < p; b++) {
            const second = (riskXX[a][b] - f * tieXX[a][b]) / denom;
            info[a][b] += second - mean[a] * mean[b];
          }
        }
      }
      // The events' own covariate sum enters the gradient once.
      for (let a = 0; a < p; a++) grad[a] += sumEventX[a];
    }
    i = j;
  }

  return { ll, grad, info };
}

/**
 * Harrell's concordance (c-index). Over all comparable pairs (one subject has
 * an event strictly before the other subject's time), the pair is concordant
 * when the higher-risk subject (larger linear predictor) is the one who failed
 * first. Ties in risk score count as half.
 */
function concordance(rows: CoxObservation[], beta: number[]): number {
  const eta = rows.map((r) => {
    let s = 0;
    for (let a = 0; a < beta.length; a++) s += beta[a] * r.covariates[a];
    return s;
  });
  let concordant = 0;
  let comparable = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].event !== 1) continue;
    for (let j = 0; j < rows.length; j++) {
      if (i === j) continue;
      // i fails at time_i; the pair is comparable when j is still at risk then,
      // i.e. time_j > time_i (j either fails later or is censored later).
      if (rows[j].time > rows[i].time) {
        comparable += 1;
        if (eta[i] > eta[j]) concordant += 1;
        else if (eta[i] === eta[j]) concordant += 0.5;
      }
    }
  }
  return comparable === 0 ? 0.5 : concordant / comparable;
}

/**
 * Fit a Cox proportional hazards model by Newton-Raphson on the Breslow partial
 * log-likelihood. names labels each covariate column. Reports per covariate the
 * coefficient, SE, z, two-sided p, hazard ratio and its 95% Wald interval, plus
 * the maximized log-likelihood, the likelihood-ratio test vs the null, and
 * Harrell's concordance.
 */
export function coxPH(
  observations: CoxObservation[],
  names: string[],
): EngineResult<CoxResult> {
  const rows = cleanCoxRows(observations);
  const n = rows.length;
  if (n === 0) {
    return { ok: false, error: "No finite survival observations." };
  }
  const events = rows.filter((r) => r.event === 1).length;
  if (events === 0) {
    return { ok: false, error: "Cox regression needs at least one event." };
  }
  const p = names.length;
  if (p === 0 || rows.some((r) => r.covariates.length !== p)) {
    return { ok: false, error: "Cox regression needs at least one covariate." };
  }

  // The null partial log-likelihood (all coefficients zero) anchors the LR test.
  const nullFit = coxPartial(rows, new Array<number>(p).fill(0));
  const nullLogLikelihood = nullFit.ll;

  // Newton-Raphson. beta_{k+1} = beta_k + I^{-1} grad, with I the observed
  // information (negative Hessian). solveWithInverse gives both the step and the
  // inverse information reused as the coefficient covariance at the MLE.
  let beta = new Array<number>(p).fill(0);
  let inverse: number[][] | null = null;
  let logLikelihood = nullLogLikelihood;
  let iterations = 0;
  const maxIter = 50;
  for (let it = 0; it < maxIter; it++) {
    iterations = it + 1;
    const fit = coxPartial(rows, beta);
    const solved = solveWithInverse(fit.info, fit.grad);
    if (solved === null) {
      return {
        ok: false,
        error: "Cox information matrix is singular (collinear covariates).",
      };
    }
    const step = solved.solution;
    const next = beta.map((b, a) => b + step[a]);
    inverse = solved.inverse;
    logLikelihood = coxPartial(rows, next).ll;
    const delta = step.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
    beta = next;
    if (delta < 1e-9) break;
  }
  if (inverse === null) {
    return { ok: false, error: "Cox regression failed to converge." };
  }

  const z975 = normalQuantile(0.975, 0, 1);
  const coefficients: CoxCoefficient[] = beta.map((coef, a) => {
    const variance = inverse![a][a];
    const se = variance > 0 ? Math.sqrt(variance) : NaN;
    const z = se > 0 ? coef / se : NaN;
    const pValue = Number.isFinite(z) ? normalPValue(z, "two-sided") : NaN;
    const hazardRatio = Math.exp(coef);
    const hrCiLow = Math.exp(coef - z975 * se);
    const hrCiHigh = Math.exp(coef + z975 * se);
    return {
      name: names[a],
      coef,
      se,
      z,
      pValue,
      hazardRatio,
      hrCiLow,
      hrCiHigh,
    };
  });

  let lrChiSquare = 2 * (logLikelihood - nullLogLikelihood);
  if (!Number.isFinite(lrChiSquare) || lrChiSquare < 0) lrChiSquare = 0;
  const lrPValue = chiSquarePValue(lrChiSquare, p);

  return {
    ok: true,
    test: "Cox proportional hazards",
    n,
    events,
    coefficients,
    logLikelihood,
    nullLogLikelihood,
    lrChiSquare,
    lrDf: p,
    lrPValue,
    concordance: concordance(rows, beta),
    iterations,
  };
}
