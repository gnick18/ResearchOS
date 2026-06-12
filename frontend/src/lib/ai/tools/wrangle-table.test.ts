// Unit tests for wrangle-table.ts (BeakerAI manager, 2026-06-12).
//
// Covers.
//   1. parseWrangleTableArgs - argument coercion.
//   2. parseRecipe - good recipes plus a bad op kind and missing required fields.
//   3. describeWrangleTable - payload shape, one step per op, real engine preview.
//   4. execute - a JOIN pipeline and a GROUPBY pipeline run through the real engine,
//      asserting the derived columns / rows, the derivedFrom { sources, recipe }
//      shape, and navigation after create. Plus error cases.
//
// Runs in the "node" environment (no jsdom). The injectable deps seam means no
// real folder or Loro store is needed. The math itself is gated elsewhere
// (transform/__tests__/transform.gate.test.ts vs pandas); here we assert the
// TOOL maps args -> engine -> derived table + approval payload correctly.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseWrangleTableArgs,
  parseRecipe,
  describeWrangleTable,
  wrangleTableTool,
  wrangleTableDeps,
} from "./wrangle-table";
import {
  cacheTableContent,
  _clearDataHubAnalysisCache,
} from "./datahub-analysis";
import type { DataHubDocContent, DataHubDocument } from "@/lib/datahub/model/types";

// ---------------------------------------------------------------------------
// Fixtures: two small tables that share a "sample" key, for a JOIN; and a
// long-format table with a repeated "group" column, for a GROUPBY.
// ---------------------------------------------------------------------------

const LEFT: DataHubDocContent = {
  meta: {
    id: "tL",
    name: "Samples",
    project_ids: ["p1"],
    folder_path: null,
    table_type: "column",
    created_at: "2026-06-12T00:00:00.000Z",
  },
  columns: [
    { id: "c_sample", name: "sample", role: "y", dataType: "text" },
    { id: "c_mass", name: "mass", role: "y", dataType: "number" },
  ],
  rows: [
    { id: "r1", cells: { c_sample: "A", c_mass: 10 } },
    { id: "r2", cells: { c_sample: "B", c_mass: 20 } },
  ],
  analyses: [],
  plots: [],
};

const RIGHT: DataHubDocContent = {
  meta: {
    id: "tR",
    name: "Reads",
    project_ids: [],
    folder_path: null,
    table_type: "column",
    created_at: "2026-06-12T00:00:00.000Z",
  },
  columns: [
    { id: "c_sample", name: "sample", role: "y", dataType: "text" },
    { id: "c_reads", name: "reads", role: "y", dataType: "number" },
  ],
  rows: [
    { id: "r1", cells: { c_sample: "A", c_reads: 100 } },
    { id: "r2", cells: { c_sample: "B", c_reads: 200 } },
  ],
  analyses: [],
  plots: [],
};

const LONG: DataHubDocContent = {
  meta: {
    id: "tG",
    name: "Measurements",
    project_ids: [],
    folder_path: null,
    table_type: "column",
    created_at: "2026-06-12T00:00:00.000Z",
  },
  columns: [
    { id: "c_group", name: "group", role: "y", dataType: "text" },
    { id: "c_value", name: "value", role: "y", dataType: "number" },
  ],
  rows: [
    { id: "r1", cells: { c_group: "ctrl", c_value: 2 } },
    { id: "r2", cells: { c_group: "ctrl", c_value: 4 } },
    { id: "r3", cells: { c_group: "drug", c_value: 10 } },
    { id: "r4", cells: { c_group: "drug", c_value: 20 } },
  ],
  analyses: [],
  plots: [],
};

const NEW_DOC: DataHubDocument = {
  id: "tNew",
  name: "result",
  project_ids: [],
  folder_path: null,
  table_type: "column",
  created_at: "2026-06-12T00:00:00.000Z",
};

// Read a result column's cells by NAME (engine assigns ids col-1, col-2, ...).
function colCells(content: DataHubDocContent, name: string): (number | string | null)[] {
  const col = content.columns.find((c) => c.name === name);
  if (!col) throw new Error(`column "${name}" not in result`);
  return content.rows.map((r) => r.cells[col.id] ?? null);
}

// ---------------------------------------------------------------------------
// 1. parseWrangleTableArgs
// ---------------------------------------------------------------------------

