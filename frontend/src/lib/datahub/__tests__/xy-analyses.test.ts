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
      "logisticRegression",
      "rocCurve",
      "doseResponse",
      "modelComparison",
    ]);
  });
});

describe("run-analysis: simple logistic regression through the XY pipe", () => {
  // Moderate-overlap binary dataset, pinned against statsmodels in the engine
  // test. Here we confirm the run-analysis path resolves names and normalizes.
  const LX = [
    0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5,
    8.0, 8.5, 9.0, 9.5, 10.0,
  ];
  const LY = [0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1];

  it("reports the slope, odds ratio, X at P=0.5, and McFadden pseudo-R2", () => {
    const out = runAnalysis(spec("logisticRegression"), xyContent(LX, LY));
    if (!out.ok || out.kind !== "logisticRegression") {
      throw new Error("expected logisticRegression");
    }
    expect(out.slope.estimate).toBeCloseTo(0.5529, 3);
    expect(out.intercept.estimate).toBeCloseTo(-2.271, 3);
    expect(out.oddsRatio).toBeCloseTo(1.7383, 3);
    expect(out.xAtHalf).toBeCloseTo(4.1074, 3);
    expect(out.mcFaddenR2).toBeCloseTo(0.2896, 4);
    expect(out.xName).toBe("Dose");
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

describe("run-analysis: global (shared-parameter) fit through the XY pipe", () => {
  // A two-Y XY table: one shared RAW-dose X column (the analysis log10-transforms
  // it internally — dose-response fits on log10 dose), two response columns that
  // share Bottom/Top/Hill and differ only in EC50. Pinned against the same scipy
  // least_squares reference the engine + transparency gate use; the raw grid is
  // 10^[-9 .. -4], so the recovered log doses — and thus the fit — are identical
  // to feeding the logs directly (this is exactly the raw-dose user path).
  const LOG_DOSE = [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0];
  const GX = LOG_DOSE.map((lx) => 10 ** lx);
  const GYA = [0.9, 2.9, 8.6, 23.0, 50.4, 75.9, 90.8, 96.9, 99.1, 99.6, 100.1];
  const GYB = [0.1, 0.4, 0.8, 2.9, 8.6, 23.4, 50.4, 75.9, 90.8, 96.9, 99.1];

  function multiYContent(): DataHubDocContent {
    const rows = GX.map((xv, i) => ({
      id: `row-${i + 1}`,
      cells: { x: xv, y1: GYA[i], y2: GYB[i] } as Record<
        string,
        number | string | null
      >,
    }));
    return {
      meta: META,
      columns: [
        { id: "x", name: "Dose", role: "x", dataType: "number" },
        { id: "y1", name: "Drug A", role: "y", dataType: "number" },
        { id: "y2", name: "Drug B", role: "y", dataType: "number" },
      ],
      rows,
      analyses: [],
      plots: [],
    };
  }

  function gfSpec(): AnalysisSpec {
    return {
      id: "g1",
      type: "globalFit",
      params: {},
      inputs: { columnIds: ["y1", "y2"] },
      resultCache: null,
      resultStale: false,
    };
  }

  it("offers globalFit only once the table has two or more Y columns", () => {
    expect(validAnalysisTypes(multiYContent())).toContain("globalFit");
    // A single-Y XY table does not offer it.
    expect(validAnalysisTypes(xyContent(GX, GYA))).not.toContain("globalFit");
  });

  it("shares Bottom/Top/Hill and reports a separate EC50 per curve", () => {
    const out = runAnalysis(gfSpec(), multiYContent());
    if (!out.ok || out.kind !== "globalFit") {
      throw new Error("expected globalFit");
    }
    expect(out.nDatasets).toBe(2);
    expect(out.nTotal).toBe(22);
    expect(out.nParams).toBe(5);
    // Three shared parameters, each a single value across both curves.
    const sharedNames = out.sharedParams.map((p) => p.name).sort();
    expect(sharedNames).toEqual(["Bottom", "HillSlope", "Top"]);
    const hill = out.sharedParams.find((p) => p.name === "HillSlope")!;
    expect(hill.value).toBeCloseTo(1.014554, 2);
    // One local EC50 per curve, the readout the analysis exists to compare.
    expect(out.localParams.length).toBe(2);
    const byName = Object.fromEntries(
      out.localParams.map((lp) => [lp.datasetLabel, lp.ec50]),
    );
    expect(byName["Drug A"]).toBeCloseTo(1.0050971e-7, 8);
    expect(byName["Drug B"]).toBeCloseTo(1.0001309e-6, 7);
    expect(out.rSquared).toBeCloseTo(0.9999619363, 6);
  });

  it("honors the share preset (Hill only keeps Top/Bottom local)", () => {
    const s = gfSpec();
    s.params = { model: "logistic4pl", share: "hill" };
    const out = runAnalysis(s, multiYContent());
    if (!out.ok || out.kind !== "globalFit") {
      throw new Error("expected globalFit");
    }
    // Only Hill is shared now; Top and Bottom become local (not in sharedParams).
    expect(out.sharedParams.map((p) => p.name)).toEqual(["HillSlope"]);
  });

  it("fails cleanly when the table has only one Y column", () => {
    const out = runAnalysis(gfSpec(), xyContent(GX, GYA));
    expect(out.ok).toBe(false);
  });
});

describe("run-analysis: single-curve dose-response on a raw dose column", () => {
  // The Drug A response fit on its own. X is a RAW dose column (10^[-9..-4]); the
  // analysis log10-transforms it before fitting, so EC50 = 10^logEC50 lands in
  // LINEAR dose units near 1e-7 M (the curve crosses 50% around the -7 log dose),
  // NOT the ~1e8 blow-up a missing transform produced (10^(rawDose half-max)).
  // This guards the raw-dose user path end to end — the gap the engine's own
  // (already-log) parity test could not see.
  const LOG_DOSE = [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0];
  const DOSE = LOG_DOSE.map((lx) => 10 ** lx);
  const RESP = [0.9, 2.9, 8.6, 23.0, 50.4, 75.9, 90.8, 96.9, 99.1, 99.6, 100.1];

  it("reports EC50 in linear dose units, not 10^(raw dose)", () => {
    const out = runAnalysis(spec("doseResponse"), xyContent(DOSE, RESP));
    if (!out.ok || out.kind !== "doseResponse") {
      throw new Error("expected doseResponse");
    }
    expect(out.n).toBe(11);
    expect(out.xName).toBe("Dose");
    // Half-max in linear dose units, ~1e-7 M, and unambiguously NOT the ~1e8
    // raw-dose failure mode.
    expect(out.ec50).toBeGreaterThan(3e-8);
    expect(out.ec50).toBeLessThan(3e-7);
    expect(out.ec50CI95[0]).toBeGreaterThan(0);
    expect(out.ec50CI95[1]).toBeLessThan(1);
    // Plateaus and fit quality match the clean sigmoid.
    expect(out.top.value).toBeGreaterThan(98);
    expect(out.top.value).toBeLessThan(102);
    expect(out.bottom.value).toBeGreaterThan(-2);
    expect(out.bottom.value).toBeLessThan(3);
    expect(out.rSquared).toBeGreaterThan(0.999);
  });
});
