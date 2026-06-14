import { describe as suite, it, expect } from "vitest";

import {
  fitModel,
  fitGlobal,
  listModels,
  aicc,
  aiccCompare,
  extraSumOfSquaresF,
  type ModelFitSummary,
} from "../fit";

suite("Michaelis-Menten vs R nls Puromycin reference", () => {
  // R's built-in Puromycin dataset, treated state. The R nls fit
  //   nls(rate ~ Vm * conc/(K + conc), start = c(Vm = 200, K = 0.05))
  // gives the certified estimates
  //   Vm = 212.68369   (SE 6.94715)
  //   K  = 0.06412     (SE 0.00828)
  //   residual sum-of-squares = 1195.
  // Source: Bates & Watts (1988); reproduced in R datasets::Puromycin docs
  //   https://stat.ethz.ch/R-manual/R-devel/library/datasets/html/Puromycin.html
  const conc = [0.02, 0.02, 0.06, 0.06, 0.11, 0.11, 0.22, 0.22, 0.56, 0.56, 1.1, 1.1];
  const rate = [76, 47, 97, 107, 123, 139, 159, 152, 191, 201, 207, 200];

  const r = fitModel("michaelis-menten", conc, rate);

  it("recovers Vmax and Km", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.Vmax).toBeCloseTo(212.68369, 1);
    expect(r.values.Km).toBeCloseTo(0.06412, 4);
  });

  it("matches the residual sum-of-squares and a high R-squared", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.ssr).toBeCloseTo(1195, 0);
    expect(r.rSquared).toBeGreaterThan(0.96);
  });

  it("produces standard errors close to the R summary table", () => {
    // SE(Vm) ~ 6.947, SE(K) ~ 0.00828 from R summary(nls fit). Our SEs come from
    // s^2 * pinv(J^T J); pinned to 1 significant figure for cross-tool tolerance.
    if (!r.ok) throw new Error("expected ok");
    const vm = r.parameters.find((p) => p.name === "Vmax")!;
    const km = r.parameters.find((p) => p.name === "Km")!;
    expect(vm.standardError).toBeCloseTo(6.947, 0);
    expect(km.standardError).toBeCloseTo(0.00828, 3);
    // 95% CI should bracket the point estimate.
    expect(vm.ci95[0]).toBeLessThan(vm.value);
    expect(vm.ci95[1]).toBeGreaterThan(vm.value);
  });
});

suite("4-parameter logistic dose-response (EC50)", () => {
  // Synthetic but exact 4PL data generated from known parameters:
  //   Bottom = 0, Top = 100, logEC50 = -6 (EC50 = 1e-6 M), HillSlope = 1.
  //   y = Bottom + (Top - Bottom) / (1 + 10^((logEC50 - x) * HillSlope))
  // x is log10(dose). Because the data are noise-free and lie exactly on the
  // curve, a correct fitter must recover the generating parameters and report
  // EC50 = 10^logEC50 = 1e-6. This is the standard self-consistency check used
  // when no published 4PL worked example with raw data is available; the model
  // formula matches GraphPad Prism's "log(agonist) vs response (variable slope)"
  //   https://www.graphpad.com/guides/prism/latest/curve-fitting/reg_dr_stim_variable.htm
  const BOTTOM = 0;
  const TOP = 100;
  const LOG_EC50 = -6;
  const HILL = 1;
  const xs = [-9, -8, -7.5, -7, -6.5, -6, -5.5, -5, -4.5, -4, -3];
  const ys = xs.map(
    (x) => BOTTOM + (TOP - BOTTOM) / (1 + Math.pow(10, (LOG_EC50 - x) * HILL)),
  );

  const r = fitModel("logistic4pl", xs, ys);

  it("recovers the four generating parameters", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.Bottom).toBeCloseTo(BOTTOM, 3);
    expect(r.values.Top).toBeCloseTo(TOP, 3);
    expect(r.values.logEC50).toBeCloseTo(LOG_EC50, 3);
    expect(r.values.HillSlope).toBeCloseTo(HILL, 3);
  });

  it("reports EC50 = IC50 = 10^logEC50", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.derived?.EC50).toBeCloseTo(1e-6, 9);
    expect(r.derived?.IC50).toBeCloseTo(1e-6, 9);
    expect(r.rSquared).toBeGreaterThan(0.9999);
  });
});

