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
  resolveGraphColumns,
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
});

// ---------------------------------------------------------------------------
// make_datahub_graph tool (wiring)
// ---------------------------------------------------------------------------

describe("make_datahub_graph tool", () => {
  it("is NOT a gated action, so a build never raises an approval request", () => {
    expect(makeDataHubGraphTool.action).toBeFalsy();
    expect(makeDataHubGraphTool.describeAction).toBeUndefined();
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
