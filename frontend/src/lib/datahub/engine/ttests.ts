// Two-group comparison tests: unpaired t (Welch default + Student option),
// paired t, and the nonparametric fallbacks Mann-Whitney U (rank-sum) and
// Wilcoxon signed-rank. Parametric tests delegate the statistic/df/p to
// @stdlib (already validated upstream); we add effect sizes and group
// descriptives. Mann-Whitney U is authored here because @stdlib ships no
// rank-sum package.

import ttest2 from "@stdlib/stats-ttest2";
import ttest from "@stdlib/stats-ttest";
import wilcoxon from "@stdlib/stats-wilcoxon";

import { normalPValue } from "./dists";
import { describeUnsafe } from "./descriptive";
import type { EngineResult, Tail, TTestResult } from "./types";
import { clean, mean as meanOf, rankWithTies, sampleVariance, sum } from "./util";

export interface UnpairedOptions {
  tail?: Tail;
  /** "welch" (default, unequal variance) or "student" (pooled / equal var). */
  variance?: "welch" | "student";
}

/**
 * Cohen's d using the pooled standard deviation. This is the standard reported
 * effect size for a two-group mean comparison.
 */
function cohensD(a: number[], b: number[]): number {
  const na = a.length;
  const nb = b.length;
  if (na < 2 || nb < 2) return NaN;
  const va = sampleVariance(a);
  const vb = sampleVariance(b);
  const pooledSD = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2));
  if (pooledSD === 0) return NaN;
  return (meanOf(a) - meanOf(b)) / pooledSD;
}

export function unpairedTTest(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  options: UnpairedOptions = {},
): EngineResult<TTestResult> {
  const a = clean(x);
  const b = clean(y);
  if (a.length < 2 || b.length < 2) {
    return { ok: false, error: "Each group needs at least 2 finite values." };
  }
  const tail: Tail = options.tail ?? "two-sided";
  const variance = options.variance === "student" ? "equal" : "unequal";

  const out = ttest2(a, b, { alternative: tail, variance });
  const label =
    variance === "equal" ? "Student's two-sample t-test" : "Welch's t-test";

  return {
    ok: true,
    test: label,
    statistic: out.statistic,
    df: out.df,
    pValue: out.pValue,
    tail,
    effectSize: cohensD(a, b),
    effectSizeLabel: "Cohen's d",
    ci95: out.ci,
    groupA: describeUnsafe(a),
    groupB: describeUnsafe(b),
  };
}

export function pairedTTest(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  options: { tail?: Tail } = {},
): EngineResult<TTestResult> {
  const a = clean(x);
  const b = clean(y);
  if (a.length !== b.length) {
    return { ok: false, error: "Paired test needs equal-length samples." };
  }
  if (a.length < 2) {
    return { ok: false, error: "Paired test needs at least 2 pairs." };
  }
  const tail: Tail = options.tail ?? "two-sided";
  const diffs = a.map((v, i) => v - b[i]);

  // Paired t test is a one-sample t test on the differences vs mu = 0.
  const out = ttest(diffs, { alternative: tail });

  // Effect size: Cohen's d_z = mean(diff) / sd(diff).
  const dz = out.mean / Math.sqrt(sampleVariance(diffs));

  return {
    ok: true,
    test: "Paired t-test",
    statistic: out.statistic,
    df: out.df,
    pValue: out.pValue,
    tail,
    effectSize: dz,
    effectSizeLabel: "Cohen's dz",
    ci95: out.ci,
    groupA: describeUnsafe(a),
    groupB: describeUnsafe(b),
  };
}

