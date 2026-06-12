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
    expect(twoTypes).toEqual([
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
  });
});
