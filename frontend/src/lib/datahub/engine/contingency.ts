// Categorical association tests on an R x C contingency table of counts: the
// Pearson chi-square test of independence, the Yates continuity correction and
// Fisher's exact test for the 2x2 case, and the 2x2 effect measures (relative
// risk and odds ratio with 95% confidence intervals). Authored here (no @stdlib
// contingency package is in the dependency set) and pinned in the test suite
// against scipy.stats.chi2_contingency and scipy.stats.fisher_exact on a fixed
// 2x2 (and 2x3) table, so the numbers match the references bench scientists
// already trust.
//
// THE DATA. A contingency table is an R x C grid of non-negative integer counts.
// Rows index the categories of one factor (e.g. "Exposed" / "Not exposed") and
// columns the categories of another (e.g. "Disease" / "No disease"). The two
// factors are independent under the null hypothesis.
//
// CHI-SQUARE. The expected count in cell (i, j) under independence is
// rowTotal_i * colTotal_j / n. The Pearson statistic sums (observed - expected)^2
// / expected over every cell, compared to a chi-square distribution with
// (R - 1)(C - 1) degrees of freedom. When any expected count is below 5 the
// large-sample approximation is shaky and Fisher's exact test is preferred; we
// report the minimum expected count so the caller can raise that caveat.
//
// YATES. For a 2x2 table scipy's chi2_contingency applies the Yates continuity
// correction by default, subtracting 0.5 from each |observed - expected| before
// squaring. We compute both the corrected and the uncorrected statistic so the
// caller can show either; the correction is meaningful only for the 2x2 case.
//
// FISHER. For a 2x2 table Fisher's exact test gives an exact two-sided p-value
// from the hypergeometric distribution over all tables with the same margins.
// We sum the probabilities of every table at least as extreme (probability at or
// below the observed table's probability), which matches scipy's two-sided
// convention. For larger tables Fisher's exact is expensive and is not computed.
//
// EFFECT MEASURES (2x2 only). With the layout
//
//     row 1 = exposed,     col 1 = event:  a = (1,1), b = (1,2)
//     row 2 = not exposed, col 2 = no event: c = (2,1), d = (2,2)
//
// the relative risk is [a / (a + b)] / [c / (c + d)] and the odds ratio is
// (a * d) / (b * c). Each carries a 95% confidence interval from the log method
// (a normal interval on the log measure, exponentiated back). When a zero cell
// makes a log undefined we apply the Haldane-Anscombe 0.5 continuity correction
// to every cell of the measure so the interval stays finite, the same guard
// epidemiology textbooks use; the point estimates are reported uncorrected.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { chiSquarePValue, normalQuantile } from "./dists";
import type { EngineResult } from "./types";

/** A relative-risk or odds-ratio estimate with its 95% confidence interval. */
export interface RatioMeasure {
  /** The point estimate (uncorrected). */
  estimate: number;
  /** 95% confidence interval lower bound (log method). */
  ciLow: number;
  /** 95% confidence interval upper bound (log method). */
  ciHigh: number;
  /**
   * True when a zero cell forced the Haldane-Anscombe 0.5 continuity correction
   * on the interval (and, when the raw estimate is undefined, the estimate too).
   */
  corrected: boolean;
}

export interface ContingencyResult {
  /** Number of rows (R) and columns (C). */
  rows: number;
  cols: number;
  /** The observed count matrix, echoed back row-major. */
  observed: number[][];
  /** The expected count matrix under independence (rowTotal * colTotal / n). */
  expected: number[][];
  /** Pearson chi-square statistic (no continuity correction). */
  chiSquare: number;
  /** Degrees of freedom (R - 1)(C - 1). */
  df: number;
  /** Upper-tail chi-square p-value for `chiSquare`. */
  pValue: number;
  /** Yates continuity-corrected chi-square, 2x2 only (NaN otherwise). */
  yatesChiSquare: number;
  /** p-value for the Yates statistic, 2x2 only (NaN otherwise). */
  yatesPValue: number;
  /** Fisher's exact two-sided p-value, 2x2 only (NaN otherwise). */
  fisherPValue: number;
  /** Relative risk + CI, 2x2 only (null otherwise). */
  relativeRisk: RatioMeasure | null;
  /** Odds ratio + CI, 2x2 only (null otherwise). */
  oddsRatio: RatioMeasure | null;
  /** The smallest expected count across all cells (drives the < 5 caveat). */
  minExpected: number;
  /** Total count n (sum of every cell). */
  n: number;
}

/** Sum a numeric array. */
function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/**
 * Log of the gamma function via the Lanczos approximation (g = 7, n = 9), good
 * to about 15 significant digits for the positive arguments Fisher's exact test
 * needs. Used only to form log factorials (logGamma(k + 1) = log(k!)), which keep
 * the hypergeometric probabilities numerically stable for the table sizes a Data
 * Hub user enters.
 */
