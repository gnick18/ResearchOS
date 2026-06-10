import { describe as suite, it, expect } from "vitest";

import {
  mannWhitneyU,
  pairedTTest,
  unpairedTTest,
  wilcoxonSignedRank,
} from "../ttests";

// R's built-in `sleep` dataset (extra hours of sleep by drug group). This is the
// canonical Welch two-sample t-test reference reproduced in the R t.test docs:
//   t = -1.8608, df = 17.776, p = 0.07939, 95% CI [-3.3654832, 0.2054832]
// Source: R stats::t.test help page worked example
//   https://stat.ethz.ch/R-manual/R-devel/library/stats/html/t.test.html
const SLEEP_G1 = [0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0.0, 2.0];
const SLEEP_G2 = [1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4];

suite("unpaired t test (Welch default)", () => {
  it("matches the R sleep-data Welch reference", () => {
    const r = unpairedTTest(SLEEP_G1, SLEEP_G2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.statistic).toBeCloseTo(-1.8608, 3);
    expect(r.df).toBeCloseTo(17.776, 2);
    expect(r.pValue).toBeCloseTo(0.07939, 4);
    expect(r.ci95?.[0]).toBeCloseTo(-3.3654832, 4);
    expect(r.ci95?.[1]).toBeCloseTo(0.2054832, 4);
    expect(r.test).toContain("Welch");
  });

  it("Student (equal-variance) option uses pooled df = n1 + n2 - 2", () => {
    // For the sleep data the pooled (Student) test gives t = -1.8608 as well but
    // df = 18 exactly. Source: R t.test(..., var.equal = TRUE) on sleep data.
    const r = unpairedTTest(SLEEP_G1, SLEEP_G2, { variance: "student" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.df).toBeCloseTo(18, 6);
    expect(r.statistic).toBeCloseTo(-1.8608, 3);
    expect(r.test).toContain("Student");
  });

  it("one-sided p is half the two-sided p in the direction of the effect", () => {
    const two = unpairedTTest(SLEEP_G1, SLEEP_G2, { tail: "two-sided" });
    const less = unpairedTTest(SLEEP_G1, SLEEP_G2, { tail: "less" });
    if (!two.ok || !less.ok) throw new Error("expected ok");
    expect(less.pValue).toBeCloseTo(two.pValue / 2, 6);
  });

  it("guards degenerate input", () => {
    expect(unpairedTTest([1], [2, 3]).ok).toBe(false);
  });
});

suite("paired t test", () => {
  it("matches the R sleep-data paired reference", () => {
    // R t.test(extra ~ group, paired = TRUE) on sleep: t = -4.0621, df = 9,
    // p = 0.002833. Source: R stats::t.test docs.
    const r = pairedTTest(SLEEP_G1, SLEEP_G2);
    if (!r.ok) throw new Error("expected ok");
    expect(r.statistic).toBeCloseTo(-4.0621, 3);
    expect(r.df).toBe(9);
    expect(r.pValue).toBeCloseTo(0.002833, 5);
  });

  it("rejects unequal-length samples", () => {
    expect(pairedTTest([1, 2, 3], [1, 2]).ok).toBe(false);
  });
});

suite("Mann-Whitney U (rank-sum)", () => {
  it("matches the R wilcox.test normal-approx reference on sleep data", () => {
    // R wilcox.test(g1, g2, correct = TRUE): W = 25.5, p = 0.06933 (normal
    // approximation with continuity correction; ties present).
    // Source: reproducible via R wilcox.test on the sleep groups; W = n1 n2 - U.
    const r = mannWhitneyU(SLEEP_G1, SLEEP_G2);
    if (!r.ok) throw new Error("expected ok");
    // Our reported statistic is U_min; R reports W = R1 - n1(n1+1)/2 = U1.
    // The p-value is the invariant we pin to.
    expect(r.pValue).toBeCloseTo(0.06933, 3);
  });

  it("clearly separated groups yield a small p-value", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [11, 12, 13, 14, 15];
    const r = mannWhitneyU(a, b);
    if (!r.ok) throw new Error("expected ok");
    expect(r.statistic).toBe(0); // no overlap -> U_min = 0
    expect(r.pValue).toBeLessThan(0.05);
  });
});

suite("Wilcoxon signed-rank", () => {
  it("matches the published Hollander & Wolfe paired example", () => {
    // Hollander & Wolfe (1973) p. 29 paired measurements; exact p = 0.039.
    // Source: reproduced in the @stdlib/stats-wilcoxon README.
    const x = [1.83, 0.5, 1.62, 2.48, 1.68, 1.88, 1.55, 3.06, 1.3];
    const y = [0.878, 0.647, 0.598, 2.05, 1.06, 1.29, 1.06, 3.14, 1.29];
    const r = wilcoxonSignedRank(x, y);
    if (!r.ok) throw new Error("expected ok");
    expect(r.statistic).toBe(40);
    expect(r.pValue).toBeCloseTo(0.0390625, 4);
  });
});
