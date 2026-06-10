import { describe as suite, it, expect } from "vitest";

import { fitModel, listModels } from "../fit";

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
    expect(ids).toContain("michaelis-menten");
    expect(ids).toContain("exp-decay-1phase");
    expect(ids).toContain("exp-association-1phase");
    expect(ids).toContain("linear");
  });
});
