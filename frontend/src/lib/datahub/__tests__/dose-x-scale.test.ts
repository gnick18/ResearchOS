import { describe, expect, it } from "vitest";

import {
  prepareFitData,
  fitModel,
  fitLog10sDose,
  xLooksLogDose,
} from "@/lib/datahub/engine";
import type {
  AnalysisSpec,
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import { runAnalysis } from "@/lib/datahub/run-analysis";
import { showCode } from "@/lib/datahub/show-code";

// A noise-free 4PL on the standard Prism log-dose grid. Bottom 0, Top 100,
// logEC50 -6 (EC50 = 1e-6 M), Hill 1. The points lie exactly on the curve, so a
// correct fit recovers EC50 = 1e-6 regardless of how X is presented.
const BOTTOM = 0;
const TOP = 100;
const LOG_EC50 = -6;
const HILL = 1;
const LOG_DOSE = [-9, -8, -7.5, -7, -6.5, -6, -5.5, -5, -4.5, -4, -3];
const CONC = LOG_DOSE.map((lx) => 10 ** lx); // raw concentration (all positive)
const RESPONSE = LOG_DOSE.map(
  (x) => BOTTOM + (TOP - BOTTOM) / (1 + 10 ** ((LOG_EC50 - x) * HILL)),
);

describe("xLooksLogDose heuristic", () => {
  it("flags a column with any strictly-negative value as already-log dose", () => {
    expect(xLooksLogDose(LOG_DOSE)).toBe(true);
    expect(xLooksLogDose([-9, -8.5, -8])).toBe(true);
    // A mixed log column straddling zero (e.g. -12 .. 2) still reads as log dose.
    expect(xLooksLogDose([-12, -6, 0, 2])).toBe(true);
  });

  it("reads an all-positive concentration column as raw", () => {
    expect(xLooksLogDose(CONC)).toBe(false);
    expect(xLooksLogDose([1e-9, 1e-6, 1e-3])).toBe(false);
  });

  it("treats a lone zero (vehicle control) as raw, not log", () => {
    // A zero-dose control is a legitimate raw concentration log10 simply drops;
    // it must NOT flip an otherwise-positive column to the log-dose branch.
    expect(xLooksLogDose([0, 1e-9, 1e-8, 1e-7])).toBe(false);
  });
});

describe("fitLog10sDose transform decision (single source of truth)", () => {
  it("log-transforms a raw concentration column for a log-dose model", () => {
    expect(fitLog10sDose("logistic4pl", CONC)).toBe(true);
    expect(fitLog10sDose("logistic5pl", CONC)).toBe(true);
  });

  it("does NOT transform an already-log column (auto)", () => {
    expect(fitLog10sDose("logistic4pl", LOG_DOSE)).toBe(false);
  });

  it("honors the explicit scale override either way", () => {
    // Force raw even on a negative column, and force log even on a positive one.
    expect(fitLog10sDose("logistic4pl", LOG_DOSE, "concentration")).toBe(true);
    expect(fitLog10sDose("logistic4pl", CONC, "logDose")).toBe(false);
  });

  it("never transforms a non-log model", () => {
    expect(fitLog10sDose("michaelis-menten", CONC)).toBe(false);
    expect(fitLog10sDose("linear", LOG_DOSE)).toBe(false);
  });
});

describe("prepareFitData", () => {
  it("raw concentration: log10-transforms and keeps every point", () => {
    const prep = prepareFitData("logistic4pl", CONC, RESPONSE);
    expect(prep.logTransformed).toBe(true);
    expect(prep.droppedNonPositive).toBe(0);
    expect(prep.x).toHaveLength(CONC.length);
    // The transformed x equals the log-dose grid the curve was generated on.
    prep.x.forEach((v, i) => expect(v).toBeCloseTo(LOG_DOSE[i], 9));
  });

  it("already-log dose: passes X through untouched (the bug fix)", () => {
    const prep = prepareFitData("logistic4pl", LOG_DOSE, RESPONSE);
    expect(prep.logTransformed).toBe(false);
    expect(prep.droppedNonPositive).toBe(0);
    expect(prep.x).toEqual(LOG_DOSE);
    expect(prep.y).toEqual(RESPONSE);
  });

  it("raw mode counts the non-positive points it drops", () => {
    // Two zero-dose controls + four real doses, forced raw.
    const x = [0, 0, 1e-9, 1e-8, 1e-7, 1e-6];
    const y = [1, 2, 3, 4, 5, 6];
    const prep = prepareFitData("logistic4pl", x, y, "concentration");
    expect(prep.logTransformed).toBe(true);
    expect(prep.droppedNonPositive).toBe(2);
    expect(prep.x).toHaveLength(4);
  });

  it("non-log model returns its pairs unchanged", () => {
    const prep = prepareFitData("michaelis-menten", CONC, RESPONSE);
    expect(prep.logTransformed).toBe(false);
    expect(prep.x).toBe(CONC);
    expect(prep.y).toBe(RESPONSE);
  });
});

describe("engine fit recovers the same EC50 from raw and log-dose X", () => {
  it("raw concentration X fits to EC50 = 1e-6 (existing contract)", () => {
    const prep = prepareFitData("logistic4pl", CONC, RESPONSE);
    const r = fitModel("logistic4pl", prep.x, prep.y);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.derived?.EC50).toBeCloseTo(1e-6, 9);
  });

  it("already-log dose X fits to the SAME EC50 instead of dropping all points", () => {
    const prep = prepareFitData("logistic4pl", LOG_DOSE, RESPONSE);
    // The pre-fix bug: every point had x <= 0 so all were dropped and the fit
    // failed. Now the column is kept and the fit recovers the generating curve.
    expect(prep.x.length).toBeGreaterThan(4);
    const r = fitModel("logistic4pl", prep.x, prep.y);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.derived?.EC50).toBeCloseTo(1e-6, 9);
  });
});