suite("4PL noisy-data regression: no mirror / degenerate optimum", () => {
  // The 4PL has an exact mirror degeneracy, (Bottom, Top, Hill) and
  // (Top, Bottom, -Hill) describe the SAME curve, plus a starting guess that used
  // to fix the Hill sign to +1. On a DECREASING (inhibition) curve that wrong-sign
  // seed stranded the optimizer in a degenerate optimum: it reported Top < Bottom,
  // a Hill of the wrong sign, and a half-max (EC50) decades outside the tested
  // doses, sometimes with a wrecked R-squared. Regression guards both the fix
  // (trend-aware Hill seed + logEC50 bound) and the canonical-orientation guard
  // (always report Top >= Bottom). x is log10(dose); the deterministic noise array
  // makes the fit reproducible.
  const BOTTOM = 5;
  const TOP = 95;
  const LOG_EC50 = 1; // EC50 = 10
  const xs = [-1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3];
  // Fixed pseudo-noise, so the dataset is "known" and the assertions stable.
  const noise = [2.1, -1.7, 3.0, -2.4, 1.2, -0.8, 2.6, -1.1, 0.5];
  const fourPLAt = (x: number, hill: number) =>
    BOTTOM + (TOP - BOTTOM) / (1 + Math.pow(10, (LOG_EC50 - x) * hill));

  it("recovers a steep DECREASING curve (true Hill -3) instead of a wrecked fit", () => {
    // This is the case that previously collapsed to R-squared ~0.22.
    const ys = xs.map((x, i) => fourPLAt(x, -3) + noise[i]);
    const r = fitModel("logistic4pl", xs, ys);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Canonical orientation: Top is reported above Bottom regardless of direction.
    expect(r.values.Top).toBeGreaterThan(r.values.Bottom);
    // Direction is carried by the Hill sign (negative for a decreasing curve).
    expect(r.values.HillSlope).toBeLessThan(0);
    // EC50 lands near the truth (10), inside the tested dose range, NOT at ~1e8.
    expect(r.values.logEC50).toBeCloseTo(LOG_EC50, 1);
    expect(r.derived?.EC50).toBeGreaterThan(3);
    expect(r.derived?.EC50).toBeLessThan(30);
    // The fit is good now, not the old degenerate near-flat optimum.
    expect(r.rSquared).toBeGreaterThan(0.95);
  });

  it("recovers a shallow DECREASING curve with canonical Top >= Bottom", () => {
    const ys = xs.map((x, i) => fourPLAt(x, -1) + noise[i]);
    const r = fitModel("logistic4pl", xs, ys);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.Top).toBeGreaterThan(r.values.Bottom);
    expect(r.values.HillSlope).toBeLessThan(0);
    expect(r.derived?.EC50).toBeGreaterThan(3);
    expect(r.derived?.EC50).toBeLessThan(30);
    expect(r.rSquared).toBeGreaterThan(0.95);
  });

  it("still fits an INCREASING noisy curve correctly (no regression)", () => {
    const ys = xs.map((x, i) => fourPLAt(x, 1) + noise[i]);
    const r = fitModel("logistic4pl", xs, ys);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.Top).toBeGreaterThan(r.values.Bottom);
    expect(r.values.HillSlope).toBeGreaterThan(0);
    expect(r.derived?.EC50).toBeGreaterThan(3);
    expect(r.derived?.EC50).toBeLessThan(30);
    expect(r.rSquared).toBeGreaterThan(0.95);
  });

  it("the logEC50 bound keeps the half-max inside a sane multiple of the data range", () => {
    const ys = xs.map((x, i) => fourPLAt(x, -3) + noise[i]);
    const r = fitModel("logistic4pl", xs, ys);
    if (!r.ok) throw new Error("expected ok");
    // x spans [-1, 3] (span 4); the bound is +/- 3*span, so logEC50 must stay
    // within [-13, 15]. The old failure put logEC50 at ~8.1 (EC50 1.3e8) which,
    // with a wider seed, could escape entirely; assert it is well inside.
    expect(r.values.logEC50).toBeGreaterThan(-13);
    expect(r.values.logEC50).toBeLessThan(15);
  });
});

