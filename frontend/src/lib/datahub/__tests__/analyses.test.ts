import { describe, expect, it } from "vitest";

import {
  oneWayAnova,
  unpairedTTest,
  mannWhitneyU,
  wilcoxonSignedRank,
  kruskalWallis,
} from "@/lib/datahub/engine";
import type {
  AnalysisSpec,
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import {
  runAnalysis,
  resolveGroups,
  validAnalysisTypes,
} from "@/lib/datahub/run-analysis";
import { plainLanguageSummary, formatP } from "@/lib/datahub/plain-language";
import { showCode } from "@/lib/datahub/show-code";

/**
 * Slice 2 (the analyses, results sheet, and show-the-code). The headline pin:
 * runAnalysis on the slice-1 demo Column data returns a one-way ANOVA F and p
 * that match the engine (which the engine suite already validates against
 * scipy), and the 2-group case routes to the t-test.
 */

const META: DataHubDocument = {
  id: "demo",
  name: "Cell viability assay",
  project_ids: [],
  folder_path: null,
  table_type: "column",
  created_at: "2026-06-10T00:00:00.000Z",
};

// The slice-1 demo Column data: Control / Drug A / Drug B, 6 replicates each.
const CONTROL = [98, 102, 95, 105, 100, 99];
const DRUG_A = [78, 82, 75, 80, 85, 79];
const DRUG_B = [55, 60, 52, 58, 50, 57];

function demoContent(): DataHubDocContent {
  const cols = [
    { id: "col-1", name: "Control" },
    { id: "col-2", name: "Drug A" },
    { id: "col-3", name: "Drug B" },
  ];
  const series = [CONTROL, DRUG_A, DRUG_B];
  const rows = Array.from({ length: 6 }, (_, r) => ({
    id: `row-${r + 1}`,
    cells: {
      "col-1": series[0][r],
      "col-2": series[1][r],
      "col-3": series[2][r],
    } as Record<string, number>,
  }));
  return {
    meta: META,
    columns: cols.map((c) => ({
      id: c.id,
      name: c.name,
      role: "y" as const,
      dataType: "number" as const,
    })),
    rows,
    analyses: [],
    plots: [],
  };
}

function spec(type: string, columnIds: string[]): AnalysisSpec {
  return {
    id: `a-${type}`,
    type,
    params: {},
    inputs: { columnIds },
    resultCache: null,
    resultStale: false,
  };
}

describe("run-analysis", () => {
  it("resolves named groups and offers types by group count", () => {
    const content = demoContent();
    const groups = resolveGroups(content, ["col-1", "col-2", "col-3"]);
    expect(groups.map((g) => g.name)).toEqual(["Control", "Drug A", "Drug B"]);
    expect(groups[0].values).toEqual(CONTROL);

    expect(validAnalysisTypes(content)).toContain("oneWayAnova");
    // A three-group table also offers the nonparametric Kruskal-Wallis.
    expect(validAnalysisTypes(content)).toContain("kruskalWallis");
    // A two-group table offers the two-group tests (parametric + rank-based)
    // but not the three-or-more-group tests.
    const twoGroup: DataHubDocContent = {
      ...content,
      columns: content.columns.slice(0, 2),
    };
    const twoTypes = validAnalysisTypes(twoGroup);
    // Grubbs outlier detection is offered from a single group column up (each
    // column is screened on its own), so it leads the list for any column table.
    expect(twoTypes).toEqual([
      "grubbsOutlier",
      "unpairedTTest",
      "pairedTTest",
      "mannWhitneyU",
      "wilcoxonSignedRank",
    ]);
    expect(twoTypes).not.toContain("oneWayAnova");
    expect(twoTypes).not.toContain("kruskalWallis");
  });

  it("runs one-way ANOVA on the demo data consistent with the engine", () => {
    const content = demoContent();
    const outcome = runAnalysis(
      spec("oneWayAnova", ["col-1", "col-2", "col-3"]),
      content,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== "anova") throw new Error("expected anova");

    // Compare against the engine called directly with the same data.
    const engine = oneWayAnova(
      { Control: CONTROL, "Drug A": DRUG_A, "Drug B": DRUG_B },
      { postHoc: "tukey" },
    );
    expect(engine.ok).toBe(true);
    if (!engine.ok) throw new Error("engine failed");

    expect(outcome.statistic).toBeCloseTo(engine.statistic, 6);
    expect(outcome.pValue).toBeCloseTo(engine.pValue, 10);
    // F(2, 15) for 3 groups of 6.
    expect(outcome.dfBetween).toBe(2);
    expect(outcome.dfWithin).toBe(15);
    // The omnibus is hugely significant; all three pairs differ.
    expect(outcome.pValue).toBeLessThan(0.0001);
    expect(outcome.comparisons.length).toBe(3);
    expect(outcome.comparisons.every((c) => c.significant)).toBe(true);
  });

  it("routes a 2-group choice to the unpaired t-test", () => {
    const content = demoContent();
    const outcome = runAnalysis(
      spec("unpairedTTest", ["col-1", "col-2"]),
      content,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== "ttest") throw new Error("expected ttest");

    const engine = unpairedTTest(CONTROL, DRUG_A);
    expect(engine.ok).toBe(true);
    if (!engine.ok) throw new Error("engine failed");
    expect(outcome.test).toBe("Welch's t-test");
    expect(outcome.statistic).toBeCloseTo(engine.statistic, 6);
    expect(outcome.pValue).toBeCloseTo(engine.pValue, 10);
    // Control mean 99.833, Drug A mean 79.833, so the difference is exactly 20.
    expect(outcome.meanDiff).toBeCloseTo(20.0, 3);

    // E4 additive bootstrap CI of the difference: present for the parametric
    // path, reproducible (fixed seed), and it must bracket the observed
    // difference. We assert the bracket + a sane width rather than exact bounds,
    // since the bounds are RNG-derived (deterministic given the seed but not a
    // simple closed form).
    expect(outcome.bootstrapCI95).not.toBeNull();
    const [bLo, bHi] = outcome.bootstrapCI95!;
    expect(bLo).toBeLessThanOrEqual(outcome.meanDiff);
    expect(bHi).toBeGreaterThanOrEqual(outcome.meanDiff);
    // Reproducible across re-runs of the same spec on the same data.
    const again = runAnalysis(
      spec("unpairedTTest", ["col-1", "col-2"]),
      content,
    );
    if (!again.ok || again.kind !== "ttest") throw new Error("expected ttest");
    expect(again.bootstrapCI95).toEqual(outcome.bootstrapCI95);
  });

  it("fails cleanly when ANOVA is asked for with too few groups", () => {
    const content = demoContent();
    const outcome = runAnalysis(spec("oneWayAnova", ["col-1", "col-2"]), content);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected failure");
    expect(outcome.error).toMatch(/3 groups/);
  });

  it("routes a Mann-Whitney choice to the engine rank-sum test", () => {
    const content = demoContent();
    const outcome = runAnalysis(spec("mannWhitneyU", ["col-1", "col-2"]), content);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== "ttest") throw new Error("expected ttest");
    expect(outcome.nonparametric).toBe(true);
    expect(outcome.test).toContain("Mann-Whitney");

    const engine = mannWhitneyU(CONTROL, DRUG_A);
    if (!engine.ok) throw new Error("engine failed");
    expect(outcome.statistic).toBeCloseTo(engine.statistic, 10);
    expect(outcome.pValue).toBeCloseTo(engine.pValue, 10);
    // A rank test has no df and no CI of the difference.
    expect(Number.isNaN(outcome.df)).toBe(true);
    expect(outcome.ci95).toBeNull();
    // The rank test IS the nonparametric path, so it carries no redundant
    // bootstrap CI and never flags normality.
    expect(outcome.bootstrapCI95).toBeNull();
    expect(outcome.normalityShaky).toBe(false);
  });

  it("routes a Wilcoxon choice to the engine signed-rank test", () => {
    const content = demoContent();
    const outcome = runAnalysis(
      spec("wilcoxonSignedRank", ["col-1", "col-2"]),
      content,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== "ttest") throw new Error("expected ttest");
    expect(outcome.nonparametric).toBe(true);
    expect(outcome.test).toContain("Wilcoxon");

    const engine = wilcoxonSignedRank(CONTROL, DRUG_A);
    if (!engine.ok) throw new Error("engine failed");
    expect(outcome.statistic).toBeCloseTo(engine.statistic, 10);
    expect(outcome.pValue).toBeCloseTo(engine.pValue, 10);
  });

  it("routes a Kruskal-Wallis choice to the engine rank-based ANOVA", () => {
    const content = demoContent();
    const outcome = runAnalysis(
      spec("kruskalWallis", ["col-1", "col-2", "col-3"]),
      content,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== "anova") throw new Error("expected anova");
    expect(outcome.nonparametric).toBe(true);
    expect(outcome.test).toContain("Kruskal-Wallis");

    const engine = kruskalWallis({
      Control: CONTROL,
      "Drug A": DRUG_A,
      "Drug B": DRUG_B,
    });
    if (!engine.ok) throw new Error("engine failed");
    expect(outcome.statistic).toBeCloseTo(engine.statistic, 10);
    expect(outcome.pValue).toBeCloseTo(engine.pValue, 10);
    // dfBetween = k - 1 for the H statistic.
    expect(outcome.dfBetween).toBe(2);
  });
});

