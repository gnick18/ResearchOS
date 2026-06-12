// Distribution-free (bootstrap) confidence intervals for an arbitrary
// statistic. This is the robust fallback used when normality is shaky, since a
// resampling CI makes no parametric distributional assumption. It is also the
// shared primitive that estimation plots (E2) will consume, so the API is kept
// generic and fully exported.
//
// WHY a seeded PRNG lives in this file: a bootstrap draws resamples at random,
// so without a fixed seed the same table would render a slightly different CI on
// every run and the result would not be unit-testable. Every CI function here
// takes a seed and is therefore reproducible bit-for-bit. We do NOT add an RNG
// dependency, a tiny mulberry32 generator is plenty and keeps the engine
// dependency-free.
//
// A JS PRNG cannot reproduce scipy.stats.bootstrap resample-for-resample, so the
// validation strategy is layered (see __tests__/bootstrap.test.ts): the
// deterministic quantile / z0 / acceleration machinery is pinned exactly against
// hand and scipy computed numbers, and the seeded end-to-end CI is checked for
// statistical convergence to the analytic interval at large B with a documented
// loose tolerance. That layered approach IS the rigor here.

import { normalCdf, normalQuantile } from "./dists";
import { clean, mean as meanOf, quantileSorted } from "./util";

/** Which interval the bootstrap reports. */
export type BootstrapMethod = "percentile" | "bca";

export interface BootstrapOptions {
  /** Number of bootstrap resamples. More resamples, tighter Monte-Carlo noise. */
  B?: number;
  /** Two-sided alpha, so a 95% CI is alpha = 0.05. */
  alpha?: number;
  /** "percentile" (simple) or "bca" (bias-corrected and accelerated). */
  method?: BootstrapMethod;
  /** PRNG seed. A fixed seed makes the CI reproducible and testable. */
  seed?: number;
  /**
   * When true, the result carries the full SORTED array of finite resample
   * statistics in `distribution`. WHY this opt-in flag exists: an estimation
   * plot (E2) draws the bootstrap sampling distribution as a density / violin,
   * which needs every resample value, not just the two CI bounds. Keeping the
   * array out of the default result avoids holding B numbers on every CI a table
   * footer computes. Off by default, so the result shape is byte-identical to
   * before this flag existed for every existing caller.
   */
  keepDistribution?: boolean;
}

export interface BootstrapResult {
  /** The statistic evaluated on the original sample. */
  observed: number;
  /** Lower and upper CI bounds. */
  ci: [number, number];
  method: BootstrapMethod;
  alpha: number;
  B: number;
  /** Bias-correction z0 and acceleration a (only the BCa path fills these). */
  z0: number | null;
  acceleration: number | null;
  /**
   * The full SORTED array of finite resample statistics, present ONLY when the
   * caller passed keepDistribution. Length is the number of resamples that
   * produced a finite statistic (at most B). The CI bounds are the requested
   * percentiles of exactly this array, so an estimation plot drawing the density
   * from it cannot diverge from the reported CI. Absent (undefined) on every
   * default-options result, so the shape is unchanged for existing callers.
   */
  distribution?: number[];
}

const DEFAULT_B = 2000;
const DEFAULT_ALPHA = 0.05;

/**
 * mulberry32 seeded PRNG. A compact, well-distributed 32-bit generator that
 * needs no dependency and no state object beyond a single integer. Returns a
 * generator yielding floats in [0, 1). We seed it from an integer so a given
 * seed always produces the same resample stream, which is what makes a bootstrap
 * CI reproducible.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw one resample (with replacement) of the same size as `sample`, using the
 * supplied PRNG. Pulled out so both the one-sample and two-sample paths share
 * the exact same draw logic.
 */
function resampleOnce(sample: number[], rng: () => number): number[] {
  const n = sample.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    // Floor of rng()*n is a uniform index in [0, n). rng() < 1 guarantees the
    // index never reaches n, so no out-of-range pull.
    out[i] = sample[(rng() * n) | 0];
  }
  return out;
}