suite("5-parameter logistic dose-response (asymmetric, EC50)", () => {
  // Self-consistency, the same noise-free check used for the 4PL. Data generated
  // from known 5PL parameters must be recovered, and the reported EC50 must be the
  // TRUE half-maximal-response concentration, NOT 10^logEC50 (they differ when
  // S != 1). With Bottom=0, Top=100, logEC50=-6, Hill=1, S=2 the true half-max
  // logEC50 is logEC50 - log10(2^(1/S) - 1)/Hill = -6 - log10(2^0.5 - 1)/1
  //   = -6 - log10(0.41421356) = -6 - (-0.382776) = -5.617224, EC50 = 2.414e-6.
  const BOTTOM = 0;
  const TOP = 100;
  const LOG_EC50 = -6;
  const HILL = 1;
  const S = 2;
  const xs = [-9, -8, -7.5, -7, -6.5, -6, -5.5, -5, -4.5, -4, -3, -2];
  const f5 = (x: number) =>
    BOTTOM +
    (TOP - BOTTOM) / Math.pow(1 + Math.pow(10, (LOG_EC50 - x) * HILL), S);
  const ys = xs.map(f5);
  const r = fitModel("logistic5pl", xs, ys);

  it("recovers the five generating parameters", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.Bottom).toBeCloseTo(BOTTOM, 2);
    expect(r.values.Top).toBeCloseTo(TOP, 2);
    expect(r.values.logEC50).toBeCloseTo(LOG_EC50, 2);
    expect(r.values.HillSlope).toBeCloseTo(HILL, 2);
    expect(r.values.S).toBeCloseTo(S, 2);
  });

  it("reports the TRUE half-max EC50, not 10^logEC50, for S != 1", () => {
    if (!r.ok) throw new Error("expected ok");
    // The naive 10^logEC50 would be 1e-6; the correct half-max EC50 is 2.414e-6.
    const trueLogEC50 = LOG_EC50 - Math.log10(Math.pow(2, 1 / S) - 1) / HILL;
    expect(r.derived?.logEC50True).toBeCloseTo(trueLogEC50, 3);
    expect(r.derived?.EC50).toBeCloseTo(Math.pow(10, trueLogEC50), 9);
    expect(r.derived?.EC50).not.toBeCloseTo(1e-6, 9);
    expect(r.rSquared).toBeGreaterThan(0.9999);
  });
});

