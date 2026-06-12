import { describe, expect, it } from "vitest";

import type {
  AnalysisSpec,
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import { runAnalysis } from "@/lib/datahub/run-analysis";
import { resultToText } from "@/lib/datahub/result-text";

/**
 * The results-toolbar Export copies the visible result tables as tab-separated
 * text. These pins check the text matches the screen's structure: an ANOVA emits
 * the SS/df/MS/F/p header plus a Tukey comparisons block, and a t-test emits its
 * key/value rows. We do NOT re-check the engine numbers (the analyses suite
 * already validates those against scipy), only the serialization shape.
 */

const META: DataHubDocument = {
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

function content(cols: { id: string; name: string; series: number[] }[]): DataHubDocContent {
  const rows = Array.from({ length: 6 }, (_, r) => ({
    id: `row-${r + 1}`,
    cells: Object.fromEntries(cols.map((c) => [c.id, c.series[r]])) as Record<
      string,
      number
    >,
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
  return { id: `a-${type}`, type, params: {}, inputs: { columnIds }, resultCache: null, resultStale: false };
}

describe("resultToText", () => {
  it("serializes a one-way ANOVA as an SS/df/MS/F/p table plus comparisons", () => {
    const c = content([
      { id: "col-1", name: "Control", series: CONTROL },
      { id: "col-2", name: "Drug A", series: DRUG_A },
      { id: "col-3", name: "Drug B", series: DRUG_B },
    ]);
    const outcome = runAnalysis(spec("oneWayAnova", ["col-1", "col-2", "col-3"]), c);
    if (!outcome.ok) throw new Error(outcome.error);
    const text = resultToText(outcome);

    expect(text).toContain("Source\tSS\tdf\tMS\tF\tp");
    expect(text).toContain("Comparison\tMean diff\tAdj. p");
    // The Tukey block names the resolved groups.
    expect(text).toContain("Control vs Drug A");
    // Tab-separated, not comma-separated.
    expect(text).not.toContain("Source,SS");
  });

  it("serializes a t-test as key/value rows with the test name and p", () => {
    const c = content([
      { id: "col-1", name: "Control", series: CONTROL },
      { id: "col-2", name: "Drug A", series: DRUG_A },
    ]);
    const outcome = runAnalysis(spec("unpairedTTest", ["col-1", "col-2"]), c);
    if (!outcome.ok) throw new Error(outcome.error);
    const text = resultToText(outcome);

    expect(text).toContain("Test\t");
    expect(text).toMatch(/\np\t/);
    expect(text).toContain("Difference of means\t");
  });
});