const LANCZOS_G = 7;
const LANCZOS_COEF = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

function logGamma(z: number): number {
  if (z < 0.5) {
    // Reflection formula keeps the series in its accurate range. Fisher only
    // calls this on integers >= 1, so this branch is a safety net.
    return (
      Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
    );
  }
  const x = z - 1;
  let a = LANCZOS_COEF[0];
  const t = x + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_G + 2; i++) a += LANCZOS_COEF[i] / (x + i);
  return (
    0.5 * Math.log(2 * Math.PI) +
    (x + 0.5) * Math.log(t) -
    t +
    Math.log(a)
  );
}

/** log(k!) for a non-negative integer k. */
function logFactorial(k: number): number {
  return logGamma(k + 1);
}

/**
 * The hypergeometric log-probability of a 2x2 table with cell counts a, b, c, d
 * (fixed row and column margins). log P = log C(a+b, a) + log C(c+d, c) -
 * log C(n, a+c), written in log factorials so it never overflows.
 */
function logHypergeom2x2(a: number, b: number, c: number, d: number): number {
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const c2 = b + d;
  const n = r1 + r2;
  return (
    logFactorial(r1) +
    logFactorial(r2) +
    logFactorial(c1) +
    logFactorial(c2) -
    logFactorial(n) -
    logFactorial(a) -
    logFactorial(b) -
    logFactorial(c) -
    logFactorial(d)
  );
}

/**
 * Fisher's exact two-sided p-value for a 2x2 table. Holding the margins fixed,
 * the count a in cell (1,1) ranges over its feasible values; the p-value sums the
 * probability of every table whose probability is at or below the observed
 * table's (within a tiny epsilon for floating-point ties), which is scipy's
 * two-sided convention.
 */
function fisherExactTwoSided(
  a: number,
  b: number,
  c: number,
  d: number,
): number {
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const n = r1 + r2;
  const aMin = Math.max(0, c1 - r2);
  const aMax = Math.min(r1, c1);
  const pObserved = Math.exp(logHypergeom2x2(a, b, c, d));
  // A relative epsilon so a probability that equals the observed one only up to
  // rounding still counts as "at least as extreme", matching scipy's behavior.
  const epsilon = 1e-7;
  let p = 0;
  for (let ai = aMin; ai <= aMax; ai++) {
    const bi = r1 - ai;
    const ci = c1 - ai;
    const di = r2 - ci;
    const prob = Math.exp(logHypergeom2x2(ai, bi, ci, di));
    if (prob <= pObserved * (1 + epsilon)) p += prob;
  }
  // Clamp to [0, 1] against floating-point drift.
  return Math.min(1, Math.max(0, p));
}

/** The two-sided z multiplier for a 95% confidence interval (about 1.959964). */
const Z_95 = normalQuantile(0.975);

/**
 * Relative risk [a/(a+b)] / [c/(c+d)] with a 95% CI by the log method. The
 * standard error of log RR is sqrt(1/a - 1/(a+b) + 1/c - 1/(c+d)). A zero cell
 * makes a term undefined, so we add 0.5 to every cell (Haldane-Anscombe) for the
 * interval; the point estimate stays uncorrected unless it is itself undefined.
 */
function relativeRiskMeasure(
  a: number,
  b: number,
  c: number,
  d: number,
): RatioMeasure {
  const rawRisk1 = a / (a + b);
  const rawRisk2 = c / (c + d);
  const rawRR = rawRisk1 / rawRisk2;
  const needsCorrection =
    a === 0 || b === 0 || c === 0 || d === 0 || !Number.isFinite(rawRR);
  const aa = needsCorrection ? a + 0.5 : a;
  const bb = needsCorrection ? b + 0.5 : b;
  const cc = needsCorrection ? c + 0.5 : c;
  const dd = needsCorrection ? d + 0.5 : d;
  const risk1 = aa / (aa + bb);
  const risk2 = cc / (cc + dd);
  const rr = risk1 / risk2;
  const seLog = Math.sqrt(1 / aa - 1 / (aa + bb) + 1 / cc - 1 / (cc + dd));
  const logRR = Math.log(rr);
  const estimate = Number.isFinite(rawRR) ? rawRR : rr;
  return {
    estimate,
    ciLow: Math.exp(logRR - Z_95 * seLog),
    ciHigh: Math.exp(logRR + Z_95 * seLog),
    corrected: needsCorrection,
  };
}

/**
 * Odds ratio (a*d)/(b*c) with a 95% CI by the log method. The standard error of
 * log OR is sqrt(1/a + 1/b + 1/c + 1/d). A zero cell makes a term undefined, so
 * we add 0.5 to every cell (Haldane-Anscombe) for the interval; the point
 * estimate stays uncorrected unless it is itself undefined.
 */