suite("4PL + 5PL vs scipy.optimize.curve_fit reference", () => {
  // A fixed, noisy dose-response dataset (a 9-point-plus serial dilution; x is
  // log10(dose in M)). scipy.optimize.curve_fit was run in a throwaway venv
  // (numpy + scipy 1.17.1) on EXACTLY these arrays with the SAME model defs the
  // engine uses:
  //
  //   def fpl(x, bottom, top, logec50, hill):
  //       return bottom + (top - bottom) / (1 + 10**((logec50 - x) * hill))
  //   def f5pl(x, bottom, top, logec50, hill, s):
  //       return bottom + (top - bottom) / (1 + 10**((logec50 - x) * hill))**s
  //   curve_fit(fpl,  xs, ys, p0=[min(ys), max(ys), x_at_midpoint, 1])
  //   curve_fit(f5pl, xs, ys, p0=[min(ys), max(ys), x_at_midpoint, 1, 1])
  //
  // EC50 = 10^logEC50True; the 95% CI transforms the t-based logEC50 CI through
  // 10^(.). scipy reference output (see the D1 sub-bot report):
  //
  //   4PL: Bottom=4.708439 Top=98.298557 logEC50=-6.393451 Hill=0.930926
  //        EC50=4.041561e-07  EC50_CI=[3.841206e-07, 4.252365e-07]
  //        R2=0.99988139  SSR=1.888844  df=7
  //   5PL: Bottom=5.161668 Top=98.685689 logEC50param=-6.533206 Hill=0.873379
  //        S=1.236331  logEC50_true=-6.391352  EC50_true=4.061143e-07
  //        EC50_CI=[2.344336e-07, 7.035204e-07]  R2=0.99991617  SSR=1.335071  df=6
  //
  // Tolerance, 3 significant figures on EC50 and the headline parameters. A
  // nonlinear least-squares solution depends on the optimizer (Levenberg-Marquardt
  // here vs scipy's trust-region-reflective by default) and the initial guess, so
  // the converged minimum agrees to a few sig figs rather than bit-for-bit. The
  // wide-tolerance comparisons below assert agreement well within that band.
  const xs = [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0];
  const ys = [4.8, 6.1, 7.9, 12.5, 24.0, 47.0, 70.0, 86.0, 93.5, 96.8, 98.1];

  it("4PL matches the scipy EC50, Hill, Top, Bottom, R2", () => {
    const r = fitModel("logistic4pl", xs, ys);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.Bottom).toBeCloseTo(4.708439, 2);
    expect(r.values.Top).toBeCloseTo(98.298557, 2);
    expect(r.values.logEC50).toBeCloseTo(-6.393451, 3);
    expect(r.values.HillSlope).toBeCloseTo(0.930926, 3);
    expect(r.derived?.EC50).toBeGreaterThan(4.02e-7);
    expect(r.derived?.EC50).toBeLessThan(4.06e-7);
    expect(r.rSquared).toBeCloseTo(0.99988139, 4);
    // The EC50 95% CI brackets the point estimate and matches scipy to ~3 sig figs.
    const logp = r.parameters.find((p) => p.name === "logEC50")!;
    const ec50Lo = Math.pow(10, logp.ci95[0]);
    const ec50Hi = Math.pow(10, logp.ci95[1]);
    expect(ec50Lo).toBeGreaterThan(3.82e-7);
    expect(ec50Lo).toBeLessThan(3.86e-7);
    expect(ec50Hi).toBeGreaterThan(4.23e-7);
    expect(ec50Hi).toBeLessThan(4.28e-7);
  });

  it("5PL matches the scipy true EC50, S, R2 and an EC50 != 10^logEC50param", () => {
    const r = fitModel("logistic5pl", xs, ys);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.Top).toBeCloseTo(98.685689, 1);
    expect(r.values.S).toBeCloseTo(1.236331, 1);
    // True half-max EC50 ~4.06e-7, agreeing with the 4PL (same underlying curve).
    expect(r.derived?.EC50).toBeGreaterThan(3.9e-7);
    expect(r.derived?.EC50).toBeLessThan(4.3e-7);
    expect(r.derived?.logEC50True).toBeCloseTo(-6.391352, 2);
    // The raw logEC50 parameter (~-6.53) is distinct from the half-max logEC50.
    expect(r.values.logEC50).toBeLessThan(r.derived!.logEC50True - 0.05);
    expect(r.rSquared).toBeGreaterThan(0.9998);
  });
});

suite("exponential decay one-phase", () => {
  it("recovers rate constant, tau, and half-life", () => {
    // y = Plateau + (Y0 - Plateau) e^{-K x}; Y0 = 100, Plateau = 10, K = 0.5.
    const Y0 = 100;
    const PLATEAU = 10;
    const K = 0.5;
    const xs = [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 10];
    const ys = xs.map((x) => PLATEAU + (Y0 - PLATEAU) * Math.exp(-K * x));
    const r = fitModel("exp-decay-1phase", xs, ys);
    if (!r.ok) throw new Error("expected ok");
    expect(r.values.K).toBeCloseTo(K, 4);
    expect(r.derived?.tau).toBeCloseTo(1 / K, 4);
    expect(r.derived?.halfLife).toBeCloseTo(Math.LN2 / K, 4);
  });
});

suite("exponential association one-phase", () => {
  it("recovers the plateau and rate", () => {
    const Y0 = 5;
    const PLATEAU = 80;
    const K = 0.7;
    const xs = [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8];
    const ys = xs.map((x) => Y0 + (PLATEAU - Y0) * (1 - Math.exp(-K * x)));
    const r = fitModel("exp-association-1phase", xs, ys);
    if (!r.ok) throw new Error("expected ok");
    expect(r.values.Plateau).toBeCloseTo(PLATEAU, 3);
    expect(r.values.K).toBeCloseTo(K, 4);
  });
});

