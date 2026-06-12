// Single source of truth for distribution CDFs, quantiles, and the derived
// p-values / critical values used across the engine. Thin typed wrappers over
// the @stdlib base-dists namespaces, plus the studentized-range (q)
// distribution (via jstat) that Tukey HSD needs. Keeping every probability
// computation here means tests, ANOVA, correlation, regression, and curve
// fitting all agree on one numerical backend.

import tDist from "@stdlib/stats-base-dists-t";
import fDist from "@stdlib/stats-base-dists-f";
import chiDist from "@stdlib/stats-base-dists-chisquare";
import normalDist from "@stdlib/stats-base-dists-normal";
import { jStat } from "jstat";

import type { Tail } from "./types";

// --- Student's t ---

export function tCdf(x: number, df: number): number {
  return tDist.cdf(x, df);
}

/** Inverse CDF (quantile) of Student's t with `df` degrees of freedom. */
export function tQuantile(p: number, df: number): number {
  return tDist.quantile(p, df);
}

/**
 * Two-sided critical t value for the given alpha (e.g. alpha 0.05 -> the value
 * t* such that P(|T| <= t*) = 0.95). Used for 95% confidence intervals.
 */
export function tCritTwoSided(alpha: number, df: number): number {
  return tDist.quantile(1 - alpha / 2, df);
}

/** p-value for a t statistic under the chosen tail. */
export function tPValue(statistic: number, df: number, tail: Tail): number {
  const cdf = tDist.cdf(statistic, df);
  switch (tail) {
    case "less":
      return cdf;
    case "greater":
      return 1 - cdf;
    case "two-sided":
    default:
      // Symmetric: 2 * upper-tail beyond |statistic|.
      return 2 * (1 - tDist.cdf(Math.abs(statistic), df));
  }
}

// --- F distribution ---

export function fCdf(x: number, d1: number, d2: number): number {
  return fDist.cdf(x, d1, d2);
}

/** Upper-tail p-value for an F statistic (the only tail used in ANOVA). */
export function fPValue(statistic: number, d1: number, d2: number): number {
  return 1 - fDist.cdf(statistic, d1, d2);
}

// --- Chi-square ---

export function chiSquareCdf(x: number, df: number): number {
  return chiDist.cdf(x, df);
}

/** Upper-tail p-value for a chi-square statistic (Kruskal-Wallis, Friedman). */
export function chiSquarePValue(statistic: number, df: number): number {
  return 1 - chiDist.cdf(statistic, df);
}

// --- Standard normal ---

export function normalCdf(x: number, mu = 0, sigma = 1): number {
  return normalDist.cdf(x, mu, sigma);
}

export function normalQuantile(p: number, mu = 0, sigma = 1): number {
  return normalDist.quantile(p, mu, sigma);
}

/** Two-sided p-value for a z statistic. */
export function normalPValue(statistic: number, tail: Tail): number {
  const cdf = normalDist.cdf(statistic, 0, 1);
  switch (tail) {
    case "less":
      return cdf;
    case "greater":
      return 1 - cdf;
    case "two-sided":
    default:
      return 2 * (1 - normalDist.cdf(Math.abs(statistic), 0, 1));
  }
}

// --- Studentized range (q) distribution, for Tukey HSD + Dunn-style posthocs ---
// jstat.tukey.cdf(q, nMeans, df) gives P(Q <= q); .inv gives the critical q.

/** Upper-tail p-value for a studentized-range statistic q. */
export function studentizedRangePValue(
  q: number,
  nMeans: number,
  df: number,
): number {
  const p = 1 - jStat.tukey.cdf(Math.abs(q), nMeans, df);
  // Guard the jstat numeric integration against tiny negative / >1 drift.
  if (!Number.isFinite(p)) return NaN;
  return Math.min(1, Math.max(0, p));
}

/** Critical studentized-range value q* for the given alpha. */
export function studentizedRangeCrit(
  alpha: number,
  nMeans: number,
  df: number,
): number {
  return jStat.tukey.inv(1 - alpha, nMeans, df);
}

