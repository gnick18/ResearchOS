import { describe as suite, it, expect } from "vitest";

import { linearRegression } from "../regression-linear";
import { pearson, spearman } from "../correlation";

// NIST StRD certified linear-regression dataset "Norris" (lower difficulty).
// Certified values (https://www.itl.nist.gov/div898/strd/lls/data/Norris.shtml):
//   B0 (intercept)        = -0.262323073774029   SD = 0.232818234301152
//   B1 (slope)            =  1.00211681802045     SD = 0.429796848199937E-03
//   Residual SD           =  0.884796396144373
//   R-squared             =  0.999993745883712
// Data are 36 (y, x) pairs.
const NORRIS: Array<[number, number]> = [
  [0.1, 0.2], [338.8, 337.4], [118.1, 118.2], [888.0, 884.6], [9.2, 10.1],
  [228.1, 226.5], [668.5, 666.3], [998.5, 996.3], [449.1, 448.6], [778.9, 777.0],
  [559.2, 558.2], [0.3, 0.4], [0.1, 0.6], [778.1, 775.5], [668.8, 666.9],
  [339.3, 338.0], [448.9, 447.5], [10.8, 11.6], [557.7, 556.0], [228.3, 228.1],
  [998.0, 995.8], [888.8, 887.6], [119.6, 120.2], [0.3, 0.3], [0.6, 0.3],
  [557.6, 556.8], [339.3, 339.1], [888.0, 887.2], [998.5, 999.0], [778.9, 779.0],
  [10.2, 11.1], [117.6, 118.3], [228.9, 229.2], [668.4, 669.1], [449.2, 448.9],
  [0.2, 0.5],
];
const NORRIS_Y = NORRIS.map((p) => p[0]);
const NORRIS_X = NORRIS.map((p) => p[1]);

suite("linear regression vs NIST Norris certified values", () => {
  const r = linearRegression(NORRIS_X, NORRIS_Y);

  it("matches certified slope and intercept", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.intercept).toBeCloseTo(-0.262323073774029, 6);
    expect(r.slope).toBeCloseTo(1.00211681802045, 8);
  });

  it("matches certified parameter standard errors", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.interceptSE).toBeCloseTo(0.232818234301152, 6);
    expect(r.slopeSE).toBeCloseTo(0.000429796848199937, 8);
  });

  it("matches certified residual SD and R-squared", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.residualSE).toBeCloseTo(0.884796396144373, 6);
    expect(r.rSquared).toBeCloseTo(0.999993745883712, 9);
  });

  it("residuals reconstruct y from fitted", () => {
    if (!r.ok) throw new Error("expected ok");
    for (let i = 0; i < NORRIS_Y.length; i++) {
      expect(r.fitted[i] + r.residuals[i]).toBeCloseTo(NORRIS_Y[i], 8);
    }
  });
});

suite("Pearson correlation vs NIST Norris", () => {
  it("r = sqrt(R-squared) for the certified Norris fit", () => {
    const r = pearson(NORRIS_X, NORRIS_Y);
    if (!r.ok) throw new Error("expected ok");
    // r^2 = 0.999993745883712 -> r = 0.99999687...
    expect(r.coefficient).toBeCloseTo(Math.sqrt(0.999993745883712), 9);
    expect(r.pValue).toBeLessThan(1e-50);
  });
});

suite("Pearson + Spearman vs scipy documented small example", () => {
  // scipy.stats.pearsonr docs worked example:
  //   x = [1, 2, 3, 4, 5, 6, 7]; y = [10, 9, 2.5, 6, 4, 3, 2]
  //   PearsonRResult(statistic=-0.828503883588428, pvalue=0.021280260007523286)
  // Source: https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.pearsonr.html
  const X = [1, 2, 3, 4, 5, 6, 7];
  const Y = [10, 9, 2.5, 6, 4, 3, 2];

  it("Pearson matches the scipy pearsonr example", () => {
    const r = pearson(X, Y);
    if (!r.ok) throw new Error("expected ok");
    expect(r.coefficient).toBeCloseTo(-0.828503883588428, 9);
    expect(r.pValue).toBeCloseTo(0.021280260007523286, 6);
  });

  it("Spearman matches the hand-computed rank correlation", () => {
    // y ranks (2.5 smallest) -> [7,6,2,5,4,3,1]; x ranks [1..7]. Pearson on
    // those ranks (no ties) gives rho = -11/14 = -0.7857142857142857 exactly,
    // matching scipy.stats.spearmanr on this data. Hand-verified.
    const r = spearman(X, Y);
    if (!r.ok) throw new Error("expected ok");
    expect(r.coefficient).toBeCloseTo(-0.7857142857142857, 10);
  });
});
