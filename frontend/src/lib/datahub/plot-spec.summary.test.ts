// Coverage for plotting a SUMMARY-format Column table (subcol UI chunk 3).
//
// A summary table has no raw replicates, so a figure draws each group's bar /
// mean from the ENTERED mean and its error bar from the ENTERED spread (the
// table stores SD or SEM; the figure shows whichever errorBar kind it picked,
// converted with the stored n). The per-replicate scatter has no points to draw.
// The replicates path is asserted unchanged by the same helpers.

import { describe, expect, it } from "vitest";

import {
  resolvePlotGroups,
  errorMagnitude,
  layoutPlot,
  defaultPlotStyle,
  type PlotStyle,
} from "./plot-spec";
import { buildSummaryColumnTable } from "./summary-table";
import type { DataHubDocContent } from "./model/types";

function summaryContent(
  format: "mean-sd-n" | "mean-sem-n",
): DataHubDocContent {
  const built = buildSummaryColumnTable(
    [
      { datasetId: "g1", name: "Control", mean: 5, spread: 0.8, n: 4 },
      { datasetId: "g2", name: "Treated", mean: 8, spread: 1.2, n: 4 },
    ],
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

function replicatesContent(): DataHubDocContent {
  return {
    meta: {
      id: "2",
      name: "Reps",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: "2026-06-11T00:00:00Z",
    },
    columns: [{ id: "col-1", name: "Control", role: "y", dataType: "number" }],
    rows: [
      { id: "row-1", cells: { "col-1": 2 } },
      { id: "row-2", cells: { "col-1": 4 } },
      { id: "row-3", cells: { "col-1": 6 } },
    ],
    analyses: [],
    plots: [],
  };
}

const STYLE: PlotStyle = defaultPlotStyle();

describe("resolvePlotGroups on a summary table", () => {
  it("reads the entered mean and derives both spreads with the stored n", () => {
    const groups = resolvePlotGroups(summaryContent("mean-sd-n"), STYLE);
    expect(groups.map((g) => g.name)).toEqual(["Control", "Treated"]);
    const g1 = groups[0];
    expect(g1.stats.mean).toBe(5);
    expect(g1.stats.n).toBe(4);
    // Stored SD = 0.8, n = 4 -> SEM = 0.8 / 2 = 0.4.
    expect(g1.stats.sd).toBeCloseTo(0.8, 12);
    expect(g1.stats.sem).toBeCloseTo(0.4, 12);
    // No raw replicates, so no scatter points are drawn.
    expect(g1.values).toEqual([]);
  });

  it("reads SEM as the stored spread and derives SD for a mean-sem-n table", () => {
    const groups = resolvePlotGroups(summaryContent("mean-sem-n"), STYLE);
    const g1 = groups[0];
    // Stored SEM = 0.8, n = 4 -> SD = 0.8 * 2 = 1.6.
    expect(g1.stats.sem).toBeCloseTo(0.8, 12);
    expect(g1.stats.sd).toBeCloseTo(1.6, 12);
  });

  it("draws the error bar from the entered spread, by errorBar kind", () => {
    const groups = resolvePlotGroups(summaryContent("mean-sd-n"), STYLE);
    const g1 = groups[0];
    // The figure can show either spread regardless of which the table stores.
    expect(errorMagnitude(g1.stats, "sd")).toBeCloseTo(0.8, 12);
    expect(errorMagnitude(g1.stats, "sem")).toBeCloseTo(0.4, 12);
    expect(errorMagnitude(g1.stats, "none")).toBeNull();
  });

  it("lays out the mean line + error bar but no scatter points", () => {
    const groups = resolvePlotGroups(summaryContent("mean-sd-n"), {
      ...STYLE,
      kind: "columnScatter",
      errorBar: "sd",
      showPoints: true,
    });
    const geo = layoutPlot(groups, { ...STYLE, kind: "columnScatter", errorBar: "sd" }, []);
    const g1 = geo.groups[0];
    expect(g1.meanY).not.toBeNull();
    expect(g1.errorBar).not.toBeNull();
    // showPoints is on, but a summary group has no raw values, so no dots.
    expect(g1.points).toEqual([]);
  });
});

describe("resolvePlotGroups on a replicates table (unchanged path)", () => {
  it("still reads engine stats and the raw values", () => {
    const groups = resolvePlotGroups(replicatesContent(), STYLE);
    const g1 = groups[0];
    // mean(2,4,6) = 4, raw values carried for the scatter.
    expect(g1.stats.mean).toBeCloseTo(4, 12);
    expect(g1.values).toEqual([2, 4, 6]);
  });
});
