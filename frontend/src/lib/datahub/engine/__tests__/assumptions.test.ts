import { describe as suite, it, expect } from "vitest";

import { brownForsythe, levene, shapiroWilk } from "../assumptions";

suite("Shapiro-Wilk normality", () => {
  it("matches the classic Shapiro & Wilk men's-weights example", () => {
    // 11 men's weights from Shapiro & Wilk; R shapiro.test gives
    //   W = 0.7888, p-value = 0.006704.
    // Source: statsref.com Shapiro-Wilk worked example (R shapiro.test)
    //   https://www.statsref.com/HTML/shapiro-wilk.html
    const data = [148, 154, 158, 160, 161, 162, 166, 170, 182, 195, 236];
    const r = shapiroWilk(data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.statistic).toBeCloseTo(0.7888, 3);
    expect(r.pValue).toBeCloseTo(0.006704, 3);
    expect(r.pass).toBe(false); // clearly non-normal
  });

  it("passes for an approximately normal sample", () => {
    // Symmetric, bell-ish sample; W high, p large -> pass.
    const data = [
      9.8, 10.1, 9.9, 10.0, 10.2, 9.7, 10.3, 9.95, 10.05, 9.85, 10.15, 10.0,
    ];
    const r = shapiroWilk(data);
    if (!r.ok) throw new Error("expected ok");
    expect(r.statistic).toBeGreaterThan(0.9);
    expect(r.pass).toBe(true);
  });

  it("guards tiny samples", () => {
    expect(shapiroWilk([1, 2]).ok).toBe(false);
  });
});

suite("Levene / Brown-Forsythe equal variance", () => {
  // scipy.stats.levene documented example (three groups):
  //   a = [8.88, 9.12, 9.04, 8.98, 9.00, 9.08, 9.01, 8.85, 9.06, 8.99]
  //   b = [8.88, 8.95, 9.29, 9.44, 9.15, 9.58, 8.36, 9.18, 8.67, 9.05]
  //   c = [8.95, 9.12, 8.95, 8.85, 9.03, 8.84, 9.07, 8.98, 8.86, 8.98]
  // scipy.stats.levene(a, b, c) -> statistic = 7.5848, pvalue = 0.00243.
  // (scipy default center = "median", i.e. the Brown-Forsythe variant.)
  // Source: https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.levene.html
  const a = [8.88, 9.12, 9.04, 8.98, 9.0, 9.08, 9.01, 8.85, 9.06, 8.99];
  const b = [8.88, 8.95, 9.29, 9.44, 9.15, 9.58, 8.36, 9.18, 8.67, 9.05];
  const c = [8.95, 9.12, 8.95, 8.85, 9.03, 8.84, 9.07, 8.98, 8.86, 8.98];

  it("Brown-Forsythe (median-centered) matches the scipy levene default", () => {
    const r = brownForsythe([a, b, c]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.statistic).toBeCloseTo(7.5848, 3);
    expect(r.pValue).toBeCloseTo(0.002431, 4);
    expect(r.pass).toBe(false);
  });

  it("classic Levene (mean-centered) runs and flags unequal variance", () => {
    const r = levene([a, b, c]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.statistic).toBeGreaterThan(0);
    expect(r.pass).toBe(false);
  });

  it("equal-spread groups pass", () => {
    const g1 = [1, 2, 3, 4, 5];
    const g2 = [11, 12, 13, 14, 15];
    const r = levene([g1, g2]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.pass).toBe(true); // same spread, different location
  });
});
