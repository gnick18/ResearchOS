import { describe as suite, it, expect } from "vitest";

import { grubbsCriticalValue, grubbsTest, GRUBBS_MIN_N } from "../grubbs";

// The same one-outlier sample pinned in the transparency gate
// (frontend/src/lib/transparency/datasets/datahub-stats.ts OUTLIER_SAMPLE). The
// reference G and critical values come from scipy.stats.t computed by hand in
// gen-datahub-stats-golden.py (scipy 1.17.1). There is no scipy.stats.grubbs, so
// the critical value is exact by construction.
const OUTLIER_SAMPLE = [5.1, 4.9, 5.6, 5.0, 5.3, 4.8, 5.2, 5.4, 12.7];

suite("Grubbs outlier test", () => {
  it("flags the single obvious outlier on the first pass", () => {
    const r = grubbsTest(OUTLIER_SAMPLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.n).toBe(9);
    // Pass 1 (n = 9): scipy reference G = 2.653595, G_crit = 2.215004, flagged.
    const s1 = r.steps[0];
    expect(s1.n).toBe(9);
    expect(s1.value).toBe(12.7);
    expect(s1.g).toBeCloseTo(2.653595, 4);
    expect(s1.gCritical).toBeCloseTo(2.215004, 4);
    expect(s1.flagged).toBe(true);
    // The flagged value sits at the last row of the input array.
    expect(s1.rowIndex).toBe(8);
  });

  it("stops after the second pass flags nothing (removes exactly one)", () => {
    const r = grubbsTest(OUTLIER_SAMPLE);
    if (!r.ok) throw new Error("expected ok");
    expect(r.steps.length).toBe(2);
    // Pass 2 (n = 8): scipy reference G = 1.639025, G_crit = 2.126645, not flagged.
    const s2 = r.steps[1];
    expect(s2.n).toBe(8);
    expect(s2.g).toBeCloseTo(1.639025, 4);
    expect(s2.gCritical).toBeCloseTo(2.126645, 4);
    expect(s2.flagged).toBe(false);
    expect(r.outlierValues).toEqual([12.7]);
    expect(r.outlierRowIndices).toEqual([8]);
    expect(r.cleanedN).toBe(8);
  });

  it("single-pass mode removes at most one point", () => {
    const r = grubbsTest(OUTLIER_SAMPLE, { iterative: false });
    if (!r.ok) throw new Error("expected ok");
    expect(r.iterative).toBe(false);
    expect(r.steps.length).toBe(1);
    expect(r.outlierValues).toEqual([12.7]);
    expect(r.cleanedN).toBe(8);
  });

  it("flags nothing on a clean sample", () => {
    const clean = [5.1, 4.9, 5.6, 5.0, 5.3, 4.8, 5.2, 5.4];
    const r = grubbsTest(clean);
    if (!r.ok) throw new Error("expected ok");
    expect(r.outlierValues.length).toBe(0);
    expect(r.cleanedN).toBe(clean.length);
    // One pass that examined the extreme point but did not flag it.
    expect(r.steps.length).toBe(1);
    expect(r.steps[0].flagged).toBe(false);
  });

  it("drops non-finite values before screening", () => {
    const withGaps = [5.1, NaN, 4.9, 5.6, 5.0, 5.3, 4.8, 5.2, 5.4, 12.7];
    const r = grubbsTest(withGaps);
    if (!r.ok) throw new Error("expected ok");
    expect(r.n).toBe(9); // the NaN is dropped
    expect(r.outlierValues).toEqual([12.7]);
    // The row index points at the position in the ORIGINAL array (index 9).
    expect(r.outlierRowIndices).toEqual([9]);
  });

  it("a stricter alpha raises the critical value (flags fewer points)", () => {
    const crit05 = grubbsCriticalValue(9, 0.05);
    const crit01 = grubbsCriticalValue(9, 0.01);
    expect(crit05).toBeCloseTo(2.215004, 4);
    expect(crit01).toBeGreaterThan(crit05);
  });

  it("rejects a sample smaller than the minimum", () => {
    const r = grubbsTest([1, 2]);
    expect(r.ok).toBe(false);
    expect(GRUBBS_MIN_N).toBe(3);
  });

  it("rejects an out-of-range alpha", () => {
    const r = grubbsTest(OUTLIER_SAMPLE, { alpha: 0 });
    expect(r.ok).toBe(false);
  });

  it("returns G = 0 for a zero-spread sample (no spurious flag)", () => {
    const r = grubbsTest([3, 3, 3, 3]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.steps[0].g).toBe(0);
    expect(r.outlierValues.length).toBe(0);
  });
});
