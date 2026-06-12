// Validation for the bootstrap / resampling CI engine primitive.
//
// WHY a LAYERED strategy: a JS PRNG cannot reproduce scipy.stats.bootstrap
// resample-for-resample, so there is no way to pin an end-to-end seeded CI
// against scipy draw-for-draw. Instead we validate the two things that actually
// determine correctness, separately:
//
//   1. DETERMINISTIC-MATH layer (EXACT). The percentile extractor, the BCa
//      bias-correction z0, the jackknife acceleration a, and the BCa adjusted
//      percentile points are pure functions of fixed inputs. We feed
//      hand-written / scipy-computed inputs and assert the outputs to a tight
//      tolerance. This proves the BCa machinery is correct INDEPENDENT of the
//      RNG. The reference numbers below were produced by a throwaway numpy/scipy
//      script (cited inline at each assertion) and are reproducible by hand.
//
//   2. CONVERGENCE layer (STATISTICAL, loose tolerance). With the seeded PRNG
//      and a large B, the bootstrap percentile CI of the mean on a fixed
//      normal-ish sample must land CLOSE to the analytic t-interval, and the BCa
//      CI on a right-skewed sample must shift UP relative to the percentile CI
//      (the expected BCa correction direction for positive skew). Tolerances are
//      deliberately loose because Monte-Carlo noise at finite B is real; the
//      rationale and size of each tolerance is documented at the assertion.

import { describe, expect, it } from "vitest";

import {
  bootstrapCI,
  bootstrapDiffCI,
  percentileInterval,
  biasCorrection,
  jackknifeAcceleration,
  mulberry32,
  sampleMean,
  sampleMedian,
  meanDifference,
} from "../bootstrap";

// --- Layer 1: deterministic math, pinned exactly ---

describe("percentileInterval (exact, no RNG)", () => {
  it("matches numpy type-7 quantiles on 1..10", () => {
    // numpy: np.quantile([1..10], [0.025, 0.975]) = [1.225, 9.775].
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const [lo, hi] = percentileInterval(sorted, 0.05);
    expect(lo).toBeCloseTo(1.225, 10);
    expect(hi).toBeCloseTo(9.775, 10);
  });

  it("matches numpy on the 11-element 0..100 ladder", () => {
    // numpy: np.quantile([0,10,...,100], [0.025, 0.975]) = [2.5, 97.5].
    const sorted = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const [lo, hi] = percentileInterval(sorted, 0.05);
    expect(lo).toBeCloseTo(2.5, 10);
    expect(hi).toBeCloseTo(97.5, 10);
  });
});

describe("biasCorrection z0 (exact, hand-written bootstrap distribution)", () => {
  it("returns the scipy norm.ppf of the below-or-half-equal share", () => {
    // Hand-written boot distribution (NOT from RNG), observed = 5.0. Constructed
    // so the share strictly below the observed is 4 of 10 and exactly 1 ties the
    // observed, giving prop = (4 + 0.5) / 10 = 0.45:
    //   below 5.0: 3, 3.5, 4, 4.5  (4 values)
    //   equal 5.0: 5.0             (1 value, counted as half)
    //   above 5.0: 5.5, 6, 6.5, 7, 7.5  (5 values)
    const obs = 5.0;
    const dist = [3.0, 3.5, 4.0, 4.5, obs, 5.5, 6.0, 6.5, 7.0, 7.5];
    const z0 = biasCorrection(dist, obs);
    // scipy reference: norm.ppf(0.45) = -0.12566134685507402
    expect(z0).toBeCloseTo(-0.12566134685507402, 10);
  });

  it("is 0 for a symmetric distribution centered on the observed", () => {
    // below = equal-split, prop = 0.5, norm.ppf(0.5) = 0.
    const obs = 0;
    const dist = [-2, -1, 0, 1, 2];
    const z0 = biasCorrection(dist, obs);
    expect(z0).toBeCloseTo(0, 12);
  });
});

