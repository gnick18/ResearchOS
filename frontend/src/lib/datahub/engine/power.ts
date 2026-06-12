// Power and sample-size planner (E3). A stateless calculator for designing a
// study before any data is collected, the same job GraphPad Prism and G*Power do.
// Three directions for each test family:
//   - a priori sample size: given an effect size, alpha, and desired power, what
//     N do I need?
//   - achieved power: given N, an effect size, and alpha, what power do I have?
//   - sensitivity: given N, alpha, and a desired power, what is the smallest
//     effect size I can detect?
//
// Every number is reference-validated against statsmodels.stats.power in the
// __tests__/power.test.ts pin suite. The noncentral t and noncentral F machinery
// is reused from dists.ts (the E1 work), so the power curves agree exactly with
// the confidence-interval code that already ships. The math correctness is the
// feature.
//
// All functions are pure, native JS, and individually testable. Nothing here
// reads or writes disk, the Loro doc, or any stored shape; this is a calculator.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import {
  noncentralFCdf,
  noncentralTCdf,
  normalCdf,
  normalQuantile,
  tQuantile,
} from "./dists";

// --- Shared helpers ---

// Power is monotone increasing in N (and in the effect size), so a priori sample
// size and sensitivity are both root finds against a monotone power function. We
// search with bisection on a generous bracket, which is robust and needs no
// derivative. The caller already knows the target power lies in (0, 1).

const MAX_N = 10_000_000; // A bracket ceiling so an unreachable target ends cleanly.

/**
 * Smallest integer per-group (or per the family's N convention) sample size whose
 * achieved power reaches `target`. `powerAt(n)` must be monotone increasing in n.
 * Returns null when even MAX_N cannot reach the target (e.g. an effect of zero).
 * `minN` is the smallest n the family allows (so degrees of freedom stay positive).
 */