/**
 * The percentile extractor, isolated so it can be unit-tested against a fixed,
 * hand-written bootstrap distribution with NO RNG involved. Given the sorted
 * resample statistics and a two-sided alpha, returns the [alpha/2, 1-alpha/2]
 * quantile pair via the standard type-7 (linear interpolation) definition.
 */
export function percentileInterval(
  sortedStats: number[],
  alpha: number,
): [number, number] {
  const lo = quantileSorted(sortedStats, alpha / 2);
  const hi = quantileSorted(sortedStats, 1 - alpha / 2);
  return [lo, hi];
}

/**
 * BCa bias-correction z0. WHY: the percentile interval is only correct when the
 * bootstrap distribution is unbiased and symmetric on the normal-quantile scale.
 * z0 measures the median bias as the standard-normal quantile of the share of
 * resample statistics strictly below the observed statistic. A z0 of 0 means
 * exactly half the resamples fell below the observed value (no median bias).
 * Ties at the observed value are counted as half, the standard convention, so a
 * perfectly symmetric discrete distribution still yields z0 = 0.
 */
export function biasCorrection(
  bootStats: number[],
  observed: number,
): number {
  const B = bootStats.length;
  if (B === 0) return 0;
  let below = 0;
  let equal = 0;
  for (const s of bootStats) {
    if (s < observed) below++;
    else if (s === observed) equal++;
  }
  const prop = (below + equal / 2) / B;
  // Clamp away from the open boundary so normalQuantile stays finite when every
  // resample is on one side of the observed value.
  const p = Math.min(1 - 1e-9, Math.max(1e-9, prop));
  return normalQuantile(p, 0, 1);
}

/**
 * BCa acceleration a from the jackknife. WHY: a corrects for the statistic's
 * standard error changing with the true parameter value (skewness of the
 * sampling distribution). It is the standard jackknife skewness estimate
 *   a = sum (mean - theta_i)^3 / (6 * (sum (mean - theta_i)^2)^{3/2})
 * where theta_i is the statistic recomputed with observation i left out and
 * `mean` is the average of those leave-one-out values. a = 0 recovers the
 * bias-corrected (BC) interval. Returns 0 when the spread of jackknife values is
 * zero (a constant statistic), since the interval then collapses to the point.
 */
export function jackknifeAcceleration(
  sample: number[],
  statisticFn: (s: number[]) => number,
): number {
  const n = sample.length;
  if (n < 2) return 0;
  const theta = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const loo = new Array<number>(n - 1);
    let k = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      loo[k++] = sample[j];
    }
    theta[i] = statisticFn(loo);
  }
  const mbar = meanOf(theta);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const d = mbar - theta[i];
    num += d * d * d;
    den += d * d;
  }
  if (den === 0) return 0;
  return num / (6 * Math.pow(den, 1.5));
}

/**
 * Map a BCa-adjusted alpha tail to the percentile point on the bootstrap
 * distribution. The adjusted percentile is
 *   Phi( z0 + (z0 + z_a) / (1 - a (z0 + z_a)) )
 * where z_a is the standard-normal quantile of the requested tail probability.
 * This is the core BCa formula (Efron 1987); the percentile method is the
 * special case z0 = a = 0, where this returns exactly the tail probability.
 */
function bcaPercentile(
  tailProb: number,
  z0: number,
  a: number,
): number {
  const za = normalQuantile(tailProb, 0, 1);
  const adjusted = z0 + (z0 + za) / (1 - a * (z0 + za));
  return normalCdf(adjusted, 0, 1);
}

/**
 * Generic bootstrap confidence interval for an arbitrary statistic of one
 * sample. Resamples the sample with replacement B times, evaluates statisticFn
 * on each resample, and returns either the percentile interval or the BCa
 * interval. Deterministic given the seed.
 *
 * statisticFn must accept a number[] and return a finite number; the ready
 * helpers below (sampleMean, sampleMedian, ...) satisfy that contract.
 */