describe("parseWrangleTableArgs", () => {
  it("parses tableId, recipe, and resultName", () => {
    const parsed = parseWrangleTableArgs({
      tableId: "tL",
      recipe: [{ kind: "select", columns: ["sample"] }],
      resultName: "My table",
    });
    expect(parsed.tableId).toBe("tL");
    expect(Array.isArray(parsed.recipe)).toBe(true);
    expect(parsed.resultName).toBe("My table");
  });

  it("falls back to empty tableId and undefined resultName", () => {
    const parsed = parseWrangleTableArgs({ recipe: [] });
    expect(parsed.tableId).toBe("");
    expect(parsed.resultName).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. parseRecipe
// ---------------------------------------------------------------------------

describe("parseRecipe", () => {
  it("accepts a valid multi-op recipe", () => {
    const parse = parseRecipe([
      { kind: "join", rightRef: "tR", on: ["sample"], how: "inner" },
      { kind: "select", columns: ["sample", "mass", "reads"] },
    ]);
    expect(parse.ok).toBe(true);
    if (parse.ok) expect(parse.recipe).toHaveLength(2);
  });

  it("rejects a non-array recipe", () => {
    const parse = parseRecipe({ kind: "join" });
    expect(parse.ok).toBe(false);
  });

  it("rejects an empty recipe", () => {
    const parse = parseRecipe([]);
    expect(parse.ok).toBe(false);
  });

  it("rejects an unknown op kind with a helpful error", () => {
    const parse = parseRecipe([{ kind: "shuffle", columns: ["a"] }]);
    expect(parse.ok).toBe(false);
    if (!parse.ok) {
      expect(parse.error).toContain("shuffle");
      expect(parse.error).toContain("unknown kind");
    }
  });

  it("rejects a join missing its rightRef", () => {
    const parse = parseRecipe([{ kind: "join", on: ["sample"], how: "inner" }]);
    expect(parse.ok).toBe(false);
    if (!parse.ok) expect(parse.error).toContain("rightRef");
  });

  it("rejects a groupby missing its aggregations", () => {
    const parse = parseRecipe([{ kind: "groupby", by: ["group"] }]);
    expect(parse.ok).toBe(false);
    if (!parse.ok) expect(parse.error).toContain("aggregations");
  });

  it("defaults an absent params object on a folded column op to {}", () => {
    const parse = parseRecipe([{ kind: "normalize" }]);
    expect(parse.ok).toBe(true);
    if (parse.ok) {
      const op = parse.recipe[0] as { kind: string; params: unknown };
      expect(op.params).toEqual({});
    }
  });
});

// ---------------------------------------------------------------------------
// 3. describeWrangleTable
// ---------------------------------------------------------------------------

describe("describeWrangleTable", () => {
  beforeEach(() => {
    _clearDataHubAnalysisCache();
  });

  it("returns a plain summary when the primary is not cached", () => {
    const result = describeWrangleTable({
      tableId: "tL",
      recipe: [{ kind: "join", rightRef: "tR", on: ["sample"], how: "inner" }],
    });
    expect(result.transformPayload).toBeUndefined();
    expect(result.summary).toContain("wrangled");
  });

  it("returns a payload with one step per op and a real final preview (join)", () => {
    cacheTableContent("tL", LEFT);
    cacheTableContent("tR", RIGHT);
    const result = describeWrangleTable({
      tableId: "tL",
      recipe: [{ kind: "join", rightRef: "tR", on: ["sample"], how: "inner" }],
      resultName: "Joined",
    });
    expect(result.transformPayload).toBeDefined();
    const payload = result.transformPayload!;
    expect(payload.kind).toBe("transform");
    expect(payload.toolName).toBe("wrangle_table");
    expect(payload.sourceName).toBe("Samples");
    expect(payload.resultName).toBe("Joined");
    expect(payload.steps).toHaveLength(1);

    const step = payload.steps[0];
    expect(step.kind).toBe("join");
    expect(step.name).toBe("Join");
    expect(step.params.some((p) => p.label === "on" && p.value === "sample")).toBe(true);

    // Preview is the real engine output, not fabricated. The inner join of two
    // 2-row tables on "sample" yields sample / mass / reads.
    expect(step.preview).toBeDefined();
    expect(step.preview!.columns).toEqual(["sample", "mass", "reads"]);
  });

  it("emits the final preview on the LAST op of a multi-step recipe", () => {
    cacheTableContent("tL", LEFT);
    cacheTableContent("tR", RIGHT);
    const result = describeWrangleTable({
      tableId: "tL",
      recipe: [
        { kind: "join", rightRef: "tR", on: ["sample"], how: "inner" },
        { kind: "select", columns: ["sample", "reads"] },
      ],
    });
    const steps = result.transformPayload!.steps;
    expect(steps).toHaveLength(2);
    // Intermediate op carries no preview; final op carries the real result.
    expect(steps[0].preview).toBeUndefined();
    expect(steps[1].preview).toBeDefined();
    expect(steps[1].preview!.columns).toEqual(["sample", "reads"]);
  });
});

// ---------------------------------------------------------------------------
// 4. execute: JOIN and GROUPBY pipelines through the real engine
// ---------------------------------------------------------------------------

describe("wrangleTableTool.execute", () => {
  const navigate = vi.fn();
  const createTable = vi.fn().mockResolvedValue(NEW_DOC);

  // getContent resolves the primary plus any join / union source by id.
  const getContent = vi.fn(async (id: string): Promise<DataHubDocContent | null> => {
    if (id === "tL") return LEFT;
    if (id === "tR") return RIGHT;
    if (id === "tG") return LONG;
    return null;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    _clearDataHubAnalysisCache();
    wrangleTableDeps.getContent = getContent;
    wrangleTableDeps.createTable = createTable;
    wrangleTableDeps.navigate = navigate;
  });

  it("runs a JOIN pipeline and writes the recipe-shaped derivedFrom", async () => {
    const recipe = [{ kind: "join", rightRef: "tR", on: ["sample"], how: "inner" }];
    const result = await wrangleTableTool.execute({
      tableId: "tL",
      recipe,
      resultName: "Samples joined",
    });
    expect(result).toMatchObject({ ok: true, tableId: "tNew" });

    const createCall = createTable.mock.calls[0][0];

    // Recipe-shaped link: sources[0] is the primary, then the join target. No
    // legacy single-op fields.
    expect(createCall.derivedFrom.sources).toEqual(["tL", "tR"]);
    expect(createCall.derivedFrom.recipe).toEqual(recipe);
    expect(createCall.derivedFrom.sourceTableId).toBeUndefined();
    expect(createCall.derivedFrom.transform).toBeUndefined();

    // The engine joined the two tables: 2 rows, columns sample / mass / reads.
    const derived: DataHubDocContent = {
      meta: { ...createCall, id: "tNew", created_at: "x", folder_path: null, project_ids: [] },
      columns: createCall.columns,
      rows: createCall.rows,
      analyses: [],
      plots: [],
    };
    expect(derived.columns.map((c) => c.name)).toEqual(["sample", "mass", "reads"]);
    expect(derived.rows).toHaveLength(2);
    expect(colCells(derived, "reads")).toEqual([100, 200]);

    // project_ids inherit from the primary; navigates to the new table.
    expect(createCall.project_ids).toEqual(["p1"]);
    expect(navigate).toHaveBeenCalledWith("/datahub?doc=tNew");
  });

  it("runs a GROUPBY pipeline and aggregates through the engine", async () => {
    const recipe = [
      {
        kind: "groupby",
        by: ["group"],
        aggregations: [{ column: "value", func: "mean" }],
      },
    ];
    const result = await wrangleTableTool.execute({ tableId: "tG", recipe });
    expect(result).toMatchObject({ ok: true });

    const createCall = createTable.mock.calls[0][0];
    // A single-source recipe records just the primary.
    expect(createCall.derivedFrom.sources).toEqual(["tG"]);

    const derived: DataHubDocContent = {
      meta: { id: "tNew", name: "x", project_ids: [], folder_path: null, table_type: "column", created_at: "x" },
      columns: createCall.columns,
      rows: createCall.rows,
      analyses: [],
      plots: [],
    };
    // group + value_mean (default agg output name), two groups.
    expect(derived.columns.map((c) => c.name)).toEqual(["group", "value_mean"]);
    expect(colCells(derived, "group")).toEqual(["ctrl", "drug"]);
    // ctrl mean = (2+4)/2 = 3, drug mean = (10+20)/2 = 15.
    expect(colCells(derived, "value_mean")).toEqual([3, 15]);

    // Default name when resultName absent.
    expect(createCall.name).toBe("Measurements (wrangled)");
  });

  it("returns ok:false with no tableId", async () => {
    const result = await wrangleTableTool.execute({ recipe: [{ kind: "select", columns: ["a"] }] });
    expect(result).toMatchObject({ ok: false });
    expect(createTable).not.toHaveBeenCalled();
  });

  it("returns ok:false on an invalid recipe (bad op kind)", async () => {
    const result = await wrangleTableTool.execute({
      tableId: "tL",
      recipe: [{ kind: "frobnicate" }],
    });
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain("frobnicate");
    expect(createTable).not.toHaveBeenCalled();
  });

  it("returns ok:false when a join source cannot be read", async () => {
    const result = await wrangleTableTool.execute({
      tableId: "tL",
      recipe: [{ kind: "join", rightRef: "tMissing", on: ["sample"], how: "inner" }],
    });
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain("tMissing");
    expect(createTable).not.toHaveBeenCalled();
  });

  it("returns ok:false when the primary cannot be read", async () => {
    const result = await wrangleTableTool.execute({
      tableId: "tNope",
      recipe: [{ kind: "select", columns: ["a"] }],
    });
    expect(result).toMatchObject({ ok: false });
    expect(createTable).not.toHaveBeenCalled();
  });

  it("surfaces an engine error as ok:false (join on a missing key column)", async () => {
    const result = await wrangleTableTool.execute({
      tableId: "tL",
      recipe: [{ kind: "join", rightRef: "tR", on: ["nope"], how: "inner" }],
    });
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain("could not run");
    expect(createTable).not.toHaveBeenCalled();
  });
});