/**
 * Mann-Whitney U (Wilcoxon rank-sum) test with the normal approximation and a
 * tie correction. Authored here because @stdlib has no rank-sum package.
 *
 * U is computed from the rank sum of group A:
 *   R1 = sum of ranks assigned to group A across the pooled, tie-averaged ranks
 *   U1 = R1 - n1(n1 + 1) / 2
 *   U  = min(U1, U2)              (two-sided convention)
 * Under H0, E[U] = n1 n2 / 2 and the tie-corrected variance is
 *   Var = (n1 n2 / 12) * [ (N + 1) - sum(t^3 - t) / (N (N - 1)) ]
 * The z statistic is (U1 - E[U]) / sqrt(Var). A continuity correction of 0.5 is
 * applied toward the mean. Effect size is the rank-biserial correlation
 *   r = 1 - 2 U / (n1 n2).
 * Reference: Mann & Whitney (1947); tie correction per Lehmann, Nonparametrics.
 */
export function mannWhitneyU(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  options: { tail?: Tail } = {},
): EngineResult<TTestResult> {
  const a = clean(x);
  const b = clean(y);
  if (a.length < 1 || b.length < 1) {
    return { ok: false, error: "Each group needs at least 1 finite value." };
  }
  const tail: Tail = options.tail ?? "two-sided";
  const n1 = a.length;
  const n2 = b.length;
  const N = n1 + n2;

  const pooled = [...a, ...b];
  const { ranks, tieCorrection } = rankWithTies(pooled);
  const r1 = sum(ranks.slice(0, n1));
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const uMin = Math.min(u1, u2);

  const meanU = (n1 * n2) / 2;
  const varU =
    ((n1 * n2) / 12) *
    (N + 1 - tieCorrection / (N * (N - 1)));

  if (varU <= 0) {
    return { ok: false, error: "Degenerate ranks (all values tied)." };
  }

  // z based on U1 with a 0.5 continuity correction toward the mean.
  const diff = u1 - meanU;
  const cc = diff === 0 ? 0 : Math.sign(diff) * 0.5;
  const z = (diff - cc) / Math.sqrt(varU);
  const pValue = normalPValue(z, tail);

  // Rank-biserial effect size.
  const rRankBiserial = 1 - (2 * uMin) / (n1 * n2);

  return {
    ok: true,
    test: "Mann-Whitney U (rank-sum)",
    statistic: uMin,
    df: NaN, // No df for the normal-approximation rank-sum test.
    pValue,
    tail,
    effectSize: rRankBiserial,
    effectSizeLabel: "rank-biserial r",
    ci95: null,
    groupA: describeUnsafe(a),
    groupB: describeUnsafe(b),
  };
}

/**
 * Wilcoxon signed-rank test (paired nonparametric). Delegates to @stdlib's
 * wilcoxon on the paired differences. The reported statistic is W (signed-rank
 * sum) and effect size is the matched-pairs rank-biserial correlation.
 */
export function wilcoxonSignedRank(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  options: { tail?: Tail } = {},
): EngineResult<TTestResult> {
  const a = clean(x);
  const b = clean(y);
  if (a.length !== b.length) {
    return { ok: false, error: "Paired test needs equal-length samples." };
  }
  if (a.length < 2) {
    return { ok: false, error: "Paired test needs at least 2 pairs." };
  }
  const tail: Tail = options.tail ?? "two-sided";

  const out = wilcoxon(a, b, { alternative: tail });

  // Rank-biserial for signed-rank: r = W+ / sum-of-ranks scaled to [-1, 1].
  // Compute from nonzero differences directly for a robust effect size.
  const diffs = a
    .map((v, i) => v - b[i])
    .filter((d) => d !== 0);
  const { ranks } = rankWithTies(diffs.map(Math.abs));
  let wPlus = 0;
  let wMinus = 0;
  diffs.forEach((d, i) => {
    if (d > 0) wPlus += ranks[i];
    else wMinus += ranks[i];
  });
  const total = wPlus + wMinus;
  const rRankBiserial = total === 0 ? NaN : (wPlus - wMinus) / total;

  return {
    ok: true,
    test: "Wilcoxon signed-rank",
    statistic: out.statistic,
    df: NaN,
    pValue: out.pValue,
    tail,
    effectSize: rRankBiserial,
    effectSizeLabel: "rank-biserial r",
    ci95: null,
    groupA: describeUnsafe(a),
    groupB: describeUnsafe(b),
  };
}