export function bootstrapCI(
  sample: ArrayLike<number>,
  statisticFn: (s: number[]) => number,
  options: BootstrapOptions = {},
): BootstrapResult | null {
  const data = clean(sample);
  const n = data.length;
  const B = options.B ?? DEFAULT_B;
  const alpha = options.alpha ?? DEFAULT_ALPHA;
  const method: BootstrapMethod = options.method ?? "percentile";
  const seed = options.seed ?? 12345;

  // A bootstrap needs at least two distinct-capable observations to vary; below
  // that the interval is undefined and we return null so callers can omit it.
  if (n < 2) return null;
  const observed = statisticFn(data);
  if (!Number.isFinite(observed)) return null;

  const rng = mulberry32(seed);
  const bootStats = new Array<number>(B);
  for (let b = 0; b < B; b++) {
    bootStats[b] = statisticFn(resampleOnce(data, rng));
  }
  const finite = bootStats.filter((s) => Number.isFinite(s));
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((x, y) => x - y);

  if (method === "percentile") {
    return withDistribution(
      {
        observed,
        ci: percentileInterval(sorted, alpha),
        method,
        alpha,
        B,
        z0: null,
        acceleration: null,
      },
      sorted,
      options.keepDistribution,
    );
  }

  // BCa: compute z0 from the resamples and a from the jackknife, then read off
  // the two adjusted percentile points.
  const z0 = biasCorrection(finite, observed);
  const a = jackknifeAcceleration(data, statisticFn);
  const pLo = bcaPercentile(alpha / 2, z0, a);
  const pHi = bcaPercentile(1 - alpha / 2, z0, a);
  const lo = quantileSorted(sorted, clampProb(pLo));
  const hi = quantileSorted(sorted, clampProb(pHi));
  // BCa can in rare degenerate cases invert the bounds (heavy acceleration on a
  // tiny sample); order them so the interval is always [low, high].
  const ci: [number, number] = lo <= hi ? [lo, hi] : [hi, lo];
  return withDistribution(
    { observed, ci, method, alpha, B, z0, acceleration: a },
    sorted,
    options.keepDistribution,
  );
}

/** Keep an adjusted percentile strictly inside (0, 1) for quantileSorted. */
function clampProb(p: number): number {
  return Math.min(1 - 1e-9, Math.max(1e-9, p));
}

/**
 * Attach the sorted resample distribution to a result when the caller asked for
 * it. WHY a shared helper: both the one-sample and two-sample paths build the
 * same `sorted` array, and an estimation plot consumes the identical array the
 * CI percentiles are read from, so wiring it in one place keeps the two in lock
 * step. A fresh copy is returned so the caller cannot mutate the internal array.
 */
function withDistribution(
  result: BootstrapResult,
  sorted: number[],
  keep: boolean | undefined,
): BootstrapResult {
  if (!keep) return result;
  return { ...result, distribution: [...sorted] };
}

/**
 * Two-sample bootstrap CI for a statistic of two independent samples, for a mean
 * difference / ratio of means / median difference. Each sample is resampled
 * INDEPENDENTLY with replacement (the standard two-sample bootstrap, which
 * respects that the two groups are separate populations), then statisticFn(a, b)
 * is evaluated on the paired resamples. Deterministic given the seed.
 *
 * The percentile interval is always available. The BCa interval here uses z0
 * from the two-sample resamples and a from a pooled-style jackknife that drops
 * one observation at a time across BOTH samples, the standard two-sample BCa
 * acceleration (Efron & Tibshirani 1993, S 14.3).
 */
