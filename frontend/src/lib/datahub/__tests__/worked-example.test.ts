import { describe, expect, it } from "vitest";

import type {
  NormalizedResult,
  NormalizedTTest,
  NormalizedCoxRegression,
  NormalizedRocAuc,
  NormalizedContingency,
  NormalizedCorrelation,
} from "@/lib/datahub/run-analysis";
import { workedExample, learnMoreTopic } from "@/lib/datahub/plain-language";

// workedExample is a pure function of a normalized result, so the tests build
// minimal typed result literals and assert the concrete "for your numbers"
// sentence built from the actual fields. The point is that the sentence quotes
// THIS result's numbers, not a canned string, and that it returns null where a
// worked example would only restate the verdict.

function baseGroup(name: string) {
  return { columnId: name.toLowerCase(), name, values: [] as number[] };
}

function ttest(overrides: Partial<NormalizedTTest> = {}): NormalizedTTest {
  return {
    kind: "ttest",
    type: "unpairedTTest",
    test: "Welch's t-test",
    nonparametric: false,
    tail: "two-sided",
    variance: "welch",
    groups: [baseGroup("Control"), baseGroup("Drug")] as NormalizedTTest["groups"],
    statistic: 4.2,
    df: 8,
    pValue: 0.001,
    effectSize: 1.2,
    effectSizeLabel: "Cohen's d",
    hedgesG: 1.1,
    effectSizeCI95: [0.5, 1.9],
    ci95: [1, 3],
    bootstrapCI95: null,
    normalityShaky: false,
    meanA: 100,
    meanB: 80,
    meanDiff: 20,
    ...overrides,
  };
}

describe("workedExample", () => {
  it("reads a t-test Cohen's d as standard deviations apart", () => {
    const out = workedExample(ttest());
    expect(out).toBe(
      "A Cohen's d of 1.2 is a large effect, the two group means are about 1.2 standard deviations apart.",
    );
  });

  it("returns null for a rank-based (nonparametric) t-test", () => {
    expect(
      workedExample(
        ttest({ nonparametric: true, test: "Mann-Whitney U (rank-sum)" }),
      ),
    ).toBeNull();
  });

  it("reads a Cox hazard ratio above 1 with the flipped protective HR", () => {
    const cox: NormalizedCoxRegression = {
      kind: "coxRegression",
      type: "coxRegression",
      n: 40,
      events: 20,
      coefficients: [
        {
          name: "Untreated",
          coef: Math.log(6.24),
          se: 0.3,
          z: 6.2,
          pValue: 0.0001,
          hazardRatio: 6.24,
          hrCiLow: 3.5,
          hrCiHigh: 11.1,
        },
      ],
      logLikelihood: -50,
      nullLogLikelihood: -70,
      lrChiSquare: 40,
      lrDf: 1,
      lrPValue: 0.0001,
      concordance: 0.82,
    };
    const out = workedExample(cox);
    expect(out).toContain("HR 6.24");
    expect(out).toContain("Untreated subject is about 6.2x as likely");
    expect(out).toContain("protective HR of about 0.16");
  });

  it("reads a ROC AUC as a pairwise scoring probability", () => {
    const roc: NormalizedRocAuc = {
      kind: "rocCurve",
      type: "rocCurve",
      xName: "Marker",
      yName: "Disease",
      x: [],
      y: [],
      n: 100,
      nPositive: 40,
      nNegative: 60,
      auc: 0.88,
      aucStandardError: 0.03,
      aucCiLow: 0.82,
      aucCiHigh: 0.94,
      youdenThreshold: 5,
      youdenSensitivity: 0.8,
      youdenSpecificity: 0.85,
      points: [],
    };
    const out = workedExample(roc);
    expect(out).toBe(
      "An AUC of 0.88 means that for a random positive and negative Disease pair, Marker scores the positive one higher about 88 percent of the time.",
    );
  });

  it("reads a 2x2 contingency odds ratio for the table", () => {
    const ct: NormalizedContingency = {
      kind: "contingency",
      type: "contingency",
      rowLabels: ["Treated", "Control"],
      colLabels: ["Improved", "Not"],
      rows: 2,
      cols: 2,
      observed: [
        [21, 9],
        [6, 24],
      ],
      expected: [
        [13.5, 16.5],
        [13.5, 16.5],
      ],
      chiSquare: 16,
      df: 1,
      pValue: 0.0001,
      yatesApplied: true,
      yatesChiSquare: 14,
      yatesPValue: 0.0002,
      fisherPValue: 0.0001,
      relativeRisk: { estimate: 3.5, ciLow: 1.7, ciHigh: 7.2, corrected: false },
      oddsRatio: { estimate: 7, ciLow: 2.2, ciHigh: 22, corrected: false },
      minExpected: 13.5,
      n: 60,
      cellConvention: "first row exposed",
    };
    const out = workedExample(ct);
    expect(out).toBe(
      "An odds ratio of 7 means the odds of the first-column outcome are 7x as high in the first row's group.",
    );
  });

  it("returns null for a contingency table with no odds ratio (not 2x2)", () => {
    const ct: NormalizedContingency = {
      kind: "contingency",
      type: "contingency",
      rowLabels: ["A", "B", "C"],
      colLabels: ["X", "Y"],
      rows: 3,
      cols: 2,
      observed: [
        [5, 5],
        [5, 5],
        [5, 5],
      ],
      expected: [
        [5, 5],
        [5, 5],
        [5, 5],
      ],
      chiSquare: 0,
      df: 2,
      pValue: 1,
      yatesApplied: false,
      yatesChiSquare: 0,
      yatesPValue: 1,
      fisherPValue: 1,
      relativeRisk: null,
      oddsRatio: null,
      minExpected: 5,
      n: 30,
      cellConvention: "",
    };
    expect(workedExample(ct)).toBeNull();
  });

  it("returns null for a correlation with a non-finite coefficient", () => {
    const corr = {
      kind: "correlation",
      coefficient: NaN,
      rSquared: NaN,
      coefficientLabel: "r",
      xName: "X",
      yName: "Y",
    } as unknown as NormalizedCorrelation;
    expect(workedExample(corr)).toBeNull();
  });
});

describe("learnMoreTopic", () => {
  it("labels the link per analysis type and points at /transparency", () => {
    expect(learnMoreTopic(ttest())).toEqual({
      label: "Learn more about effect sizes",
      href: "/transparency",
    });
    expect(
      learnMoreTopic({ kind: "coxRegression" } as NormalizedResult),
    ).toEqual({ label: "Learn more about hazard ratios", href: "/transparency" });
    expect(learnMoreTopic({ kind: "correlation" } as NormalizedResult)).toEqual({
      label: "Learn more about correlation",
      href: "/transparency",
    });
  });
});
