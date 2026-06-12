// E3 validation suite: power and sample-size planning, pinned against
// statsmodels.stats.power reference values. The math correctness IS the feature,
// so every power number, every a priori N, and every sensitivity effect size is
// checked against statsmodels with the exact Python call recorded above the
// assertion. References were produced in a throwaway venv (numpy + scipy +
// statsmodels) and the venv was then deleted; the numbers are frozen here.
//
// Tolerances. Achieved power matches statsmodels to ~1e-3 (we share the same
// noncentral t / F backend, so the agreement is much tighter than that in
// practice). A priori sample size is an integer, and our rule is "the smallest
// integer N whose achieved power reaches the target" (round UP so the planned
// study is never under-powered). statsmodels.solve_power returns a FRACTIONAL N
// at the exact power crossover, so our integer answer is its ceiling. Each N
// assertion records both the fractional statsmodels value and its ceiling.
//
// Correlation note. statsmodels has no first-class Pearson-correlation power
// engine, so the references for r were built directly from the Fisher z normal
// model (the same construction the engine implements), using scipy.stats.norm
// and scipy.optimize.brentq. The Python is recorded in full above those blocks.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe as suite, it, expect } from "vitest";

import {
  powerTwoSampleT,
  sampleSizeTwoSampleT,
  detectableDTwoSampleT,
  powerPairedT,
  sampleSizePairedT,
  detectableDzPairedT,
  powerOneWayAnova,
  sampleSizeOneWayAnova,
  detectableFOneWayAnova,
  cohenFFromEtaSquared,
  etaSquaredFromCohenF,
  powerCorrelation,
  sampleSizeCorrelation,
  detectableRCorrelation,
} from "../power";

suite("two-sample t-test power and sample size", () => {
  it("achieved power matches statsmodels TTestIndPower", () => {
    // from statsmodels.stats.power import TTestIndPower
    // ind = TTestIndPower()
    //   ind.power(0.8, nobs1=26, alpha=0.05, ratio=1.0, alternative='two-sided')
    //     = 0.8074866151465275
    //   ind.power(0.5, nobs1=64, alpha=0.05, ratio=1.0, alternative='two-sided')
    //     = 0.8014595579222543
    //   ind.power(0.3, nobs1=100, alpha=0.01, ratio=1.0, alternative='two-sided')
    //     = 0.31837231020520734
    expect(powerTwoSampleT(26, 0.8, 0.05)).toBeCloseTo(0.8074866151465275, 4);
    expect(powerTwoSampleT(64, 0.5, 0.05)).toBeCloseTo(0.8014595579222543, 4);
    expect(powerTwoSampleT(100, 0.3, 0.01)).toBeCloseTo(0.31837231020520734, 4);
  });

  it("a priori per-group N is the ceiling of statsmodels solve_power", () => {
    // ind.solve_power(effect_size=0.8, power=0.8, alpha=0.05, ratio=1.0,
    //                 alternative='two-sided') = 25.524571854446116 -> ceil 26
    // ind.solve_power(0.5, power=0.8, ...) = 63.765610588911635 -> ceil 64
    // ind.solve_power(0.5, power=0.9, ...) = 85.03128411573417  -> ceil 86
    expect(sampleSizeTwoSampleT(0.8, 0.05, 0.8)).toBe(26);
    expect(sampleSizeTwoSampleT(0.5, 0.05, 0.8)).toBe(64);
    expect(sampleSizeTwoSampleT(0.5, 0.05, 0.9)).toBe(86);
    // A zero effect needs an unbounded N, reported as null.
    expect(sampleSizeTwoSampleT(0, 0.05, 0.8)).toBeNull();
  });

  it("sensitivity detectable d matches statsmodels (continuous)", () => {
    // ind.solve_power(nobs1=26, power=0.8, alpha=0.05, ratio=1.0,
    //                 alternative='two-sided') = 0.79234670152806
    // ind.solve_power(nobs1=64, power=0.9, ...) = 0.577443211836613
    expect(detectableDTwoSampleT(26, 0.05, 0.8)).toBeCloseTo(0.79234670152806, 3);
    expect(detectableDTwoSampleT(64, 0.05, 0.9)).toBeCloseTo(0.577443211836613, 3);
  });
});

suite("paired t-test power and sample size", () => {
  it("achieved power matches statsmodels TTestPower", () => {
    // from statsmodels.stats.power import TTestPower
    // pt = TTestPower()
    //   pt.power(0.5, nobs=34, alpha=0.05, alternative='two-sided')
    //     = 0.8077775012792736
    //   pt.power(0.8, nobs=15, alpha=0.05, alternative='two-sided')
    //     = 0.8213105387241096
    expect(powerPairedT(34, 0.5, 0.05)).toBeCloseTo(0.8077775012792736, 4);
    expect(powerPairedT(15, 0.8, 0.05)).toBeCloseTo(0.8213105387241096, 4);
  });

  it("a priori number of pairs is the ceiling of statsmodels solve_power", () => {
    // pt.solve_power(effect_size=0.5, power=0.8, alpha=0.05,
    //                alternative='two-sided') = 33.36713118431777 -> ceil 34
    // pt.solve_power(0.8, power=0.9, ...) = 18.446224616418814 -> ceil 19
    expect(sampleSizePairedT(0.5, 0.05, 0.8)).toBe(34);
    expect(sampleSizePairedT(0.8, 0.05, 0.9)).toBe(19);
    expect(sampleSizePairedT(0, 0.05, 0.8)).toBeNull();
  });

  it("sensitivity detectable dz matches statsmodels (continuous)", () => {
    // pt.solve_power(nobs=34, power=0.8, alpha=0.05, alternative='two-sided')
    //   = 0.4950291315285059
    expect(detectableDzPairedT(34, 0.05, 0.8)).toBeCloseTo(0.4950291315285059, 3);
  });
});

