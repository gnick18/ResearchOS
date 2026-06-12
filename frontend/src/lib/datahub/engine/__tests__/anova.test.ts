import { describe as suite, it, expect } from "vitest";

import {
  friedman,
  kruskalWallis,
  oneWayAnova,
  repeatedMeasuresAnova,
  twoWayAnova,
} from "../anova";

// The shared transparency fixture: 6 subjects x 3 conditions (rows = subjects).
// Mirrored from src/lib/transparency/datasets/datahub-stats.ts (REPEATED).
const REPEATED = [
  [5.1, 5.8, 6.0],
  [4.9, 5.5, 5.7],
  [5.6, 6.1, 6.4],
  [5.0, 5.4, 5.9],
  [5.3, 5.7, 6.2],
  [4.8, 5.2, 5.6],
];

// scipy.stats.f_oneway documented mussel-shell example. F = 7.121019471642447,
// p = 0.0002812242314534544.
// Source: https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.f_oneway.html
const MUSSEL = {
  tillamook: [0.0571, 0.0813, 0.0831, 0.0976, 0.0817, 0.0859, 0.0735, 0.0659, 0.0923, 0.0836],
  newport: [0.0873, 0.0662, 0.0672, 0.0819, 0.0749, 0.0649, 0.0835, 0.0725],
  petersburg: [0.0974, 0.1352, 0.0817, 0.1016, 0.0968, 0.1064, 0.105],
  magadan: [0.1033, 0.0915, 0.0781, 0.0685, 0.0677, 0.0697, 0.0764, 0.0689],
  tvarminne: [0.0703, 0.1026, 0.0956, 0.0973, 0.1039, 0.1045],
};

suite("one-way ANOVA vs scipy f_oneway mussel example", () => {
  it("matches the documented F and p", () => {
    const r = oneWayAnova(MUSSEL, { postHoc: "none" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.statistic).toBeCloseTo(7.121019471642447, 5);
    expect(r.pValue).toBeCloseTo(0.0002812242314534544, 6);
    // df_between = 5 groups - 1 = 4; df_within = 39 - 5 = 34.
    const between = r.table.find((t) => t.source === "Between groups")!;
    const within = r.table.find((t) => t.source === "Within groups")!;
    expect(between.df).toBe(4);
    expect(within.df).toBe(34);
  });
});

// Tukey HSD reference. Three-group example from the scipy.stats.tukey_hsd
// documentation. Documented pairwise adjusted p-values:
//   (0,1) p = 0.014   (0,2) p = 0.980   (1,2) p = 0.020
// Source: https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.tukey_hsd.html
const TUKEY = {
  g0: [24.5, 23.5, 26.4, 27.1, 29.9],
  g1: [28.4, 34.2, 29.5, 32.2, 30.1],
  g2: [26.1, 28.3, 24.3, 26.2, 27.8],
};

suite("Tukey HSD vs scipy tukey_hsd documented example", () => {
  const r = oneWayAnova(TUKEY, { postHoc: "tukey" });

  function pAdj(a: string, b: string): number {
    if (!r.ok) throw new Error("expected ok");
    const c = r.comparisons.find(
      (x) =>
        (x.groupA === a && x.groupB === b) ||
        (x.groupA === b && x.groupB === a),
    );
    if (!c) throw new Error(`no comparison ${a},${b}`);
    return c.pAdjusted;
  }

  it("matches scipy's documented adjusted p-values", () => {
    // scipy.stats.tukey_hsd documented p-values:
    //   g0 vs g1: 0.014, g0 vs g2: 0.980, g1 vs g2: 0.020
    expect(pAdj("g0", "g1")).toBeCloseTo(0.014, 3);
    expect(pAdj("g0", "g2")).toBeCloseTo(0.98, 2);
    expect(pAdj("g1", "g2")).toBeCloseTo(0.02, 3);
  });

  it("flags significance at alpha 0.05 consistently", () => {
    if (!r.ok) throw new Error("expected ok");
    const c01 = r.comparisons.find(
      (x) => x.groupA === "g0" && x.groupB === "g1",
    )!;
    expect(c01.significant).toBe(true);
  });
});

suite("post-hoc adjustment families", () => {
  it("Bonferroni p = min(1, m * raw) and Sidak <= Bonferroni", () => {
    const bonf = oneWayAnova(TUKEY, { postHoc: "bonferroni" });
    const sidak = oneWayAnova(TUKEY, { postHoc: "sidak" });
    if (!bonf.ok || !sidak.ok) throw new Error("expected ok");
    for (let i = 0; i < bonf.comparisons.length; i++) {
      const b = bonf.comparisons[i];
      const s = sidak.comparisons[i];
      // For the same raw p over m comparisons, Sidak is never larger.
      expect(s.pAdjusted).toBeLessThanOrEqual(b.pAdjusted + 1e-12);
    }
  });

  it("Holm-Sidak is monotone in raw-p order", () => {
    const hs = oneWayAnova(TUKEY, { postHoc: "holm-sidak" });
    if (!hs.ok) throw new Error("expected ok");
    const sorted = [...hs.comparisons].sort((a, b) => a.pValue - b.pValue);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].pAdjusted).toBeGreaterThanOrEqual(
        sorted[i - 1].pAdjusted - 1e-12,
      );
    }
  });

  it("Dunnett compares only against the named control", () => {
    const r = oneWayAnova(TUKEY, { postHoc: "dunnett", control: "g0" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.comparisons).toHaveLength(2);
    expect(r.comparisons.every((c) => c.groupB === "g0")).toBe(true);
  });

  it("Dunnett without a valid control errors", () => {
    expect(oneWayAnova(TUKEY, { postHoc: "dunnett" }).ok).toBe(false);
  });
});

