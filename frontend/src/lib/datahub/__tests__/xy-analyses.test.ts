import { describe, it, expect } from "vitest";

import type {
  AnalysisSpec,
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import {
  runAnalysis,
  validAnalysisTypes,
  type NormalizedCorrelation,
  type NormalizedRegression,
} from "@/lib/datahub/run-analysis";

// These mirror the engine's own reference cases so the run-analysis WRAPPER is
// validated end to end against the same external values (scipy / NIST), not
// against eyeballed numbers. The engine math is pinned in its own suites; this
// confirms the DataHubDocContent -> runAnalysis -> normalized-result pipe
// reproduces them through an XY table.

const META: DataHubDocument = {
  id: "1",
  name: "Relationship",
  project_ids: [],
  folder_path: null,
  table_type: "xy",
  created_at: "2026-06-10T00:00:00.000Z",
};

function xyContent(x: number[], y: number[]): DataHubDocContent {
  const rows = x.map((xv, i) => ({
    id: `row-${i + 1}`,
    cells: { x: xv, y1: y[i] } as Record<string, number | string | null>,
  }));
  return {
    meta: META,
    columns: [
      { id: "x", name: "Dose", role: "x", dataType: "number" },
      { id: "y1", name: "Response", role: "y", dataType: "number" },
    ],
    rows,
    analyses: [],
    plots: [],
  };
}

function spec(type: string): AnalysisSpec {
  return {
    id: "a1",
    type,
    params: {},
    inputs: { columnIds: ["y1"] },
    resultCache: null,
    resultStale: false,
  };
}

// scipy.stats.pearsonr documented example.
const SX = [1, 2, 3, 4, 5, 6, 7];
const SY = [10, 9, 2.5, 6, 4, 3, 2];

describe("run-analysis: XY valid types", () => {
  it("offers correlation, regression, and dose-response once an XY table has X and Y", () => {
    const types = validAnalysisTypes(xyContent(SX, SY));
    expect(types).toEqual([
      "correlationPearson",
      "correlationSpearman",
      "linearRegression",
      "doseResponse",
      "modelComparison",
    ]);
  });
});

describe("run-analysis: Pearson through the XY pipe", () => {
  it("reproduces the scipy pearsonr example with resolved names", () => {
    const out = runAnalysis(spec("correlationPearson"), xyContent(SX, SY));
    if (!out.ok || out.kind !== "correlation") throw new Error("expected correlation");
    const r = out as NormalizedCorrelation & { ok: true };
    expect(r.method).toBe("pearson");
    expect(r.coefficientLabel).toBe("r");
    expect(r.xName).toBe("Dose");
    expect(r.yName).toBe("Response");
    expect(r.n).toBe(7);
    expect(r.coefficient).toBeCloseTo(-0.828503883588428, 9);
    expect(r.pValue).toBeCloseTo(0.021280260007523286, 6);
    // r-squared and its CI flow through the wrapper too (E1). scipy: r^2 =
    // 0.686418685121107; squaring the Fisher-z r CI [-0.9739, -0.2006] gives
    // r^2 CI [0.040242957412993385, 0.9485226114997691].
    expect(r.rSquared).toBeCloseTo(0.686418685121107, 9);
    expect(r.rSquaredCI95[0]).toBeCloseTo(0.040242957412993385, 6);
    expect(r.rSquaredCI95[1]).toBeCloseTo(0.9485226114997691, 6);
  });

  it("reproduces the hand-verified Spearman rho", () => {
    const out = runAnalysis(spec("correlationSpearman"), xyContent(SX, SY));
    if (!out.ok || out.kind !== "correlation") throw new Error("expected correlation");
    expect(out.method).toBe("spearman");
    expect(out.coefficientLabel).toBe("rho");
    expect(out.coefficient).toBeCloseTo(-0.7857142857142857, 10);
  });
});

// NIST StRD Norris certified linear regression.
const NORRIS: Array<[number, number]> = [
  [0.1, 0.2], [338.8, 337.4], [118.1, 118.2], [888.0, 884.6], [9.2, 10.1],
  [228.1, 226.5], [668.5, 666.3], [998.5, 996.3], [449.1, 448.6], [778.9, 777.0],
  [559.2, 558.2], [0.3, 0.4], [0.1, 0.6], [778.1, 775.5], [668.8, 666.9],
  [339.3, 338.0], [448.9, 447.5], [10.8, 11.6], [557.7, 556.0], [228.3, 228.1],
  [998.0, 995.8], [888.8, 887.6], [119.6, 120.2], [0.3, 0.3], [0.6, 0.3],
  [557.6, 556.8], [339.3, 339.1], [888.0, 887.2], [998.5, 999.0], [778.9, 779.0],
  [10.2, 11.1], [117.6, 118.3], [228.9, 229.2], [668.4, 669.1], [449.2, 448.9],
  [0.2, 0.5],
];

describe("run-analysis: linear regression through the XY pipe", () => {
  it("reproduces the NIST Norris certified slope, intercept, and R-squared", () => {
    const x = NORRIS.map((p) => p[1]);
    const y = NORRIS.map((p) => p[0]);
    const out = runAnalysis(spec("linearRegression"), xyContent(x, y));
    if (!out.ok || out.kind !== "regression") throw new Error("expected regression");
    const r = out as NormalizedRegression & { ok: true };
    expect(r.slope).toBeCloseTo(1.00211681802045, 8);
    expect(r.intercept).toBeCloseTo(-0.262323073774029, 6);
    expect(r.rSquared).toBeCloseTo(0.999993745883712, 9);
    expect(r.slopeSE).toBeCloseTo(0.000429796848199937, 8);
    expect(r.n).toBe(36);
  });
});

describe("run-analysis: XY failure modes", () => {
  it("reports a clear error when too few pairs to correlate", () => {
    const out = runAnalysis(spec("correlationPearson"), xyContent([1, 2], [3, 4]));
    expect(out.ok).toBe(false);
  });
});