// ---------------------------------------------------------------------------
// Analysis layer: runAnalysis on a real XY table
// ---------------------------------------------------------------------------

const XMETA: DataHubDocument = {
  id: "dr-xscale",
  name: "Dose response (X scale)",
  project_ids: [],
  folder_path: null,
  table_type: "xy",
  created_at: "2026-06-15T00:00:00.000Z",
};

function drContent(xValues: number[], yColumns = 1): DataHubDocContent {
  const cols = [
    { id: "x", name: "dose", role: "x" as const, dataType: "number" as const },
    ...Array.from({ length: yColumns }, (_, i) => ({
      id: `y${i + 1}`,
      name: `Response ${i + 1}`,
      role: "y" as const,
      dataType: "number" as const,
    })),
  ];
  return {
    meta: XMETA,
    columns: cols,
    rows: xValues.map((x, i) => {
      const cells: Record<string, number> = { x };
      for (let c = 1; c <= yColumns; c++) cells[`y${c}`] = RESPONSE[i];
      return { id: `r${i}`, cells };
    }),
    analyses: [],
    plots: [],
  };
}

function drSpec(params: Record<string, string> = {}): AnalysisSpec {
  return {
    id: "dr-spec",
    type: "doseResponse",
    params,
    inputs: { columnIds: ["y1"] },
    resultCache: null,
    resultStale: false,
  };
}

