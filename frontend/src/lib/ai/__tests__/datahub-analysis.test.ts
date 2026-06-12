import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  AnalysisSpec,
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import { runAnalysis } from "@/lib/datahub/run-analysis";
import { planAnalysis } from "@/lib/datahub/planner";

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
  const xs = [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0];
  const ys = [4.8, 6.1, 7.9, 12.5, 24.0, 47.0, 70.0, 86.0, 93.5, 96.8, 98.1];
  return {
    meta: meta({ id: "5", name: "Dose response", table_type: "xy" }),
    columns: [
      { id: "x", name: "log[dose]", role: "x", dataType: "number" },
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
  const xs = [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0];
  const yA = [4.8, 6.1, 7.9, 12.5, 24.0, 47.0, 70.0, 86.0, 93.5, 96.8, 98.1];
  const yB = [4.0, 5.0, 6.5, 9.5, 18.0, 38.0, 62.0, 82.0, 92.0, 96.0, 98.0];
  return {
    meta: meta({ id: "9", name: "Two curves", table_type: "xy" }),
    columns: [
      { id: "x", name: "log[dose]", role: "x", dataType: "number" },
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
