import { describe as suite, it, expect } from "vitest";

import {
  kaplanMeier,
  logRank,
  gehanBreslowWilcoxon,
  coxPH,
  type SurvivalObservation,
  type CoxObservation,
} from "../survival";

// The classic aml / leukemia dataset from R's survival package (Miller 1997),
// also shipped with lifelines. Two groups, Maintained vs Nonmaintained, with
// right censoring (event = 0). Reference values below are from
// survival::survdiff and survival::survfit in R, cross-checked with lifelines.
//   survdiff(Surv(time, status) ~ x, data = aml):
//     Maintained    N=11  Observed=7  Expected=10.69
//     Nonmaintained N=12  Observed=11 Expected= 7.31
//     Chisq = 3.4 on 1 df,  p = 0.0653
//   survfit median survival: Maintained = 31, Nonmaintained = 23.
const MAINTAINED: SurvivalObservation[] = [
  { time: 9, event: 1 },
  { time: 13, event: 1 },
  { time: 13, event: 0 },
  { time: 18, event: 1 },
  { time: 23, event: 1 },
  { time: 28, event: 0 },
  { time: 31, event: 1 },
  { time: 34, event: 1 },
  { time: 45, event: 0 },
  { time: 48, event: 1 },
  { time: 161, event: 0 },
];
const NONMAINTAINED: SurvivalObservation[] = [
  { time: 5, event: 1 },
  { time: 5, event: 1 },
  { time: 8, event: 1 },
  { time: 8, event: 1 },
  { time: 12, event: 1 },
  { time: 16, event: 0 },
  { time: 23, event: 1 },
  { time: 27, event: 1 },
  { time: 30, event: 1 },
  { time: 33, event: 1 },
  { time: 43, event: 1 },
  { time: 45, event: 1 },
];

suite("Kaplan-Meier vs R survfit (aml dataset)", () => {
  it("estimates the Maintained survival curve and median", () => {
    const r = kaplanMeier(MAINTAINED);
    if (!r.ok) throw new Error("expected ok");
    expect(r.n).toBe(11);
    expect(r.events).toBe(7);
    // First event at t=9: S = 1 - 1/11 = 0.9091 (R survfit gives 0.909).
    expect(r.steps[0].time).toBe(9);
    expect(r.steps[0].atRisk).toBe(11);
    expect(r.steps[0].survival).toBeCloseTo(1 - 1 / 11, 6);
    // R survfit reports the median survival for Maintained as 31.
    expect(r.median).toBe(31);
  });

  it("estimates the Nonmaintained median as 23", () => {
    const r = kaplanMeier(NONMAINTAINED);
    if (!r.ok) throw new Error("expected ok");
    expect(r.n).toBe(12);
    expect(r.events).toBe(11);
    expect(r.median).toBe(23);
  });
});

suite("log-rank vs R survdiff (aml dataset)", () => {
  const r = logRank([
    { name: "Maintained", observations: MAINTAINED },
    { name: "Nonmaintained", observations: NONMAINTAINED },
  ]);

  it("matches the observed and expected event counts", () => {
    if (!r.ok) throw new Error("expected ok");
    const m = r.groups.find((x) => x.name === "Maintained")!;
    const nm = r.groups.find((x) => x.name === "Nonmaintained")!;
    expect(m.observed).toBe(7);
    expect(nm.observed).toBe(11);
    // R: Expected Maintained = 10.69, Nonmaintained = 7.31.
    expect(m.expected).toBeCloseTo(10.69, 1);
    expect(nm.expected).toBeCloseTo(7.31, 1);
  });

  it("matches the chi-square statistic, df, and p-value", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.df).toBe(1);
    // R survdiff: Chisq = 3.4 on 1 df, p = 0.0653 (3.396 to more places).
    expect(r.chiSquare).toBeCloseTo(3.396, 2);
    expect(r.pValue).toBeCloseTo(0.0653, 3);
  });
});

// The Gehan-Breslow-Wilcoxon test (the early-weighted log-rank variant). The
// reference comes from lifelines.statistics.logrank_test(..., weightings=
// "wilcoxon") on the same aml dataset (lifelines 0.30.3).
suite("Gehan-Breslow-Wilcoxon vs lifelines (aml dataset)", () => {
  const r = gehanBreslowWilcoxon([
    { name: "Maintained", observations: MAINTAINED },
    { name: "Nonmaintained", observations: NONMAINTAINED },
  ]);

  it("matches the chi-square statistic, df, and p-value", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.df).toBe(1);
    // lifelines weightings="wilcoxon": chi2 = 2.723312, p = 0.098893.
    expect(r.chiSquare).toBeCloseTo(2.723312, 3);
    expect(r.pValue).toBeCloseTo(0.098893, 4);
  });

  it("weights early times more, so it differs from the log-rank chi-square", () => {
    const lr = logRank([
      { name: "Maintained", observations: MAINTAINED },
      { name: "Nonmaintained", observations: NONMAINTAINED },
    ]);
    if (!r.ok || !lr.ok) throw new Error("expected ok");
    expect(r.chiSquare).not.toBeCloseTo(lr.chiSquare, 3);
  });
});