describe("plain-language", () => {
  it("states the practical takeaway for a significant ANOVA", () => {
    const content = demoContent();
    const outcome = runAnalysis(
      spec("oneWayAnova", ["col-1", "col-2", "col-3"]),
      content,
    );
    if (!outcome.ok) throw new Error("run failed");
    const sentence = plainLanguageSummary(outcome);
    expect(sentence).toContain("one-way ANOVA");
    expect(sentence).toContain("F(2, 15)");
    expect(sentence).toContain("p < 0.0001");
    expect(sentence).toMatch(/Control|Drug A|Drug B/);
    // House voice: no em-dashes, no emojis.
    expect(sentence).not.toContain("—");
  });

  it("names the actual post-hoc family in the ANOVA prose", () => {
    const content = demoContent();
    const tukeySpec = spec("oneWayAnova", ["col-1", "col-2", "col-3"]);
    const tukey = runAnalysis(tukeySpec, content);
    if (!tukey.ok) throw new Error("run failed");
    expect(plainLanguageSummary(tukey)).toContain("Tukey");

    // Switching the family to Bonferroni must update the narrative too, not keep
    // saying Tukey while the comparisons table recomputes.
    const bonf = runAnalysis(
      { ...tukeySpec, params: { postHoc: "bonferroni" } },
      content,
    );
    if (!bonf.ok) throw new Error("run failed");
    const sentence = plainLanguageSummary(bonf);
    expect(sentence).toContain("Bonferroni");
    expect(sentence).not.toContain("Tukey");
  });

  it("names the higher group for a significant t-test", () => {
    const content = demoContent();
    const outcome = runAnalysis(
      spec("unpairedTTest", ["col-1", "col-2"]),
      content,
    );
    if (!outcome.ok) throw new Error("run failed");
    const sentence = plainLanguageSummary(outcome);
    // Control (mean 100) is higher than Drug A (mean ~80).
    expect(sentence).toContain("Control is higher than Drug A");
    expect(sentence).not.toContain("—");
  });

  it("formats p-values the methods-section way", () => {
    expect(formatP(0.00001)).toBe("p < 0.0001");
    expect(formatP(0.0005)).toBe("p < 0.001");
    expect(formatP(0.032)).toBe("p = 0.032");
  });
});

