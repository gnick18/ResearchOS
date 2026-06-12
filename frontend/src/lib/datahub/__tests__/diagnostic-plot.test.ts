// diagnostic-plot.test.ts
//
// Pins the Theme 4 diagnostic plots. The rigor here is on the COMPUTED POSITIONS,
// not the pixels: a QQ plot's theoretical normal quantiles and its reference line
// must equal the scipy.stats.probplot reference (pinned in datahub-stats.ts); a
// residual plot's residuals must equal the statsmodels OLS residuals; and the ROC
// visual must CONSUME the validated rocCurve analysis points (never recompute).
// We also assert each kind serializes to a valid SVG string without throwing, and
// that a diagnostic figure round-trips through the stored spec byte-identically.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import type {
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import {
  buildPlotSpec,
  readPlotStyle,
  renderPlot,
  defaultPlotStyle,
} from "@/lib/datahub/plot-spec";
import {
  qqPositions,
  residualPositions,
  rocCurveData,
  resolveQQSample,
  layoutQQPlot,
  layoutResidualPlot,
  layoutRocCurve,
  renderDiagnosticSvg,
  isDiagnosticKind,
} from "@/lib/datahub/diagnostic-plot";
import {
  GROUP_A,
  XY_X,
  XY_Y,
  STAT_PINS,
} from "@/lib/transparency/datasets/datahub-stats";
import { linearRegression } from "@/lib/datahub/engine";

const META: DataHubDocument = {
  id: "tbl-diag",
  name: "Diagnostics",
  project_ids: [],
  folder_path: null,
  table_type: "column",
  created_at: "2026-06-12T00:00:00.000Z",
};

/** A one-group Column table holding GROUP_A (the fixed QQ-plot sample). */
function groupAContent(): DataHubDocContent {
  return {
    meta: META,
    columns: [{ id: "col-1", name: "GROUP_A", role: "y", dataType: "number" }],
    rows: GROUP_A.map((v, i) => ({ id: `r${i}`, cells: { "col-1": v } })),
    analyses: [],
    plots: [],
  };
}

/** The stored linear-regression analysis on XY_X / XY_Y (a result cache). */
function regressionAnalysis() {
  const reg = linearRegression(XY_X, XY_Y);
  if (!reg.ok) throw new Error("fixture regression failed");
  return {
    id: "an-reg",
    title: "Linear regression",
    type: "linearRegression",
    inputs: {},
    params: {},
    resultStale: false,
    resultCache: {
      ok: true,
      kind: "regression" as const,
      type: "linearRegression" as const,
      xName: "X",
      yName: "Y",
      x: XY_X,
      y: XY_Y,
      n: reg.n,
      slope: reg.slope,
      intercept: reg.intercept,
      rSquared: reg.rSquared,
      slopeSE: reg.slopeSE,
      interceptSE: reg.interceptSE,
      slopeCI95: reg.slopeCI95,
      interceptCI95: reg.interceptCI95,
      residualSE: reg.residualSE,
    },
  };
}

/** A stored ROC analysis with a small validated curve (points from (0,0)..(1,1)). */
function rocAnalysis() {
  return {
    id: "an-roc",
    title: "ROC curve",
    type: "rocCurve",
    inputs: {},
    params: {},
    resultStale: false,
    resultCache: {
      ok: true,
      kind: "rocCurve" as const,
      type: "rocCurve" as const,
      xName: "score",
      yName: "label",
      x: [],
      y: [],
      n: 4,
      nPositive: 2,
      nNegative: 2,
      auc: 0.75,
      aucStandardError: 0.1,
      aucCiLow: 0.5,
      aucCiHigh: 0.95,
      youdenThreshold: 0.5,
      youdenSensitivity: 1.0,
      youdenSpecificity: 0.5,
      points: [
        { threshold: Infinity, fpr: 0, tpr: 0 },
        { threshold: 0.8, fpr: 0, tpr: 0.5 },
        { threshold: 0.5, fpr: 0.5, tpr: 1 },
        { threshold: 0.2, fpr: 1, tpr: 1 },
      ],
    },
  };
}

/** Look up a pinned reference value by id (the scipy / statsmodels oracle value). */
function pin(id: string): number {
  const p = STAT_PINS.find((x) => x.id === id);
  if (!p) throw new Error(`no pin ${id}`);
  return p.reference;
}

describe("isDiagnosticKind", () => {
  it("recognizes the three diagnostic kinds and rejects others", () => {
    expect(isDiagnosticKind("qqPlot")).toBe(true);
    expect(isDiagnosticKind("residualPlot")).toBe(true);
    expect(isDiagnosticKind("rocCurve")).toBe(true);
    expect(isDiagnosticKind("columnScatter")).toBe(false);
    expect(isDiagnosticKind("estimationGardnerAltman")).toBe(false);
  });
});

describe("qqPositions against scipy.stats.probplot", () => {
  const data = qqPositions(GROUP_A, "GROUP_A");

  it("computes the theoretical normal quantiles at the midpoint positions", () => {
    const first = data.points[0].theoretical;
    const last = data.points[data.points.length - 1].theoretical;
    expect(first).toBeCloseTo(pin("qq_theoretical_first"), 4);
    expect(last).toBeCloseTo(pin("qq_theoretical_last"), 4);
  });

  it("computes the least-squares reference line (slope, intercept)", () => {
    expect(data.lineSlope).toBeCloseTo(pin("qq_line_slope"), 4);
    expect(data.lineIntercept).toBeCloseTo(pin("qq_line_intercept"), 4);
  });

  it("orders the sample so the first / last points are the extremes", () => {
    expect(data.points[0].ordered).toBeCloseTo(Math.min(...GROUP_A), 6);
    expect(data.points[data.points.length - 1].ordered).toBeCloseTo(
      Math.max(...GROUP_A),
      6,
    );
  });
});

