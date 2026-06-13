/**
 * dataset-analyses.test.ts (DataHub-largetables lane, Phase 3a)
 *
 * THE VALIDATION-GATE PARITY TEST. This is the point of Phase 3a: prove that an
 * analysis run on the DATASET lane (DuckDB path) returns NUMBERS IDENTICAL to the
 * same analysis on the EDITABLE lane (the validated engine path) for the same
 * data. Both lanes ultimately call the SAME runAnalysis -> validated engine, so
 * "identical" is the contract: the dataset lane only MOVES the data into arrays.
 *
 * DuckDB cannot run under vitest (the WASM worker), so we mock duckdb-client.query
 * to serve a small in-memory table. The mock recognizes the THREE exact query
 * shapes the column readers emit (a single value column aliased `v`; several
 * aligned columns aliased `c0..cN`; a value+group pair aliased `v`,`g`) and serves
 * the corresponding rows from the in-memory table, so the readers' SQL projection
 * and array-shaping ARE exercised, only the engine is the in-process DuckDB stand
 * in. What is NOT covered here (and needs live verification) is the real DuckDB
 * SQL execution and the recipe-to-SQL compile, noted in the report.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory table + a query() mock that serves the column readers' three shapes.
// ---------------------------------------------------------------------------

// The fixture table: a "value" column, a "group" label column (tidy / long), and
// two more numeric columns for the wide / aligned (paired) path. Deliberately
// includes a null and a non-numeric cell so the finite-only coercion is tested.
type Cell = number | string | null;
interface FixtureTable {
  columns: string[];
  rows: Cell[][];
}

let FIXTURE: FixtureTable;

// A tiny Arrow-Table stand-in: toArray() yields one object per row keyed by the
// SELECT alias, and schema.fields lists the alias names (unused by these readers).
function arrowLike(rows: Record<string, Cell>[]) {
  return {
    toArray: () => rows,
    schema: { fields: rows.length ? Object.keys(rows[0]).map((name) => ({ name })) : [] },
  };
}

// Recognize the reader query shapes by their alias pattern and serve the matching
// projection from FIXTURE. This is a deliberately narrow parser: it only needs to
// satisfy the exact SQL the three readers emit (see dataset-columns.ts).
function runMockQuery(sql: string) {
  const colIndex = (name: string) => FIXTURE.columns.indexOf(name);
  const quoted = (s: string): string[] => {
    // Pull every "..." quoted identifier out of the SELECT list, in order.
    const m = s.match(/"([^"]+)"/g) ?? [];
    return m.map((q) => q.slice(1, -1));
  };

  // Shape 1: SELECT "X" AS v FROM ...  (readColumn)
  if (/AS v\b/.test(sql) && !/AS g\b/.test(sql)) {
    const name = quoted(sql)[0];
    const i = colIndex(name);
    return arrowLike(FIXTURE.rows.map((r) => ({ v: r[i] })));
  }

  // Shape 2: SELECT "X" AS v, "Y" AS g FROM ...  (readColumnByGroup)
  if (/AS v\b/.test(sql) && /AS g\b/.test(sql)) {
    const names = quoted(sql);
    const vi = colIndex(names[0]);
    const gi = colIndex(names[1]);
    return arrowLike(FIXTURE.rows.map((r) => ({ v: r[vi], g: r[gi] })));
  }

  // Shape 3: SELECT "A" AS c0, "B" AS c1, ... FROM ...  (readColumnAligned)
  if (/AS c0\b/.test(sql)) {
    const names = quoted(sql);
    return arrowLike(
      FIXTURE.rows.map((r) => {
        const o: Record<string, Cell> = {};
        names.forEach((n, k) => {
          o[`c${k}`] = r[colIndex(n)];
        });
        return o;
      }),
    );
  }

  throw new Error(`mock query did not recognize SQL: ${sql}`);
}

vi.mock("../duckdb-client", () => ({
  query: vi.fn(async (sql: string) => runMockQuery(sql)),
  // The readers never call these, but dataset-view (imported transitively for
  // fromSource / quoteIdent) pulls them from the module, so stub them out.
  init: vi.fn(async () => {}),
  registerParquetBuffer: vi.fn(async () => {}),
  dropFileBuffer: vi.fn(async () => {}),
  copyQueryToParquet: vi.fn(async () => new Uint8Array()),
}));

// dataset-view also imports dataset-store (fileService) and sql-codegen; the
// readers only use fromSource with NO recipe, so recipeToSql is never invoked.
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    async readJson() {
      return null;
    },
    async writeJson() {},
    async readFileAsBlob() {
      return null;
    },
    async writeFileFromBlob() {},
  },
}));

import { runAnalysisOnDataset } from "../dataset-analyses";
import type { OpenDatasetHandle } from "../dataset-view";
import type { DatasetSidecar } from "../types";
import { runAnalysis } from "@/lib/datahub/run-analysis";
import type {
  AnalysisSpec,
  ColumnDef,
  DataHubDocContent,
  RowRecord,
  CellValue,
} from "@/lib/datahub/model/types";

// ---------------------------------------------------------------------------
// Helpers: build the editable-lane content for the SAME data the fixture holds.
// ---------------------------------------------------------------------------

const HANDLE: OpenDatasetHandle = {
  id: "ds1",
  fileName: "ds1.parquet",
  owner: "u1",
  columnNames: [],
};

function sidecar(columns: string[]): DatasetSidecar {
  return {
    schemaVersion: 1,
    id: "ds1",
    name: "Fixture",
    schema: columns.map((name) => ({ name, type: "number", nullCount: 0, sample: [] })),
    rowCount: FIXTURE.rows.length,
    colCount: columns.length,
    source: { kind: "paste" },
    recipe: [],
    project_ids: [],
    folder_path: null,
    created_at: "",
    updated_at: "",
  };
}

/** Build an editable Column table whose columns are the given finite arrays. */
function editableWide(cols: { name: string; values: number[] }[]): DataHubDocContent {
  const columns: ColumnDef[] = cols.map((c, i) => ({
    id: `c${i}`,
    name: c.name,
    role: "y",
    dataType: "number",
  }));
  const maxLen = cols.reduce((m, c) => Math.max(m, c.values.length), 0);
  const rows: RowRecord[] = [];
  for (let r = 0; r < maxLen; r++) {
    const cells: Record<string, CellValue> = {};
    cols.forEach((c, i) => {
      cells[`c${i}`] = c.values[r] === undefined ? null : c.values[r];
    });
    rows.push({ id: `r${r}`, cells });
  }
  return {
    meta: {
      id: "t1",
      name: "T",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: "",
    },
    columns,
    rows,
    analyses: [],
    plots: [],
  };
}