describe("show-code", () => {
  it("emits reproducible scipy ANOVA + Tukey code with the real values", () => {
    const content = demoContent();
    const outcome = runAnalysis(
      spec("oneWayAnova", ["col-1", "col-2", "col-3"]),
      content,
    );
    if (!outcome.ok) throw new Error("run failed");
    const code = showCode(outcome);
    expect(code).toMatchSnapshot();
    // The real values and the scipy call are present.
    expect(code).toContain("stats.f_oneway");
    expect(code).toContain("pairwise_tukeyhsd");
    expect(code).toContain("98, 102, 95, 105, 100, 99");
    expect(code).toContain('"Control"');
  });

  it("emits a Welch ttest_ind snippet for an unpaired t-test", () => {
    const content = demoContent();
    const outcome = runAnalysis(
      spec("unpairedTTest", ["col-1", "col-2"]),
      content,
    );
    if (!outcome.ok) throw new Error("run failed");
    const code = showCode(outcome);
    expect(code).toMatchSnapshot();
    expect(code).toContain("ttest_ind");
    expect(code).toContain("equal_var=False");
  });

  it("emits a ttest_rel snippet for a paired t-test", () => {
    const content = demoContent();
    const outcome = runAnalysis(
      spec("pairedTTest", ["col-1", "col-2"]),
      content,
    );
    if (!outcome.ok) throw new Error("run failed");
    const code = showCode(outcome);
    expect(code).toContain("ttest_rel");
  });

  it("emits a mannwhitneyu snippet for a Mann-Whitney U test", () => {
    const content = demoContent();
    const outcome = runAnalysis(spec("mannWhitneyU", ["col-1", "col-2"]), content);
    if (!outcome.ok) throw new Error("run failed");
    const code = showCode(outcome);
    expect(code).toContain("stats.mannwhitneyu");
    expect(code).toContain('alternative="two-sided"');
  });

  it("emits a wilcoxon snippet for a Wilcoxon signed-rank test", () => {
    const content = demoContent();
    const outcome = runAnalysis(
      spec("wilcoxonSignedRank", ["col-1", "col-2"]),
      content,
    );
    if (!outcome.ok) throw new Error("run failed");
    const code = showCode(outcome);
    expect(code).toContain("stats.wilcoxon");
  });

  it("emits a kruskal + dunn snippet for a Kruskal-Wallis test", () => {
    const content = demoContent();
    const outcome = runAnalysis(
      spec("kruskalWallis", ["col-1", "col-2", "col-3"]),
      content,
    );
    if (!outcome.ok) throw new Error("run failed");
    const code = showCode(outcome);
    expect(code).toContain("stats.kruskal");
    expect(code).toContain("posthoc_dunn");
    // A rank test has no parametric eta-squared, so the effect-size block is NOT
    // emitted for Kruskal-Wallis.
    expect(code).not.toContain("eta-squared");
  });

  it("emits the Cohen's d / Hedges' g effect size and bootstrap CI for an unpaired t-test", () => {
    const content = demoContent();
    const outcome = runAnalysis(
      spec("unpairedTTest", ["col-1", "col-2"]),
      content,
    );
    if (!outcome.ok) throw new Error("run failed");
    if (outcome.kind !== "ttest") throw new Error("not a ttest");
    const code = showCode(outcome);
    // E1: pingouin effect size, the unpaired (non-paired) form.
    expect(code).toContain("import pingouin as pg");
    expect(code).toContain("pg.compute_effsize");
    expect(code).toContain('eftype="cohen"');
    expect(code).not.toContain("paired=True");
    expect(code).toContain('eftype="hedges"');
    // E4: the parametric raw-data t-test carries a bootstrap CI, so its snippet
    // emits the scipy.stats.bootstrap reproduction of the mean-difference CI.
    expect(outcome.bootstrapCI95).not.toBeNull();
    expect(code).toContain("from scipy.stats import bootstrap");
    expect(code).toContain('method="BCa"');
    expect(code).toContain("n_resamples=2000");
  });

  it("emits the paired dz effect size for a paired t-test", () => {
    const content = demoContent();
    const outcome = runAnalysis(
      spec("pairedTTest", ["col-1", "col-2"]),
      content,
    );
    if (!outcome.ok) throw new Error("run failed");
    const code = showCode(outcome);
    expect(code).toContain("pg.compute_effsize");
    expect(code).toContain("paired=True");
  });

  it("does NOT emit a parametric effect size or bootstrap for the rank tests", () => {
    const content = demoContent();
    for (const t of ["mannWhitneyU", "wilcoxonSignedRank"] as const) {
      const outcome = runAnalysis(spec(t, ["col-1", "col-2"]), content);
      if (!outcome.ok) throw new Error("run failed");
      const code = showCode(outcome);
      expect(code).not.toContain("compute_effsize");
      expect(code).not.toContain("from scipy.stats import bootstrap");
    }
  });

  it("emits the eta-squared / omega-squared effect size for a one-way ANOVA", () => {
    const content = demoContent();
    const outcome = runAnalysis(
      spec("oneWayAnova", ["col-1", "col-2", "col-3"]),
      content,
    );
    if (!outcome.ok) throw new Error("run failed");
    const code = showCode(outcome);
    expect(code).toContain("eta2 = ss_between / ss_total");
    expect(code).toContain("omega2 =");
    expect(code).toContain('print(f"eta-squared');
  });

  it("emits the r-squared effect size for a Pearson correlation", () => {
    // Correlation runs on an XY table; build the normalized result directly so the
    // show-code string is unit-tested without an XY fixture. The r-squared print is
    // the E1 addition.
    const code = showCode({
      ok: true,
      kind: "correlation",
      type: "correlationPearson",
      method: "pearson",
      coefficientLabel: "r",
      xName: "Dose",
      yName: "Response",
      x: [1, 2, 3, 4, 5],
      y: [2.1, 3.9, 6.2, 7.8, 10.1],
      n: 5,
      coefficient: 0.999,
      statistic: 40,
      df: 3,
      pValue: 1e-5,
      ci95: [0.99, 0.9999],
      rSquared: 0.998,
      rSquaredCI95: [0.99, 0.9999],
    } as Parameters<typeof showCode>[0]);
    expect(code).toContain("stats.pearsonr");
    expect(code).toContain("r-squared = {r ** 2");
  });
});