describe("jackknifeAcceleration a (exact, scipy-pinned)", () => {
  // Fixed sample used in the scipy reference script:
  const sample = [2, 4, 4, 4, 5, 5, 7, 9];

  it("matches the scipy jackknife acceleration for the mean", () => {
    // scipy reference: a_mean = 0.038669902096139144
    const a = jackknifeAcceleration(sample, sampleMean);
    expect(a).toBeCloseTo(0.038669902096139144, 10);
  });

  it("matches the scipy jackknife acceleration for the population variance", () => {
    // A deliberately skewed statistic gives a clearly nonzero acceleration, so
    // this exercises the cubic numerator with a value worth pinning.
    // scipy reference: a_var = 0.07958812847276805
    const popVar = (s: number[]): number => {
      const m = s.reduce((x, y) => x + y, 0) / s.length;
      return s.reduce((acc, v) => acc + (v - m) * (v - m), 0) / s.length;
    };
    const a = jackknifeAcceleration(sample, popVar);
    expect(a).toBeCloseTo(0.07958812847276805, 10);
  });
});

describe("BCa interval reproduces the percentile interval when z0 = a = 0", () => {
  it("a symmetric bootstrap of a symmetric sample gives BCa approx percentile", () => {
    // On a symmetric sample the mean's z0 and a are both near 0, so the BCa and
    // percentile intervals must nearly coincide. Same seed and B for both, so
    // the only difference is the BCa adjustment, which here is negligible.
    const sample = [-3, -2, -1, 0, 1, 2, 3];
    const opts = { B: 4000, seed: 7, alpha: 0.05 } as const;
    const pct = bootstrapCI(sample, sampleMean, { ...opts, method: "percentile" });
    const bca = bootstrapCI(sample, sampleMean, { ...opts, method: "bca" });
    expect(pct).not.toBeNull();
    expect(bca).not.toBeNull();
    // z0 should be tiny and a near 0 for the symmetric mean.
    expect(Math.abs(bca!.z0 ?? 1)).toBeLessThan(0.1);
    expect(Math.abs(bca!.acceleration ?? 1)).toBeLessThan(0.05);
    // Bounds agree to within a small fraction of the half-width.
    const halfWidth = (pct!.ci[1] - pct!.ci[0]) / 2;
    expect(Math.abs(bca!.ci[0] - pct!.ci[0])).toBeLessThan(0.15 * halfWidth);
    expect(Math.abs(bca!.ci[1] - pct!.ci[1])).toBeLessThan(0.15 * halfWidth);
  });
});

// --- Layer 2: statistical convergence, loose documented tolerances ---

describe("convergence: percentile CI of the mean approx analytic t-interval", () => {
  it("lands within 10 percent of the t-interval half-width", () => {
    // Fixed normal-ish sample (n = 20). scipy analytic t-interval of the mean:
    //   mean = 5.04, t-interval = [4.94870403785438, 5.13129596214562],
    //   half-width = 0.09129596214561977.
    const sample = [
      5.1, 4.8, 5.5, 4.9, 5.2, 5.0, 4.7, 5.3, 5.1, 4.95, 5.05, 4.85, 5.25,
      4.9, 5.15, 5.0, 4.8, 5.2, 5.1, 4.95,
    ];
    const tLo = 4.94870403785438;
    const tHi = 5.13129596214562;
    const tHalf = (tHi - tLo) / 2;
    // Large B drives down Monte-Carlo noise; the bootstrap mean CI is known to
    // converge to the normal-theory interval as n and B grow. Tolerance is set
    // to 10 percent of the analytic half-width, well inside the residual noise
    // at B = 10000 on n = 20, and chosen loose on purpose because an EXACT match
    // is impossible (the bootstrap uses the empirical, not the t, distribution).
    const res = bootstrapCI(sample, sampleMean, {
      B: 10000,
      seed: 42,
      method: "percentile",
    });
    expect(res).not.toBeNull();
    const tol = 0.1 * tHalf;
    expect(Math.abs(res!.ci[0] - tLo)).toBeLessThan(tol);
    expect(Math.abs(res!.ci[1] - tHi)).toBeLessThan(tol);
  });
});