suite("linear + polynomial through the nonlinear path", () => {
  it("linear fit recovers slope and intercept", () => {
    const xs = [1, 2, 3, 4, 5, 6];
    const ys = xs.map((x) => 3 * x + 7);
    const r = fitModel("linear", xs, ys);
    if (!r.ok) throw new Error("expected ok");
    expect(r.values.Slope).toBeCloseTo(3, 6);
    expect(r.values.Intercept).toBeCloseTo(7, 6);
  });

  it("quadratic fit recovers a, b, c", () => {
    const xs = [-3, -2, -1, 0, 1, 2, 3, 4];
    const ys = xs.map((x) => 2 * x * x - 3 * x + 1);
    const r = fitModel("polynomial2", xs, ys);
    if (!r.ok) throw new Error("expected ok");
    expect(r.values.a).toBeCloseTo(2, 4);
    expect(r.values.b).toBeCloseTo(-3, 4);
    expect(r.values.c).toBeCloseTo(1, 4);
  });
});

suite("fitter guards + registry", () => {
  it("rejects an unknown model", () => {
    expect(fitModel("nope", [1, 2, 3], [1, 2, 3]).ok).toBe(false);
  });

  it("rejects too few points for the parameter count", () => {
    // 4PL has 4 params; 3 points is underdetermined.
    expect(fitModel("logistic4pl", [1, 2, 3], [1, 2, 3]).ok).toBe(false);
  });

  it("registry lists the required models", () => {
    const ids = listModels().map((m) => m.id);
    expect(ids).toContain("logistic4pl");
    expect(ids).toContain("logistic5pl");
    expect(ids).toContain("michaelis-menten");
    expect(ids).toContain("exp-decay-1phase");
    expect(ids).toContain("exp-association-1phase");
    expect(ids).toContain("linear");
  });
});

suite("model comparison (D2): F test + AICc", () => {
  // The dose-response dataset (also the scipy-pinned transparency dataset). Fit
  // both nested models and check the comparison math against the scipy reference.
  const XS = [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0];
  const YS = [4.8, 6.1, 7.9, 12.5, 24.0, 47.0, 70.0, 86.0, 93.5, 96.8, 98.1];

  it("extra-sum-of-squares F matches scipy (F ~ 2.49, p ~ 0.166)", () => {
    const dr4 = fitModel("logistic4pl", XS, YS);
    const dr5 = fitModel("logistic5pl", XS, YS);
    if (!dr4.ok || !dr5.ok) throw new Error("fits failed");
    const simple: ModelFitSummary = {
      id: "logistic4pl",
      label: "4PL",
      ssr: dr4.ssr,
      nParams: 4,
      n: XS.length,
    };
    const complex: ModelFitSummary = {
      id: "logistic5pl",
      label: "5PL",
      ssr: dr5.ssr,
      nParams: 5,
      n: XS.length,
    };
    const f = extraSumOfSquaresF(simple, complex);
    expect(f.dfNumerator).toBe(1);
    expect(f.dfDenominator).toBe(6);
    expect(f.f).toBeCloseTo(2.4887, 1);
    expect(f.pValue).toBeCloseTo(0.16574, 2);
    // p > 0.05, keep the simpler model.
    expect(f.preferredId).toBe("logistic4pl");

    const a = aiccCompare([simple, complex]);
    expect(a.preferredId).toBe("logistic4pl");
    const a4 = a.models.find((m) => m.id === "logistic4pl")!;
    const a5 = a.models.find((m) => m.id === "logistic5pl")!;
    expect(a4.aicc).toBeCloseTo(2.6188, 1);
    expect(a5.aicc).toBeCloseTo(9.8020, 1);
    expect(a4.probability + a5.probability).toBeCloseTo(1, 9);
  });

  it("aicc uses K = nparams + 1 and the small-sample correction", () => {
    // Hand-check the closed form: n=10, ssr=5, K=4 -> 10*ln(0.5)+8 + (2*4*5)/(10-4-1).
    const expected =
      10 * Math.log(5 / 10) + 2 * 4 + (2 * 4 * (4 + 1)) / (10 - 4 - 1);
    expect(aicc(5, 3, 10)).toBeCloseTo(expected, 9);
    // Undefined correction (n - K - 1 <= 0) returns NaN.
    expect(Number.isNaN(aicc(5, 8, 10))).toBe(true);
  });

  it("the F test is undefined for a non-nested (equal-param) pair", () => {
    const a: ModelFitSummary = { id: "linear", label: "L", ssr: 3, nParams: 2, n: 8 };
    const b: ModelFitSummary = { id: "mm", label: "MM", ssr: 2, nParams: 2, n: 8 };
    const f = extraSumOfSquaresF(a, b);
    expect(Number.isNaN(f.f)).toBe(true);
    // AICc still ranks them.
    const cmp = aiccCompare([a, b]);
    expect(["linear", "mm"]).toContain(cmp.preferredId);
  });
});

