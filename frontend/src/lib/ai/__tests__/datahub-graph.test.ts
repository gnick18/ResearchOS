import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  DataHubDocContent,
  DataHubDocument,
  PlotSpec,
} from "@/lib/datahub/model/types";
import { readPlotStyle, readPlotSource } from "@/lib/datahub/plot-spec";

// Pins for BeakerBot's make_datahub_graph tool. The pure mapping + build
// functions are tested directly against built content (no folder, no Loro), and
// the stored PlotSpec is asserted through the engine's OWN style / source
// readers, so the figure shape the engine will draw is what we check. The tool
// execute path is tested with the data-layer deps stubbed.

import {
  datahubGraphDeps,
  parseMakeGraphArgs,
  toPlotKind,
  estimationKindForGroups,
  resolveGraphColumns,
  resolveControlIndex,
  buildGraph,
  makeDataHubGraphTool,
} from "../tools/datahub-graph";

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

function twoGroupContent(): DataHubDocContent {
  const control = [10, 11, 9, 12, 10, 11];
  const drug = [18, 19, 21, 20, 22, 19];
  const rows = control.map((c, i) => ({
    id: `r${i}`,
    cells: { cControl: c, cDrug: drug[i] },
  }));
  return {
    meta: meta(),
    columns: [
      { id: "cControl", name: "Control", role: "y", dataType: "number" },
      { id: "cDrug", name: "Drug", role: "y", dataType: "number" },
    ],
    rows,
    analyses: [],
    plots: [],
  };
}

// The two-group table plus a stored one-way ANOVA whose Tukey comparison is
// significant, so a significanceBrackets request links it and draws a bracket.
function twoGroupContentWithAnova(): DataHubDocContent {
  const base = twoGroupContent();
  return {
    ...base,
    analyses: [
      {
        id: "an-1",
        type: "oneWayAnova",
        params: {},
        inputs: {},
        resultCache: {
          kind: "anova",
          comparisons: [
            { groupA: "Control", groupB: "Drug", pAdjusted: 0.0001 },
          ],
        },
        resultStale: false,
      },
    ],
  };
}

// A three-group column table, so an estimation request resolves to Cumming.
function threeGroupContent(): DataHubDocContent {
  const control = [10, 11, 9, 12, 10, 11];
  const low = [13, 14, 12, 15, 13, 14];
  const high = [18, 19, 21, 20, 22, 19];
  const rows = control.map((c, i) => ({
    id: `r${i}`,
    cells: { cControl: c, cLow: low[i], cHigh: high[i] },
  }));
  return {
    meta: meta({ id: "3", name: "dose response" }),
    columns: [
      { id: "cControl", name: "Control", role: "y", dataType: "number" },
      { id: "cLow", name: "Low", role: "y", dataType: "number" },
      { id: "cHigh", name: "High", role: "y", dataType: "number" },
    ],
    rows,
    analyses: [],
    plots: [],
  };
}