function oddsRatioMeasure(
  a: number,
  b: number,
  c: number,
  d: number,
): RatioMeasure {
  const rawOR = (a * d) / (b * c);
  const needsCorrection =
    a === 0 || b === 0 || c === 0 || d === 0 || !Number.isFinite(rawOR);
  const aa = needsCorrection ? a + 0.5 : a;
  const bb = needsCorrection ? b + 0.5 : b;
  const cc = needsCorrection ? c + 0.5 : c;
  const dd = needsCorrection ? d + 0.5 : d;
  const or = (aa * dd) / (bb * cc);
  const seLog = Math.sqrt(1 / aa + 1 / bb + 1 / cc + 1 / dd);
  const logOR = Math.log(or);
  const estimate = Number.isFinite(rawOR) ? rawOR : or;
  return {
    estimate,
    ciLow: Math.exp(logOR - Z_95 * seLog),
    ciHigh: Math.exp(logOR + Z_95 * seLog),
    corrected: needsCorrection,
  };
}

/**
 * Run the categorical association analysis on an R x C count matrix. Validates
 * that the matrix is rectangular, has at least 2 rows and 2 columns, holds only
 * finite non-negative numbers, and has a positive total with no empty row or
 * column margin (an empty margin makes an expected count zero and the chi-square
 * undefined). Returns the chi-square test plus, for a 2x2 table, the Yates
 * correction, Fisher's exact p, and the relative-risk / odds-ratio measures.
 */
export function contingencyTest(
  matrix: number[][],
): EngineResult<ContingencyResult> {
  const rows = matrix.length;
  if (rows < 2) {
    return { ok: false, error: "A contingency table needs at least 2 rows." };
  }
  const cols = matrix[0].length;
  if (cols < 2) {
    return {
      ok: false,
      error: "A contingency table needs at least 2 columns.",
    };
  }
  for (const row of matrix) {
    if (row.length !== cols) {
      return {
        ok: false,
        error: "Every row of a contingency table must have the same number of columns.",
      };
    }
    for (const v of row) {
      if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
        return {
          ok: false,
          error: "Contingency cells must be non-negative whole-number counts.",
        };
      }
    }
  }

  const rowTotals = matrix.map((r) => sum(r));
  const colTotals: number[] = [];
  for (let j = 0; j < cols; j++) {
    let s = 0;
    for (let i = 0; i < rows; i++) s += matrix[i][j];
    colTotals.push(s);
  }
  const n = sum(rowTotals);
  if (n <= 0) {
    return { ok: false, error: "Enter at least one count before running the test." };
  }
  if (rowTotals.some((t) => t === 0) || colTotals.some((t) => t === 0)) {
    return {
      ok: false,
      error: "Every row and every column needs at least one count (an empty margin has no expected value).",
    };
  }

  const expected: number[][] = [];
  let chiSquare = 0;
  let minExpected = Infinity;
  for (let i = 0; i < rows; i++) {
    const erow: number[] = [];
    for (let j = 0; j < cols; j++) {
      const e = (rowTotals[i] * colTotals[j]) / n;
      erow.push(e);
      if (e < minExpected) minExpected = e;
      const diff = matrix[i][j] - e;
      chiSquare += (diff * diff) / e;
    }
    expected.push(erow);
  }
  const df = (rows - 1) * (cols - 1);
  const pValue = chiSquarePValue(chiSquare, df);

  let yatesChiSquare = NaN;
  let yatesPValue = NaN;
  let fisherPValue = NaN;
  let relativeRisk: RatioMeasure | null = null;
  let oddsRatio: RatioMeasure | null = null;

  if (rows === 2 && cols === 2) {
    // Yates continuity correction: subtract 0.5 from each |observed - expected|
    // (floored at 0) before squaring, scipy's default for a 2x2 table.
    let yates = 0;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const e = expected[i][j];
        const adj = Math.max(0, Math.abs(matrix[i][j] - e) - 0.5);
        yates += (adj * adj) / e;
      }
    }
    yatesChiSquare = yates;
    yatesPValue = chiSquarePValue(yates, df);

    const a = matrix[0][0];
    const b = matrix[0][1];
    const c = matrix[1][0];
    const d = matrix[1][1];
    fisherPValue = fisherExactTwoSided(a, b, c, d);
    relativeRisk = relativeRiskMeasure(a, b, c, d);
    oddsRatio = oddsRatioMeasure(a, b, c, d);
  }

  return {
    ok: true,
    rows,
    cols,
    observed: matrix.map((r) => [...r]),
    expected,
    chiSquare,
    df,
    pValue,
    yatesChiSquare,
    yatesPValue,
    fisherPValue,
    relativeRisk,
    oddsRatio,
    minExpected,
    n,
  };
}
