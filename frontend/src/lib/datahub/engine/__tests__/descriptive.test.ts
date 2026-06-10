import { describe as suite, it, expect } from "vitest";

import { describe } from "../descriptive";

// Reference values hand-computed and cross-checked against numpy / Excel for the
// canonical small sample [2, 4, 4, 4, 5, 5, 7, 9] (population SD = 2 by
// construction; sample SD differs). Source: this 8-value set is the textbook
// standard-deviation worked example on Wikipedia "Standard deviation"
// (https://en.wikipedia.org/wiki/Standard_deviation#Basic_examples).
const SAMPLE = [2, 4, 4, 4, 5, 5, 7, 9];

suite("descriptive", () => {
  it("computes core statistics for the textbook sample", () => {
    const r = describe(SAMPLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.n).toBe(8);
    expect(r.mean).toBeCloseTo(5, 12);
    // Sample variance = 32 / 7 = 4.571428...; sample SD = 2.13809...
    expect(r.variance).toBeCloseTo(32 / 7, 10);
    expect(r.sd).toBeCloseTo(2.138089935, 8);
    // SEM = sd / sqrt(8).
    expect(r.sem).toBeCloseTo(2.138089935 / Math.sqrt(8), 8);
    expect(r.median).toBeCloseTo(4.5, 12);
    expect(r.min).toBe(2);
    expect(r.max).toBe(9);
    // %CV = 100 * sd / mean.
    expect(r.cvPercent).toBeCloseTo((100 * 2.138089935) / 5, 6);
  });

  it("computes the type-7 quartiles (numpy default)", () => {
    // For [2,4,4,4,5,5,7,9] numpy.percentile gives q1 = 4, q3 = 5.5.
    const r = describe(SAMPLE);
    if (!r.ok) throw new Error("expected ok");
    expect(r.q1).toBeCloseTo(4, 10);
    expect(r.q3).toBeCloseTo(5.5, 10);
  });

  it("returns a 95% CI of the mean using the t critical value", () => {
    // t_0.975, df=7 = 2.364624; half-width = t * SEM.
    const r = describe(SAMPLE);
    if (!r.ok) throw new Error("expected ok");
    const sem = 2.138089935 / Math.sqrt(8);
    const half = 2.364624252 * sem;
    expect(r.ci95[0]).toBeCloseTo(5 - half, 6);
    expect(r.ci95[1]).toBeCloseTo(5 + half, 6);
  });

  it("handles empty and single-value inputs without throwing", () => {
    expect(describe([]).ok).toBe(false);
    const one = describe([42]);
    expect(one.ok).toBe(true);
    if (one.ok) {
      expect(one.mean).toBe(42);
      expect(Number.isNaN(one.sd)).toBe(true); // SD undefined for n = 1
    }
  });
});