describe("dose-response analysis (D1)", () => {
  const XMETA: DataHubDocument = {
    id: "dr",
    name: "Agonist dose-response",
    project_ids: [],
    folder_path: null,
    table_type: "xy",
    created_at: "2026-06-12T00:00:00.000Z",
  };
  // x = RAW dose (the analysis log10-transforms it before fitting). An 11-point
  // curve generated from a known 4PL on the log10(dose) grid [-9..-4] plus a
  // little wobble (Bottom~5, Top~98, logEC50~-6.4, Hill~0.93). The response array
  // is the engine's scipy-pinned reference, so the analysis-layer EC50 (in linear
  // dose units) matches after the internal log transform — this is the raw-dose
  // user path the engine's already-log reference test could not exercise.
  const LOG_DOSE = [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0];
  const XS = LOG_DOSE.map((lx) => 10 ** lx);
  const YS = [4.8, 6.1, 7.9, 12.5, 24.0, 47.0, 70.0, 86.0, 93.5, 96.8, 98.1];

  function drContent(): DataHubDocContent {
    return {
      meta: XMETA,
      columns: [
        { id: "x", name: "dose", role: "x" as const, dataType: "number" as const },
        { id: "y1", name: "Response", role: "y" as const, dataType: "number" as const },
      ],
      rows: XS.map((x, i) => ({ id: `r${i}`, cells: { x, y1: YS[i] } })),
      analyses: [],
      plots: [],
    };
  }

  function drSpec(model?: "logistic4pl" | "logistic5pl"): AnalysisSpec {
    return {
      id: "dr-spec",
      type: "doseResponse",
      params: model ? { model } : {},
      inputs: { columnIds: ["y1"] },
      resultCache: null,
      resultStale: false,
    };
  }

  it("is offered on an XY table alongside correlation and regression", () => {
    const types = validAnalysisTypes(drContent());
    expect(types).toContain("doseResponse");
    expect(types).toContain("linearRegression");
    expect(types).toContain("correlationPearson");
  });

  it("4PL reports EC50, Hill, Top, Bottom, R2 matching the scipy reference", () => {
    const out = runAnalysis(drSpec(), drContent());
    expect(out.ok).toBe(true);
    if (!out.ok || out.kind !== "doseResponse") throw new Error("expected DR");
    expect(out.model).toBe("logistic4pl");
    // EC50 ~ 4.04e-7 (scipy curve_fit reference), to 3 sig figs.
    expect(out.ec50).toBeGreaterThan(4.02e-7);
    expect(out.ec50).toBeLessThan(4.06e-7);
    // The CI is asymmetric in dose units and brackets the EC50.
    expect(out.ec50CI95[0]).toBeLessThan(out.ec50);
    expect(out.ec50CI95[1]).toBeGreaterThan(out.ec50);
    expect(out.ec50CI95[0]).toBeGreaterThan(3.82e-7);
    expect(out.ec50CI95[1]).toBeLessThan(4.28e-7);
    expect(out.hillSlope.value).toBeCloseTo(0.930926, 2);
    expect(out.top.value).toBeCloseTo(98.298557, 1);
    expect(out.bottom.value).toBeCloseTo(4.708439, 1);
    expect(out.rSquared).toBeGreaterThan(0.9998);
    expect(out.asymmetryS).toBeNull();
  });

  it("5PL fits the asymmetric model and reports the true half-max EC50", () => {
    const out = runAnalysis(drSpec("logistic5pl"), drContent());
    expect(out.ok).toBe(true);
    if (!out.ok || out.kind !== "doseResponse") throw new Error("expected DR");
    expect(out.model).toBe("logistic5pl");
    expect(out.asymmetryS).not.toBeNull();
    // Same underlying curve, so the half-max EC50 agrees with the 4PL (~4.06e-7).
    expect(out.ec50).toBeGreaterThan(3.9e-7);
    expect(out.ec50).toBeLessThan(4.3e-7);
    expect(out.rSquared).toBeGreaterThan(0.9998);
  });

  it("the plain-language verdict names the EC50 and Hill slope", () => {
    const out = runAnalysis(drSpec(), drContent());
    if (!out.ok) throw new Error("run failed");
    const sentence = plainLanguageSummary(out);
    expect(sentence).toContain("EC50");
    expect(sentence).toContain("Hill slope");
    expect(sentence).not.toContain("—");
  });

  it("show-the-code emits a runnable curve_fit with the EC50 readout", () => {
    const out = runAnalysis(drSpec(), drContent());
    if (!out.ok) throw new Error("run failed");
    const code = showCode(out);
    expect(code).toContain("from scipy.optimize import curve_fit");
    expect(code).toContain("def model_4pl");
    expect(code).toContain("ec50 = 10**logec50");
    expect(code).toContain("R-squared");
  });

  it("show-the-code emits the 5PL half-max correction for the asymmetric fit", () => {
    const out = runAnalysis(drSpec("logistic5pl"), drContent());
    if (!out.ok) throw new Error("run failed");
    const code = showCode(out);
    expect(code).toContain("def model_5pl");
    // The half-max shift is the defining 5PL correction (EC50 != 10^logEC50).
    expect(code).toContain("2**(1.0/s) - 1.0");
  });
});

