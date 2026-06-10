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