// --- Noncentral t distribution ---
//
// Needed to build the 95% confidence interval of a STANDARDIZED effect size
// (Cohen's d / Hedges' g). The CI is obtained by inverting the noncentral t
// CDF for the noncentrality parameter delta, because the observed t statistic
// follows a noncentral t with delta = effect * sqrt(n-factor). We author the
// CDF here rather than pull a new dependency, reusing jStat's regularized
// incomplete beta (ibeta) and regularized lower incomplete gamma (lowRegGamma)
// as the series building blocks.
//
// Algorithm: Lenth (1989), "Cumulative Distribution Function of the Non-central
// t Distribution", Applied Statistics 38(1), 185-189. The same series scipy's
// stats.nct.cdf uses. For x >= 0,
//   P(T <= x) = Phi(-delta)
//             + 0.5 * sum_{j>=0} [ p_j * I_y(j+0.5, df/2)
//                                + q_j * I_y(j+1, df/2) ]
// where y = x^2 / (x^2 + df), p_j are Poisson(delta^2/2) weights, and q_j are
// the matching gamma-weighted terms. For x < 0 we use the reflection
//   P_{delta}(T <= x) = 1 - P_{-delta}(T <= -x).

const NCT_MAX_TERMS = 2000;
const NCT_TOL = 1e-12;

function noncentralTCdfNonneg(x: number, df: number, delta: number): number {
  // Precondition x >= 0. Lenth's recurrence over the Poisson / gamma weights.
  const y = (x * x) / (x * x + df);
  const del2 = (delta * delta) / 2;

  // p_0 = exp(-del2), q_0 = delta / sqrt(2) * exp(-del2) / Gamma(1.5).
  // We carry p and q by their recurrences:
  //   p_{j+1} = p_j * del2 / (j + 1)
  //   q_{j+1} = q_j * del2 / (j + 1.5)
  let p = Math.exp(-del2);
  // q_0 = exp(-del2) * delta / sqrt(2) / Gamma(1.5); Gamma(1.5) = sqrt(pi)/2.
  let q =
    (Math.exp(-del2) * delta) / Math.SQRT2 / (Math.sqrt(Math.PI) / 2);

  let sum = 0;
  for (let j = 0; j < NCT_MAX_TERMS; j++) {
    const ib1 = jStat.ibeta(y, j + 0.5, df / 2);
    const ib2 = jStat.ibeta(y, j + 1, df / 2);
    const term = p * ib1 + q * ib2;
    sum += term;
    // Stop once the running tail contribution is negligible and we are past the
    // Poisson mode (so we do not stop early on the rising shoulder).
    if (j > del2 && term < NCT_TOL && p < NCT_TOL && q < NCT_TOL) break;
    p = (p * del2) / (j + 1);
    q = (q * del2) / (j + 1.5);
  }

  const phiNegDelta = normalDist.cdf(-delta, 0, 1);
  const cdf = phiNegDelta + 0.5 * sum;
  return Math.min(1, Math.max(0, cdf));
}

/**
 * CDF of the noncentral t distribution with `df` degrees of freedom and
 * noncentrality `delta`. Reduces to the central t when delta = 0.
 */
export function noncentralTCdf(x: number, df: number, delta: number): number {
  if (!Number.isFinite(x) || df <= 0) return NaN;
  if (delta === 0) return tDist.cdf(x, df);
  if (x >= 0) return noncentralTCdfNonneg(x, df, delta);
  // Reflection for negative x to keep the series argument nonnegative.
  return 1 - noncentralTCdfNonneg(-x, df, -delta);
}

/**
 * Solve for the noncentrality `delta` such that the noncentral t CDF at the
 * observed statistic `t` equals the target probability `p`. This is the pivot
 * that yields a confidence bound on the standardized effect size, since the CDF
 * is monotone decreasing in delta at a fixed t. A plain bisection is enough:
 * the function is smooth and bounded, and we only need it twice per CI.
 */
