import { describe as suite, it, expect } from "vitest";

import { nestedTTest, nestedOneWayAnova, type NestedGroup } from "../nested";

// The shared transparency fixtures: balanced nested designs. Mirrored from
// src/lib/transparency/datasets/datahub-stats.ts (NESTED_T, NESTED_ANOVA).
//
// NESTED_T: 2 groups (Control, Drug) x 3 subgroups x 4 replicates.
// NESTED_ANOVA: 3 groups (Control, Drug, Vehicle) x 3 subgroups x 4 replicates.
//
// Reference values copied verbatim from scripts/gen-datahub-stats-golden.py run
// against statsmodels 0.14.6 / scipy 1.17.1 (the nested t-test through MixedLM,
// the nested ANOVA through the exact balanced classic-F by hand).

const NESTED_T: NestedGroup[] = [
  {
    name: "Control",
    subgroups: [
      { name: "C1", values: [5.1, 5.3, 4.9, 5.2] },
      { name: "C2", values: [5.5, 5.7, 5.4, 5.6] },
      { name: "C3", values: [4.7, 4.9, 4.6, 4.8] },
    ],
  },
  {
    name: "Drug",
    subgroups: [
      { name: "D1", values: [6.2, 6.4, 6.1, 6.3] },
      { name: "D2", values: [6.8, 7.0, 6.7, 6.9] },
      { name: "D3", values: [5.9, 6.1, 5.8, 6.0] },
    ],
  },
];

const NESTED_ANOVA: NestedGroup[] = [
  ...NESTED_T,
  {
    name: "Vehicle",
    subgroups: [
      { name: "V1", values: [5.6, 5.8, 5.5, 5.7] },
      { name: "V2", values: [6.0, 6.2, 5.9, 6.1] },
      { name: "V3", values: [5.2, 5.4, 5.1, 5.3] },
    ],
  },
];

suite("nested t-test (mixed-model route)", () => {
  it("matches the statsmodels MixedLM reference on NESTED_T", () => {
    const r = nestedTTest(NESTED_T);
    if (!r.ok) throw new Error("expected ok");

    expect(r.subgroups).toBe(6);
    expect(r.observations).toBe(24);
    expect(r.groupNames).toEqual(["Control", "Drug"]);

    // The group fixed-effect (Drug minus Control) IS the nested t-test. The
    // estimate / SE / z / p / CI are stable across implementations, so they pin
    // tight to the MixedLM reference.
    expect(r.estimate).toBeCloseTo(1.208333, 4);
    expect(r.standardError).toBeCloseTo(0.351272, 4);
    expect(r.z).toBeCloseTo(3.439876, 3);
    expect(r.pValue).toBeCloseTo(0.000582, 5);
    expect(r.ciLow).toBeCloseTo(0.519852, 4);
    expect(r.ciHigh).toBeCloseTo(1.896814, 4);

    // Variance components come from a numeric optimum, so check on a looser band.
    expect(r.subgroupVariance).toBeCloseTo(0.180401, 2);
    expect(r.residualVariance).toBeCloseTo(0.01875, 3);
    expect(r.remlLogLikelihood).toBeCloseTo(2.688584, 1);
  });

  it("rejects a design that is not exactly 2 groups", () => {
    expect(nestedTTest([NESTED_T[0]]).ok).toBe(false);
    expect(nestedTTest(NESTED_ANOVA).ok).toBe(false);
  });
});

suite("nested one-way ANOVA (balanced classic F)", () => {
  it("matches the exact classic-F reference on NESTED_ANOVA", () => {
    const r = nestedOneWayAnova(NESTED_ANOVA);
    if (!r.ok) throw new Error("expected ok");

    expect(r.method).toBe("classic-f");
    expect(r.balanced).toBe(true);
    expect(r.subgroups).toBe(9);
    expect(r.observations).toBe(36);
    expect(r.groupNames).toEqual(["Control", "Drug", "Vehicle"]);

    // The balanced classic random-effects F is exact, so it pins tight.
    expect(r.f).toBeCloseTo(6.247937, 4);
    expect(r.dfBetween).toBe(2);
    expect(r.dfSubgroups).toBe(6);
    expect(r.pValue).toBeCloseTo(0.034137, 5);

    // The ANOVA table sums of squares are exact.
    const groupsRow = r.table.find((t) => t.source === "Groups");
    const subRow = r.table.find((t) => t.source === "Subgroups within groups");
    const errRow = r.table.find((t) => t.source === "Replicates within subgroups");
    expect(groupsRow?.ss).toBeCloseTo(8.833889, 4);
    expect(subRow?.ss).toBeCloseTo(4.241667, 4);
    expect(errRow?.ss).toBeCloseTo(0.4875, 4);
    expect(groupsRow?.ms).toBeCloseTo(4.416944, 4);
    expect(subRow?.ms).toBeCloseTo(0.706944, 4);
    expect(errRow?.ms).toBeCloseTo(0.018056, 4);

    // The method-of-moments variance components match the hand computation.
    expect(r.subgroupVariance).toBeCloseTo(0.172222, 4);
    expect(r.residualVariance).toBeCloseTo(0.018056, 4);
  });

  it("rejects fewer than 3 groups or a group with fewer than 2 subgroups", () => {
    expect(nestedOneWayAnova(NESTED_T).ok).toBe(false);
    const oneSubEach: NestedGroup[] = NESTED_ANOVA.map((g) => ({
      name: g.name,
      subgroups: [g.subgroups[0]],
    }));
    expect(nestedOneWayAnova(oneSubEach).ok).toBe(false);
  });

  it("falls back to the mixed-model route for an unbalanced design", () => {
    // Drop one replicate from a single subgroup so the design is unbalanced.
    const unbalanced: NestedGroup[] = NESTED_ANOVA.map((g, gi) => ({
      name: g.name,
      subgroups: g.subgroups.map((s, si) =>
        gi === 0 && si === 0 ? { name: s.name, values: s.values.slice(0, 3) } : s,
      ),
    }));
    const r = nestedOneWayAnova(unbalanced);
    if (!r.ok) throw new Error("expected ok");
    expect(r.method).toBe("mixed-model");
    expect(r.balanced).toBe(false);
    expect(Number.isFinite(r.pValue)).toBe(true);
  });
});