// A table with no group columns, so buildGraph errors gracefully.
function emptyGroupContent(): DataHubDocContent {
  return {
    meta: meta({ id: "9", name: "X only" }),
    columns: [{ id: "x1", name: "Time", role: "x", dataType: "number" }],
    rows: [{ id: "r0", cells: { x1: 1 } }],
    analyses: [],
    plots: [],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Arg parsing + kind mapping
// ---------------------------------------------------------------------------

describe("parseMakeGraphArgs", () => {
  it("defaults to a dot plot with SEM error bars", () => {
    const p = parseMakeGraphArgs({ tableId: "1" });
    expect(p).toMatchObject({ tableId: "1", type: "dot", errorBar: "sem" });
    expect(p.columns).toBeUndefined();
  });
  it("reads an explicit bar + sd request", () => {
    const p = parseMakeGraphArgs({
      tableId: "1",
      type: "bar",
      errorBar: "sd",
      columns: ["Control", "Drug"],
      title: "GFP",
    });
    expect(p).toMatchObject({
      type: "bar",
      errorBar: "sd",
      columns: ["Control", "Drug"],
      title: "GFP",
    });
  });
  it("normalizes an unknown error bar to sem and an unknown type to dot", () => {
    const p = parseMakeGraphArgs({ tableId: "1", type: "wat", errorBar: "wat" });
    expect(p.type).toBe("dot");
    expect(p.errorBar).toBe("sem");
  });
});

describe("toPlotKind", () => {
  it("maps the plain model types onto the engine PlotKind", () => {
    expect(toPlotKind("bar")).toBe("columnBar");
    expect(toPlotKind("dot")).toBe("columnScatter");
  });
});

describe("estimationKindForGroups", () => {
  it("draws Gardner-Altman for two groups and Cumming for three or more", () => {
    expect(estimationKindForGroups(2)).toBe("estimationGardnerAltman");
    expect(estimationKindForGroups(3)).toBe("estimationCumming");
    expect(estimationKindForGroups(5)).toBe("estimationCumming");
  });
});

describe("parseMakeGraphArgs (estimation)", () => {
  it("reads the estimation type and its control / paired args", () => {
    const p = parseMakeGraphArgs({
      tableId: "1",
      type: "estimation",
      control: "Control",
      paired: true,
      ci: 0.9,
      bootstrapSamples: 2000,
      seed: 7,
      bootstrapMethod: "percentile",
    });
    expect(p.type).toBe("estimation");
    expect(p.control).toBe("Control");
    expect(p.paired).toBe(true);
    expect(p.ci).toBe(0.9);
    expect(p.bootstrapSamples).toBe(2000);
    expect(p.seed).toBe(7);
    expect(p.bootstrapMethod).toBe("percentile");
  });
  it("drops an out-of-range ci and an unknown bootstrap method", () => {
    const p = parseMakeGraphArgs({
      tableId: "1",
      type: "estimation",
      ci: 1.5,
      bootstrapMethod: "wat",
    });
    expect(p.ci).toBeUndefined();
    expect(p.bootstrapMethod).toBeUndefined();
  });
});

describe("resolveControlIndex", () => {
  it("resolves a control name to its index in the plotted column order", () => {
    const content = threeGroupContent();
    const cols = ["cControl", "cLow", "cHigh"];
    expect(resolveControlIndex(content, cols, "High")).toBe(2);
    expect(resolveControlIndex(content, cols, "cLow")).toBe(1);
  });
  it("falls back to the first plotted group for an unknown or absent control", () => {
    const content = threeGroupContent();
    const cols = ["cControl", "cLow", "cHigh"];
    expect(resolveControlIndex(content, cols, undefined)).toBe(0);
    expect(resolveControlIndex(content, cols, "nope")).toBe(0);
  });
});

describe("resolveGraphColumns", () => {
  it("resolves by name, case-insensitive", () => {
    expect(resolveGraphColumns(twoGroupContent(), ["drug", "CONTROL"])).toEqual([
      "cDrug",
      "cControl",
    ]);
  });
  it("defaults to every group column when none are named", () => {
    expect(resolveGraphColumns(twoGroupContent(), undefined)).toEqual([
      "cControl",
      "cDrug",
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildGraph (the model -> plot-spec engine bridge)
// ---------------------------------------------------------------------------

describe("buildGraph", () => {
  it("builds a bar PlotSpec with SEM error bars through the engine builder", () => {
    const content = twoGroupContent();
    const built = buildGraph(
      content,
      parseMakeGraphArgs({ tableId: "1", type: "bar", errorBar: "sem" }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // The stored spec's top-level type + style read back as a bar with SEM error
    // bars, the figure the engine will draw. The model supplied no geometry.
    expect(built.spec.type).toBe("columnBar");
    const style = readPlotStyle(built.spec);
    expect(style.kind).toBe("columnBar");
    expect(style.errorBar).toBe("sem");
    // A bar request does not overlay points by default, and never draws brackets
    // from a bare request (no analysis is linked).
    expect(style.showPoints).toBe(false);
    expect(style.showBrackets).toBe(false);

    // The source points at the table, and the y-axis title seeds from its name.
    const source = readPlotSource(built.spec);
    expect(source.tableId).toBe("1");
    expect(style.yTitle).toBe("fakeGFP qPCR");

    expect(built.result.graphType).toBe("bar");
    expect(built.result.errorBar).toBe("sem");
    expect(built.result.columns).toEqual(["Control", "Drug"]);
    expect(built.result.plotId).toBe(built.spec.id);
  });

  it("builds a dot plot that shows points by default", () => {
    const built = buildGraph(
      twoGroupContent(),
      parseMakeGraphArgs({ tableId: "1", type: "dot" }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.type).toBe("columnScatter");
    expect(readPlotStyle(built.spec).showPoints).toBe(true);
  });

  it("carries an explicit title through to the stored style", () => {
    const built = buildGraph(
      twoGroupContent(),
      parseMakeGraphArgs({ tableId: "1", title: "GFP expression" }),
    );
    expect(built.ok && readPlotStyle(built.spec).title).toBe("GFP expression");
  });

  it("links a stored one-way ANOVA and draws brackets when significanceBrackets is set", () => {
    const content = twoGroupContentWithAnova();
    const built = buildGraph(
      content,
      parseMakeGraphArgs({
        tableId: "1",
        type: "bar",
        errorBar: "sem",
        significanceBrackets: true,
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // The stored ANOVA is linked on the source and brackets are turned on, so
    // the engine reads its Tukey comparisons and draws the stars (the model
    // never computes a star).
    expect(readPlotSource(built.spec).analysisId).toBe("an-1");
    expect(readPlotStyle(built.spec).showBrackets).toBe(true);
    expect(built.result.bracketsDrawn).toBe(true);
  });

  it("fails with a run-the-ANOVA-first message when brackets are asked but none is saved", () => {
    const built = buildGraph(
      twoGroupContent(),
      parseMakeGraphArgs({
        tableId: "1",
        type: "bar",
        significanceBrackets: true,
      }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/one-way ANOVA/i);
    expect(built.error).toMatch(/run_datahub_analysis/);
  });

  it("leaves brackets off when significanceBrackets is not set, even with a stored ANOVA", () => {
    const built = buildGraph(
      twoGroupContentWithAnova(),
      parseMakeGraphArgs({ tableId: "1", type: "bar" }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(readPlotStyle(built.spec).showBrackets).toBe(false);
    expect(readPlotSource(built.spec).analysisId).toBeNull();
    expect(built.result.bracketsDrawn).toBe(false);
  });

  it("errors when the table has no group columns to plot", () => {
    const built = buildGraph(
      emptyGroupContent(),
      parseMakeGraphArgs({ tableId: "9" }),
    );
    expect(built.ok).toBe(false);
  });

  it("errors when no named column matches a group", () => {
    const built = buildGraph(
      twoGroupContent(),
      parseMakeGraphArgs({ tableId: "1", columns: ["nope"] }),
    );
    expect(built.ok).toBe(false);
  });

  it("builds a Gardner-Altman estimation figure for a two-group table", () => {
    const built = buildGraph(
      twoGroupContent(),
      parseMakeGraphArgs({ tableId: "1", type: "estimation" }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // Two groups resolve to the Gardner-Altman kind, on both the top-level type
    // and the style.kind the engine reads.
    expect(built.spec.type).toBe("estimationGardnerAltman");
    const style = readPlotStyle(built.spec);
    expect(style.kind).toBe("estimationGardnerAltman");
    // The control defaults to the first plotted group (index 0).
    expect(style.estimationControlIndex).toBe(0);
    expect(built.result.graphType).toBe("estimation");
    expect(built.result.plotKind).toBe("estimationGardnerAltman");
    expect(built.result.control).toBe("Control");
  });

  it("builds a Cumming estimation figure for a three-group table", () => {
    const built = buildGraph(
      threeGroupContent(),
      parseMakeGraphArgs({ tableId: "3", type: "estimation" }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.type).toBe("estimationCumming");
    expect(readPlotStyle(built.spec).kind).toBe("estimationCumming");
    expect(built.result.plotKind).toBe("estimationCumming");
  });

  it("resolves a named control to its index in the difference style", () => {
    const built = buildGraph(
      threeGroupContent(),
      parseMakeGraphArgs({ tableId: "3", type: "estimation", control: "High" }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(readPlotStyle(built.spec).estimationControlIndex).toBe(2);
    expect(built.result.control).toBe("High");
  });

  it("honors paired for a two-group estimation figure", () => {
    const built = buildGraph(
      twoGroupContent(),
      parseMakeGraphArgs({ tableId: "1", type: "estimation", paired: true }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(readPlotStyle(built.spec).estimationPaired).toBe(true);
    expect(built.result.paired).toBe(true);
  });

  it("ignores paired for a three-or-more-group (Cumming) figure per the engine contract", () => {
    const built = buildGraph(
      threeGroupContent(),
      parseMakeGraphArgs({ tableId: "3", type: "estimation", paired: true }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // Paired is only valid for the two-group Gardner-Altman variant, so a Cumming
    // figure never carries it (the engine ignores it for 3+ groups).
    expect(readPlotStyle(built.spec).estimationPaired).toBe(false);
    expect(built.result.paired).toBe(false);
  });

  it("carries the bootstrap settings (ci / B / seed / method) onto the estimation style", () => {
    const built = buildGraph(
      twoGroupContent(),
      parseMakeGraphArgs({
        tableId: "1",
        type: "estimation",
        ci: 0.9,
        bootstrapSamples: 2000,
        seed: 7,
        bootstrapMethod: "percentile",
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const style = readPlotStyle(built.spec);
    expect(style.estimationCi).toBe(0.9);
    expect(style.estimationB).toBe(2000);
    expect(style.estimationSeed).toBe(7);
    expect(style.estimationBootMethod).toBe("percentile");
  });
});

// ---------------------------------------------------------------------------
// make_datahub_graph tool (wiring)
// ---------------------------------------------------------------------------

describe("make_datahub_graph tool", () => {
  it("is previewable, not a gated action (ai review-mode bot)", () => {
    // No `action` flag, so whole-plan mode runs it free. `previewable` true, so
    // step-by-step mode shows a preview-and-confirm block from its synchronous
    // describeAction. No isDestructive hook, the plot write is reversible.
    expect(makeDataHubGraphTool.action).toBeFalsy();
    expect(makeDataHubGraphTool.previewable).toBe(true);
    expect(typeof makeDataHubGraphTool.describeAction).toBe("function");
    expect(makeDataHubGraphTool.isDestructive).toBeUndefined();
  });

  it("builds + stores a PlotSpec, then navigates the user to the figure", async () => {
    const content = twoGroupContent();
    let stored: PlotSpec | null = null;
    vi.spyOn(datahubGraphDeps, "resolveContent").mockResolvedValue(content);
    vi.spyOn(datahubGraphDeps, "persistPlot").mockImplementation(
      async (_id, spec) => {
        stored = spec;
        return true;
      },
    );
    const navigate = vi
      .spyOn(datahubGraphDeps, "navigate")
      .mockImplementation(() => {});

    const out = (await makeDataHubGraphTool.execute({
      tableId: "1",
      type: "bar",
      errorBar: "sem",
    })) as { ok: boolean; plotId: string; graphType: string };

    expect(out.ok).toBe(true);
    expect(out.graphType).toBe("bar");

    // A real PlotSpec was stored (the engine's shape), not a model-drawn figure.
    expect(stored).not.toBeNull();
    const storedSpec = stored as PlotSpec | null;
    expect(storedSpec?.id).toBe(out.plotId);
    expect(readPlotStyle(storedSpec as PlotSpec).kind).toBe("columnBar");
    expect(readPlotStyle(storedSpec as PlotSpec).errorBar).toBe("sem");

    // Hard-wired navigation to the figure deep link, so the user lands on the
    // Graphs view of the just-built plot, not the raw data grid.
    expect(navigate).toHaveBeenCalledWith(`/datahub?doc=1&plot=${out.plotId}`);
  });

  it("does not navigate when the build fails (nothing was stored to show)", async () => {
    vi.spyOn(datahubGraphDeps, "resolveContent").mockResolvedValue(
      emptyGroupContent(),
    );
    const persist = vi
      .spyOn(datahubGraphDeps, "persistPlot")
      .mockResolvedValue(true);
    const navigate = vi
      .spyOn(datahubGraphDeps, "navigate")
      .mockImplementation(() => {});

    const out = (await makeDataHubGraphTool.execute({ tableId: "9" })) as {
      ok: boolean;
    };
    expect(out.ok).toBe(false);
    expect(persist).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("returns a graceful error when the table cannot be opened", async () => {
    vi.spyOn(datahubGraphDeps, "resolveContent").mockResolvedValue(null);
    const out = (await makeDataHubGraphTool.execute({ tableId: "nope" })) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/could not open/i);
  });

  it("returns an error when no tableId is given", async () => {
    const out = (await makeDataHubGraphTool.execute({})) as { ok: boolean };
    expect(out.ok).toBe(false);
  });
});
