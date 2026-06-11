import { describe as suite, it, expect } from "vitest";

import { kaplanMeier, logRank, type SurvivalObservation } from "../survival";

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

suite("survival engine guards", () => {
  it("rejects an empty Kaplan-Meier input", () => {
    expect(kaplanMeier([]).ok).toBe(false);
  });
  it("rejects a single-group log-rank", () => {
    expect(logRank([{ name: "A", observations: MAINTAINED }]).ok).toBe(false);
  });
});