suite("one-way ANOVA power and sample size", () => {
  it("achieved power matches statsmodels FTestAnovaPower", () => {
    // from statsmodels.stats.power import FTestAnovaPower
    // fa = FTestAnovaPower()  (effect_size is Cohen's f, nobs is the TOTAL N)
    //   fa.power(0.25, nobs=60, alpha=0.05, k_groups=3) = 0.37443107625635486
    //   fa.power(0.40, nobs=80, alpha=0.05, k_groups=4) = 0.8453727808006524
    //   fa.power(0.10, nobs=150, alpha=0.05, k_groups=3) = 0.17552867719318543
    expect(powerOneWayAnova(60, 3, 0.25, 0.05)).toBeCloseTo(0.37443107625635486, 4);
    expect(powerOneWayAnova(80, 4, 0.4, 0.05)).toBeCloseTo(0.8453727808006524, 4);
    expect(powerOneWayAnova(150, 3, 0.1, 0.05)).toBeCloseTo(0.17552867719318543, 4);
  });

  it("a priori TOTAL N is the ceiling of statsmodels solve_power", () => {
    // fa.solve_power(effect_size=0.25, power=0.8, alpha=0.05, k_groups=3)
    //   = 157.1897924213224 -> ceil 158
    // fa.solve_power(0.40, power=0.9, alpha=0.05, k_groups=4)
    //   = 92.5831257948802 -> ceil 93
    expect(sampleSizeOneWayAnova(3, 0.25, 0.05, 0.8)).toBe(158);
    expect(sampleSizeOneWayAnova(4, 0.4, 0.05, 0.9)).toBe(93);
    expect(sampleSizeOneWayAnova(3, 0, 0.05, 0.8)).toBeNull();
  });

  it("sensitivity detectable Cohen's f matches statsmodels (continuous)", () => {
    // fa.solve_power(nobs=60, power=0.8, alpha=0.05, k_groups=3)
    //   = 0.4114918047828209
    expect(detectableFOneWayAnova(60, 3, 0.05, 0.8)).toBeCloseTo(0.4114918047828209, 3);
  });

  it("eta-squared and Cohen's f convert both ways", () => {
    // f = sqrt(eta2 / (1 - eta2)); eta2 = f^2 / (1 + f^2). A round trip is exact.
    // Cohen's f = 0.25 corresponds to eta-squared 0.0588235...
    expect(cohenFFromEtaSquared(0.0588235294117647)).toBeCloseTo(0.25, 6);
    expect(etaSquaredFromCohenF(0.25)).toBeCloseTo(0.0588235294117647, 8);
    expect(etaSquaredFromCohenF(cohenFFromEtaSquared(0.3))).toBeCloseTo(0.3, 10);
  });
});

suite("Pearson correlation power and sample size (Fisher z)", () => {
  it("achieved power matches the Fisher-z normal model", () => {
    // import numpy as np; from scipy.stats import norm
    // def corr_power(n, r, alpha):
    //     se = 1/np.sqrt(n-3); eff = np.arctanh(abs(r)); zc = norm.ppf(1-alpha/2)
    //     return (1-norm.cdf(zc - eff/se)) + norm.cdf(-zc - eff/se)
    //   corr_power(84, 0.3, 0.05)  = 0.7955174261087984
    //   corr_power(30, 0.5, 0.05)  = 0.8144239082828044
    //   corr_power(100, 0.1, 0.01) = 0.05636641166789144
    expect(powerCorrelation(84, 0.3, 0.05)).toBeCloseTo(0.7955174261087984, 4);
    expect(powerCorrelation(30, 0.5, 0.05)).toBeCloseTo(0.8144239082828044, 4);
    expect(powerCorrelation(100, 0.1, 0.01)).toBeCloseTo(0.05636641166789144, 4);
  });

  it("a priori N is the smallest integer reaching the target power", () => {
    // smallest integer N with corr_power(N, r, alpha) >= power:
    //   r=0.3, power=0.8, alpha=0.05 -> 85
    //   r=0.5, power=0.9, alpha=0.05 -> 38
    expect(sampleSizeCorrelation(0.3, 0.05, 0.8)).toBe(85);
    expect(sampleSizeCorrelation(0.5, 0.05, 0.9)).toBe(38);
    expect(sampleSizeCorrelation(0, 0.05, 0.8)).toBeNull();
  });

  it("sensitivity detectable r matches scipy brentq on the Fisher-z model", () => {
    // from scipy.optimize import brentq
    //   brentq(lambda r: corr_power(84, r, 0.05) - 0.8, 1e-9, 0.999999)
    //     = 0.30160735367134844
    expect(detectableRCorrelation(84, 0.05, 0.8)).toBeCloseTo(0.30160735367134844, 3);
  });
});
