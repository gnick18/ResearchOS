import { describe as suite, it, expect } from "vitest";

import { randomInterceptModel } from "../mixed-model";

// The shared transparency fixture: 6 subjects x 3 conditions (rows = subjects).
// Mirrored from src/lib/transparency/datasets/datahub-stats.ts (REPEATED). The
// linear mixed model reshapes it to long form (a response value, a treatment-
// coded condition fixed effect with P the reference, a random intercept by
// subject) and fits by REML.
const REPEATED = [
  [5.1, 5.8, 6.0],
  [4.9, 5.5, 5.7],
  [5.6, 6.1, 6.4],
  [5.0, 5.4, 5.9],
  [5.3, 5.7, 6.2],
  [4.8, 5.2, 5.6],
];
const REPEATED_LABELS = ["P", "Q", "R"];

// statsmodels.regression.mixed_linear_model.MixedLM, groups=subject,
// re_formula="1", default REML fit. Reference values copied verbatim from
// scripts/gen-datahub-stats-golden.py run against statsmodels 0.14.6.
suite("random-intercept linear mixed model (REML)", () => {
  it("matches the statsmodels MixedLM reference on the REPEATED fixture", () => {
    const r = randomInterceptModel(REPEATED, REPEATED_LABELS);
    if (!r.ok) throw new Error("expected ok");

    expect(r.groups).toBe(6);
    expect(r.observations).toBe(18);
    expect(r.conditionLabels).toEqual(["P", "Q", "R"]);

    const [intercept, q, rEffect] = r.fixedEffects;
    expect(intercept.name).toBe("(Intercept)");
    expect(q.name).toBe("Q");
    expect(rEffect.name).toBe("R");

    // The fixed effects and their SEs are stable across implementations, so the
    // engine reproduces the statsmodels values tightly. Intercept is the
    // reference-condition (P) mean; Q and R are the differences from P.
    expect(intercept.estimate).toBeCloseTo(5.116667, 4);
    expect(intercept.standardError).toBeCloseTo(0.12427, 4);
    expect(q.estimate).toBeCloseTo(0.5, 4);
    expect(q.standardError).toBeCloseTo(0.045948, 4);
    expect(rEffect.estimate).toBeCloseTo(0.85, 4);
    expect(rEffect.standardError).toBeCloseTo(0.045948, 4);

    // Wald z and the two-sided normal p follow from the estimate and SE.
    expect(q.z).toBeCloseTo(q.estimate / q.standardError, 8);
    expect(q.pValue).toBeGreaterThanOrEqual(0);
    expect(q.pValue).toBeLessThan(1e-6);

    // The 95% Wald interval is the estimate plus or minus 1.96 standard errors.
    expect(q.ciLow).toBeCloseTo(q.estimate - 1.959964 * q.standardError, 6);
    expect(q.ciHigh).toBeCloseTo(q.estimate + 1.959964 * q.standardError, 6);

    // The variance components and the REML log-likelihood come from a numeric
    // optimum, so we check them on an honest looser band (matching the
    // transparency pins). The observed deltas are far inside these bands.
    expect(r.groupVariance).toBeCloseTo(0.086325, 2);
    expect(r.residualVariance).toBeCloseTo(0.006334, 2);
    expect(r.remlLogLikelihood).toBeCloseTo(4.654847, 2);

    // The random-intercept variance dominates the residual on this fixture (the
    // subjects differ in baseline far more than the within-subject scatter).
    expect(r.groupVariance).toBeGreaterThan(r.residualVariance);
  });

  it("drops subjects with a missing condition (complete cases only)", () => {
    const withGap = [...REPEATED, [5.0, NaN, 5.5]];
    const r = randomInterceptModel(withGap, REPEATED_LABELS);
    if (!r.ok) throw new Error("expected ok");
    expect(r.groups).toBe(6);
    expect(r.observations).toBe(18);
  });

  it("rejects fewer than 2 conditions or 2 subjects", () => {
    expect(randomInterceptModel([[1], [2]], ["P"]).ok).toBe(false);
    expect(randomInterceptModel([[1, 2]], ["P", "Q"]).ok).toBe(false);
  });

  it("recovers an unbiased common mean when subjects share one level", () => {
    // Two conditions with a constant per-subject offset and identical contrast:
    // the Q effect must equal the constant gap, and the random-intercept
    // variance must be positive (the subjects differ in baseline).
    const data = [
      [1.0, 2.0],
      [3.0, 4.0],
      [5.0, 6.0],
      [2.0, 3.0],
    ];
    const r = randomInterceptModel(data, ["P", "Q"]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.fixedEffects[1].estimate).toBeCloseTo(1.0, 6);
    expect(r.groupVariance).toBeGreaterThan(0);
  });
});