function spec(type: string, columnIds: string[], params: Record<string, unknown> = {}): AnalysisSpec {
  return { id: "a1", type, params, inputs: { columnIds }, resultCache: null, resultStale: false };
}

// Pull the comparable scalar fields out of a normalized result for the assertion.
function statsOf(outcome: unknown): Record<string, number> {
  const o = outcome as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const k of ["statistic", "pValue", "df", "effectSize", "meanDiff"]) {
    if (typeof o[k] === "number" && Number.isFinite(o[k] as number)) out[k] = o[k] as number;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dataset-lane parity with the editable lane (validation gate)", () => {
  it("unpaired t-test: GROUP-BY tidy mode matches the editable two-column run", async () => {
    // Tidy / long: one value column, one group column. A null value and a
    // non-numeric value are dropped by both lanes identically.
    const groupA = [12, 15, 14, 11, 13];
    const groupB = [22, 19, 25, 21, 20];
    FIXTURE = {
      columns: ["value", "group"],
      rows: [
        ...groupA.map((v) => [v, "A"] as Cell[]),
        ...groupB.map((v) => [v, "B"] as Cell[]),
        [null, "A"],
        ["nope", "B"],
      ],
    };

    const datasetOutcome = await runAnalysisOnDataset(
      HANDLE,
      spec("unpairedTTest", ["value"]),
      sidecar(["value", "group"]),
      { groupByColumn: "group" },
    );

    const editableOutcome = runAnalysis(
      spec("unpairedTTest", ["c0", "c1"]),
      editableWide([
        { name: "A", values: groupA },
        { name: "B", values: groupB },
      ]),
    );

    expect(datasetOutcome.ok).toBe(true);
    expect(editableOutcome.ok).toBe(true);
    const d = statsOf(datasetOutcome);
    const e = statsOf(editableOutcome);
    expect(Object.keys(d).length).toBeGreaterThan(0);
    for (const k of Object.keys(e)) {
      expect(d[k]).toBeCloseTo(e[k], 10);
    }
  });

  it("one-way ANOVA: GROUP-BY mode across three categories matches the editable three-column run", async () => {
    const g1 = [5, 6, 7, 6, 5];
    const g2 = [8, 9, 7, 8, 10];
    const g3 = [12, 11, 13, 14, 12];
    FIXTURE = {
      columns: ["measure", "treatment"],
      rows: [
        ...g1.map((v) => [v, "ctrl"] as Cell[]),
        ...g2.map((v) => [v, "low"] as Cell[]),
        ...g3.map((v) => [v, "high"] as Cell[]),
      ],
    };

    const datasetOutcome = await runAnalysisOnDataset(
      HANDLE,
      spec("oneWayAnova", ["measure"]),
      sidecar(["measure", "treatment"]),
      { groupByColumn: "treatment" },
    );

    const editableOutcome = runAnalysis(
      spec("oneWayAnova", ["c0", "c1", "c2"]),
      editableWide([
        { name: "ctrl", values: g1 },
        { name: "low", values: g2 },
        { name: "high", values: g3 },
      ]),
    );

    expect(datasetOutcome.ok).toBe(true);
    expect(editableOutcome.ok).toBe(true);
    const d = statsOf(datasetOutcome);
    const e = statsOf(editableOutcome);
    expect(d.statistic).toBeCloseTo(e.statistic, 10);
    expect(d.pValue).toBeCloseTo(e.pValue, 10);
  });

  it("unpaired t-test: WIDE column mode matches the editable run on the same columns", async () => {
    const a = [3.1, 4.2, 2.9, 3.8, 3.3];
    const b = [5.5, 6.1, 5.9, 6.4, 5.2];
    FIXTURE = {
      columns: ["A", "B"],
      rows: a.map((v, i) => [v, b[i]] as Cell[]),
    };

    const datasetOutcome = await runAnalysisOnDataset(
      HANDLE,
      spec("unpairedTTest", ["A", "B"]),
      sidecar(["A", "B"]),
    );
    const editableOutcome = runAnalysis(
      spec("unpairedTTest", ["c0", "c1"]),
      editableWide([
        { name: "A", values: a },
        { name: "B", values: b },
      ]),
    );

    const d = statsOf(datasetOutcome);
    const e = statsOf(editableOutcome);
    for (const k of Object.keys(e)) expect(d[k]).toBeCloseTo(e[k], 10);
  });

  it("paired t-test: WIDE mode pairs by position, matching the editable per-column run", async () => {
    // The editable paired t reads each column's finite values INDEPENDENTLY and
    // pairs by array position (it does NOT drop listwise), so the dataset lane
    // reads each column independently too. Equal-length, fully-finite columns make
    // the positional pairing unambiguous and identical across both lanes.
    const before = [10, 12, 9, 11, 13, 8];
    const after = [14, 15, 12, 13, 16, 10];
    FIXTURE = {
      columns: ["before", "after"],
      rows: before.map((v, i) => [v, after[i]] as Cell[]),
    };

    const datasetOutcome = await runAnalysisOnDataset(
      HANDLE,
      spec("pairedTTest", ["before", "after"]),
      sidecar(["before", "after"]),
    );
    const editableOutcome = runAnalysis(
      spec("pairedTTest", ["c0", "c1"]),
      editableWide([
        { name: "before", values: before },
        { name: "after", values: after },
      ]),
    );

    expect(datasetOutcome.ok).toBe(true);
    expect(editableOutcome.ok).toBe(true);
    const d = statsOf(datasetOutcome);
    const e = statsOf(editableOutcome);
    expect(d.statistic).toBeCloseTo(e.statistic, 10);
    expect(d.pValue).toBeCloseTo(e.pValue, 10);
    expect(d.df).toBeCloseTo(e.df, 10);
  });

  it("multiple regression: WIDE listwise mode matches the editable row-aligned run", async () => {
    // Multiple regression drops a row with any missing Y or predictor (listwise),
    // so the dataset lane reads the columns aligned by row. A row with a null in a
    // predictor is dropped by both lanes identically.
    const yv = [2.1, 3.4, 1.9, 4.2, 3.0, 2.6, 3.8];
    const x1 = [1.0, 2.0, 0.8, 3.1, 2.2, 1.5, 2.9];
    const x2 = [5.0, 4.2, 5.5, 3.8, 4.0, 4.7, 3.9];
    FIXTURE = {
      columns: ["y", "x1", "x2"],
      rows: [
        ...yv.map((v, i) => [v, x1[i], x2[i]] as Cell[]),
        [9.9, null, 1.0], // dropped listwise (predictor null) in both lanes
      ],
    };

    const datasetOutcome = await runAnalysisOnDataset(
      HANDLE,
      spec("multipleRegression", ["y", "x1", "x2"]),
      sidecar(["y", "x1", "x2"]),
    );
    const editableOutcome = runAnalysis(
      spec("multipleRegression", ["c0", "c1", "c2"]),
      editableWide([
        { name: "y", values: [...yv, 9.9] },
        { name: "x1", values: [...x1] }, // shorter -> last row null in x1, dropped
        { name: "x2", values: [...x2, 1.0] },
      ]),
    );

    expect(datasetOutcome.ok).toBe(true);
    expect(editableOutcome.ok).toBe(true);
    const dr = datasetOutcome as unknown as Record<string, unknown>;
    const er = editableOutcome as unknown as Record<string, unknown>;
    expect(dr.n).toBe(er.n);
    expect(dr.rSquared as number).toBeCloseTo(er.rSquared as number, 10);
    expect(dr.fStatistic as number).toBeCloseTo(er.fStatistic as number, 10);
  });

  it("rejects a row-paired analysis in group-by mode (no soft data trap)", async () => {
    FIXTURE = { columns: ["value", "group"], rows: [[1, "A"], [2, "B"]] };
    const outcome = await runAnalysisOnDataset(
      HANDLE,
      spec("pairedTTest", ["value"]),
      sidecar(["value", "group"]),
      { groupByColumn: "group" },
    );
    expect(outcome.ok).toBe(false);
  });
});