export function noncentralTDeltaForCdf(
  p: number,
  t: number,
  df: number,
): number {
  if (!(p > 0 && p < 1)) return NaN;
  // CDF is decreasing in delta. Bracket delta around the observed t, widening
  // until the target p is enclosed.
  let lo = t - 1;
  let hi = t + 1;
  const cdfAt = (d: number) => noncentralTCdf(t, df, d);
  // Expand the bracket so cdf(lo) >= p >= cdf(hi).
  let guard = 0;
  while (cdfAt(lo) < p && guard < 100) {
    lo -= Math.max(1, Math.abs(lo));
    guard++;
  }
  guard = 0;
  while (cdfAt(hi) > p && guard < 100) {
    hi += Math.max(1, Math.abs(hi));
    guard++;
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const c = cdfAt(mid);
    if (Math.abs(c - p) < 1e-12) return mid;
    // c decreases as delta increases, so move the correct edge.
    if (c > p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// --- Noncentral F distribution ---
//
// Needed for the 95% confidence interval of eta-squared / omega-squared in
// one-way ANOVA. The observed F follows a noncentral F with noncentrality
// lambda; inverting the CDF for lambda at the two confidence levels gives the
// CI on lambda, which maps to the eta-squared CI.
//
// CDF as a Poisson mixture of regularized incomplete betas (Johnson, Kotz &
// Balakrishnan, Continuous Univariate Distributions Vol. 2, ch. 30; the form
// scipy's stats.ncf.cdf uses):
//   P(F <= f) = sum_{j>=0} Poisson(j; lambda/2) * I_x(d1/2 + j, d2/2)
// with x = (d1 f) / (d1 f + d2).

const NCF_MAX_TERMS = 2000;
const NCF_TOL = 1e-12;

/**
 * CDF of the noncentral F distribution with numerator df `d1`, denominator df
 * `d2`, and noncentrality `lambda`. Reduces to the central F when lambda = 0.
 */
export function noncentralFCdf(
  f: number,
  d1: number,
  d2: number,
  lambda: number,
): number {
  if (!Number.isFinite(f) || f <= 0) return f <= 0 ? 0 : NaN;
  if (lambda === 0) return fDist.cdf(f, d1, d2);
  const x = (d1 * f) / (d1 * f + d2);
  const half = lambda / 2;
  // Poisson(j; half) by its recurrence weight_{j+1} = weight_j * half / (j+1).
  let weight = Math.exp(-half);
  let sum = 0;
  for (let j = 0; j < NCF_MAX_TERMS; j++) {
    const ib = jStat.ibeta(x, d1 / 2 + j, d2 / 2);
    const term = weight * ib;
    sum += term;
    if (j > half && term < NCF_TOL && weight < NCF_TOL) break;
    weight = (weight * half) / (j + 1);
  }
  return Math.min(1, Math.max(0, sum));
}

/**
 * Solve for the noncentrality `lambda` such that the noncentral F CDF at the
 * observed `f` equals the target probability `p`. The CDF is monotone
 * decreasing in lambda at a fixed f, so a bisection on lambda >= 0 converges.
 * Returns 0 when even lambda = 0 already gives a CDF at or below p (the lower
 * confidence bound on lambda is then clamped at zero, as scipy does).
 */
export function noncentralFLambdaForCdf(
  p: number,
  f: number,
  d1: number,
  d2: number,
): number {
  if (!(p > 0 && p < 1)) return NaN;
  const cdfAt = (lam: number) => noncentralFCdf(f, d1, d2, lam);
  // At lambda = 0 the CDF is the central F CDF (its largest value). If that is
  // already <= p, the bound on lambda is 0.
  if (cdfAt(0) <= p) return 0;
  let lo = 0;
  let hi = 1;
  let guard = 0;
  while (cdfAt(hi) > p && guard < 200) {
    hi *= 2;
    guard++;
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const c = cdfAt(mid);
    if (Math.abs(c - p) < 1e-12) return mid;
    if (c > p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