function smallestNForPower(
  powerAt: (n: number) => number,
  target: number,
  minN: number,
): number | null {
  if (!(target > 0 && target < 1)) return null;
  // Already enough at the floor.
  if (powerAt(minN) >= target) return minN;
  // Find an upper bracket by doubling.
  let hi = Math.max(minN + 1, 2);
  let guard = 0;
  while (powerAt(hi) < target) {
    hi *= 2;
    guard++;
    if (hi > MAX_N || guard > 64) return null;
  }
  // Bisect on the integer line for the first n with power >= target.
  let lo = minN;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (powerAt(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Root find on a continuous monotone-increasing `powerAt(effect)` for the effect
 * size whose power equals `target`. Used by sensitivity. The bracket [lo, hi] must
 * enclose the answer; effect sizes are nonnegative here (the planner reports the
 * magnitude of the smallest detectable effect).
 */
function effectForPower(
  powerAt: (effect: number) => number,
  target: number,
  lo: number,
  hi: number,
): number | null {
  if (!(target > 0 && target < 1)) return null;
  // Widen the upper edge if the requested power is beyond it.
  let high = hi;
  let guard = 0;
  while (powerAt(high) < target) {
    high *= 2;
    guard++;
    if (guard > 64) return null;
  }
  let low = lo;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const p = powerAt(mid);
    if (Math.abs(p - target) < 1e-10) return mid;
    if (p < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

// --- Two-sample (independent) t-test, Cohen's d, equal group sizes ---
//
// With n per group, df = 2n - 2 and the noncentrality is
//   delta = d * sqrt(n / 2)
// (because the SE of the mean difference is sigma * sqrt(2/n) and d = mean
// difference over sigma). A two-sided test at level alpha rejects when |T| > t*,
// where t* is the central t quantile at 1 - alpha/2. The power is the noncentral
// t probability of landing in either rejection tail. This matches statsmodels
// TTestIndPower (its default ratio = 1, equal groups).

/** Achieved power of a two-sided two-sample t-test, n per group, effect d. */
export function powerTwoSampleT(
  n: number,
  d: number,
  alpha: number,
): number {
  if (n < 2) return NaN;
  const df = 2 * n - 2;
  const delta = Math.abs(d) * Math.sqrt(n / 2);
  // Critical values of the central t under the null.
  const tCrit = tQuantile(1 - alpha / 2, df);
  // P(reject) = P(T > tCrit) + P(T < -tCrit) under the noncentral alternative.
  const upper = 1 - noncentralTCdf(tCrit, df, delta);
  const lower = noncentralTCdf(-tCrit, df, delta);
  return clampPower(upper + lower);
}

/**
 * A priori per-group sample size for a two-sample t-test. Returns the smallest n
 * per group whose power reaches `targetPower`. Null when d = 0 (no finite N).
 */
export function sampleSizeTwoSampleT(
  d: number,
  alpha: number,
  targetPower: number,
): number | null {
  if (d === 0) return null;
  return smallestNForPower((n) => powerTwoSampleT(n, d, alpha), targetPower, 2);
}

/**
 * Sensitivity for a two-sample t-test. Returns the smallest Cohen's d detectable
 * with n per group at the given alpha and target power.
 */
export function detectableDTwoSampleT(
  n: number,
  alpha: number,
  targetPower: number,
): number | null {
  if (n < 2) return null;
  return effectForPower(
    (d) => powerTwoSampleT(n, d, alpha),
    targetPower,
    1e-6,
    2,
  );
}

// --- Paired t-test, Cohen's dz ---
//
// The paired test is a one-sample t on the within-pair differences. With n pairs,
// df = n - 1 and the noncentrality is delta = dz * sqrt(n), where dz is the mean
// difference over the SD of the differences. Two-sided rejection as above. This
// matches statsmodels TTestPower (the one-sample / paired engine).

/** Achieved power of a two-sided paired t-test, n pairs, effect dz. */
export function powerPairedT(n: number, dz: number, alpha: number): number {
  if (n < 2) return NaN;
  const df = n - 1;
  const delta = Math.abs(dz) * Math.sqrt(n);
  const tCrit = tQuantile(1 - alpha / 2, df);
  const upper = 1 - noncentralTCdf(tCrit, df, delta);
  const lower = noncentralTCdf(-tCrit, df, delta);
  return clampPower(upper + lower);
}

/** A priori number of pairs for a paired t-test. Null when dz = 0. */
export function sampleSizePairedT(
  dz: number,
  alpha: number,
  targetPower: number,
): number | null {
  if (dz === 0) return null;
  return smallestNForPower((n) => powerPairedT(n, dz, alpha), targetPower, 2);
}

/** Sensitivity for a paired t-test. Smallest dz detectable with n pairs. */
export function detectableDzPairedT(
  n: number,
  alpha: number,
  targetPower: number,
): number | null {
  if (n < 2) return null;
  return effectForPower((dz) => powerPairedT(n, dz, alpha), targetPower, 1e-6, 2);
}

// --- One-way ANOVA, Cohen's f, k groups ---
//
// With k groups and total sample size N, the F test has df1 = k - 1 and
// df2 = N - k. The noncentrality is lambda = f^2 * N, where f is Cohen's f. The
// test rejects when F > F*, the central F upper quantile at 1 - alpha. Power is
// the noncentral F upper-tail probability. This matches statsmodels
// FTestAnovaPower, which takes the total nobs and k_groups and the same f.
//
// Cohen's f relates to eta-squared by f^2 = eta2 / (1 - eta2), so the UI can let
// a user enter either; we keep the engine in f and convert at the edge.

/** Convert eta-squared to Cohen's f, the effect-size unit the F power uses. */
export function cohenFFromEtaSquared(etaSquared: number): number {
  if (!(etaSquared >= 0 && etaSquared < 1)) return NaN;
  return Math.sqrt(etaSquared / (1 - etaSquared));
}

/** Convert Cohen's f back to eta-squared, for reporting a sensitivity result. */
export function etaSquaredFromCohenF(f: number): number {
  const f2 = f * f;
  return f2 / (1 + f2);
}

/** Achieved power of a one-way ANOVA, k groups, total N, effect f. */
export function powerOneWayAnova(
  totalN: number,
  k: number,
  f: number,
  alpha: number,
): number {
  if (k < 2 || totalN <= k) return NaN;
  const df1 = k - 1;
  const df2 = totalN - k;
  const lambda = f * f * totalN;
  // Central F critical value (upper tail) under the null.
  const fCrit = fQuantile(1 - alpha, df1, df2);
  // Power is the noncentral F mass above the critical value.
  return clampPower(1 - noncentralFCdf(fCrit, df1, df2, lambda));
}

/**
 * A priori total sample size for a one-way ANOVA. Returns the smallest total N
 * (across all k groups) whose power reaches the target. Null when f = 0. Note the
 * value is the TOTAL N; divide by k for a per-group count when reporting.
 */
export function sampleSizeOneWayAnova(
  k: number,
  f: number,
  alpha: number,
  targetPower: number,
): number | null {
  if (k < 2 || f === 0) return null;
  // df2 = N - k must stay positive, so the floor is N = k + 1.
  return smallestNForPower(
    (totalN) => powerOneWayAnova(totalN, k, f, alpha),
    targetPower,
    k + 1,
  );
}

/** Sensitivity for a one-way ANOVA. Smallest Cohen's f detectable at total N. */
export function detectableFOneWayAnova(
  totalN: number,
  k: number,
  alpha: number,
  targetPower: number,
): number | null {
  if (k < 2 || totalN <= k) return null;
  return effectForPower(
    (f) => powerOneWayAnova(totalN, k, f, alpha),
    targetPower,
    1e-6,
    2,
  );
}

// --- Pearson correlation, via the Fisher z transform ---
//
// Under H1 the Fisher z = atanh(r) is approximately normal with mean atanh(rho)
// and SD 1 / sqrt(N - 3). A two-sided test at level alpha rejects when the
// observed z exceeds z* = z_{1 - alpha/2} / sqrt(N - 3) in magnitude. Power is the
// normal probability of landing in either rejection region under the shifted
// mean. This is the standard correlation power and matches statsmodels'
// NormalIndPower applied to the Fisher-z effect size atanh(r).

/** Achieved power of a two-sided Pearson correlation test, N pairs, true r. */
export function powerCorrelation(n: number, r: number, alpha: number): number {
  if (n < 4) return NaN;
  const se = 1 / Math.sqrt(n - 3);
  const effect = Math.atanh(Math.abs(r)); // Fisher z of the alternative.
  const zCrit = normalQuantile(1 - alpha / 2);
  // Mean of the observed z (in SD units) is effect / se. Power in both tails.
  const upper = 1 - normalCdf(zCrit - effect / se);
  const lower = normalCdf(-zCrit - effect / se);
  return clampPower(upper + lower);
}

/** A priori number of pairs for a Pearson correlation test. Null when r = 0. */
export function sampleSizeCorrelation(
  r: number,
  alpha: number,
  targetPower: number,
): number | null {
  if (r === 0) return null;
  // df needs N - 3 > 0, so the floor is N = 4.
  return smallestNForPower((n) => powerCorrelation(n, r, alpha), targetPower, 4);
}

/** Sensitivity for a Pearson correlation. Smallest |r| detectable with N pairs. */
export function detectableRCorrelation(
  n: number,
  alpha: number,
  targetPower: number,
): number | null {
  if (n < 4) return null;
  // r lives in (0, 1); search the open magnitude interval.
  return effectForPower(
    (r) => powerCorrelation(n, Math.min(r, 0.999999), alpha),
    targetPower,
    1e-6,
    0.5,
  );
}

// --- small shared utilities ---

function clampPower(p: number): number {
  if (!Number.isFinite(p)) return NaN;
  return Math.min(1, Math.max(0, p));
}

// The central F upper quantile. dists.ts exposes fCdf but not the F quantile, and
// the planner needs the critical value F* under the null. We invert the central F
// CDF by bisection (monotone increasing), which is cheap and keeps the planner
// self-contained without widening the dists.ts surface.
function fQuantile(p: number, d1: number, d2: number): number {
  if (!(p > 0 && p < 1)) return NaN;
  // Bracket: F is positive and unbounded above; double the high edge until the
  // central F CDF passes p.
  let lo = 0;
  let hi = 2;
  let guard = 0;
  while (noncentralFCdf(hi, d1, d2, 0) < p) {
    hi *= 2;
    guard++;
    if (guard > 200) return NaN;
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const c = noncentralFCdf(mid, d1, d2, 0);
    if (Math.abs(c - p) < 1e-12) return mid;
    if (c < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
