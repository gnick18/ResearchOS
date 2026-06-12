import { describe, it, expect } from "vitest";

import type {
  AnalysisSpec,
  DataHubDocContent,
  DataHubDocument,
  RowRecord,
} from "@/lib/datahub/model/types";
import {
  runAnalysis,
  validAnalysisTypes,
  type NormalizedSurvival,
} from "@/lib/datahub/run-analysis";
import {
  layoutSurvivalCurve,
  renderSurvivalCurveSvg,
  defaultPlotStyle,
} from "@/lib/datahub/plot-spec";

const META: DataHubDocument = {
  id: "1",
  name: "Leukemia",
  project_ids: [],
  folder_path: null,
  table_type: "survival",
  created_at: "2026-06-10T00:00:00.000Z",
};

// The R survival::aml dataset entered through the Survival table (two arms).
const AML: Array<[number, number, string]> = [
  [9, 1, "Maintained"], [13, 1, "Maintained"], [13, 0, "Maintained"],
  [18, 1, "Maintained"], [23, 1, "Maintained"], [28, 0, "Maintained"],
  [31, 1, "Maintained"], [34, 1, "Maintained"], [45, 0, "Maintained"],
  [48, 1, "Maintained"], [161, 0, "Maintained"],
  [5, 1, "Nonmaintained"], [5, 1, "Nonmaintained"], [8, 1, "Nonmaintained"],
  [8, 1, "Nonmaintained"], [12, 1, "Nonmaintained"], [16, 0, "Nonmaintained"],
  [23, 1, "Nonmaintained"], [27, 1, "Nonmaintained"], [30, 1, "Nonmaintained"],
  [33, 1, "Nonmaintained"], [43, 1, "Nonmaintained"], [45, 1, "Nonmaintained"],
];

function amlContent(): DataHubDocContent {
  const columns = [
    { id: "time", name: "Time", role: "x" as const, dataType: "number" as const },
    { id: "event", name: "Event", role: "y" as const, dataType: "number" as const },
    { id: "group", name: "Group", role: "group" as const, dataType: "text" as const },
  ];
  const rows: RowRecord[] = AML.map(([time, event, group], i) => ({
    id: `r${i + 1}`,
    cells: { time, event, group },
  }));
  return { meta: META, columns, rows, analyses: [], plots: [] };
}

function spec(): AnalysisSpec {
  return {
    id: "a1",
    type: "kaplanMeier",
    params: {},
    inputs: {},
    resultCache: null,
    resultStale: false,
  };
}

describe("run-analysis: survival valid types", () => {
  it("offers survival analysis once a Survival table has data", () => {
    expect(validAnalysisTypes(amlContent())).toEqual([
      "kaplanMeier",
      "coxRegression",
    ]);
  });
});

describe("run-analysis: Kaplan-Meier + log-rank through the survival pipe", () => {
  const out = runAnalysis(spec(), amlContent());

  it("reproduces the per-arm medians (R survfit: 31 and 23)", () => {
    if (!out.ok || out.kind !== "survival") throw new Error("expected survival");
    const r = out as NormalizedSurvival & { ok: true };
    const maint = r.groups.find((g) => g.name === "Maintained")!;
    const non = r.groups.find((g) => g.name === "Nonmaintained")!;
    expect(maint.median).toBe(31);
    expect(non.median).toBe(23);
    expect(maint.events).toBe(7);
    expect(non.events).toBe(11);
  });

  it("reproduces the log-rank statistic (R survdiff: chi2 3.4, p 0.0653)", () => {
    if (!out.ok || out.kind !== "survival") throw new Error("expected survival");
    expect(out.logRank).not.toBeNull();
    expect(out.logRank!.df).toBe(1);
    expect(out.logRank!.chiSquare).toBeCloseTo(3.396, 2);
    expect(out.logRank!.pValue).toBeCloseTo(0.0653, 3);
  });
});

describe("plot-spec: survival curve", () => {
  it("lays out one step curve per group starting at survival 1", () => {
    const content = amlContent();
    const style = { ...defaultPlotStyle(), kind: "survivalCurve" as const };
    const geo = layoutSurvivalCurve(content, style);
    expect(geo.curves).toHaveLength(2);
    for (const c of geo.curves) {
      // First point is at time 0, survival 1 (top of the y range).
      expect(c.path[0].y).toBeCloseTo(geo.y1, 6);
      expect(c.path.length).toBeGreaterThan(2);
    }
    const svg = renderSurvivalCurveSvg(geo, style);
    expect(svg.startsWith("<" + "svg")).toBe(true);
    expect(svg).toContain("<path");
  });
});
