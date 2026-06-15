import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  AnalysisSpec,
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import { runAnalysis } from "@/lib/datahub/run-analysis";
import { planAnalysis } from "@/lib/datahub/planner";
import { buildEmptyNestedTable } from "@/lib/datahub/nested-table";

// Pins for BeakerBot's Data Hub analysis tools. The pure mapping + planning
// functions are tested directly against built content, so no folder and no Loro
// are involved. The tool execute paths are tested with the data-layer deps
// stubbed, and the engine-computed number is asserted against the engine's OWN
// output for the same dataset (we never eyeball a statistic).

import {
  datahubAnalysisDeps,
  shapeTableBrief,
  shapeAnalysisBrief,
  shapeStoredAnalysis,
  resolveColumnIds,
  buildIntent,
  parseRunAnalysisArgs,
  planAndRun,
  describeRunAnalysis,
  cacheTableContent,
  _clearDataHubAnalysisCache,
  listDataHubTablesTool,
  listDataHubAnalysesTool,
  readDataHubAnalysisTool,
  runDataHubAnalysisTool,
  compareModelsTool,
  parseCompareModelsArgs,
  resolveYColumnId,
  buildModelComparison,
  getAnalysisCodeTool,
  shapeAnalysisCode,
  parseMultipleRegressionArgs,
  buildMultipleRegression,
  runMultipleRegressionTool,
  parseLogisticRegressionArgs,
  buildLogisticRegression,
  runLogisticRegressionTool,
  parseGlobalFitArgs,
  buildGlobalFit,
  globalFitTool,
  parseDoseResponseArgs,
  buildDoseResponse,
  describeDoseResponse,
  runDoseResponseTool,
  parseCoxRegressionArgs,
  buildCoxRegression,
  describeCoxRegression,
  runCoxRegressionTool,
  parseContingencyArgs,
  buildContingency,
  describeContingency,
  runContingencyTool,
  parseNestedArgs,
  buildNestedTTest,
  buildNestedAnova,
  describeNestedTTest,
  describeNestedAnova,
  runNestedTTestTool,
  runNestedAnovaTool,
  parseRocCurveArgs,
  buildRocCurve,
  describeRocCurve,
  runRocCurveTool,
  parseRmAnovaArgs,
  buildRmAnova,
  describeRmAnova,
  runRepeatedMeasuresAnovaTool,
  parseMixedModelArgs,
  buildMixedModel,
  describeMixedModel,
  runMixedModelTool,
  parseGrubbsOutliersArgs,
  buildGrubbsOutliers,
  describeGrubbsOutliers,
  runGrubbsOutliersTool,
} from "../tools/datahub-analysis";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function meta(overrides: Partial<DataHubDocument> = {}): DataHubDocument {
  return {
    id: "1",
    name: "fakeGFP qPCR",
    project_ids: [],
    folder_path: null,
    table_type: "column",
    created_at: "2026-06-11T00:00:00.000Z",
    ...overrides,
  };
}

// A two-group Column table with a clear separation (Control low, Drug high), so
// an unpaired t-test is significant and the planner stays parametric.
function twoGroupContent(): DataHubDocContent {
  const m = meta();
  const control = [10, 11, 9, 12, 10, 11];
  const drug = [18, 19, 21, 20, 22, 19];
  const rows = control.map((c, i) => ({
    id: `r${i}`,
    cells: { cControl: c, cDrug: drug[i] },
  }));
  return {
    meta: m,
    columns: [
      { id: "cControl", name: "Control", role: "y", dataType: "number" },
      { id: "cDrug", name: "Drug", role: "y", dataType: "number" },
    ],
    rows,
    analyses: [],
    plots: [],
  };
}

// A three-group Column table for the ANOVA path.
function threeGroupContent(): DataHubDocContent {
  const m = meta({ id: "2", name: "Triple" });
  const a = [1, 2, 3, 2, 1];
  const b = [4, 5, 6, 5, 4];
  const c = [8, 9, 10, 9, 8];
  const rows = a.map((_, i) => ({
    id: `r${i}`,
    cells: { gA: a[i], gB: b[i], gC: c[i] },
  }));
  return {
    meta: m,
    columns: [
      { id: "gA", name: "A", role: "y", dataType: "number" },
      { id: "gB", name: "B", role: "y", dataType: "number" },
      { id: "gC", name: "C", role: "y", dataType: "number" },
    ],
    rows,
    analyses: [],
    plots: [],
  };
}

// An XY dose-response table (the SAME dataset the engine modelComparison test +
// the D1 transparency pin use), so 4PL vs 5PL fits and the F / AICc are real.
function doseResponseContent(): DataHubDocContent {
  // RAW dose (the analysis log10-transforms it). Same log grid [-9..-4] as the
  // engine pins, so the recovered fit and EC50 match.
  const xs = [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0].map(
    (lx) => 10 ** lx,
  );
  const ys = [4.8, 6.1, 7.9, 12.5, 24.0, 47.0, 70.0, 86.0, 93.5, 96.8, 98.1];
  return {
    meta: meta({ id: "5", name: "Dose response", table_type: "xy" }),
    columns: [
      { id: "x", name: "dose", role: "x", dataType: "number" },
      { id: "y1", name: "Response", role: "y", dataType: "number" },
    ],
    rows: xs.map((x, i) => ({ id: `r${i}`, cells: { x, y1: ys[i] } })),
    analyses: [],
    plots: [],
  };
}

