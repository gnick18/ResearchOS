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

import { chiSquarePValue, normalQuantile } from "./dists";
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
