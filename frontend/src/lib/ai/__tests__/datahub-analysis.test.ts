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
  resolveColumnIds,
  buildIntent,
  parseRunAnalysisArgs,
  planAndRun,
  describeRunAnalysis,
  cacheTableContent,
  _clearDataHubAnalysisCache,
  listDataHubTablesTool,
  runDataHubAnalysisTool,
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
  it("is a non-destructive action so plan-approval covers it", () => {
    expect(runDataHubAnalysisTool.action).toBe(true);
    expect(runDataHubAnalysisTool.isDestructive?.({ tableId: "1" })).toBe(false);
  });

  it("reads live content, runs through the engine, and stores an AnalysisSpec", async () => {
    const content = twoGroupContent();
    let stored: AnalysisSpec | null = null;
    vi.spyOn(datahubAnalysisDeps, "resolveContent").mockResolvedValue(content);
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
