// Two-group comparison tests: unpaired t (Welch default + Student option),
// paired t, and the nonparametric fallbacks Mann-Whitney U (rank-sum) and
// Wilcoxon signed-rank. Parametric tests delegate the statistic/df/p to
// @stdlib (already validated upstream); we add effect sizes and group
// descriptives. Mann-Whitney U is authored here because @stdlib ships no
// rank-sum package.

import ttest2 from "@stdlib/stats-ttest2";
import ttest from "@stdlib/stats-ttest";
import wilcoxon from "@stdlib/stats-wilcoxon";

import { normalPValue, tCritTwoSided, tPValue } from "./dists";
import { describeUnsafe } from "./descriptive";
import type { Descriptives, EngineResult, Tail, TTestResult } from "./types";
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

export interface UnpairedFromStatsInput {
  mean1: number;
  sd1: number;
  n1: number;
  mean2: number;
  sd2: number;
  n2: number;
  tail?: Tail;
  /** "welch" (default, unequal variance) or "student" (pooled / equal var). */
  variance?: "welch" | "student";
}

/**
 * Build a partial Descriptives from entered summary stats. Only mean / sd / sem /
 * n are known from a summary, so the quantile-based fields (median, quartiles,
 * min, max) are NaN and the CI of the mean is the Student-t interval on n - 1 df.
 * This lets the from-stats result carry groupA / groupB descriptives in the same
 * shape the raw path does, with the unknown order statistics left as NaN.
 */
function descriptivesFromStats(m: number, sd: number, n: number): Descriptives {
  const sem = n >= 2 && Number.isFinite(sd) ? sd / Math.sqrt(n) : NaN;
  let ci95: [number, number] = [NaN, NaN];
  if (n >= 2 && Number.isFinite(sem)) {
    const half = tCritTwoSided(0.05, n - 1) * sem;
    ci95 = [m - half, m + half];
  }
  const variance = Number.isFinite(sd) ? sd * sd : NaN;
  const cvPercent =
    m !== 0 && Number.isFinite(sd) ? (100 * sd) / Math.abs(m) : NaN;
  return {
    n,
    mean: m,
    sd,
    sem,
    variance,
    median: NaN,
    q1: NaN,
    q3: NaN,
    min: NaN,
    max: NaN,
    ci95,
    cvPercent,
  };
}

/**
 * Unpaired (two-sample) t-test computed from ENTERED SUMMARY STATISTICS rather
 * than raw replicates. Matches scipy.stats.ttest_ind_from_stats for both the
 * Welch (unequal variance, default) and Student (pooled, equal variance) cases.
 *
 * Welch:   t = (m1 - m2) / sqrt(s1^2/n1 + s2^2/n2)
 *          df via the Welch-Satterthwaite approximation
 * Student: sp^2 = ((n1-1) s1^2 + (n2-1) s2^2) / (n1 + n2 - 2)
 *          t = (m1 - m2) / sqrt(sp^2 (1/n1 + 1/n2)),  df = n1 + n2 - 2
 *
 * The 95% CI of the mean difference uses the same df and the t critical value.
 * Cohen's d is computed from the pooled SD of the two summaries (the same
 * definition the raw path uses, expressed in terms of the entered SDs). This is
 * the summary-compatible sibling of unpairedTTest; the raw path is unchanged.
 */
export function unpairedTTestFromStats(
  input: UnpairedFromStatsInput,
): EngineResult<TTestResult> {
  const { mean1, sd1, n1, mean2, sd2, n2 } = input;
  if (
    !Number.isFinite(mean1) ||
    !Number.isFinite(mean2) ||
    !Number.isFinite(sd1) ||
    !Number.isFinite(sd2)
  ) {
    return { ok: false, error: "Enter a mean and an SD for each group." };
  }
  if (n1 < 2 || n2 < 2) {
    return { ok: false, error: "Each group needs n of at least 2." };
  }
  if (sd1 < 0 || sd2 < 0) {
    return { ok: false, error: "SD cannot be negative." };
  }
  const tail: Tail = input.tail ?? "two-sided";
  const useStudent = input.variance === "student";

  const v1 = sd1 * sd1;
  const v2 = sd2 * sd2;
  const meanDiff = mean1 - mean2;

  let se: number;
  let df: number;
  let label: string;
  if (useStudent) {
    const pooledVar = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
    se = Math.sqrt(pooledVar * (1 / n1 + 1 / n2));
    df = n1 + n2 - 2;
    label = "Student's two-sample t-test";
  } else {
    se = Math.sqrt(v1 / n1 + v2 / n2);
    const num = (v1 / n1 + v2 / n2) ** 2;
    const den =
      (v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1);
    df = den === 0 ? NaN : num / den;
    label = "Welch's t-test";
  }
  if (!(se > 0)) {
    return { ok: false, error: "Zero spread in both groups; t is undefined." };
  }

  const statistic = meanDiff / se;
  const pValue = tPValue(statistic, df, tail);

  // 95% CI of the mean difference, two-sided t critical value on the same df.
  const half = tCritTwoSided(0.05, df) * se;
  const ci95: [number, number] = [meanDiff - half, meanDiff + half];

  // Cohen's d from the pooled SD of the two summaries.
  const pooledSD = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
  const effectSize = pooledSD === 0 ? NaN : meanDiff / pooledSD;

  return {
    ok: true,
    test: label,
    statistic,
    df,
    pValue,
    tail,
    effectSize,
    effectSizeLabel: "Cohen's d",
    ci95,
    groupA: descriptivesFromStats(mean1, sd1, n1),
    groupB: descriptivesFromStats(mean2, sd2, n2),
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