suite("survival engine guards", () => {
  it("rejects an empty Kaplan-Meier input", () => {
    expect(kaplanMeier([]).ok).toBe(false);
  });
  it("rejects a single-group log-rank", () => {
    expect(logRank([{ name: "A", observations: MAINTAINED }]).ok).toBe(false);
  });
  it("rejects a single-group Gehan-Breslow-Wilcoxon", () => {
    expect(
      gehanBreslowWilcoxon([{ name: "A", observations: MAINTAINED }]).ok,
    ).toBe(false);
  });
});

// Cox proportional hazards on the two-arm leukemia dataset pinned for the
// transparency gate (arm indicator Treatment = 1, Control = 0). The reference
// values are lifelines CoxPHFitter (Efron ties), generated verbatim by
// scripts/gen-datahub-stats-golden.py and pinned in datahub-stats.ts.
const COX_TREAT: [number, number][] = [
  [6, 1], [7, 1], [10, 1], [13, 1], [16, 1], [22, 1], [23, 1],
  [6, 0], [9, 0], [10, 0], [11, 0], [17, 0], [19, 0], [20, 0], [25, 0],
];
const COX_CONTROL: [number, number][] = [
  [1, 1], [1, 1], [2, 1], [2, 1], [3, 1], [4, 1], [4, 1], [5, 1],
  [5, 1], [8, 1], [8, 1], [8, 1], [8, 1], [11, 1], [11, 1], [12, 1],
  [12, 1], [15, 1], [17, 1], [22, 1], [23, 1],
];
const COX_ROWS: CoxObservation[] = [
  ...COX_TREAT.map(([time, event]) => ({ time, event, covariates: [1] })),
  ...COX_CONTROL.map(([time, event]) => ({ time, event, covariates: [0] })),
];

suite("Cox proportional hazards vs lifelines (Efron ties)", () => {
  const r = coxPH(COX_ROWS, ["arm"]);

  it("matches the coefficient, hazard ratio, and its 95% interval", () => {
    if (!r.ok) throw new Error("expected ok");
    const arm = r.coefficients[0];
    expect(arm.coef).toBeCloseTo(-1.370812, 3);
    expect(arm.se).toBeCloseTo(0.441773, 3);
    expect(arm.z).toBeCloseTo(-3.10298, 3);
    expect(arm.pValue).toBeCloseTo(0.001916, 4);
    expect(arm.hazardRatio).toBeCloseTo(0.253901, 3);
    expect(arm.hrCiLow).toBeCloseTo(0.106814, 3);
    expect(arm.hrCiHigh).toBeCloseTo(0.603534, 3);
  });

  it("matches the log-likelihood, LR test, and concordance", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.logLikelihood).toBeCloseTo(-72.396745, 3);
    expect(r.lrChiSquare).toBeCloseTo(11.307176, 3);
    expect(r.lrDf).toBe(1);
    expect(r.lrPValue).toBeCloseTo(0.000772, 4);
    // Concordance to 2 dp: lifelines and our engine differ only in the exact
    // tied-risk-score convention, a sub-1e-3 wobble on this tie-heavy dataset.
    expect(r.concordance).toBeCloseTo(0.684512, 2);
    expect(r.n).toBe(36);
    expect(r.events).toBe(28);
  });
});

suite("Cox engine guards", () => {
  it("rejects an input with no covariates", () => {
    expect(coxPH([{ time: 5, event: 1, covariates: [] }], []).ok).toBe(false);
  });
  it("rejects an input with no events", () => {
    expect(
      coxPH(
        [
          { time: 5, event: 0, covariates: [1] },
          { time: 8, event: 0, covariates: [0] },
        ],
        ["arm"],
      ).ok,
    ).toBe(false);
  });
  it("drops rows with a non-finite time", () => {
    const res = coxPH(
      [
        { time: NaN, event: 1, covariates: [1] },
        ...COX_ROWS,
      ],
      ["arm"],
    );
    if (!res.ok) throw new Error("expected ok");
    expect(res.n).toBe(36);
  });
});
