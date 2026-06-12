import { describe, expect, it } from "vitest";

import type {
  AnalysisSpec,
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import { runAnalysis } from "@/lib/datahub/run-analysis";
import type {
  NormalizedAnova,
  NormalizedTTest,
  NormalizedTwoWayAnova,
} from "@/lib/datahub/run-analysis";
import {
  coerceParam,
  defaultParams,
  hasEditableParams,
  paramSchema,
  readParams,
} from "@/lib/datahub/analysis-params";

/**
 * Change-analysis-parameters tests. Two invariants matter most. First, an empty
 * params bag reproduces the prior hardcoded behavior byte for byte (so every
 * pre-feature analysis is unaffected). Second, flipping a param changes the
 * engine call in the documented way (one-sided p is half the two-sided p for a
 * t-test, Student differs from Welch, a "none" post-hoc drops the comparisons).
 */

const COLUMN_META: DataHubDocument = {
  id: "demo",
  name: "Assay",
  project_ids: [],
  folder_path: null,
  table_type: "column",
  created_at: "2026-06-10T00:00:00.000Z",
};

const CONTROL = [98, 102, 95, 105, 100, 99];
const DRUG_A = [78, 82, 75, 80, 85, 79];
const DRUG_B = [55, 60, 52, 58, 50, 57];

function columnContent(): DataHubDocContent {
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
    meta: COLUMN_META,
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

function spec(
  type: string,
  columnIds: string[],
  params: Record<string, unknown> = {},
): AnalysisSpec {
  return {
    id: `a-${type}`,
    type,
    params,
    inputs: { columnIds },
    resultCache: null,
    resultStale: false,
  };
}

function runTTest(
  params: Record<string, unknown>,
  columnIds = ["col-1", "col-2"],
  type = "unpairedTTest",
): NormalizedTTest {
  const out = runAnalysis(spec(type, columnIds, params), columnContent());
  if (!out.ok || out.kind !== "ttest") throw new Error("expected a t-test");
  return out;
}

function runAnova(params: Record<string, unknown>): NormalizedAnova {
  const out = runAnalysis(
    spec("oneWayAnova", ["col-1", "col-2", "col-3"], params),
    columnContent(),
  );
  if (!out.ok || out.kind !== "anova") throw new Error("expected an anova");
  return out;
}

describe("analysis-params schema", () => {
  it("only exposes options the engine computes", () => {
    // The unpaired t exposes tail + variance; the others a tail where the
    // engine accepts one. Correlation and regression take no options.
    expect(paramSchema("unpairedTTest").map((f) => f.key)).toEqual([
      "tail",
      "variance",
    ]);
    expect(paramSchema("pairedTTest").map((f) => f.key)).toEqual(["tail"]);
    expect(paramSchema("mannWhitneyU").map((f) => f.key)).toEqual(["tail"]);
    expect(paramSchema("wilcoxonSignedRank").map((f) => f.key)).toEqual([
      "tail",
    ]);
    expect(paramSchema("oneWayAnova").map((f) => f.key)).toEqual(["postHoc"]);
    expect(paramSchema("twoWayAnova").map((f) => f.key)).toEqual([
      "postHocFactor",
    ]);
    // Correlation is two-sided only and regression reports a fixed 95% CI, so
    // neither exposes an editable parameter.
    expect(paramSchema("correlationPearson")).toEqual([]);
    expect(paramSchema("correlationSpearman")).toEqual([]);
    expect(paramSchema("linearRegression")).toEqual([]);
    expect(paramSchema("kruskalWallis")).toEqual([]);
    expect(hasEditableParams("unpairedTTest")).toBe(true);
    expect(hasEditableParams("linearRegression")).toBe(false);
  });

  it("defaultParams matches the prior hardcoded engine options", () => {
    expect(defaultParams("unpairedTTest")).toEqual({
      tail: "two-sided",
      variance: "welch",
    });
    expect(defaultParams("oneWayAnova")).toEqual({ postHoc: "tukey" });
    expect(defaultParams("twoWayAnova")).toEqual({ postHocFactor: "B" });
    expect(defaultParams("pairedTTest")).toEqual({ tail: "two-sided" });
  });

  it("readParams merges over defaults and rejects out-of-schema values", () => {
    // A valid stored value wins.
    expect(readParams(spec("unpairedTTest", [], { variance: "student" }))).toEqual(
      { tail: "two-sided", variance: "student" },
    );
    // A bogus value falls back to the default rather than reaching the engine.
    expect(readParams(spec("unpairedTTest", [], { tail: "sideways" }))).toEqual(
      { tail: "two-sided", variance: "welch" },
    );
    // An empty bag yields the full default bag.
    expect(readParams(spec("pairedTTest", []))).toEqual({ tail: "two-sided" });
  });

  it("coerceParam accepts allowed options and rejects the rest", () => {
    expect(coerceParam("unpairedTTest", "variance", "student")).toBe("student");
    expect(coerceParam("unpairedTTest", "variance", "nope")).toBeNull();
    expect(coerceParam("unpairedTTest", "missingKey", "x")).toBeNull();
    expect(coerceParam("linearRegression", "tail", "two-sided")).toBeNull();
  });
});

describe("run-analysis honors params", () => {
  it("empty params reproduce the default behavior exactly", () => {
    // Empty bag and the explicit default bag must produce identical results.
    const empty = runTTest({});
    const explicit = runTTest({ tail: "two-sided", variance: "welch" });
    expect(empty.pValue).toBe(explicit.pValue);
    expect(empty.statistic).toBe(explicit.statistic);
    expect(empty.df).toBe(explicit.df);
    // The default unpaired test is Welch (the prior hardcode).
    expect(empty.test).toBe("Welch's t-test");
    expect(empty.tail).toBe("two-sided");
    expect(empty.variance).toBe("welch");
  });

  it("a one-sided t-test halves the two-sided p", () => {
    const two = runTTest({ tail: "two-sided" });
    // Control > Drug A, so the "greater" tail (mean A above mean B) is the small
    // one. A symmetric t distribution gives one-sided p = two-sided p / 2.
    const greater = runTTest({ tail: "greater" });
    expect(greater.statistic).toBeCloseTo(two.statistic, 10);
    expect(greater.pValue).toBeCloseTo(two.pValue / 2, 10);
    // The opposite tail is 1 - (two-sided / 2).
    const less = runTTest({ tail: "less" });
    expect(less.pValue).toBeCloseTo(1 - two.pValue / 2, 10);
  });

  it("Student differs from Welch on the same data", () => {
    const welch = runTTest({ variance: "welch" });
    const student = runTTest({ variance: "student" });
    expect(student.test).toBe("Student's two-sample t-test");
    // The pooled vs Welch statistic differs, so the p-values differ even when
    // the equal-n df happens to coincide.
    expect(student.statistic).not.toBe(welch.statistic);
    expect(student.pValue).not.toBe(welch.pValue);
  });

  it("the tail flows into the paired and rank-based tests too", () => {
    const twoSided = runTTest({ tail: "two-sided" }, ["col-1", "col-2"], "pairedTTest");
    const oneSided = runTTest({ tail: "greater" }, ["col-1", "col-2"], "pairedTTest");
    expect(oneSided.pValue).toBeCloseTo(twoSided.pValue / 2, 10);
    expect(oneSided.tail).toBe("greater");
  });

  it("ANOVA post-hoc none drops the comparisons; tukey keeps them", () => {
    const tukey = runAnova({ postHoc: "tukey" });
    expect(tukey.postHoc).toBe("tukey");
    expect(tukey.comparisons.length).toBe(3); // 3 groups -> 3 pairs
    const none = runAnova({ postHoc: "none" });
    expect(none.postHoc).toBe("none");
    expect(none.comparisons).toEqual([]);
    // The omnibus F and p are unchanged by the post-hoc choice.
    expect(none.statistic).toBeCloseTo(tukey.statistic, 12);
    expect(none.pValue).toBeCloseTo(tukey.pValue, 12);
  });

  it("ANOVA post-hoc family changes the adjusted p-values", () => {
    const tukey = runAnova({ postHoc: "tukey" });
    const bonferroni = runAnova({ postHoc: "bonferroni" });
    expect(bonferroni.comparisons[0].method).toBe("Bonferroni");
    // Bonferroni and Tukey give different adjusted p-values for the same pair.
    expect(bonferroni.comparisons[0].pAdjusted).not.toBe(
      tukey.comparisons[0].pAdjusted,
    );
  });
});

describe("two-way ANOVA post-hoc factor", () => {
  const GROUPED_META: DataHubDocument = {
    ...COLUMN_META,
    name: "Two factor",
    table_type: "grouped",
  };

  // A balanced 2x2x3 grouped design (the engine's pinned reference shape),
  // enough for the interaction + error terms. Row factor (Stage) has 2 levels,
  // the group factor (Vehicle / Drug) also has 2, so each post-hoc factor has
  // exactly one pairwise comparison.
  function groupedContent(): DataHubDocContent {
    return {
      meta: GROUPED_META,
      columns: [
        { id: "rowlabel", name: "Stage", role: "x", dataType: "text" },
        { id: "blo-r1", name: "Vehicle", role: "y", dataType: "number", datasetId: "grp-1", subcolumnKind: "replicate" },
        { id: "blo-r2", name: "Vehicle", role: "y", dataType: "number", datasetId: "grp-1", subcolumnKind: "replicate" },
        { id: "blo-r3", name: "Vehicle", role: "y", dataType: "number", datasetId: "grp-1", subcolumnKind: "replicate" },
        { id: "bhi-r1", name: "Drug", role: "y", dataType: "number", datasetId: "grp-2", subcolumnKind: "replicate" },
        { id: "bhi-r2", name: "Drug", role: "y", dataType: "number", datasetId: "grp-2", subcolumnKind: "replicate" },
        { id: "bhi-r3", name: "Drug", role: "y", dataType: "number", datasetId: "grp-2", subcolumnKind: "replicate" },
      ],
      rows: [
        { id: "r1", cells: { rowlabel: "lo", "blo-r1": 9, "blo-r2": 10, "blo-r3": 11, "bhi-r1": 11, "bhi-r2": 12, "bhi-r3": 13 } },
        { id: "r2", cells: { rowlabel: "hi", "blo-r1": 14, "blo-r2": 15, "blo-r3": 16, "bhi-r1": 17, "bhi-r2": 18, "bhi-r3": 19 } },
      ],
      analyses: [],
      plots: [],
    };
  }

  function runTwoWay(params: Record<string, unknown>): NormalizedTwoWayAnova {
    const out = runAnalysis(spec("twoWayAnova", [], params), groupedContent());
    if (!out.ok || out.kind !== "twoWayAnova") {
      throw new Error("expected a two-way anova");
    }
    return out;
  }

  it("default factor B reproduces the prior hardcode; none drops comparisons", () => {
    const def = runTwoWay({});
    expect(def.postHocFactor).toBe("B");
    // Factor B has 2 levels -> 1 pairwise comparison.
    expect(def.comparisons.length).toBe(1);
    const none = runTwoWay({ postHocFactor: "none" });
    expect(none.postHocFactor).toBe("none");
    expect(none.comparisons).toEqual([]);
    // The ANOVA table (the headline F/p) is identical regardless of post-hoc.
    expect(none.fInteraction).toBeCloseTo(def.fInteraction, 12);
    expect(none.pInteraction).toBeCloseTo(def.pInteraction, 12);
  });
});
