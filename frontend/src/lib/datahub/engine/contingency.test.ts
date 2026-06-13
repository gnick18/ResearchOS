// Engine unit tests for the contingency analysis (chi-square test of
// independence, the 2x2 Yates correction, Fisher's exact test, and the relative
// risk / odds ratio measures). Pinned against scipy.stats on the same fixed
// tables the transparency gate uses, so the numbers match scipy / closed-form
// epidemiology formulas. The reference values are transcribed verbatim from
// scripts/gen-datahub-stats-golden.py (scipy.stats.chi2_contingency /
// fisher_exact, closed-form RR / OR with 95% log CIs).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, expect, it } from "vitest";

import { contingencyTest } from "./contingency";

// The headline 2x2 table (row 1 = exposed, col 1 = event): a=30, b=10, c=12, d=28.
const TWO_BY_TWO = [
  [30, 10],
  [12, 28],
];

// A 2x3 table for the larger-table path (no Yates, no Fisher, no 2x2 measures).
const TWO_BY_THREE = [
  [10, 20, 30],
  [25, 15, 20],
];

describe("contingencyTest, 2x2 chi-square / Fisher / effect measures", () => {
  const r = contingencyTest(TWO_BY_TWO);
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);

  it("reports the table shape and total", () => {
    expect(r.rows).toBe(2);
    expect(r.cols).toBe(2);
    expect(r.df).toBe(1);
    expect(r.n).toBe(80);
  });

  it("matches scipy chi2_contingency (uncorrected) chi-square and p", () => {
    expect(r.chiSquare).toBeCloseTo(16.240602, 4);
    expect(r.pValue).toBeCloseTo(5.58e-5, 7);
  });

  it("matches scipy Yates continuity-corrected chi-square and p", () => {
    expect(r.yatesChiSquare).toBeCloseTo(14.486216, 4);
    expect(r.yatesPValue).toBeCloseTo(0.000141, 5);
  });

  it("matches scipy fisher_exact two-sided p", () => {
    expect(r.fisherPValue).toBeCloseTo(0.000112, 5);
  });

  it("reports the smallest expected count", () => {
    expect(r.minExpected).toBeCloseTo(19.0, 4);
  });

  it("matches the closed-form relative risk and 95% CI", () => {
    expect(r.relativeRisk).not.toBeNull();
    expect(r.relativeRisk!.estimate).toBeCloseTo(2.5, 4);
    expect(r.relativeRisk!.ciLow).toBeCloseTo(1.507165, 4);
    expect(r.relativeRisk!.ciHigh).toBeCloseTo(4.146859, 4);
    expect(r.relativeRisk!.corrected).toBe(false);
  });

  it("matches the closed-form odds ratio and 95% CI", () => {
    expect(r.oddsRatio).not.toBeNull();
    expect(r.oddsRatio!.estimate).toBeCloseTo(7.0, 4);
    expect(r.oddsRatio!.ciLow).toBeCloseTo(2.615022, 4);
    expect(r.oddsRatio!.ciHigh).toBeCloseTo(18.73789, 3);
    expect(r.oddsRatio!.corrected).toBe(false);
  });

  it("echoes the observed matrix and computes the expected matrix", () => {
    expect(r.observed).toEqual(TWO_BY_TWO);
    // Each expected cell is rowTotal * colTotal / n.
    expect(r.expected[0][0]).toBeCloseTo((40 * 42) / 80, 6);
    expect(r.expected[1][1]).toBeCloseTo((40 * 38) / 80, 6);
  });
});

describe("contingencyTest, 2x3 chi-square (larger-table path)", () => {
  const r = contingencyTest(TWO_BY_THREE);
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);

  it("matches scipy chi2_contingency (uncorrected) chi-square, df, and p", () => {
    expect(r.chiSquare).toBeCloseTo(9.142857, 4);
    expect(r.df).toBe(2);
    expect(r.pValue).toBeCloseTo(0.010343, 5);
    expect(r.minExpected).toBeCloseTo(17.5, 4);
    expect(r.n).toBe(120);
  });

  it("leaves the 2x2-only fields as NaN / null", () => {
    expect(Number.isNaN(r.yatesChiSquare)).toBe(true);
    expect(Number.isNaN(r.fisherPValue)).toBe(true);
    expect(r.relativeRisk).toBeNull();
    expect(r.oddsRatio).toBeNull();
  });
});

describe("contingencyTest, zero-cell continuity correction", () => {
  it("applies the Haldane-Anscombe 0.5 correction when a cell is zero", () => {
    // A zero in cell b makes the raw odds ratio infinite; the CI uses the 0.5
    // continuity correction so it stays finite, and the flag is set.
    const r = contingencyTest([
      [10, 0],
      [5, 10],
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(r.oddsRatio).not.toBeNull();
    expect(r.oddsRatio!.corrected).toBe(true);
    expect(Number.isFinite(r.oddsRatio!.ciLow)).toBe(true);
    expect(Number.isFinite(r.oddsRatio!.ciHigh)).toBe(true);
  });
});

describe("contingencyTest, input validation", () => {
  it("rejects a table with fewer than 2 rows", () => {
    const r = contingencyTest([[1, 2]]);
    expect(r.ok).toBe(false);
  });

  it("rejects a table with fewer than 2 columns", () => {
    const r = contingencyTest([[1], [2]]);
    expect(r.ok).toBe(false);
  });

  it("rejects a ragged matrix", () => {
    const r = contingencyTest([
      [1, 2],
      [3],
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects negative or non-integer counts", () => {
    expect(contingencyTest([[1, -2], [3, 4]]).ok).toBe(false);
    expect(contingencyTest([[1, 2.5], [3, 4]]).ok).toBe(false);
  });

  it("rejects an all-zero table and an empty margin", () => {
    expect(contingencyTest([[0, 0], [0, 0]]).ok).toBe(false);
    // A zero row margin (first row sums to 0) is rejected.
    expect(contingencyTest([[0, 0], [3, 4]]).ok).toBe(false);
  });
});