describe("runAnalysis dose-response across X scales", () => {
  it("raw concentration column still fits (auto) and reports EC50 in dose units", () => {
    const out = runAnalysis(drSpec(), drContent(CONC));
    expect(out.ok).toBe(true);
    if (!out.ok || out.kind !== "doseResponse") throw new Error("expected DR");
    expect(out.ec50).toBeCloseTo(1e-6, 9);
  });

  it("already-log dose column auto-detects and fits to the SAME EC50", () => {
    const out = runAnalysis(drSpec(), drContent(LOG_DOSE));
    expect(out.ok).toBe(true);
    if (!out.ok || out.kind !== "doseResponse") throw new Error("expected DR");
    expect(out.ec50).toBeCloseTo(1e-6, 9);
  });

  it("explicit Log dose pick fits a log column even if it were all positive", () => {
    // Shift the log grid up so every value is > 0; auto would (wrongly) read it
    // as concentration, but the explicit pick forces the correct log-dose fit.
    const shifted = LOG_DOSE.map((v) => v + 10); // 1 .. 7, all positive
    const out = runAnalysis(drSpec({ xScale: "logDose" }), drContent(shifted));
    expect(out.ok).toBe(true);
    if (!out.ok || out.kind !== "doseResponse") throw new Error("expected DR");
    // logEC50 shifts with the data: fitting on x' = x + 10 moves logEC50 to -6 + 10.
    expect(out.logEC50).toBeCloseTo(LOG_EC50 + 10, 3);
  });

  it("forcing Concentration on a log column gives the actionable error, not a bare count", () => {
    const out = runAnalysis(
      drSpec({ xScale: "concentration" }),
      drContent(LOG_DOSE),
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected failure");
    expect(out.error).toContain("already log dose");
    expect(out.error).toContain("Log dose");
    expect(out.error).toContain(`${LOG_DOSE.length} of ${LOG_DOSE.length}`);
    // It must NOT be the cryptic engine default.
    expect(out.error).not.toMatch(/^Need more than/);
  });

  it("show-the-code log10-transforms a raw column but not an already-log column", () => {
    const rawOut = runAnalysis(drSpec(), drContent(CONC));
    if (!rawOut.ok) throw new Error("raw run failed");
    expect(showCode(rawOut)).toContain("x = np.log10(np.asarray(dose");

    const logOut = runAnalysis(drSpec(), drContent(LOG_DOSE));
    if (!logOut.ok) throw new Error("log run failed");
    const logCode = showCode(logOut);
    expect(logCode).toContain("X is already log10(dose)");
    expect(logCode).not.toContain("np.log10(np.asarray(dose");
  });
});

describe("runAnalysis global fit across X scales", () => {
  function gfSpec(params: Record<string, string> = {}): AnalysisSpec {
    return {
      id: "gf-spec",
      type: "globalFit",
      params,
      inputs: { columnIds: ["y1", "y2"] },
      resultCache: null,
      resultStale: false,
    };
  }

  it("raw concentration shared X still fits two curves", () => {
    const out = runAnalysis(gfSpec(), drContent(CONC, 2));
    expect(out.ok).toBe(true);
    if (!out.ok || out.kind !== "globalFit") throw new Error("expected GF");
    expect(out.localParams.length).toBe(2);
    out.localParams.forEach((p) => expect(p.ec50).toBeCloseTo(1e-6, 6));
  });

  it("already-log shared X auto-detects instead of dropping every point", () => {
    const out = runAnalysis(gfSpec(), drContent(LOG_DOSE, 2));
    expect(out.ok).toBe(true);
    if (!out.ok || out.kind !== "globalFit") throw new Error("expected GF");
    out.localParams.forEach((p) => expect(p.ec50).toBeCloseTo(1e-6, 6));
  });

  it("forcing Concentration on a log shared X gives the actionable error", () => {
    const out = runAnalysis(
      gfSpec({ xScale: "concentration" }),
      drContent(LOG_DOSE, 2),
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected failure");
    expect(out.error).toContain("already log dose");
    expect(out.error).not.toMatch(/^Need more than/);
  });

  it("show-the-code log10-transforms a raw shared X but not an already-log one", () => {
    // Raw concentration: the global code must log10 each curve's X (in the
    // residual closure AND the logEC50 p0 seed), mirroring the single-curve
    // path, so the printed shared params and per-curve EC50s reproduce the
    // on-screen fit instead of fitting in raw-dose space.
    const rawOut = runAnalysis(gfSpec(), drContent(CONC, 2));
    if (!rawOut.ok || rawOut.kind !== "globalFit") {
      throw new Error("raw global run failed");
    }
    const rawCode = showCode(rawOut);
    expect(rawCode).toContain("np.log10(np.asarray(xs[d]");
    expect(rawCode).toContain("np.log10(x[min(range(len(x))");

    // Already-log shared X: leave it un-logged (logging a negative dose column
    // again would shift every EC50 by orders of magnitude).
    const logOut = runAnalysis(gfSpec(), drContent(LOG_DOSE, 2));
    if (!logOut.ok || logOut.kind !== "globalFit") {
      throw new Error("log global run failed");
    }
    const logCode = showCode(logOut);
    expect(logCode).not.toContain("np.log10(np.asarray(xs[d]");
    expect(logCode).not.toContain("np.log10(x[min(range(len(x))");
    expect(logCode).toContain("X is already log10(dose)");
  });
});