export function bootstrapDiffCI(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  statisticFn: (sa: number[], sb: number[]) => number,
  options: BootstrapOptions = {},
): BootstrapResult | null {
  const da = clean(a);
  const db = clean(b);
  const B = options.B ?? DEFAULT_B;
  const alpha = options.alpha ?? DEFAULT_ALPHA;
  const method: BootstrapMethod = options.method ?? "percentile";
  const seed = options.seed ?? 12345;
  if (da.length < 2 || db.length < 2) return null;

  const observed = statisticFn(da, db);
  if (!Number.isFinite(observed)) return null;

  const rng = mulberry32(seed);
  const bootStats = new Array<number>(B);
  for (let i = 0; i < B; i++) {
    bootStats[i] = statisticFn(resampleOnce(da, rng), resampleOnce(db, rng));
  }
  const finite = bootStats.filter((s) => Number.isFinite(s));
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((x, y) => x - y);

  if (method === "percentile") {
    return withDistribution(
      {
        observed,
        ci: percentileInterval(sorted, alpha),
        method,
        alpha,
        B,
        z0: null,
        acceleration: null,
      },
      sorted,
      options.keepDistribution,
    );
  }

  const z0 = biasCorrection(finite, observed);
  const a2 = twoSampleAcceleration(da, db, statisticFn);
  const pLo = bcaPercentile(alpha / 2, z0, a2);
  const pHi = bcaPercentile(1 - alpha / 2, z0, a2);
  const lo = quantileSorted(sorted, clampProb(pLo));
  const hi = quantileSorted(sorted, clampProb(pHi));
  const ci: [number, number] = lo <= hi ? [lo, hi] : [hi, lo];
  return withDistribution(
    { observed, ci, method, alpha, B, z0, acceleration: a2 },
    sorted,
    options.keepDistribution,
  );
}

/**
 * Two-sample jackknife acceleration. WHY a pooled jackknife: the acceleration is
 * the skewness of the empirical influence values, and for a two-sample statistic
 * the influence comes from leaving out one observation at a time within whichever
 * group it belongs to. We collect the leave-one-out statistic for every
 * observation in both groups, then apply the same skewness formula as the
 * one-sample case to the combined influence values (Efron & Tibshirani 1993).
 */
function twoSampleAcceleration(
  da: number[],
  db: number[],
  statisticFn: (sa: number[], sb: number[]) => number,
): number {
  const theta: number[] = [];
  for (let i = 0; i < da.length; i++) {
    const loo = da.filter((_, j) => j !== i);
    if (loo.length >= 1) theta.push(statisticFn(loo, db));
  }
  for (let i = 0; i < db.length; i++) {
    const loo = db.filter((_, j) => j !== i);
    if (loo.length >= 1) theta.push(statisticFn(da, loo));
  }
  if (theta.length < 2) return 0;
  const mbar = meanOf(theta);
  let num = 0;
  let den = 0;
  for (const t of theta) {
    const d = mbar - t;
    num += d * d * d;
    den += d * d;
  }
  if (den === 0) return 0;
  return num / (6 * Math.pow(den, 1.5));
}

// --- Ready statistic helpers ---
// Small, named functions so callers and tests do not re-declare closures. Each
// returns a finite number on a non-empty sample and NaN where it is undefined,
// so bootstrapCI can drop the bad resample.

/** Arithmetic mean of a sample. */
export function sampleMean(s: number[]): number {
  return meanOf(s);
}

/** Median of a sample (type-7 quantile at 0.5). */
export function sampleMedian(s: number[]): number {
  if (s.length === 0) return NaN;
  const sorted = [...s].sort((x, y) => x - y);
  return quantileSorted(sorted, 0.5);
}

/** Mean difference statistic for the two-sample path: mean(a) - mean(b). */
export function meanDifference(sa: number[], sb: number[]): number {
  return meanOf(sa) - meanOf(sb);
}

/** Median difference statistic for the two-sample path: median(a) - median(b). */
export function medianDifference(sa: number[], sb: number[]): number {
  return sampleMedian(sa) - sampleMedian(sb);
}

/**
 * Ratio of means for the two-sample path: mean(a) / mean(b). NaN when the
 * denominator mean is zero, so the bootstrap drops that resample rather than
 * emitting an Infinity that would poison the quantiles.
 */
export function ratioOfMeans(sa: number[], sb: number[]): number {
  const mb = meanOf(sb);
  if (mb === 0) return NaN;
  return meanOf(sa) / mb;
}