describe("convergence: BCa shifts in the expected direction on a skewed sample", () => {
  it("right-skewed mean: BCa interval sits above the percentile interval", () => {
    // Right-skewed sample (scipy skewness approx 1.69, mean approx 6.083). For
    // positive skew the BCa correction (positive z0 and acceleration) pushes
    // BOTH bounds UP relative to the plain percentile interval; that directional
    // shift is the qualitative BCa behavior we assert. We do not pin the exact
    // bounds (RNG-dependent), only the direction, which is robust to the seed.
    const skew = [1, 1, 1, 2, 2, 3, 3, 4, 6, 10, 15, 25];
    const opts = { B: 10000, seed: 99, alpha: 0.05 } as const;
    const pct = bootstrapCI(skew, sampleMean, { ...opts, method: "percentile" });
    const bca = bootstrapCI(skew, sampleMean, { ...opts, method: "bca" });
    expect(pct).not.toBeNull();
    expect(bca).not.toBeNull();
    // Positive acceleration and z0 are the signature of right skew here.
    expect(bca!.acceleration!).toBeGreaterThan(0);
    // Both BCa bounds shift up (toward the long right tail) vs percentile.
    expect(bca!.ci[0]).toBeGreaterThan(pct!.ci[0]);
    expect(bca!.ci[1]).toBeGreaterThan(pct!.ci[1]);
  });
});

// --- Reproducibility + API surface ---

describe("seeded reproducibility and the two-sample path", () => {
  it("same seed gives an identical CI; different seed differs", () => {
    const sample = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = bootstrapCI(sample, sampleMean, { B: 1000, seed: 5 });
    const b = bootstrapCI(sample, sampleMean, { B: 1000, seed: 5 });
    const c = bootstrapCI(sample, sampleMean, { B: 1000, seed: 6 });
    expect(a!.ci).toEqual(b!.ci);
    expect(a!.ci).not.toEqual(c!.ci);
  });

  it("mulberry32 is deterministic per seed", () => {
    const r1 = mulberry32(123);
    const r2 = mulberry32(123);
    expect(r1()).toBe(r2());
    expect(r1()).toBe(r2());
  });

  it("two-sample mean-difference CI brackets the observed difference", () => {
    // Two clearly separated groups: the difference of means is about -5 and the
    // bootstrap CI must contain it (a basic sanity coverage check).
    const a = [10, 11, 9, 10, 12, 8, 11, 10];
    const b = [15, 16, 14, 15, 17, 13, 16, 15];
    const res = bootstrapDiffCI(a, b, meanDifference, {
      B: 4000,
      seed: 3,
      method: "bca",
    });
    expect(res).not.toBeNull();
    expect(res!.observed).toBeLessThan(0);
    expect(res!.ci[0]).toBeLessThanOrEqual(res!.observed);
    expect(res!.ci[1]).toBeGreaterThanOrEqual(res!.observed);
  });

  it("median helper and tiny / degenerate samples are handled", () => {
    expect(sampleMedian([3, 1, 2])).toBe(2);
    // n < 2 has no bootstrap, returns null rather than throwing.
    expect(bootstrapCI([1], sampleMean)).toBeNull();
    // A constant sample has zero spread; the CI collapses to the point value.
    const flat = bootstrapCI([4, 4, 4, 4], sampleMean, { B: 500, seed: 1 });
    expect(flat).not.toBeNull();
    expect(flat!.ci[0]).toBeCloseTo(4, 10);
    expect(flat!.ci[1]).toBeCloseTo(4, 10);
  });
});
