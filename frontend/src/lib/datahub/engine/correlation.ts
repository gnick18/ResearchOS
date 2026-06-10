// Pearson and Spearman correlation, each with a t-based p-value and a
// Fisher-z 95% confidence interval. Authored here (no @stdlib correlation
// package is in the dependency set) and pinned against scipy.stats in the test
// suite.

import { normalQuantile, tPValue } from "./dists";
import type { CorrelationResult, EngineResult } from "./types";
import { clean, mean as meanOf, rankWithTies } from "./util";

function pearsonR(a: number[], b: number[]): number {
  const n = a.length;
  const ma = meanOf(a);
  const mb = meanOf(b);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = a[i] - ma;
    const dy = b[i] - mb;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  return denom === 0 ? NaN : sxy / denom;
}

/**
 * Fisher z-transform 95% confidence interval for a correlation coefficient.
 * z = atanh(r), SE = 1 / sqrt(n - 3), interval back-transformed with tanh.
 */
function fisherCI(r: number, n: number): [number, number] {
  if (n < 4 || Math.abs(r) >= 1) return [NaN, NaN];
  const z = Math.atanh(r);
  const se = 1 / Math.sqrt(n - 3);
  const zCrit = normalQuantile(0.975, 0, 1);
  return [Math.tanh(z - zCrit * se), Math.tanh(z + zCrit * se)];
}

function pairClean(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): { a: number[]; b: number[] } {
  // Keep only pairs where both members are finite.
  const a: number[] = [];
  const b: number[] = [];
  const len = Math.min(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const xv = x[i];
    const yv = y[i];
    if (
      typeof xv === "number" &&
      typeof yv === "number" &&
      Number.isFinite(xv) &&
      Number.isFinite(yv)
    ) {
      a.push(xv);
      b.push(yv);
    }
  }
  return { a, b };
}

export function pearson(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): EngineResult<CorrelationResult> {
  const { a, b } = pairClean(x, y);
  const n = a.length;
  if (n < 3) {
    return { ok: false, error: "Need at least 3 paired finite values." };
  }
  const r = pearsonR(a, b);
  if (!Number.isFinite(r)) {
    return { ok: false, error: "Zero variance in one variable." };
  }
  const df = n - 2;
  // t = r * sqrt(df / (1 - r^2)); two-sided p from Student t.
  const t =
    Math.abs(r) >= 1 ? Infinity : r * Math.sqrt(df / (1 - r * r));
  const pValue = Math.abs(r) >= 1 ? 0 : tPValue(t, df, "two-sided");

  return {
    ok: true,
    method: "pearson",
    n,
    coefficient: r,
    statistic: t,
    df,
    pValue,
    ci95: fisherCI(r, n),
  };
}

export function spearman(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): EngineResult<CorrelationResult> {
  const { a, b } = pairClean(x, y);
  const n = a.length;
  if (n < 3) {
    return { ok: false, error: "Need at least 3 paired finite values." };
  }
  // Spearman rho is Pearson r on the rank-transformed data (tie-averaged ranks).
  const ra = rankWithTies(a).ranks;
  const rb = rankWithTies(b).ranks;
  const rho = pearsonR(ra, rb);
  if (!Number.isFinite(rho)) {
    return { ok: false, error: "Zero variance in ranks." };
  }
  const df = n - 2;
  const t =
    Math.abs(rho) >= 1 ? Infinity : rho * Math.sqrt(df / (1 - rho * rho));
  const pValue = Math.abs(rho) >= 1 ? 0 : tPValue(t, df, "two-sided");

  return {
    ok: true,
    method: "spearman",
    n,
    coefficient: rho,
    statistic: t,
    df,
    pValue,
    // Fisher CI is an approximation for Spearman but the conventional reported one.
    ci95: fisherCI(rho, n),
  };
}