beforeEach(() => {
  _clearDataHubAnalysisCache();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// list_datahub_tables
// ---------------------------------------------------------------------------

describe("shapeTableBrief", () => {
  it("returns the group column names and row count for a table", () => {
    const brief = shapeTableBrief(meta(), twoGroupContent());
    expect(brief).toEqual({
      id: "1",
      name: "fakeGFP qPCR",
      table_type: "column",
      columns: ["Control", "Drug"],
      rows: 6,
    });
  });

  it("degrades to empty columns when content cannot be read", () => {
    const brief = shapeTableBrief(meta(), null);
    expect(brief.columns).toEqual([]);
    expect(brief.rows).toBe(0);
  });
});

describe("list_datahub_tables tool", () => {
  it("lists the user's tables with their columns and caches content", async () => {
    const content = twoGroupContent();
    vi.spyOn(datahubAnalysisDeps, "listDocuments").mockResolvedValue([meta()]);
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(content);

    const out = (await listDataHubTablesTool.execute({})) as {
      count: number;
      tables: { id: string; columns: string[] }[];
    };
    expect(out.count).toBe(1);
    expect(out.tables[0].columns).toEqual(["Control", "Drug"]);
    // The describeAction (sync) must now be able to plan against the cached table.
    const described = describeRunAnalysis({ tableId: "1" });
    expect(described.summary).toMatch(/Control vs Drug/);
  });

  it("returns an empty list when there are no tables", async () => {
    vi.spyOn(datahubAnalysisDeps, "listDocuments").mockResolvedValue([]);
    const out = (await listDataHubTablesTool.execute({})) as { count: number };
    expect(out.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Intent mapping
// ---------------------------------------------------------------------------

describe("resolveColumnIds", () => {
  it("resolves columns by name, case-insensitive", () => {
    expect(resolveColumnIds(twoGroupContent(), ["control", "DRUG"])).toEqual([
      "cControl",
      "cDrug",
    ]);
  });
  it("resolves columns by id", () => {
    expect(resolveColumnIds(twoGroupContent(), ["cDrug"])).toEqual(["cDrug"]);
  });
  it("defaults to all group columns when none are named", () => {
    expect(resolveColumnIds(twoGroupContent(), undefined)).toEqual([
      "cControl",
      "cDrug",
    ]);
  });
  it("drops references that do not match a column", () => {
    expect(resolveColumnIds(twoGroupContent(), ["nope", "Control"])).toEqual([
      "cControl",
    ]);
  });
});

describe("buildIntent", () => {
  it("maps two columns to a two-group means intent", () => {
    const built = buildIntent(twoGroupContent(), parseRunAnalysisArgs({ tableId: "1" }));
    expect("intent" in built && built.intent).toMatchObject({
      family: "means",
      groupCount: "two",
      pairing: "independent",
    });
  });
  it("maps the paired flag to a paired intent", () => {
    const built = buildIntent(
      twoGroupContent(),
      parseRunAnalysisArgs({ tableId: "1", paired: true }),
    );
    expect("intent" in built && built.intent.pairing).toBe("paired");
  });
  it("maps three columns to a multi-group intent", () => {
    const built = buildIntent(threeGroupContent(), parseRunAnalysisArgs({ tableId: "2" }));
    expect("intent" in built && built.intent.groupCount).toBe("three-plus");
  });
  it("errors when fewer than two columns resolve", () => {
    const built = buildIntent(
      twoGroupContent(),
      parseRunAnalysisArgs({ tableId: "1", columns: ["Control"] }),
    );
    expect("error" in built).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// describeAction (the approval-card proposal)
// ---------------------------------------------------------------------------

describe("describeRunAnalysis", () => {
  it("produces a planner-based proposal with the test, columns, and assumptions", () => {
    cacheTableContent("1", twoGroupContent());
    const { summary } = describeRunAnalysis({ tableId: "1" });
    // The recommended parametric test on this clean, separated data.
    expect(summary).toMatch(/t-test/i);
    expect(summary).toMatch(/Control vs Drug/);
    expect(summary).toMatch(/fakeGFP qPCR/);
    expect(summary).toMatch(/Normality OK/);
  });

  it("falls back to a generic line when the table is not cached", () => {
    const { summary } = describeRunAnalysis({ tableId: "999" });
    expect(summary).toMatch(/statistical analysis/i);
  });
});

// ---------------------------------------------------------------------------
// planAndRun (engine-computed result)
// ---------------------------------------------------------------------------

describe("planAndRun", () => {
  it("runs the planner-chosen test and returns the engine's own number", () => {
    const content = twoGroupContent();
    const run = planAndRun(content, parseRunAnalysisArgs({ tableId: "1" }));
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    // The planner chose the test; recompute the SAME spec through the engine and
    // assert the tool reports the engine's exact p-value (never an eyeballed one).
    const planned = planAnalysis(content, {
      family: "means",
      groupCount: "two",
      pairing: "independent",
      groupColumnIds: ["cControl", "cDrug"],
    });
    const refSpec: AnalysisSpec = {
      id: "ref",
      type: planned.steps[0].analysisType as string,
      params: {},
      inputs: { columnIds: ["cControl", "cDrug"] },
      resultCache: null,
      resultStale: false,
    };
    const ref = runAnalysis(refSpec, content);
    expect(ref.ok && ref.kind === "ttest").toBe(true);
    if (!ref.ok || ref.kind !== "ttest") return;

    expect(run.result.pValue).toBe(ref.pValue);
    expect(run.spec.type).toBe(refSpec.type);
    expect(run.spec.inputs).toEqual({ columnIds: ["cControl", "cDrug"] });
    // The clean separation is significant.
    expect(run.result.pValue).not.toBeNull();
    expect(run.result.pValue as number).toBeLessThan(0.05);
    expect(run.result.verdict).toMatch(/Drug|Control/);
    expect(run.result.keyStatistic).toMatch(/p/);
    // The parametric t-test surfaces its effect size for the model to relay
    // (Cohen's d plus the bias-corrected Hedges' g), straight from the engine.
    expect(run.result.effectSize).toMatch(/Cohen's d/);
    expect(run.result.effectSize).toMatch(/Hedges' g/);
  });

  it("errors on a non-runnable request rather than fabricating a result", () => {
    const run = planAndRun(
      twoGroupContent(),
      parseRunAnalysisArgs({ tableId: "1", columns: ["Control"] }),
    );
    expect(run.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// run_datahub_analysis tool (action wiring)
// ---------------------------------------------------------------------------

describe("run_datahub_analysis tool", () => {
  it("is previewable, not a gated action (ai review-mode bot)", () => {
    // It carries NO `action` flag, so in whole-plan review mode it runs straight
    // away like before (the request plus the ask_user pick are the consent). It
    // IS `previewable`, so in step-by-step review mode the gate shows a
    // preview-and-confirm block first, built from its synchronous describeAction.
    // It still has no isDestructive hook, the write is reversible.
    expect(runDataHubAnalysisTool.action).toBeFalsy();
    expect(runDataHubAnalysisTool.previewable).toBe(true);
    expect(typeof runDataHubAnalysisTool.describeAction).toBe("function");
    expect(runDataHubAnalysisTool.isDestructive).toBeUndefined();
  });

  it("navigates the user to the stored result in the Data Hub after a run", async () => {
    const content = twoGroupContent();
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(content);
    vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi
      .spyOn(datahubAnalysisDeps, "navigate")
      .mockImplementation(() => {});

    const out = (await runDataHubAnalysisTool.execute({
      tableId: "1",
      columns: ["Control", "Drug"],
    })) as { ok: boolean; analysisId: string };

    expect(out.ok).toBe(true);
    // Hard-wired navigation to the result deep link, so the user lands on the test's
    // RESULT sheet instead of the raw data grid (and instead of only reading the chat
    // summary). The doc param is the table id, the analysis param is the just-stored
    // analysis id, which the Data Hub page consumes to select the table then its result.
    expect(navigate).toHaveBeenCalledWith(
      `/datahub?doc=1&analysis=${out.analysisId}`,
    );
  });

  it("does not navigate when the run fails (nothing was stored to show)", async () => {
    const content = twoGroupContent();
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(content);
    vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi
      .spyOn(datahubAnalysisDeps, "navigate")
      .mockImplementation(() => {});

    // Only one column resolves, so the run errors before storing or navigating.
    const out = (await runDataHubAnalysisTool.execute({
      tableId: "1",
      columns: ["Control"],
    })) as { ok: boolean };
    expect(out.ok).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("reads live content, runs through the engine, and stores an AnalysisSpec", async () => {
    const content = twoGroupContent();
    let stored: AnalysisSpec | null = null;
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(content);
    vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});
    vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockImplementation(
      async (_id, spec) => {
        stored = spec;
        return true;
      },
    );

    const out = (await runDataHubAnalysisTool.execute({
      tableId: "1",
      columns: ["Control", "Drug"],
    })) as { ok: boolean; pValue: number | null; analysisId: string };

    expect(out.ok).toBe(true);
    expect(stored).not.toBeNull();
    const storedSpec = stored as AnalysisSpec | null;
    expect(storedSpec?.id).toBe(out.analysisId);
    expect(storedSpec?.inputs).toEqual({ columnIds: ["cControl", "cDrug"] });
    // The stored spec carries the engine's cached result, not a model guess.
    expect(storedSpec?.resultCache).not.toBeNull();

    // The returned number is the engine's number for the same spec.
    const ref = runAnalysis(
      {
        id: "ref",
        type: storedSpec?.type as string,
        params: {},
        inputs: { columnIds: ["cControl", "cDrug"] },
        resultCache: null,
        resultStale: false,
      },
      content,
    );
    expect(ref.ok && ref.kind === "ttest").toBe(true);
    if (ref.ok && ref.kind === "ttest") {
      expect(out.pValue).toBe(ref.pValue);
    }
  });

  it("returns a graceful error when the table cannot be opened", async () => {
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(null);
    const out = (await runDataHubAnalysisTool.execute({ tableId: "nope" })) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/could not open/i);
  });

  it("returns an error when no tableId is given", async () => {
    const out = (await runDataHubAnalysisTool.execute({})) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
  });

  it("does not store when the data does not support the requested comparison", async () => {
    const content = twoGroupContent();
    const persist = vi
      .spyOn(datahubAnalysisDeps, "persistAnalysis")
      .mockResolvedValue(true);
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(content);

    const out = (await runDataHubAnalysisTool.execute({
      tableId: "1",
      columns: ["Control"],
    })) as { ok: boolean };
    expect(out.ok).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fixtures for read-tool tests (content with a stored analysis)
// ---------------------------------------------------------------------------

/** Build a two-group content object that already has a stored t-test result,
 *  the way the doc looks after run_datahub_analysis has written to it. Uses
 *  planAndRun so the spec type is the real planner-chosen type (e.g.
 *  "unpairedTTest"), and resultCache is the real engine output. */
function contentWithStoredAnalysis(): {
  content: DataHubDocContent;
  analysisId: string;
} {
  const base = twoGroupContent();
  // Use planAndRun so the spec type matches what the real write path would
  // store. Hard-coding "ttest" fails because the actual type string is
  // "unpairedTTest" (the AnalysisType union value the engine recognizes).
  const run = planAndRun(base, parseRunAnalysisArgs({ tableId: "1" }));
  if (!run.ok) throw new Error(`fixture planAndRun failed: ${run.error}`);
  const spec = run.spec;
  spec.id = "analysis-test-1";
  const content: DataHubDocContent = { ...base, analyses: [spec] };
  return { content, analysisId: spec.id };
}

// ---------------------------------------------------------------------------
// shapeAnalysisBrief (pure helper for list_datahub_analyses)
// ---------------------------------------------------------------------------

describe("shapeAnalysisBrief", () => {
  it("returns the column NAMES (not ids) and the hasResult flag", () => {
    const { content, analysisId } = contentWithStoredAnalysis();
    const spec = content.analyses.find((a) => a.id === analysisId)!;
    const brief = shapeAnalysisBrief(spec, content);
    // The type is the planner-chosen AnalysisType (e.g. "unpairedTTest"), not
    // the generic "ttest" string. Assert only the fields that are stable.
    expect(brief.id).toBe(analysisId);
    expect(brief.columns).toEqual(["Control", "Drug"]);
    expect(brief.hasResult).toBe(true);
    expect(typeof brief.type).toBe("string");
  });

  it("reports hasResult false when resultCache is null", () => {
    const base = twoGroupContent();
    const spec: AnalysisSpec = {
      id: "no-result",
      type: "unpairedTTest",
      params: {},
      inputs: { columnIds: ["cControl", "cDrug"] },
      resultCache: null,
      resultStale: false,
    };
    const content: DataHubDocContent = { ...base, analyses: [spec] };
    expect(shapeAnalysisBrief(spec, content).hasResult).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shapeStoredAnalysis (pure helper for read_datahub_analysis)
// ---------------------------------------------------------------------------

describe("shapeStoredAnalysis", () => {
  it("returns the engine-computed numbers from a stored result", () => {
    const { content, analysisId } = contentWithStoredAnalysis();

    const shaped = shapeStoredAnalysis(content, analysisId);
    expect(shaped.ok).toBe(true);
    if (!shaped.ok) return;

    // The engine value is pinned: the shaped result must carry exactly the
    // same p-value the engine returned for the same dataset, never an
    // invented one.
    const spec = content.analyses[0];
    const ref = runAnalysis(spec, content);
    expect(ref.ok && ref.kind === "ttest").toBe(true);
    if (!ref.ok || ref.kind !== "ttest") return;

    expect(shaped.pValue).toBe(ref.pValue);
    expect(shaped.table).toBe("fakeGFP qPCR");
    expect(shaped.columns).toEqual(["Control", "Drug"]);
    expect(shaped.verdict).toMatch(/Drug|Control/);
    expect(shaped.keyStatistic).toMatch(/p/);
  });

  it("returns an error when the analysis id is not found", () => {
    const { content } = contentWithStoredAnalysis();
    const result = shapeStoredAnalysis(content, "no-such-id");
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toMatch(/not found/i);
  });

  it("returns an error when resultCache is null (analysis not run yet)", () => {
    const base = twoGroupContent();
    const spec: AnalysisSpec = {
      id: "pending",
      type: "unpairedTTest",
      params: {},
      inputs: { columnIds: ["cControl", "cDrug"] },
      resultCache: null,
      resultStale: false,
    };
    const content: DataHubDocContent = { ...base, analyses: [spec] };
    const result = shapeStoredAnalysis(content, "pending");
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toMatch(/no stored result/i);
  });
});

// ---------------------------------------------------------------------------
// list_datahub_analyses tool
// ---------------------------------------------------------------------------

describe("list_datahub_analyses tool", () => {
  it("returns the list of analyses with names and hasResult flags", async () => {
    const { content } = contentWithStoredAnalysis();
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(content);

    const out = (await listDataHubAnalysesTool.execute({ tableId: "1" })) as {
      ok: boolean;
      table: string;
      analyses: { id: string; type: string; columns: string[]; hasResult: boolean }[];
    };
    expect(out.ok).toBe(true);
    expect(out.table).toBe("fakeGFP qPCR");
    expect(out.analyses).toHaveLength(1);
    expect(out.analyses[0].columns).toEqual(["Control", "Drug"]);
    expect(out.analyses[0].hasResult).toBe(true);
  });

  it("returns an error when the table cannot be opened", async () => {
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(null);
    const out = (await listDataHubAnalysesTool.execute({ tableId: "nope" })) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/could not open/i);
  });

  it("returns an error when no tableId is given", async () => {
    const out = (await listDataHubAnalysesTool.execute({})) as {
      ok: boolean;
    };
    expect(out.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// read_datahub_analysis tool
// ---------------------------------------------------------------------------

describe("read_datahub_analysis tool", () => {
  it("returns the engine-computed stored result for a known analysis", async () => {
    const { content, analysisId } = contentWithStoredAnalysis();
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(content);

    const out = (await readDataHubAnalysisTool.execute({
      tableId: "1",
      analysisId,
    })) as { ok: boolean; pValue: number | null; verdict: string; keyStatistic: string };

    expect(out.ok).toBe(true);
    expect(out.pValue).not.toBeNull();
    expect(out.pValue as number).toBeLessThan(0.05);
    expect(out.verdict).toMatch(/Drug|Control/);
    expect(out.keyStatistic).toMatch(/p/);
  });

  it("does NOT navigate (read tools are silent)", async () => {
    const { content, analysisId } = contentWithStoredAnalysis();
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(content);
    const navigate = vi
      .spyOn(datahubAnalysisDeps, "navigate")
      .mockImplementation(() => {});

    await readDataHubAnalysisTool.execute({ tableId: "1", analysisId });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("returns an error when the table cannot be opened", async () => {
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(null);
    const out = (await readDataHubAnalysisTool.execute({
      tableId: "nope",
      analysisId: "any",
    })) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/could not open/i);
  });

  it("returns an error when the analysis id is not found on the table", async () => {
    const { content } = contentWithStoredAnalysis();
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(content);
    const out = (await readDataHubAnalysisTool.execute({
      tableId: "1",
      analysisId: "no-such",
    })) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not found/i);
  });

  it("returns an error when no tableId or analysisId is given", async () => {
    const out = (await readDataHubAnalysisTool.execute({})) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
  });

  it("is NOT a gated action (read-only, no action flag)", () => {
    expect(readDataHubAnalysisTool.action).toBeFalsy();
    expect(readDataHubAnalysisTool.describeAction).toBeUndefined();
    expect(readDataHubAnalysisTool.isDestructive).toBeUndefined();
  });

  it("is NOT a gated action for list_datahub_analyses either", () => {
    expect(listDataHubAnalysesTool.action).toBeFalsy();
    expect(listDataHubAnalysesTool.describeAction).toBeUndefined();
    expect(listDataHubAnalysesTool.isDestructive).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// compare_models (XY model comparison)
// ---------------------------------------------------------------------------

describe("parseCompareModelsArgs", () => {
  it("reads the ids, trims, and maps nested to a boolean", () => {
    const p = parseCompareModelsArgs({
      tableId: "5",
      modelA: " logistic4pl ",
      modelB: "logistic5pl",
      nested: true,
      yColumn: " Response ",
    });
    expect(p).toEqual({
      tableId: "5",
      modelA: "logistic4pl",
      modelB: "logistic5pl",
      nested: true,
      yColumn: "Response",
    });
  });

  it("defaults nested to false and yColumn to undefined", () => {
    const p = parseCompareModelsArgs({ tableId: "5", modelA: "a", modelB: "b" });
    expect(p.nested).toBe(false);
    expect(p.yColumn).toBeUndefined();
  });
});

describe("resolveYColumnId", () => {
  it("resolves a Y column by name (case-insensitive) and falls back to the first", () => {
    const content = doseResponseContent();
    expect(resolveYColumnId(content, "response")).toBe("y1");
    expect(resolveYColumnId(content, "nonexistent")).toBe("y1");
    expect(resolveYColumnId(content, undefined)).toBe("y1");
  });
});

describe("buildModelComparison", () => {
  it("builds a modelComparison spec and runs the engine (4PL vs 5PL, nested)", () => {
    const content = doseResponseContent();
    const built = buildModelComparison(
      content,
      parseCompareModelsArgs({
        tableId: "5",
        modelA: "logistic4pl",
        modelB: "logistic5pl",
        nested: true,
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.type).toBe("modelComparison");
    expect(built.spec.params).toMatchObject({
      modelA: "logistic4pl",
      modelB: "logistic5pl",
      nested: "yes",
    });
    expect(built.spec.inputs).toEqual({ columnIds: ["y1"] });
    // The engine computed a real comparison; the F test is present for a nested
    // pair and AICc is always present.
    expect(built.result.comparison.kind).toBe("modelComparison");
    expect(built.result.comparison.fTest).not.toBeNull();
    expect(built.result.comparison.aicc.preferredId).toBeTruthy();
    expect(built.result.analysisId).toBe(built.spec.id);
  });

  it("disables the F test when nested is false (AICc still present)", () => {
    const built = buildModelComparison(
      doseResponseContent(),
      parseCompareModelsArgs({
        tableId: "5",
        modelA: "logistic4pl",
        modelB: "logistic5pl",
        nested: false,
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.params).toMatchObject({ nested: "no" });
    expect(built.result.comparison.fTest).toBeNull();
    expect(built.result.comparison.aicc.preferredId).toBeTruthy();
  });

  it("rejects a non-XY (Column) table", () => {
    const built = buildModelComparison(
      twoGroupContent(),
      parseCompareModelsArgs({ tableId: "1", modelA: "logistic4pl", modelB: "logistic5pl", nested: true }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/XY table/i);
  });

  it("rejects two identical models", () => {
    const built = buildModelComparison(
      doseResponseContent(),
      parseCompareModelsArgs({ tableId: "5", modelA: "logistic4pl", modelB: "logistic4pl", nested: true }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/DIFFERENT/i);
  });

  it("rejects an unknown model id and lists the valid ones", () => {
    const built = buildModelComparison(
      doseResponseContent(),
      parseCompareModelsArgs({ tableId: "5", modelA: "logistic4pl", modelB: "not-a-model", nested: false }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/logistic4pl/);
  });
});

describe("compare_models tool", () => {
  it("is previewable, not a gated action, like run_datahub_analysis", () => {
    expect(compareModelsTool.action).toBeFalsy();
    expect(compareModelsTool.previewable).toBe(true);
    expect(typeof compareModelsTool.describeAction).toBe("function");
    expect(compareModelsTool.isDestructive).toBeUndefined();
  });

  it("stores the comparison and navigates the user to it", async () => {
    const content = doseResponseContent();
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(content);
    const persist = vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});

    const result = (await compareModelsTool.execute({
      tableId: "5",
      modelA: "logistic4pl",
      modelB: "logistic5pl",
      nested: true,
    })) as { ok: boolean; analysisId?: string };
    expect(result.ok).toBe(true);
    expect(persist).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(`/datahub?doc=5&analysis=${(result as { analysisId: string }).analysisId}`),
    );
  });

  it("does not navigate when the build fails (Column table)", async () => {
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(twoGroupContent());
    vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});

    const result = (await compareModelsTool.execute({
      tableId: "1",
      modelA: "logistic4pl",
      modelB: "logistic5pl",
      nested: true,
    })) as { ok: boolean };
    expect(result.ok).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// get_analysis_code (show-the-code for a stored analysis)
// ---------------------------------------------------------------------------

describe("shapeAnalysisCode", () => {
  it("returns the runnable code + kind for a stored result", () => {
    const { content, analysisId } = contentWithStoredAnalysis();
    const out = shapeAnalysisCode(content, analysisId);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.language).toBe("python");
    expect(out.kind).toBe("ttest");
    expect(out.code.length).toBeGreaterThan(0);
    expect(out.analysisId).toBe(analysisId);
  });

  it("errors for an unknown analysis id", () => {
    const { content } = contentWithStoredAnalysis();
    const out = shapeAnalysisCode(content, "nope");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/not found/i);
  });

  it("errors when the analysis has no stored result yet", () => {
    const content = twoGroupContent();
    const out = shapeAnalysisCode(
      {
        ...content,
        analyses: [
          {
            id: "blank",
            type: "unpairedTTest",
            params: {},
            inputs: { columnIds: ["cControl", "cDrug"] },
            resultCache: null,
            resultStale: false,
          },
        ],
      },
      "blank",
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/no stored result/i);
  });
});

describe("get_analysis_code tool", () => {
  it("is read-only (no action hooks, never navigates)", async () => {
    expect(getAnalysisCodeTool.action).toBeFalsy();
    expect(getAnalysisCodeTool.describeAction).toBeUndefined();
    const navigate = vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});
    const { content, analysisId } = contentWithStoredAnalysis();
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(content);
    const result = (await getAnalysisCodeTool.execute({
      tableId: "1",
      analysisId,
    })) as { ok: boolean; code?: string };
    expect(result.ok).toBe(true);
    expect((result as { code: string }).code.length).toBeGreaterThan(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("requires both ids", async () => {
    const result = (await getAnalysisCodeTool.execute({ tableId: "1" })) as { ok: boolean };
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// run_multiple_regression (Column table)
// ---------------------------------------------------------------------------

// A Column table with a response and two predictors, enough rows that n > k+1
// and the fit is well-posed (Y is roughly 2*x1 + 3*x2 with a little noise).
function multiRegContent(): DataHubDocContent {
  const x1 = [1, 2, 3, 4, 5, 6];
  const x2 = [2, 1, 4, 3, 6, 5];
  const y = [8, 7, 18, 18, 28, 27];
  const rows = x1.map((_, i) => ({
    id: `r${i}`,
    cells: { cY: y[i], cX1: x1[i], cX2: x2[i] },
  }));
  return {
    meta: meta({ id: "7", name: "Yield model" }),
    columns: [
      { id: "cY", name: "Yield", role: "y", dataType: "number" },
      { id: "cX1", name: "Temp", role: "y", dataType: "number" },
      { id: "cX2", name: "pH", role: "y", dataType: "number" },
    ],
    rows,
    analyses: [],
    plots: [],
  };
}

describe("parseMultipleRegressionArgs", () => {
  it("reads the Y column and the predictor list, trimming the Y", () => {
    const p = parseMultipleRegressionArgs({
      tableId: "7",
      yColumn: " Yield ",
      predictors: ["Temp", "pH"],
    });
    expect(p).toEqual({ tableId: "7", yColumn: "Yield", predictors: ["Temp", "pH"] });
  });
});

describe("buildMultipleRegression", () => {
  it("builds a spec with columnIds = [yId, ...predictorIds] and runs the engine", () => {
    const built = buildMultipleRegression(
      multiRegContent(),
      parseMultipleRegressionArgs({ tableId: "7", yColumn: "Yield", predictors: ["Temp", "pH"] }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.type).toBe("multipleRegression");
    expect(built.spec.inputs).toEqual({ columnIds: ["cY", "cX1", "cX2"] });
    expect(built.result.predictorNames).toEqual(["Temp", "pH"]);
    expect(typeof built.result.rSquared).toBe("number");
    expect(typeof built.result.fPValue).toBe("number");
    expect(built.result.regression.kind).toBe("multipleRegression");
  });

  it("drops the Y column if it is also named as a predictor and still needs 2", () => {
    const built = buildMultipleRegression(
      multiRegContent(),
      parseMultipleRegressionArgs({ tableId: "7", yColumn: "Yield", predictors: ["Yield", "Temp"] }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/at least 2 distinct predictor/i);
  });

  it("errors with fewer than two predictors", () => {
    const built = buildMultipleRegression(
      multiRegContent(),
      parseMultipleRegressionArgs({ tableId: "7", yColumn: "Yield", predictors: ["Temp"] }),
    );
    expect(built.ok).toBe(false);
  });

  it("errors when the Y column does not match", () => {
    const built = buildMultipleRegression(
      multiRegContent(),
      parseMultipleRegressionArgs({ tableId: "7", yColumn: "Nope", predictors: ["Temp", "pH"] }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/Y \(response\) column/i);
  });
});

describe("run_multiple_regression tool", () => {
  it("is non-gated and stores + navigates to the result", async () => {
    expect(runMultipleRegressionTool.action).toBeFalsy();
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(multiRegContent());
    const persist = vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});
    const result = (await runMultipleRegressionTool.execute({
      tableId: "7",
      yColumn: "Yield",
      predictors: ["Temp", "pH"],
    })) as { ok: boolean; analysisId?: string };
    expect(result.ok).toBe(true);
    expect(persist).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(`/datahub?doc=7&analysis=${(result as { analysisId: string }).analysisId}`),
    );
  });
});

// ---------------------------------------------------------------------------
// run_logistic_regression (XY table)
// ---------------------------------------------------------------------------

// An XY table with a binary 0/1 outcome that varies with X (overlapping, so the
// fit is well-posed and not perfectly separated).
function binaryOutcomeContent(): DataHubDocContent {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8];
  const ys = [0, 0, 0, 1, 0, 1, 1, 1];
  return {
    meta: meta({ id: "8", name: "Survival", table_type: "xy" }),
    columns: [
      { id: "x", name: "Dose", role: "x", dataType: "number" },
      { id: "y1", name: "Survived", role: "y", dataType: "number" },
    ],
    rows: xs.map((x, i) => ({ id: `r${i}`, cells: { x, y1: ys[i] } })),
    analyses: [],
    plots: [],
  };
}

describe("buildLogisticRegression", () => {
  it("builds a logisticRegression spec with columnIds = [yId] and runs the engine", () => {
    const built = buildLogisticRegression(
      binaryOutcomeContent(),
      parseLogisticRegressionArgs({ tableId: "8", yColumn: "Survived" }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.type).toBe("logisticRegression");
    expect(built.spec.inputs).toEqual({ columnIds: ["y1"] });
    expect(built.result.regression.kind).toBe("logisticRegression");
    expect(typeof built.result.oddsRatio).toBe("number");
    expect(typeof built.result.auc).toBe("number");
  });

  it("rejects a non-XY (Column) table", () => {
    const built = buildLogisticRegression(
      multiRegContent(),
      parseLogisticRegressionArgs({ tableId: "7" }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/XY table/i);
  });
});

describe("run_logistic_regression tool", () => {
  it("is non-gated and stores + navigates to the result", async () => {
    expect(runLogisticRegressionTool.action).toBeFalsy();
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(binaryOutcomeContent());
    vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});
    const result = (await runLogisticRegressionTool.execute({
      tableId: "8",
      yColumn: "Survived",
    })) as { ok: boolean; analysisId?: string };
    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(`/datahub?doc=8&analysis=${(result as { analysisId: string }).analysisId}`),
    );
  });
});

// ---------------------------------------------------------------------------
// global_fit (XY table with 2+ Y columns)
// ---------------------------------------------------------------------------

// An XY table with TWO dose-response curves sharing a shape (same plateaus +
// Hill, EC50 shifted between them), so a global fit is well-posed.
function twoCurveContent(): DataHubDocContent {
  // RAW dose (the analysis log10-transforms it) on the same log grid [-9..-4].
  const xs = [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0].map(
    (lx) => 10 ** lx,
  );
  const yA = [4.8, 6.1, 7.9, 12.5, 24.0, 47.0, 70.0, 86.0, 93.5, 96.8, 98.1];
  const yB = [4.0, 5.0, 6.5, 9.5, 18.0, 38.0, 62.0, 82.0, 92.0, 96.0, 98.0];
  return {
    meta: meta({ id: "9", name: "Two curves", table_type: "xy" }),
    columns: [
      { id: "x", name: "dose", role: "x", dataType: "number" },
      { id: "yA", name: "Drug A", role: "y", dataType: "number" },
      { id: "yB", name: "Drug B", role: "y", dataType: "number" },
    ],
    rows: xs.map((x, i) => ({ id: `r${i}`, cells: { x, yA: yA[i], yB: yB[i] } })),
    analyses: [],
    plots: [],
  };
}

describe("parseGlobalFitArgs", () => {
  it("defaults to 4PL and the hill-top-bottom share preset", () => {
    const p = parseGlobalFitArgs({ tableId: "9" });
    expect(p).toEqual({ tableId: "9", model: "logistic4pl", share: "hill-top-bottom" });
  });
  it("reads an explicit 5PL + a valid share preset, and normalizes an unknown share", () => {
    expect(parseGlobalFitArgs({ tableId: "9", model: "logistic5pl", share: "hill" }).model).toBe(
      "logistic5pl",
    );
    expect(parseGlobalFitArgs({ tableId: "9", share: "top-bottom" }).share).toBe("top-bottom");
    expect(parseGlobalFitArgs({ tableId: "9", share: "bogus" }).share).toBe("hill-top-bottom");
  });
});

describe("buildGlobalFit", () => {
  it("builds a globalFit spec carrying all Y ids and runs the engine across both curves", () => {
    const built = buildGlobalFit(
      twoCurveContent(),
      parseGlobalFitArgs({ tableId: "9" }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.type).toBe("globalFit");
    expect(built.spec.params).toMatchObject({ model: "logistic4pl", share: "hill-top-bottom" });
    expect(built.spec.inputs).toEqual({ columnIds: ["yA", "yB"] });
    expect(built.result.fit.kind).toBe("globalFit");
    expect(built.result.nDatasets).toBe(2);
    expect(built.result.fit.sharedParams.length).toBeGreaterThan(0);
    expect(built.result.fit.localParams.length).toBe(2);
    expect(typeof built.result.rSquared).toBe("number");
  });

  it("rejects an XY table with fewer than 2 Y columns", () => {
    const built = buildGlobalFit(
      doseResponseContent(),
      parseGlobalFitArgs({ tableId: "5" }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/at least 2 Y/i);
  });

  it("rejects a non-XY (Column) table", () => {
    const built = buildGlobalFit(
      twoGroupContent(),
      parseGlobalFitArgs({ tableId: "1" }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/XY table/i);
  });
});

describe("global_fit tool", () => {
  it("is non-gated and stores + navigates to the result", async () => {
    expect(globalFitTool.action).toBeFalsy();
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(twoCurveContent());
    vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});
    const result = (await globalFitTool.execute({ tableId: "9" })) as {
      ok: boolean;
      analysisId?: string;
    };
    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(`/datahub?doc=9&analysis=${(result as { analysisId: string }).analysisId}`),
    );
  });
});

// ---------------------------------------------------------------------------
// run_dose_response (single-curve 4PL/5PL fit)
// ---------------------------------------------------------------------------

describe("parseDoseResponseArgs", () => {
  it("defaults to the 4PL and undefined yColumn", () => {
    const p = parseDoseResponseArgs({ tableId: "5" });
    expect(p).toEqual({ tableId: "5", model: "logistic4pl", yColumn: undefined });
  });
  it("reads an explicit 5PL and trims yColumn", () => {
    const p = parseDoseResponseArgs({ tableId: "5", model: "logistic5pl", yColumn: " Response " });
    expect(p.model).toBe("logistic5pl");
    expect(p.yColumn).toBe("Response");
  });
  it("normalizes an unknown model to the 4PL", () => {
    expect(parseDoseResponseArgs({ tableId: "5", model: "bogus" }).model).toBe("logistic4pl");
  });
});

describe("buildDoseResponse", () => {
  it("builds a doseResponse spec with columnIds = [yId] and runs the engine", () => {
    const content = doseResponseContent();
    const built = buildDoseResponse(content, parseDoseResponseArgs({ tableId: "5" }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.type).toBe("doseResponse");
    expect(built.spec.params).toMatchObject({ model: "logistic4pl" });
    expect(built.spec.inputs).toEqual({ columnIds: ["y1"] });
    expect(built.result.fit.kind).toBe("doseResponse");
    expect(built.result.analysisId).toBe(built.spec.id);

    // The tool reports the engine's OWN numbers, never an eyeballed EC50. Recompute
    // the same spec through the engine and assert the readouts match exactly.
    const ref = runAnalysis(built.spec, content);
    expect(ref.ok && ref.kind === "doseResponse").toBe(true);
    if (!ref.ok || ref.kind !== "doseResponse") return;
    expect(built.result.ec50).toBe(ref.ec50);
    expect(built.result.ec50CI95).toEqual(ref.ec50CI95);
    expect(built.result.hillSlope).toBe(ref.hillSlope.value);
    expect(built.result.rSquared).toBe(ref.rSquared);
  });

  it("honors the 5PL model and stores it in params", () => {
    const built = buildDoseResponse(
      doseResponseContent(),
      parseDoseResponseArgs({ tableId: "5", model: "logistic5pl" }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.params).toMatchObject({ model: "logistic5pl" });
    expect(built.result.model).toBe("logistic5pl");
  });

  it("rejects a non-XY (Column) table", () => {
    const built = buildDoseResponse(twoGroupContent(), parseDoseResponseArgs({ tableId: "1" }));
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/XY table/i);
  });
});

describe("describeDoseResponse", () => {
  it("names the curve and table when content is cached", () => {
    cacheTableContent("5", doseResponseContent());
    const { summary } = describeDoseResponse({ tableId: "5" });
    expect(summary).toMatch(/logistic4pl/);
    expect(summary).toMatch(/Response/);
    expect(summary).toMatch(/Dose response/);
  });

  it("emits a stepPayload-style summary even when the table is NOT cached", () => {
    // The no-content fallback still returns a usable summary so the step gate
    // always has something to show (mirrors the other describers' hardening).
    const { summary } = describeDoseResponse({ tableId: "999", model: "logistic5pl" });
    expect(summary).toMatch(/logistic5pl/);
    expect(summary).toMatch(/dose-response/i);
  });
});

describe("run_dose_response tool", () => {
  it("is previewable, not a gated action, like the other analysis tools", () => {
    expect(runDoseResponseTool.action).toBeFalsy();
    expect(runDoseResponseTool.previewable).toBe(true);
    expect(typeof runDoseResponseTool.describeAction).toBe("function");
    expect(runDoseResponseTool.isDestructive).toBeUndefined();
  });

  it("stores the fit and navigates the user to it", async () => {
    const content = doseResponseContent();
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(content);
    const persist = vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});

    const result = (await runDoseResponseTool.execute({ tableId: "5" })) as {
      ok: boolean;
      analysisId?: string;
      ec50?: number;
    };
    expect(result.ok).toBe(true);
    expect(persist).toHaveBeenCalled();
    expect(typeof result.ec50).toBe("number");
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(`/datahub?doc=5&analysis=${(result as { analysisId: string }).analysisId}`),
    );
  });

  it("does not navigate when the build fails (Column table)", async () => {
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(twoGroupContent());
    vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});

    const result = (await runDoseResponseTool.execute({ tableId: "1" })) as { ok: boolean };
    expect(result.ok).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("returns an error when no tableId is given", async () => {
    const result = (await runDoseResponseTool.execute({})) as { ok: boolean };
    expect(result.ok).toBe(false);
  });
});

// ===========================================================================
// Data Hub Themes 3 + 4 tools (ai beakerai bot). Each pure builder is asserted
// against the engine's OWN output for the same spec (we never eyeball a
// statistic), and each tool's execute is checked for non-gated store + navigate
// plus the no-content describe fallback emitting a stepPayload.
// ===========================================================================

// ---------------------------------------------------------------------------
// run_cox_regression (Survival table)
// ---------------------------------------------------------------------------

// A two-arm Survival table (Time + Event + Group). The treated arm tends to
// outlive the control, but the event times are INTERLEAVED between arms (no arm
// fully precedes the other), so the Cox partial-likelihood is well-conditioned
// and its information matrix is not singular.
function survivalContent(): DataHubDocContent {
  const subjects = [
    { time: 5, event: 1, group: "Control" },
    { time: 8, event: 1, group: "Treated" },
    { time: 9, event: 1, group: "Control" },
    { time: 12, event: 0, group: "Treated" },
    { time: 13, event: 1, group: "Control" },
    { time: 14, event: 1, group: "Treated" },
    { time: 6, event: 0, group: "Control" },
    { time: 18, event: 1, group: "Treated" },
    { time: 11, event: 1, group: "Control" },
    { time: 20, event: 0, group: "Treated" },
    { time: 16, event: 1, group: "Treated" },
    { time: 7, event: 1, group: "Control" },
  ];
  return {
    meta: meta({ id: "10", name: "Trial survival", table_type: "survival" }),
    columns: [
      { id: "time", name: "Time", role: "x", dataType: "number" },
      { id: "event", name: "Event", role: "y", dataType: "number" },
      { id: "group", name: "Group", role: "group", dataType: "text" },
    ],
    rows: subjects.map((s, i) => ({
      id: `r${i}`,
      cells: { time: s.time, event: s.event, group: s.group },
    })),
    analyses: [],
    plots: [],
  };
}

describe("parseCoxRegressionArgs", () => {
  it("reads the tableId and trims an optional referenceGroup", () => {
    expect(parseCoxRegressionArgs({ tableId: "10" })).toEqual({
      tableId: "10",
      referenceGroup: undefined,
    });
    expect(
      parseCoxRegressionArgs({ tableId: "10", referenceGroup: " Treated " }).referenceGroup,
    ).toBe("Treated");
  });
});

describe("buildCoxRegression", () => {
  it("builds a coxRegression spec and relays the engine's HR + LR test + concordance", () => {
    const content = survivalContent();
    const built = buildCoxRegression(content, parseCoxRegressionArgs({ tableId: "10" }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.type).toBe("coxRegression");
    expect(built.result.cox.kind).toBe("coxRegression");

    // The tool relays the engine's OWN numbers. Recompute the same spec and
    // assert the headline fields match exactly.
    const ref = runAnalysis(built.spec, content);
    expect(ref.ok && ref.kind === "coxRegression").toBe(true);
    if (!ref.ok || ref.kind !== "coxRegression") return;
    expect(built.result.n).toBe(ref.n);
    expect(built.result.events).toBe(ref.events);
    expect(built.result.cox.lrPValue).toBe(ref.lrPValue);
    expect(built.result.cox.concordance).toBe(ref.concordance);
    expect(built.result.cox.coefficients[0].hazardRatio).toBe(
      ref.coefficients[0].hazardRatio,
    );
  });

  it("passes referenceGroup through to the engine params", () => {
    const built = buildCoxRegression(
      survivalContent(),
      parseCoxRegressionArgs({ tableId: "10", referenceGroup: "Treated" }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.params).toEqual({ referenceGroup: "Treated" });
  });

  it("rejects a table with no survival data", () => {
    const built = buildCoxRegression(twoGroupContent(), parseCoxRegressionArgs({ tableId: "1" }));
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/Survival table/i);
  });
});

describe("describeCoxRegression", () => {
  it("names the table when content is cached", () => {
    cacheTableContent("10", survivalContent());
    const { summary, stepPayload } = describeCoxRegression({ tableId: "10" });
    expect(summary).toMatch(/Cox regression/i);
    expect(summary).toMatch(/Trial survival/);
    expect(stepPayload).toBeDefined();
  });

  it("emits a stepPayload even when the table is NOT cached", () => {
    const { summary, stepPayload } = describeCoxRegression({ tableId: "999" });
    expect(summary).toMatch(/Cox proportional-hazards/i);
    expect(stepPayload?.steps[0].kind).toBe("run_cox_regression");
  });
});

describe("run_cox_regression tool", () => {
  it("is previewable, not a gated action", () => {
    expect(runCoxRegressionTool.action).toBeFalsy();
    expect(runCoxRegressionTool.previewable).toBe(true);
    expect(typeof runCoxRegressionTool.describeAction).toBe("function");
  });

  it("stores the fit and navigates the user to it", async () => {
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(survivalContent());
    const persist = vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});
    const result = (await runCoxRegressionTool.execute({ tableId: "10" })) as {
      ok: boolean;
      analysisId?: string;
    };
    expect(result.ok).toBe(true);
    expect(persist).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(`/datahub?doc=10&analysis=${(result as { analysisId: string }).analysisId}`),
    );
  });

  it("returns an error when no tableId is given", async () => {
    const result = (await runCoxRegressionTool.execute({})) as { ok: boolean };
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// run_contingency (Contingency table)
// ---------------------------------------------------------------------------

// A 2x2 Contingency table with a strong association: one role-x text row-label
// column + two role-y count columns (the column factor).
function contingencyContent(): DataHubDocContent {
  return {
    meta: meta({ id: "12", name: "Response by arm", table_type: "contingency" }),
    columns: [
      { id: "rowlabel", name: "Arm", role: "x", dataType: "text" },
      { id: "resp", name: "Responded", role: "y", dataType: "number" },
      { id: "noresp", name: "No response", role: "y", dataType: "number" },
    ],
    rows: [
      { id: "r0", cells: { rowlabel: "Treated", resp: 30, noresp: 10 } },
      { id: "r1", cells: { rowlabel: "Control", resp: 10, noresp: 30 } },
    ],
    analyses: [],
    plots: [],
  };
}

describe("parseContingencyArgs", () => {
  it("reads the tableId and a yates of on / off, undefined otherwise", () => {
    expect(parseContingencyArgs({ tableId: "12" })).toEqual({ tableId: "12", yates: undefined });
    expect(parseContingencyArgs({ tableId: "12", yates: "off" }).yates).toBe("off");
    expect(parseContingencyArgs({ tableId: "12", yates: "on" }).yates).toBe("on");
    expect(parseContingencyArgs({ tableId: "12", yates: "garbage" }).yates).toBeUndefined();
  });
});

describe("buildContingency", () => {
  it("builds a contingency spec and relays the engine's chi-square + p", () => {
    const content = contingencyContent();
    const built = buildContingency(content, parseContingencyArgs({ tableId: "12" }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.type).toBe("contingency");
    expect(built.result.contingency.kind).toBe("contingency");

    const ref = runAnalysis(built.spec, content);
    expect(ref.ok && ref.kind === "contingency").toBe(true);
    if (!ref.ok || ref.kind !== "contingency") return;
    expect(built.result.n).toBe(ref.n);
    expect(built.result.contingency.chiSquare).toBe(ref.chiSquare);
    expect(built.result.contingency.pValue).toBe(ref.pValue);
    expect(built.result.contingency.fisherPValue).toBe(ref.fisherPValue);
  });

  it("omits yates by default and sets it only to turn the correction off", () => {
    const on = buildContingency(contingencyContent(), parseContingencyArgs({ tableId: "12" }));
    const off = buildContingency(contingencyContent(), parseContingencyArgs({ tableId: "12", yates: "off" }));
    expect(on.ok && on.spec.params).toEqual({});
    expect(off.ok && off.spec.params).toEqual({ yates: "off" });
  });

  it("rejects a table with no contingency data", () => {
    const built = buildContingency(twoGroupContent(), parseContingencyArgs({ tableId: "1" }));
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/Contingency table/i);
  });
});

describe("describeContingency", () => {
  it("names the table when content is cached", () => {
    cacheTableContent("12", contingencyContent());
    const { summary, stepPayload } = describeContingency({ tableId: "12" });
    expect(summary).toMatch(/contingency analysis/i);
    expect(summary).toMatch(/Response by arm/);
    expect(stepPayload).toBeDefined();
  });

  it("emits a stepPayload even when the table is NOT cached", () => {
    const { summary, stepPayload } = describeContingency({ tableId: "999" });
    expect(summary).toMatch(/contingency \(chi-square\)/i);
    expect(stepPayload?.steps[0].kind).toBe("run_contingency");
  });
});

describe("run_contingency tool", () => {
  it("is previewable, not a gated action", () => {
    expect(runContingencyTool.action).toBeFalsy();
    expect(runContingencyTool.previewable).toBe(true);
    expect(typeof runContingencyTool.describeAction).toBe("function");
  });

  it("stores the result and navigates the user to it", async () => {
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(contingencyContent());
    const persist = vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});
    const result = (await runContingencyTool.execute({ tableId: "12" })) as {
      ok: boolean;
      analysisId?: string;
    };
    expect(result.ok).toBe(true);
    expect(persist).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(`/datahub?doc=12&analysis=${(result as { analysisId: string }).analysisId}`),
    );
  });

  it("returns an error when no tableId is given", async () => {
    const result = (await runContingencyTool.execute({})) as { ok: boolean };
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// run_nested_ttest + run_nested_anova (Nested table)
// ---------------------------------------------------------------------------

// Build a Nested table with `groups` top-level groups, 2 subgroups each, 4
// replicates, filled with a clear group effect plus subgroup clustering so the
// REML fit is well-conditioned.
function nestedContent(groups: number): DataHubDocContent {
  const { columns, rows } = buildEmptyNestedTable(groups, 2, 4);
  let g = -1;
  let sInGroup = 0;
  let lastDataset = "";
  // Walk columns in declared order (group by group, subgroup by subgroup).
  const filledRows = rows.map((row, i) => {
    const cells: Record<string, number> = {};
    g = -1;
    lastDataset = "";
    sInGroup = 0;
    for (const col of columns) {
      if (col.datasetId !== lastDataset) {
        g += 1;
        sInGroup = 0;
        lastDataset = col.datasetId ?? "";
      } else {
        sInGroup += 1;
      }
      // group effect (g*5) + subgroup offset (sInGroup*0.7) + replicate noise.
      cells[col.id] = g * 5 + sInGroup * 0.7 + (i % 4) * 0.4 + (i * g) * 0.05;
    }
    return { id: row.id, cells };
  });
  return {
    meta: meta({ id: "13", name: "Nested replicates", table_type: "nested" }),
    columns,
    rows: filledRows,
    analyses: [],
    plots: [],
  };
}

describe("parseNestedArgs", () => {
  it("reads just the tableId", () => {
    expect(parseNestedArgs({ tableId: "13", foo: "bar" })).toEqual({ tableId: "13" });
  });
});

describe("buildNestedTTest", () => {
  it("builds a nestedTTest spec and relays the engine's estimate + p + variance", () => {
    const content = nestedContent(2);
    const built = buildNestedTTest(content);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.type).toBe("nestedTTest");
    expect(built.spec.params).toEqual({});
    const ref = runAnalysis(built.spec, content);
    expect(ref.ok && ref.kind === "nestedTTest").toBe(true);
    if (!ref.ok || ref.kind !== "nestedTTest") return;
    expect(built.result.nested.estimate).toBe(ref.estimate);
    expect(built.result.nested.pValue).toBe(ref.pValue);
    expect(built.result.nested.subgroupVariance).toBe(ref.subgroupVariance);
    expect(built.result.observations).toBe(ref.observations);
  });

  it("rejects a table that is not a nested table", () => {
    const built = buildNestedTTest(twoGroupContent());
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/Nested table/i);
  });
});

describe("buildNestedAnova", () => {
  it("builds a nestedOneWayAnova spec and relays the engine's F + p + method", () => {
    const content = nestedContent(3);
    const built = buildNestedAnova(content);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.type).toBe("nestedOneWayAnova");
    const ref = runAnalysis(built.spec, content);
    expect(ref.ok && ref.kind === "nestedOneWayAnova").toBe(true);
    if (!ref.ok || ref.kind !== "nestedOneWayAnova") return;
    expect(built.result.nested.f).toBe(ref.f);
    expect(built.result.nested.pValue).toBe(ref.pValue);
    expect(built.result.nested.method).toBe(ref.method);
  });
});

describe("describeNested", () => {
  it("nested t-test emits a stepPayload even when not cached", () => {
    const { summary, stepPayload } = describeNestedTTest({ tableId: "999" });
    expect(summary).toMatch(/nested t-test/i);
    expect(stepPayload?.steps[0].kind).toBe("run_nested_ttest");
  });
  it("nested anova names the table when cached", () => {
    cacheTableContent("13", nestedContent(3));
    const { summary, stepPayload } = describeNestedAnova({ tableId: "13" });
    expect(summary).toMatch(/nested one-way ANOVA/i);
    expect(summary).toMatch(/Nested replicates/);
    expect(stepPayload).toBeDefined();
  });
});

describe("run_nested tools", () => {
  it("both are previewable, not gated actions", () => {
    expect(runNestedTTestTool.previewable).toBe(true);
    expect(runNestedTTestTool.action).toBeFalsy();
    expect(runNestedAnovaTool.previewable).toBe(true);
    expect(runNestedAnovaTool.action).toBeFalsy();
  });

  it("nested t-test stores and navigates", async () => {
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(nestedContent(2));
    const persist = vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});
    const result = (await runNestedTTestTool.execute({ tableId: "13" })) as {
      ok: boolean;
      analysisId?: string;
    };
    expect(result.ok).toBe(true);
    expect(persist).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(`/datahub?doc=13&analysis=${(result as { analysisId: string }).analysisId}`),
    );
  });

  it("returns an error when no tableId is given", async () => {
    expect(((await runNestedTTestTool.execute({})) as { ok: boolean }).ok).toBe(false);
    expect(((await runNestedAnovaTool.execute({})) as { ok: boolean }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// run_roc_curve (XY table with a binary outcome, same shape as logistic)
// ---------------------------------------------------------------------------

describe("parseRocCurveArgs", () => {
  it("reads the tableId and trims an optional yColumn", () => {
    expect(parseRocCurveArgs({ tableId: "8" })).toEqual({ tableId: "8", yColumn: undefined });
    expect(parseRocCurveArgs({ tableId: "8", yColumn: " Survived " }).yColumn).toBe("Survived");
  });
});

describe("buildRocCurve", () => {
  it("builds a rocCurve spec with columnIds = [yId] and relays the engine's AUC + Youden", () => {
    const content = binaryOutcomeContent();
    const built = buildRocCurve(content, parseRocCurveArgs({ tableId: "8", yColumn: "Survived" }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.type).toBe("rocCurve");
    expect(built.spec.inputs).toEqual({ columnIds: ["y1"] });
    expect(built.result.roc.kind).toBe("rocCurve");

    const ref = runAnalysis(built.spec, content);
    expect(ref.ok && ref.kind === "rocCurve").toBe(true);
    if (!ref.ok || ref.kind !== "rocCurve") return;
    expect(built.result.auc).toBe(ref.auc);
    expect(built.result.aucCiLow).toBe(ref.aucCiLow);
    expect(built.result.aucCiHigh).toBe(ref.aucCiHigh);
    expect(built.result.youdenThreshold).toBe(ref.youdenThreshold);
    expect(built.result.youdenSensitivity).toBe(ref.youdenSensitivity);
    expect(built.result.youdenSpecificity).toBe(ref.youdenSpecificity);
  });

  it("rejects a non-XY (Column) table", () => {
    const built = buildRocCurve(multiRegContent(), parseRocCurveArgs({ tableId: "7" }));
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/XY table/i);
  });
});

describe("describeRocCurve", () => {
  it("names the outcome and table when content is cached", () => {
    cacheTableContent("8", binaryOutcomeContent());
    const { summary } = describeRocCurve({ tableId: "8", yColumn: "Survived" });
    expect(summary).toMatch(/ROC curve/i);
    expect(summary).toMatch(/Survived/);
    expect(summary).toMatch(/Survival/);
  });

  it("emits a stepPayload even when the table is NOT cached", () => {
    const { summary, stepPayload } = describeRocCurve({ tableId: "999" });
    expect(summary).toMatch(/ROC curve/i);
    expect(stepPayload?.steps[0].kind).toBe("run_roc_curve");
  });
});

describe("run_roc_curve tool", () => {
  it("is previewable, not a gated action", () => {
    expect(runRocCurveTool.action).toBeFalsy();
    expect(runRocCurveTool.previewable).toBe(true);
  });

  it("stores the curve and navigates the user to it", async () => {
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(binaryOutcomeContent());
    vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});
    const result = (await runRocCurveTool.execute({ tableId: "8", yColumn: "Survived" })) as {
      ok: boolean;
      analysisId?: string;
    };
    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(`/datahub?doc=8&analysis=${(result as { analysisId: string }).analysisId}`),
    );
  });
});

// ---------------------------------------------------------------------------
// run_repeated_measures_anova + run_mixed_model (row-paired Column table)
// ---------------------------------------------------------------------------

// A within-subject Column table: each row is one subject measured under three
// conditions (a clear upward trend across the conditions on the same subjects),
// so both the RM-ANOVA and the random-intercept mixed model are well-posed.
function withinSubjectContent(): DataHubDocContent {
  const c1 = [10, 12, 11, 13, 9, 14];
  const c2 = [14, 17, 15, 18, 13, 19];
  const c3 = [20, 23, 21, 24, 19, 25];
  const rows = c1.map((_, i) => ({
    id: `r${i}`,
    cells: { cA: c1[i], cB: c2[i], cC: c3[i] },
  }));
  return {
    meta: meta({ id: "11", name: "Timepoints" }),
    columns: [
      { id: "cA", name: "Baseline", role: "y", dataType: "number" },
      { id: "cB", name: "Week 4", role: "y", dataType: "number" },
      { id: "cC", name: "Week 8", role: "y", dataType: "number" },
    ],
    rows,
    analyses: [],
    plots: [],
  };
}

describe("parseRmAnovaArgs", () => {
  it("reads the tableId and an optional conditions array", () => {
    expect(parseRmAnovaArgs({ tableId: "11" })).toEqual({ tableId: "11", conditions: undefined });
    expect(
      parseRmAnovaArgs({ tableId: "11", conditions: ["Baseline", "Week 4", 7] }).conditions,
    ).toEqual(["Baseline", "Week 4"]);
  });
});

describe("buildRmAnova", () => {
  it("builds a repeatedMeasuresAnova spec carrying the condition ids and relays the engine's F + corrections", () => {
    const content = withinSubjectContent();
    const built = buildRmAnova(content, parseRmAnovaArgs({ tableId: "11" }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.type).toBe("repeatedMeasuresAnova");
    expect(built.spec.inputs).toEqual({ columnIds: ["cA", "cB", "cC"] });
    expect(built.result.rmAnova.kind).toBe("rmAnova");

    const ref = runAnalysis(built.spec, content);
    expect(ref.ok && ref.kind === "rmAnova").toBe(true);
    if (!ref.ok || ref.kind !== "rmAnova") return;
    expect(built.result.fStatistic).toBe(ref.statistic);
    expect(built.result.pValue).toBe(ref.pValue);
    expect(built.result.pGreenhouseGeisser).toBe(ref.pGreenhouseGeisser);
    expect(built.result.partialEtaSquared).toBe(ref.partialEtaSquared);
    expect(built.result.conditionNames).toEqual(["Baseline", "Week 4", "Week 8"]);
  });

  it("rejects fewer than 3 conditions", () => {
    const built = buildRmAnova(
      withinSubjectContent(),
      parseRmAnovaArgs({ tableId: "11", conditions: ["Baseline", "Week 4"] }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/at least 3 condition/i);
  });
});

describe("describeRmAnova", () => {
  it("names the conditions and table when content is cached", () => {
    cacheTableContent("11", withinSubjectContent());
    const { summary } = describeRmAnova({ tableId: "11" });
    expect(summary).toMatch(/Baseline/);
    expect(summary).toMatch(/Timepoints/);
  });

  it("emits a stepPayload even when the table is NOT cached", () => {
    const { stepPayload } = describeRmAnova({ tableId: "999" });
    expect(stepPayload?.steps[0].kind).toBe("run_repeated_measures_anova");
  });
});

describe("run_repeated_measures_anova tool", () => {
  it("is previewable, not a gated action", () => {
    expect(runRepeatedMeasuresAnovaTool.action).toBeFalsy();
    expect(runRepeatedMeasuresAnovaTool.previewable).toBe(true);
  });

  it("stores the result and navigates the user to it", async () => {
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(withinSubjectContent());
    vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});
    const result = (await runRepeatedMeasuresAnovaTool.execute({ tableId: "11" })) as {
      ok: boolean;
      analysisId?: string;
    };
    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(`/datahub?doc=11&analysis=${(result as { analysisId: string }).analysisId}`),
    );
  });
});

describe("parseMixedModelArgs", () => {
  it("reads the tableId and an optional conditions array", () => {
    expect(parseMixedModelArgs({ tableId: "11" })).toEqual({ tableId: "11", conditions: undefined });
    expect(parseMixedModelArgs({ tableId: "11", conditions: ["Baseline", "Week 4"] }).conditions).toEqual([
      "Baseline",
      "Week 4",
    ]);
  });
});

describe("buildMixedModel", () => {
  it("builds a linearMixedModel spec carrying the condition ids and relays the engine's fixed effects + variances", () => {
    const content = withinSubjectContent();
    const built = buildMixedModel(content, parseMixedModelArgs({ tableId: "11" }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.type).toBe("linearMixedModel");
    expect(built.spec.inputs).toEqual({ columnIds: ["cA", "cB", "cC"] });
    expect(built.result.mixedModel.kind).toBe("mixedModel");

    const ref = runAnalysis(built.spec, content);
    expect(ref.ok && ref.kind === "mixedModel").toBe(true);
    if (!ref.ok || ref.kind !== "mixedModel") return;
    expect(built.result.groupVariance).toBe(ref.groupVariance);
    expect(built.result.residualVariance).toBe(ref.residualVariance);
    expect(built.result.remlLogLikelihood).toBe(ref.remlLogLikelihood);
    expect(built.result.mixedModel.fixedEffects).toEqual(ref.fixedEffects);
  });

  it("rejects fewer than 2 conditions", () => {
    const built = buildMixedModel(
      withinSubjectContent(),
      parseMixedModelArgs({ tableId: "11", conditions: ["Baseline"] }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/at least 2 condition/i);
  });
});

describe("describeMixedModel", () => {
  it("emits a stepPayload even when the table is NOT cached", () => {
    const { stepPayload } = describeMixedModel({ tableId: "999" });
    expect(stepPayload?.steps[0].kind).toBe("run_mixed_model");
  });
});

describe("run_mixed_model tool", () => {
  it("is previewable, not a gated action, and stores + navigates", async () => {
    expect(runMixedModelTool.action).toBeFalsy();
    expect(runMixedModelTool.previewable).toBe(true);
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(withinSubjectContent());
    vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});
    const result = (await runMixedModelTool.execute({ tableId: "11" })) as {
      ok: boolean;
      analysisId?: string;
    };
    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(`/datahub?doc=11&analysis=${(result as { analysisId: string }).analysisId}`),
    );
  });
});

// ---------------------------------------------------------------------------
// run_grubbs_outliers (Column table)
// ---------------------------------------------------------------------------

// A Column table with one obvious outlier planted in the Control column (the 99
// among values near 10), so the iterative Grubbs sweep flags exactly that point.
function outlierContent(): DataHubDocContent {
  const control = [10, 11, 9, 12, 10, 11, 99, 10, 9, 11];
  const drug = [20, 21, 19, 22, 20, 21, 19, 20, 21, 20];
  const rows = control.map((_, i) => ({
    id: `r${i}`,
    cells: { cControl: control[i], cDrug: drug[i] },
  }));
  return {
    meta: meta({ id: "12", name: "Replicates" }),
    columns: [
      { id: "cControl", name: "Control", role: "y", dataType: "number" },
      { id: "cDrug", name: "Drug", role: "y", dataType: "number" },
    ],
    rows,
    analyses: [],
    plots: [],
  };
}

describe("parseGrubbsOutliersArgs", () => {
  it("defaults to alpha 0.05 and an iterative sweep", () => {
    expect(parseGrubbsOutliersArgs({ tableId: "12" })).toEqual({
      tableId: "12",
      columns: undefined,
      alpha: 0.05,
      iterative: true,
    });
  });
  it("reads alpha as a number or a string, and an explicit non-iterative flag", () => {
    expect(parseGrubbsOutliersArgs({ tableId: "12", alpha: 0.01 }).alpha).toBe(0.01);
    expect(parseGrubbsOutliersArgs({ tableId: "12", alpha: "0.01" }).alpha).toBe(0.01);
    expect(parseGrubbsOutliersArgs({ tableId: "12", alpha: 0.2 }).alpha).toBe(0.05);
    expect(parseGrubbsOutliersArgs({ tableId: "12", iterative: false }).iterative).toBe(false);
  });
});

describe("buildGrubbsOutliers", () => {
  it("builds a grubbsOutlier spec, encodes the params the engine reads, and relays the engine's flags", () => {
    const content = outlierContent();
    const built = buildGrubbsOutliers(content, parseGrubbsOutliersArgs({ tableId: "12" }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.type).toBe("grubbsOutlier");
    // alpha is the STRING the engine expects; iterative omits mode entirely.
    expect(built.spec.params).toEqual({ alpha: "0.05" });
    expect(built.spec.inputs).toEqual({ columnIds: ["cControl", "cDrug"] });

    const ref = runAnalysis(built.spec, content);
    expect(ref.ok && ref.kind === "grubbsOutlier").toBe(true);
    if (!ref.ok || ref.kind !== "grubbsOutlier") return;
    expect(built.result.totalOutliers).toBe(ref.totalOutliers);
    // The planted 99 in Control is flagged.
    expect(built.result.totalOutliers).toBeGreaterThanOrEqual(1);
    const control = built.result.columns.find((c) => c.name === "Control");
    expect(control?.outlierValues).toContain(99);
  });

  it("encodes a single-pass screen as params.mode = single", () => {
    const built = buildGrubbsOutliers(
      outlierContent(),
      parseGrubbsOutliersArgs({ tableId: "12", iterative: false }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.params).toEqual({ alpha: "0.05", mode: "single" });
  });

  it("encodes alpha 0.01 as the string params.alpha", () => {
    const built = buildGrubbsOutliers(
      outlierContent(),
      parseGrubbsOutliersArgs({ tableId: "12", alpha: 0.01 }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.params).toMatchObject({ alpha: "0.01" });
  });

  it("rejects a table with no measurement columns (none to screen)", () => {
    // A table whose only column is an X column (role x). groupColumns returns the
    // y/group roles, so there is nothing to screen here.
    const xOnly: DataHubDocContent = {
      meta: meta({ id: "13", name: "X only", table_type: "xy" }),
      columns: [{ id: "x", name: "Dose", role: "x", dataType: "number" }],
      rows: [
        { id: "r0", cells: { x: 1 } },
        { id: "r1", cells: { x: 2 } },
      ],
      analyses: [],
      plots: [],
    };
    const built = buildGrubbsOutliers(xOnly, parseGrubbsOutliersArgs({ tableId: "13" }));
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/Column table/i);
  });
});

describe("describeGrubbsOutliers", () => {
  it("names the columns, alpha, and sweep when content is cached", () => {
    cacheTableContent("12", outlierContent());
    const { summary } = describeGrubbsOutliers({ tableId: "12" });
    expect(summary).toMatch(/Control/);
    expect(summary).toMatch(/Grubbs/);
    expect(summary).toMatch(/iterative/);
  });

  it("emits a stepPayload even when the table is NOT cached", () => {
    const { summary, stepPayload } = describeGrubbsOutliers({ tableId: "999", iterative: false });
    expect(summary).toMatch(/single-pass/);
    expect(stepPayload?.steps[0].kind).toBe("run_grubbs_outliers");
  });
});

describe("run_grubbs_outliers tool", () => {
  it("is previewable, not a gated action", () => {
    expect(runGrubbsOutliersTool.action).toBeFalsy();
    expect(runGrubbsOutliersTool.previewable).toBe(true);
  });

  it("stores the screen and navigates the user to it", async () => {
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(outlierContent());
    const persist = vi.spyOn(datahubAnalysisDeps, "persistAnalysis").mockResolvedValue(true);
    const navigate = vi.spyOn(datahubAnalysisDeps, "navigate").mockImplementation(() => {});
    const result = (await runGrubbsOutliersTool.execute({ tableId: "12" })) as {
      ok: boolean;
      analysisId?: string;
      totalOutliers?: number;
    };
    expect(result.ok).toBe(true);
    expect(persist).toHaveBeenCalled();
    expect(typeof result.totalOutliers).toBe("number");
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(`/datahub?doc=12&analysis=${(result as { analysisId: string }).analysisId}`),
    );
  });

  it("returns an error when no tableId is given", async () => {
    const result = (await runGrubbsOutliersTool.execute({})) as { ok: boolean };
    expect(result.ok).toBe(false);
  });
});