suite("Global (shared-parameter) fit vs scipy least_squares reference", () => {
  // Two dose-response curves sharing Bottom, Top, and Hill slope, differing only
  // in logEC50 (curve A at -7, curve B at -6, a 10-fold EC50 shift). A stacked
  // scipy.optimize.least_squares fit over both curves (gen-datahub-stats-golden.py)
  // lands at the global minimum below. A nonlinear least-squares minimum is
  // optimizer-dependent, so the engine (Levenberg-Marquardt) and scipy
  // (trust-region) agree to several significant figures, hence the honest bands.
  //   Bottom = -0.07607, Top = 99.8897, Hill = 1.014554
  //   EC50_A = 1.0050971e-7, EC50_B = 1.0001309e-6, global R2 = 0.99996194
  const X = [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0];
  const YA = [0.9, 2.9, 8.6, 23.0, 50.4, 75.9, 90.8, 96.9, 99.1, 99.6, 100.1];
  const YB = [0.1, 0.4, 0.8, 2.9, 8.6, 23.4, 50.4, 75.9, 90.8, 96.9, 99.1];

  const r = fitGlobal(
    "logistic4pl",
    [
      { label: "A", x: X, y: YA },
      { label: "B", x: X, y: YB },
    ],
    ["Bottom", "Top", "HillSlope"],
  );

  it("converges", () => {
    expect(r.ok).toBe(true);
  });

  const get = (name: string, ds: string | null) =>
    r.ok ? r.parameters.find((p) => p.name === name && p.datasetLabel === ds)! : null;

  it("recovers the shared Bottom / Top / Hill within scipy tolerance", () => {
    if (!r.ok) throw new Error("fit failed");
    expect(get("Bottom", null)!.value).toBeCloseTo(-0.07607, 2);
    expect(get("Top", null)!.value).toBeCloseTo(99.8897, 1);
    expect(get("HillSlope", null)!.value).toBeCloseTo(1.014554, 2);
    // The shared parameters appear exactly once (datasetLabel null).
    expect(r.parameters.filter((p) => p.name === "HillSlope").length).toBe(1);
  });

  it("fits a separate local EC50 per curve", () => {
    if (!r.ok) throw new Error("fit failed");
    const leA = get("logEC50", "A")!;
    const leB = get("logEC50", "B")!;
    expect(Math.pow(10, leA.value)).toBeCloseTo(1.0050971e-7, 8);
    expect(Math.pow(10, leB.value)).toBeCloseTo(1.0001309e-6, 7);
    // logEC50 has one row per dataset (the local readout the analysis compares).
    expect(r.parameters.filter((p) => p.name === "logEC50").length).toBe(2);
  });

  it("reports the pooled global R-squared and fit dimensions", () => {
    if (!r.ok) throw new Error("fit failed");
    expect(r.rSquared).toBeCloseTo(0.9999619363, 6);
    expect(r.nDatasets).toBe(2);
    expect(r.nTotal).toBe(22);
    expect(r.nParams).toBe(5);
    expect(r.df).toBe(17);
    expect(r.sharedNames).toEqual(["Bottom", "Top", "HillSlope"]);
    expect(r.localNames).toEqual(["logEC50"]);
  });

  it("carries finite standard errors and CIs on every parameter", () => {
    if (!r.ok) throw new Error("fit failed");
    for (const p of r.parameters) {
      expect(Number.isFinite(p.standardError)).toBe(true);
      expect(Number.isFinite(p.ci95[0])).toBe(true);
      expect(Number.isFinite(p.ci95[1])).toBe(true);
      expect(p.ci95[0]).toBeLessThan(p.ci95[1]);
    }
  });

  it("rejects a single dataset and an empty dataset", () => {
    const one = fitGlobal("logistic4pl", [{ label: "A", x: X, y: YA }], ["Top"]);
    expect(one.ok).toBe(false);
    const empty = fitGlobal(
      "logistic4pl",
      [
        { label: "A", x: X, y: YA },
        { label: "B", x: [], y: [] },
      ],
      ["Top", "Bottom", "HillSlope"],
    );
    expect(empty.ok).toBe(false);
  });
});