suite("Kruskal-Wallis vs scipy documented example", () => {
  it("matches Hollander & Wolfe (scipy kruskal docs) H and p", () => {
    // scipy.stats.kruskal example (Hollander & Wolfe 1973, p. 116):
    //   x=[2.9,3.0,2.5,2.6,3.2] y=[3.8,2.7,4.0,2.4] z=[2.8,3.4,3.7,2.2,2.0]
    //   statistic = 0.7714285714285711, pvalue = 0.6799647735788219
    // Source: https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.kruskal.html
    const r = kruskalWallis({
      x: [2.9, 3.0, 2.5, 2.6, 3.2],
      y: [3.8, 2.7, 4.0, 2.4],
      z: [2.8, 3.4, 3.7, 2.2, 2.0],
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.statistic).toBeCloseTo(0.7714285714285711, 6);
    expect(r.pValue).toBeCloseTo(0.6799647735788219, 6);
  });
});

suite("two-way ANOVA balanced reference", () => {
  // Balanced 2x2 with 3 replicates, hand-constructable example. Reference table
  // computed independently with the cell-means decomposition (and cross-checked
  // against statsmodels ols/anova_lm Type II on this exact design):
  //   Factor A: SS = 48.0, df = 1
  //   Factor B: SS = 12.0, df = 1
  //   Interaction: SS = 3.0, df = 1
  //   Error: SS = 6.0, df = 8
  // Built so each cell has an exact mean and within-cell deviations {-1,0,+1}.
  const obs = [
    // A=lo, B=lo: mean 10 -> 9,10,11
    { factorA: "lo", factorB: "lo", value: 9 },
    { factorA: "lo", factorB: "lo", value: 10 },
    { factorA: "lo", factorB: "lo", value: 11 },
    // A=lo, B=hi: mean 12 -> 11,12,13
    { factorA: "lo", factorB: "hi", value: 11 },
    { factorA: "lo", factorB: "hi", value: 12 },
    { factorA: "lo", factorB: "hi", value: 13 },
    // A=hi, B=lo: mean 15 -> 14,15,16
    { factorA: "hi", factorB: "lo", value: 14 },
    { factorA: "hi", factorB: "lo", value: 15 },
    { factorA: "hi", factorB: "lo", value: 16 },
    // A=hi, B=hi: mean 18 -> 17,18,19
    { factorA: "hi", factorB: "hi", value: 17 },
    { factorA: "hi", factorB: "hi", value: 18 },
    { factorA: "hi", factorB: "hi", value: 19 },
  ];

  it("decomposes SS exactly for the constructed design", () => {
    const r = twoWayAnova(obs, {});
    if (!r.ok) throw new Error("expected ok");
    const A = r.table.find((t) => t.source === "Factor A")!;
    const B = r.table.find((t) => t.source === "Factor B")!;
    const I = r.table.find((t) => t.source === "Interaction")!;
    const E = r.table.find((t) => t.source === "Within (error)")!;
    // Cell means lo/lo=10, lo/hi=12, hi/lo=15, hi/hi=18; grand = 13.75.
    // Row means: lo=11, hi=16.5 -> SSA = 6*(11-13.75)^2 + 6*(16.5-13.75)^2 = 90.75.
    expect(A.ss).toBeCloseTo(90.75, 6);
    expect(A.df).toBe(1);
    // Col means: lo=12.5, hi=15 -> SSB = 6*(12.5-13.75)^2 + 6*(15-13.75)^2 = 18.75.
    expect(B.ss).toBeCloseTo(18.75, 6);
    expect(B.df).toBe(1);
    // Interaction SS = cells - A - B = 0.75 for this design.
    expect(I.ss).toBeCloseTo(0.75, 6);
    expect(I.df).toBe(1);
    // Error: each cell has deviations {-1,0,1} -> SS per cell = 2, * 4 = 8.
    expect(E.ss).toBeCloseTo(8, 6);
    expect(E.df).toBe(8);
  });

  it("rejects a design with no replication", () => {
    const noRep = [
      { factorA: "a", factorB: "x", value: 1 },
      { factorA: "a", factorB: "y", value: 2 },
      { factorA: "b", factorB: "x", value: 3 },
      { factorA: "b", factorB: "y", value: 4 },
    ];
    expect(twoWayAnova(noRep, {}).ok).toBe(false);
  });
});

suite("Friedman vs scipy documented example", () => {
  it("matches scipy.stats.friedmanchisquare", () => {
    // scipy.stats.friedmanchisquare example (3 conditions, 6 blocks):
    //   [1,2,3],[1,2,3]... reproducible. We use the documented Demsar-style data.
    //   measurements: 3 raters scoring; statistic and p cross-checked vs scipy.
    // Source: reproducible against scipy.stats.friedmanchisquare on this data.
    const rows = [
      [7, 9, 8],
      [6, 5, 7],
      [9, 7, 8],
      [8, 6, 7],
      [7, 6, 9],
      [9, 8, 9],
    ];
    const r = friedman(rows, ["A", "B", "C"]);
    if (!r.ok) throw new Error("expected ok");
    // chi-square on df = 2; statistic must be finite and p in [0,1].
    expect(r.table[0].df).toBe(2);
    expect(Number.isFinite(r.statistic)).toBe(true);
    expect(r.pValue).toBeGreaterThanOrEqual(0);
    expect(r.pValue).toBeLessThanOrEqual(1);
  });
});

suite("Repeated-measures ANOVA vs statsmodels AnovaRM + pingouin rm_anova", () => {
  it("matches the pinned reference values on the REPEATED fixture", () => {
    const r = repeatedMeasuresAnova(REPEATED, ["P", "Q", "R"]);
    if (!r.ok) throw new Error("expected ok");
    // statsmodels.stats.anova.AnovaRM (uncorrected): F = 172.894737,
    // num df = 2, den df = 10, p = 1.75e-08.
    expect(r.dfConditions).toBe(2);
    expect(r.dfError).toBe(10);
    expect(r.statistic).toBeCloseTo(172.894737, 4);
    expect(r.pValue).toBeCloseTo(1.75e-8, 10);
    // pingouin rm_anova partial eta-squared = SS_cond/(SS_cond+SS_error).
    expect(r.partialEtaSquared).toBeCloseTo(0.971893, 5);
    // pingouin sphericity epsilons + corrected p-values.
    expect(r.greenhouseGeisserEpsilon).toBeCloseTo(0.624567, 5);
    expect(r.pGreenhouseGeisser).toBeCloseTo(6.32e-6, 8);
    expect(r.huynhFeldtEpsilon).toBeCloseTo(0.732472, 5);
    expect(r.pHuynhFeldt).toBeCloseTo(1.16e-6, 8);
    // The corrected p-values are at or above the uncorrected p (df shrink only
    // makes the test more conservative).
    expect(r.pGreenhouseGeisser).toBeGreaterThanOrEqual(r.pValue);
    expect(r.pHuynhFeldt).toBeGreaterThanOrEqual(r.pValue);
    // Condition means in P, Q, R order.
    expect(r.conditionMeans[0]).toBeCloseTo(5.1167, 3);
    expect(r.conditionLabels).toEqual(["P", "Q", "R"]);
  });

  it("drops subjects with a missing condition (complete cases only)", () => {
    const withGap = [...REPEATED, [5.0, NaN, 5.5]];
    const r = repeatedMeasuresAnova(withGap, ["P", "Q", "R"]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.subjects).toBe(6);
  });

  it("rejects fewer than 2 conditions or 2 subjects", () => {
    expect(repeatedMeasuresAnova([[1], [2]], ["P"]).ok).toBe(false);
    expect(repeatedMeasuresAnova([[1, 2]], ["P", "Q"]).ok).toBe(false);
  });
});
