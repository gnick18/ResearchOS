// Resolver dispatch tests for summary-format Column tables (subcol foundation).
//
// A Column table in a summary entry format runs the summary-compatible tests
// (unpaired t-test, one-way ANOVA omnibus) through the from-stats engine paths
// and guards the unsupported tests with a needs-raw message. These check the
// dispatch in runAnalysis end to end, plus validAnalysisTypes on a summary table.

import { describe, expect, it } from "vitest";

import {
  describe as engineDescribe,
  unpairedTTest,
  oneWayAnova,
} from "@/lib/datahub/engine";
import type {
  AnalysisSpec,
  DataHubDocContent,
} from "@/lib/datahub/model/types";
import { runAnalysis, validAnalysisTypes } from "@/lib/datahub/run-analysis";
import { buildSummaryColumnTable } from "@/lib/datahub/summary-table";

const GROUP_A = [5.1, 4.9, 5.6, 5.0, 5.3, 4.8];
const GROUP_B = [6.2, 5.9, 6.5, 6.0, 6.3];
const GROUP_C = [4.4, 4.7, 4.1, 4.9, 4.5, 4.3, 4.6];

function summ(values: number[]) {
  const d = engineDescribe(values);
  if (!d.ok) throw new Error("describe failed");
  return { mean: d.mean, sd: d.sd, sem: d.sem, n: d.n };
}

/** A summary Column table built from the SD summaries of the three raw groups. */
function summaryContent(
  format: "mean-sd-n" | "mean-sem-n" = "mean-sd-n",
  groups: number[][] = [GROUP_A, GROUP_B, GROUP_C],
): DataHubDocContent {
  const ids = ["gA", "gB", "gC"];
  const names = ["A", "B", "C"];
  const built = buildSummaryColumnTable(
    groups.map((g, i) => {
      const s = summ(g);
      return {
        datasetId: ids[i],
        name: names[i],
        mean: s.mean,
        spread: format === "mean-sem-n" ? s.sem : s.sd,
        n: s.n,
      };
    }),
    format,
  );
  return {
    meta: {
      id: "1",
      name: "Summary",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      entryFormat: format,
      created_at: "2026-06-11T00:00:00Z",
    },
    columns: built.columns,
    rows: built.rows,
    analyses: [],
    plots: [],
  };
}

function spec(type: string, columnIds: string[]): AnalysisSpec {
  return {
    id: "a1",
    type,
    params: {},
    inputs: { columnIds },
    resultCache: null,
    resultStale: false,
  };
}

describe("validAnalysisTypes on a summary Column table", () => {
  it("offers only the summary-compatible tests by group count", () => {
    const three = summaryContent("mean-sd-n");
    expect(validAnalysisTypes(three)).toEqual(["unpairedTTest", "oneWayAnova"]);

    const two = summaryContent("mean-sd-n", [GROUP_A, GROUP_B]);
    expect(validAnalysisTypes(two)).toEqual(["unpairedTTest"]);
  });
});

describe("runAnalysis dispatches summary tests through the from-stats engine", () => {
  it("unpaired t-test from a mean-sd-n table matches the raw t-test", () => {
    const content = summaryContent("mean-sd-n");
    const out = runAnalysis(spec("unpairedTTest", ["gA", "gB"]), content);
    const raw = unpairedTTest(GROUP_A, GROUP_B);
    if (!out.ok || out.kind !== "ttest" || !raw.ok) throw new Error("failed");
    expect(out.statistic).toBeCloseTo(raw.statistic, 9);
    expect(out.df).toBeCloseTo(raw.df, 6);
    expect(out.pValue).toBeCloseTo(raw.pValue, 9);
    expect(out.groups.map((g) => g.name)).toEqual(["A", "B"]);
  });

  it("unpaired t-test from a mean-sem-n table reconstructs the SD and matches", () => {
    const content = summaryContent("mean-sem-n");
    const out = runAnalysis(spec("unpairedTTest", ["gA", "gB"]), content);
    const raw = unpairedTTest(GROUP_A, GROUP_B);
    if (!out.ok || out.kind !== "ttest" || !raw.ok) throw new Error("failed");
    expect(out.statistic).toBeCloseTo(raw.statistic, 9);
    expect(out.pValue).toBeCloseTo(raw.pValue, 9);
  });

  it("one-way ANOVA omnibus from summary matches the raw ANOVA F and p", () => {
    const content = summaryContent("mean-sd-n");
    const out = runAnalysis(spec("oneWayAnova", ["gA", "gB", "gC"]), content);
    const raw = oneWayAnova({ A: GROUP_A, B: GROUP_B, C: GROUP_C });
    if (!out.ok || out.kind !== "anova" || !raw.ok) throw new Error("failed");
    expect(out.statistic).toBeCloseTo(raw.statistic, 6);
    expect(out.pValue).toBeCloseTo(raw.pValue, 9);
    // No post-hoc from summary stats.
    expect(out.comparisons).toHaveLength(0);
    expect(out.postHoc).toBe("none");
  });

  it("guards the unsupported tests on a summary table with a needs-raw error", () => {
    const content = summaryContent("mean-sd-n");
    for (const type of [
      "pairedTTest",
      "mannWhitneyU",
      "wilcoxonSignedRank",
      "kruskalWallis",
    ]) {
      const out = runAnalysis(spec(type, ["gA", "gB", "gC"]), content);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error).toMatch(/raw replicate/i);
    }
  });
});
