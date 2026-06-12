// Tests for the from-summary-stats engine paths (subcolumn foundation, chunk 2).
//
// The headline check is internal consistency: feeding the SUMMARY of a raw
// dataset (its mean / SD / n) into the from-stats path must reproduce the raw
// path's t / df / p / one-way F to floating point, because the two are the same
// computation expressed over different inputs. (The scipy gate is chunk 3.)

import { describe, it, expect } from "vitest";

import {
  describe as engineDescribe,
  oneWayAnova,
  oneWayAnovaFromStats,
  unpairedTTest,
  unpairedTTestFromStats,
} from "./index";

const GROUP_A = [5.1, 4.9, 5.6, 5.0, 5.3, 4.8];
const GROUP_B = [6.2, 5.9, 6.5, 6.0, 6.3];
const GROUP_C = [4.4, 4.7, 4.1, 4.9, 4.5, 4.3, 4.6];

function summary(values: number[]): { mean: number; sd: number; n: number } {
  const d = engineDescribe(values);
  if (!d.ok) throw new Error("describe failed");
  return { mean: d.mean, sd: d.sd, n: d.n };
}

describe("unpairedTTestFromStats matches the raw unpaired t-test on the same data", () => {
  const sa = summary(GROUP_A);
  const sb = summary(GROUP_B);

  it("Welch (default) reproduces t / df / p", () => {
    const raw = unpairedTTest(GROUP_A, GROUP_B);
    const fromStats = unpairedTTestFromStats({
      mean1: sa.mean, sd1: sa.sd, n1: sa.n,
      mean2: sb.mean, sd2: sb.sd, n2: sb.n,
    });
    if (!raw.ok || !fromStats.ok) throw new Error("test failed");
    expect(fromStats.statistic).toBeCloseTo(raw.statistic, 9);
    expect(fromStats.df).toBeCloseTo(raw.df, 6);
    expect(fromStats.pValue).toBeCloseTo(raw.pValue, 9);
    expect(fromStats.effectSize).toBeCloseTo(raw.effectSize, 9);
    expect(fromStats.test).toBe("Welch's t-test");
  });

  it("Student (pooled) reproduces t / df / p", () => {
    const raw = unpairedTTest(GROUP_A, GROUP_B, { variance: "student" });
    const fromStats = unpairedTTestFromStats({
      mean1: sa.mean, sd1: sa.sd, n1: sa.n,
      mean2: sb.mean, sd2: sb.sd, n2: sb.n,
      variance: "student",
    });
    if (!raw.ok || !fromStats.ok) throw new Error("test failed");
    expect(fromStats.statistic).toBeCloseTo(raw.statistic, 9);
    expect(fromStats.df).toBe(raw.df);
    expect(fromStats.pValue).toBeCloseTo(raw.pValue, 9);
    expect(fromStats.test).toBe("Student's two-sample t-test");
  });

  it("honors the one-sided tail like the raw path", () => {
    for (const tail of ["less", "greater"] as const) {
      const raw = unpairedTTest(GROUP_A, GROUP_B, { tail });
      const fromStats = unpairedTTestFromStats({
        mean1: sa.mean, sd1: sa.sd, n1: sa.n,
        mean2: sb.mean, sd2: sb.sd, n2: sb.n,
        tail,
      });
      if (!raw.ok || !fromStats.ok) throw new Error("test failed");
      expect(fromStats.pValue).toBeCloseTo(raw.pValue, 9);
    }
  });

  it("rejects invalid input rather than returning a wrong number", () => {
    expect(unpairedTTestFromStats({ mean1: 1, sd1: 1, n1: 1, mean2: 2, sd2: 1, n2: 4 }).ok).toBe(false);
    expect(unpairedTTestFromStats({ mean1: 1, sd1: -1, n1: 4, mean2: 2, sd2: 1, n2: 4 }).ok).toBe(false);
    expect(unpairedTTestFromStats({ mean1: 1, sd1: 0, n1: 4, mean2: 2, sd2: 0, n2: 4 }).ok).toBe(false);
    expect(unpairedTTestFromStats({ mean1: NaN, sd1: 1, n1: 4, mean2: 2, sd2: 1, n2: 4 }).ok).toBe(false);
  });
});

describe("oneWayAnovaFromStats matches the raw one-way ANOVA on the same data", () => {
  it("reproduces the omnibus F and p", () => {
    const raw = oneWayAnova({ A: GROUP_A, B: GROUP_B, C: GROUP_C });
    const fromStats = oneWayAnovaFromStats([
      summary(GROUP_A),
      summary(GROUP_B),
      summary(GROUP_C),
    ]);
    if (!raw.ok || !fromStats.ok) throw new Error("test failed");
    expect(fromStats.statistic).toBeCloseTo(raw.statistic, 6);
    expect(fromStats.pValue).toBeCloseTo(raw.pValue, 9);
    // SS / df rows agree too (the table is reconstructed identically).
    const rawBetween = raw.table.find((r) => r.source === "Between groups");
    const fsBetween = fromStats.table.find((r) => r.source === "Between groups");
    expect(fsBetween?.ss).toBeCloseTo(rawBetween?.ss ?? NaN, 6);
    expect(fsBetween?.df).toBe(rawBetween?.df);
  });

  it("has no post-hoc comparisons from summary stats (out of scope)", () => {
    const fromStats = oneWayAnovaFromStats([
      summary(GROUP_A),
      summary(GROUP_B),
      summary(GROUP_C),
    ]);
    if (!fromStats.ok) throw new Error("test failed");
    expect(fromStats.comparisons).toHaveLength(0);
  });

  it("needs at least 2 valid groups", () => {
    expect(oneWayAnovaFromStats([summary(GROUP_A)]).ok).toBe(false);
  });
});