describe("residualPositions against statsmodels OLS", () => {
  const data = residualPositions(regressionAnalysis());

  it("recomputes the residuals from the regression coefficients", () => {
    expect(data).not.toBeNull();
    const resid = data!.points.map((p) => p.residual);
    const ss = resid.reduce((a, r) => a + r * r, 0);
    expect(ss).toBeCloseTo(pin("residual_ss"), 4);
    expect(resid[0]).toBeCloseTo(pin("residual_first"), 4);
    expect(resid[resid.length - 1]).toBeCloseTo(pin("residual_last"), 4);
  });

  it("returns null for a non-regression analysis", () => {
    expect(residualPositions(rocAnalysis())).toBeNull();
    expect(residualPositions(null)).toBeNull();
  });
});

describe("rocCurveData consumes the validated analysis", () => {
  it("reads the points + AUC straight off the rocCurve result", () => {
    const data = rocCurveData(rocAnalysis());
    expect(data).not.toBeNull();
    expect(data!.auc).toBe(0.75);
    expect(data!.points[0]).toEqual({ fpr: 0, tpr: 0 });
    expect(data!.points[data!.points.length - 1]).toEqual({ fpr: 1, tpr: 1 });
    // The Youden cut point is read from sensitivity / specificity.
    expect(data!.youden).toEqual({ fpr: 0.5, tpr: 1 });
  });

  it("returns null for a non-ROC analysis", () => {
    expect(rocCurveData(regressionAnalysis())).toBeNull();
    expect(rocCurveData(null)).toBeNull();
  });
});

describe("resolveQQSample prefers regression residuals over a table group", () => {
  it("uses residuals when a regression is linked", () => {
    const sample = resolveQQSample(
      groupAContent(),
      defaultPlotStyle(),
      regressionAnalysis(),
    );
    expect(sample?.name).toBe("Residuals");
    expect(sample?.values.length).toBe(XY_X.length);
  });

  it("falls back to the chosen table group when no regression is linked", () => {
    const sample = resolveQQSample(groupAContent(), defaultPlotStyle(), null);
    expect(sample?.name).toBe("GROUP_A");
    expect(sample?.values.length).toBe(GROUP_A.length);
  });
});

describe("layout + SVG serialization (render smoke tests)", () => {
  const style = defaultPlotStyle();

  it("lays out and renders a QQ plot without throwing", () => {
    const geo = layoutQQPlot(groupAContent(), { ...style, kind: "qqPlot" }, null);
    expect(geo.kind).toBe("qqPlot");
    expect(geo.points.length).toBe(GROUP_A.length);
    expect(geo.refLine).not.toBeNull();
    const svg = renderDiagnosticSvg(geo, style);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    // One circle per point plus the framing.
    expect((svg.match(/<circle/g) ?? []).length).toBe(GROUP_A.length);
  });

  it("lays out and renders a residual plot with a zero line", () => {
    const geo = layoutResidualPlot(
      groupAContent(),
      { ...style, kind: "residualPlot" },
      regressionAnalysis(),
    );
    expect(geo.kind).toBe("residualPlot");
    expect(geo.points.length).toBe(XY_X.length);
    expect(geo.refLine).not.toBeNull();
    const svg = renderDiagnosticSvg(geo, style);
    expect(svg).toContain("stroke-dasharray");
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("lays out and renders the ROC curve as a connected path", () => {
    const geo = layoutRocCurve({ ...style, kind: "rocCurve" }, rocAnalysis());
    expect(geo.kind).toBe("rocCurve");
    expect(geo.note).toContain("AUC");
    expect(geo.youdenPoint).not.toBeNull();
    const svg = renderDiagnosticSvg(geo, style);
    expect(svg).toContain("<path");
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("renders a framed empty message when nothing is linked", () => {
    const geo = layoutResidualPlot(
      groupAContent(),
      { ...style, kind: "residualPlot" },
      null,
    );
    expect(geo.emptyMessage).not.toBeNull();
    const svg = renderDiagnosticSvg(geo, style);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect((svg.match(/<circle/g) ?? []).length).toBe(0);
  });
});

describe("diagnostic figures round-trip through the stored spec", () => {
  it("builds, reads back, and renders each kind via renderPlot", () => {
    const content = groupAContent();
    for (const kind of ["qqPlot", "residualPlot", "rocCurve"] as const) {
      const spec = buildPlotSpec({
        id: `plot-${kind}`,
        kind,
        tableId: META.id,
        analysisId: kind === "qqPlot" ? null : "an-x",
        diagnosticColumnIndex: 0,
      });
      const style = readPlotStyle(spec);
      expect(style.kind).toBe(kind);
      expect(style.diagnosticColumnIndex).toBe(0);
      // renderPlot dispatches the diagnostic path; with no linked analysis the
      // residual / ROC kinds draw their framed empty state (still a valid SVG).
      const analysis =
        kind === "residualPlot"
          ? regressionAnalysis()
          : kind === "rocCurve"
            ? rocAnalysis()
            : null;
      const { svg } = renderPlot(spec, content, analysis as never);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
    }
  });

  it("leaves the diagnosticColumnIndex absent on a non-diagnostic spec read", () => {
    // A column figure default still carries the field default (0), proving the
    // back-compat read-back never throws on an absent value.
    const spec = buildPlotSpec({
      id: "plot-col",
      kind: "columnScatter",
      tableId: META.id,
    });
    expect(readPlotStyle(spec).diagnosticColumnIndex).toBe(0);
  });
});