describe("model comparison analysis (D2)", () => {
  const XMETA: DataHubDocument = {
    id: "mc",
    name: "Compare models",
    project_ids: [],
    folder_path: null,
    table_type: "xy",
    created_at: "2026-06-12T00:00:00.000Z",
  };
  // The SAME dose-response dataset the D1 + transparency pins use, as a RAW dose
  // column (the analysis log10-transforms it). Both models recover the identical
  // log grid internally, so the F and AICc match the scipy reference exactly.
  const LOG_DOSE = [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0];
  const XS = LOG_DOSE.map((lx) => 10 ** lx);
  const YS = [4.8, 6.1, 7.9, 12.5, 24.0, 47.0, 70.0, 86.0, 93.5, 96.8, 98.1];

  function mcContent(): DataHubDocContent {
    return {
      meta: XMETA,
      columns: [
        { id: "x", name: "dose", role: "x" as const, dataType: "number" as const },
        { id: "y1", name: "Response", role: "y" as const, dataType: "number" as const },
      ],
      rows: XS.map((x, i) => ({ id: `r${i}`, cells: { x, y1: YS[i] } })),
      analyses: [],
      plots: [],
    };
  }

  function mcSpec(
    modelA = "logistic4pl",
    modelB = "logistic5pl",
    nested = "yes",
  ): AnalysisSpec {
    return {
      id: "mc-spec",
      type: "modelComparison",
      params: { modelA, modelB, nested },
      inputs: { columnIds: ["y1"] },
      resultCache: null,
      resultStale: false,
    };
  }

  it("is offered on an XY table", () => {
    expect(validAnalysisTypes(mcContent())).toContain("modelComparison");
  });

  it("4PL vs 5PL F test and AICc match the scipy reference", () => {
    const out = runAnalysis(mcSpec(), mcContent());
    expect(out.ok).toBe(true);
    if (!out.ok || out.kind !== "modelComparison") throw new Error("expected MC");
    // The simpler model is ordered first regardless of pick order.
    expect(out.simpler.id).toBe("logistic4pl");
    expect(out.complex.id).toBe("logistic5pl");
    // Extra-sum-of-squares F ~ 2.49, df (1, 6), p ~ 0.166 (scipy reference).
    expect(out.fTest).not.toBeNull();
    expect(out.fTest!.f).toBeCloseTo(2.4887, 1);
    expect(out.fTest!.dfNumerator).toBe(1);
    expect(out.fTest!.dfDenominator).toBe(6);
    expect(out.fTest!.pValue).toBeCloseTo(0.16574, 2);
    // p > 0.05, so the F test keeps the simpler 4PL.
    expect(out.fTest!.preferredId).toBe("logistic4pl");
    // AICc: 4PL ~ 2.62, 5PL ~ 9.80 (scipy reference); 4PL preferred.
    expect(out.simpler.aicc).toBeCloseTo(2.6188, 1);
    expect(out.complex.aicc).toBeCloseTo(9.8020, 1);
    expect(out.aicc.preferredId).toBe("logistic4pl");
    // Akaike weights sum to 1 and favor the 4PL.
    expect(out.simpler.aiccProbability + out.complex.aiccProbability).toBeCloseTo(1, 6);
    expect(out.simpler.aiccProbability).toBeGreaterThan(out.complex.aiccProbability);
    expect(out.simpler.aiccDelta).toBe(0);
  });

  it("pick order does not change which model is the baseline", () => {
    const swapped = runAnalysis(mcSpec("logistic5pl", "logistic4pl"), mcContent());
    if (!swapped.ok || swapped.kind !== "modelComparison") throw new Error("MC");
    expect(swapped.simpler.id).toBe("logistic4pl");
    expect(swapped.complex.id).toBe("logistic5pl");
  });

  it("a not-nested pair reports AICc only, no F test", () => {
    const out = runAnalysis(mcSpec("logistic4pl", "logistic5pl", "no"), mcContent());
    if (!out.ok || out.kind !== "modelComparison") throw new Error("MC");
    expect(out.nested).toBe(false);
    expect(out.fTest).toBeNull();
    // AICc still produces a verdict.
    expect(out.aicc.preferredId).toBe("logistic4pl");
    expect(plainLanguageSummary(out)).toContain("not nested");
  });

  it("rejects comparing a model with itself", () => {
    const out = runAnalysis(mcSpec("logistic4pl", "logistic4pl"), mcContent());
    expect(out.ok).toBe(false);
  });

  it("plain-language verdict names the preferred model", () => {
    const out = runAnalysis(mcSpec(), mcContent());
    if (!out.ok) throw new Error("run failed");
    const sentence = plainLanguageSummary(out);
    expect(sentence).toContain("AICc");
    expect(sentence).not.toContain("—");
  });

  it("show-the-code emits curve_fit for both models plus F and AICc", () => {
    const out = runAnalysis(mcSpec(), mcContent());
    if (!out.ok) throw new Error("run failed");
    const code = showCode(out);
    expect(code).toContain("from scipy.optimize import curve_fit");
    expect(code).toContain("def model_logistic4pl");
    expect(code).toContain("def model_logistic5pl");
    expect(code).toContain("stats.f.sf");
    expect(code).toContain("def aicc");
  });
});

describe("multiple linear regression analysis (D5)", () => {
  // A Column table with one Y column and two predictor columns. Same fixed arrays
  // the engine + transparency pins use, so the run-layer result matches statsmodels.
  const MLR_X1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const MLR_X2 = [2, 5, 3, 8, 4, 9, 6, 11, 7, 13, 10, 14];
  const MLR_Y = [4.1, 7.8, 8.9, 13.2, 13.0, 18.7, 18.2, 24.1, 22.0, 28.9, 27.1, 32.0];

  function mlrContent(): DataHubDocContent {
    const cols = [
      { id: "y", name: "Yield" },
      { id: "x1", name: "Temp" },
      { id: "x2", name: "Time" },
    ];
    const series: Record<string, number[]> = { y: MLR_Y, x1: MLR_X1, x2: MLR_X2 };
    const rows = Array.from({ length: MLR_Y.length }, (_, r) => ({
      id: `row-${r + 1}`,
      cells: {
        y: series.y[r],
        x1: series.x1[r],
        x2: series.x2[r],
      } as Record<string, number>,
    }));
    return {
      meta: { ...META, table_type: "column" },
      columns: cols.map((c) => ({
        id: c.id,
        name: c.name,
        role: "y" as const,
        dataType: "number" as const,
      })),
      rows,
      analyses: [],
      plots: [],
    };
  }

  // inputs.columnIds = [Y, x1, x2].
  const mlrSpec = (): AnalysisSpec => spec("multipleRegression", ["y", "x1", "x2"]);

  it("offers multiple regression once the table has 3 or more columns", () => {
    expect(validAnalysisTypes(mlrContent())).toContain("multipleRegression");
  });

  it("fits OLS coefficients matching statsmodels", () => {
    const out = runAnalysis(mlrSpec(), mlrContent());
    if (!out.ok || out.kind !== "multipleRegression") throw new Error("run failed");
    expect(out.intercept.estimate).toBeCloseTo(1.0135, 3);
    expect(out.slopes[0].estimate).toBeCloseTo(1.7644, 3);
    expect(out.slopes[1].estimate).toBeCloseTo(0.7415, 3);
    expect(out.predictorNames).toEqual(["Temp", "Time"]);
    expect(out.n).toBe(12);
  });

  it("reports the overall fit and F test", () => {
    const out = runAnalysis(mlrSpec(), mlrContent());
    if (!out.ok || out.kind !== "multipleRegression") throw new Error("run failed");
    expect(out.rSquared).toBeCloseTo(0.9963, 4);
    expect(out.adjRSquared).toBeCloseTo(0.9954, 4);
    expect(out.fStatistic).toBeCloseTo(1201.8155, 2);
    expect(out.fDfNum).toBe(2);
    expect(out.fDfDen).toBe(9);
  });

  it("reports the per-predictor VIF", () => {
    const out = runAnalysis(mlrSpec(), mlrContent());
    if (!out.ok || out.kind !== "multipleRegression") throw new Error("run failed");
    expect(out.slopes[0].vif).toBeCloseTo(3.5424, 3);
  });

  it("fails clearly with fewer than 2 predictors", () => {
    const out = runAnalysis(spec("multipleRegression", ["y", "x1"]), mlrContent());
    expect(out.ok).toBe(false);
  });

  it("plain-language verdict names the fit without forbidden punctuation", () => {
    const out = runAnalysis(mlrSpec(), mlrContent());
    if (!out.ok) throw new Error("run failed");
    const sentence = plainLanguageSummary(out);
    expect(sentence).toContain("R-squared");
    expect(sentence).not.toContain("—");
  });

  it("show-the-code emits statsmodels OLS plus VIF", () => {
    const out = runAnalysis(mlrSpec(), mlrContent());
    if (!out.ok) throw new Error("run failed");
    const code = showCode(out);
    expect(code).toContain("sm.OLS");
    expect(code).toContain("add_constant");
    expect(code).toContain("variance_inflation_factor");
  });
});
