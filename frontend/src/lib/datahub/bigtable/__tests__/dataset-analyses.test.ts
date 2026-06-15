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

  // Shape 4: SELECT "V" AS dv, "A" AS la, "B" AS lb  (readValueAndTwoLabels)
  if (/AS dv\b/.test(sql) && /AS la\b/.test(sql) && /AS lb\b/.test(sql)) {
    const names = quoted(sql);
    const vi = colIndex(names[0]);
    const ai = colIndex(names[1]);
    const bi = colIndex(names[2]);
    return arrowLike(
      FIXTURE.rows.map((r) => ({ dv: r[vi], la: r[ai], lb: r[bi] })),
    );
  }

  // Shape 5: SELECT "A" AS la, "B" AS lb  (readContingencyCounts, no dv)
  if (/AS la\b/.test(sql) && /AS lb\b/.test(sql)) {
    const names = quoted(sql);
    const ai = colIndex(names[0]);
    const bi = colIndex(names[1]);
    return arrowLike(FIXTURE.rows.map((r) => ({ la: r[ai], lb: r[bi] })));
  }

  // Shape 6: SELECT "T" AS st, "E" AS se [, "G" AS sg]  (readSurvivalRows)
  if (/AS st\b/.test(sql) && /AS se\b/.test(sql)) {
    const names = quoted(sql);
    const ti = colIndex(names[0]);
    const ei = colIndex(names[1]);
    const hasGroup = /AS sg\b/.test(sql);
    const gi = hasGroup ? colIndex(names[2]) : -1;
    return arrowLike(
      FIXTURE.rows.map((r) => {
        const o: Record<string, Cell> = { st: r[ti], se: r[ei] };
        if (hasGroup) o.sg = r[gi];
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

  it("Pearson correlation: WIDE mode pairs the two columns by row, matching the editable XY run", async () => {
    // Correlation is row-aligned (complete-case): a row contributes a pair only
    // when BOTH columns are finite in it. The fixture includes a row with a null
    // in X and a non-numeric in Y so both lanes drop the same rows, and the
    // dataset r must equal the editable XY r to many digits.
    const xv = [1.0, 2.0, 3.0, 4.0, 5.0, 6.5, 7.2];
    const yv = [2.1, 3.9, 6.2, 7.8, 10.1, 13.0, 14.4];
    FIXTURE = {
      columns: ["x", "y"],
      rows: [
        ...xv.map((v, i) => [v, yv[i]] as Cell[]),
        [null, 9.9], // dropped: X missing
        [3.3, "nope"], // dropped: Y non-numeric
      ],
    };

    const datasetOutcome = await runAnalysisOnDataset(
      HANDLE,
      spec("correlationPearson", ["x", "y"]),
      sidecar(["x", "y"]),
    );

    // The editable lane reads correlation off an XY table (one role-x, one
    // role-y column), complete-case paired by row.
    const editableXY: DataHubDocContent = {
      meta: {
        id: "t1",
        name: "T",
        project_ids: [],
        folder_path: null,
        table_type: "xy",
        created_at: "",
      },
      columns: [
        { id: "cx", name: "x", role: "x", dataType: "number" },
        { id: "cy", name: "y", role: "y", dataType: "number" },
      ],
      rows: xv.map((v, i) => ({
        id: `r${i}`,
        cells: { cx: v, cy: yv[i] } as Record<string, CellValue>,
      })),
      analyses: [],
      plots: [],
    };
    const editableOutcome = runAnalysis(spec("correlationPearson", ["cy"]), editableXY);

    expect(datasetOutcome.ok).toBe(true);
    expect(editableOutcome.ok).toBe(true);
    const d = datasetOutcome as unknown as Record<string, unknown>;
    const e = editableOutcome as unknown as Record<string, unknown>;
    // Row-aligned / complete-case: exactly the 7 finite pairs survive in both.
    expect(d.n).toBe(7);
    expect(d.n).toBe(e.n);
    expect(d.coefficient as number).toBeCloseTo(e.coefficient as number, 12);
    expect(d.pValue as number).toBeCloseTo(e.pValue as number, 12);
    expect(d.statistic as number).toBeCloseTo(e.statistic as number, 12);
  });

  // --- Single-Y XY family parity (linear / logistic regression, dose-response,
  //     ROC), all through the synthetic XY path. For each, the dataset-lane outcome
  //     must be numbers-identical to an editable XY run on the same pairs. ---

  /** An editable XY table (one role-x, one role-y) over the given pairs. */
  function editableXY(xv: number[], yv: number[]): DataHubDocContent {
    return {
      meta: {
        id: "t1",
        name: "T",
        project_ids: [],
        folder_path: null,
        table_type: "xy",
        created_at: "",
      },
      columns: [
        { id: "cx", name: "x", role: "x", dataType: "number" },
        { id: "cy", name: "y", role: "y", dataType: "number" },
      ],
      rows: xv.map((v, i) => ({
        id: `r${i}`,
        cells: { cx: v, cy: yv[i] } as Record<string, CellValue>,
      })),
      analyses: [],
      plots: [],
    };
  }

  /** Flatten every finite numeric leaf of a result, keyed by path. */
  function numericLeaves(
    o: unknown,
    prefix = "",
    out: Record<string, number> = {},
  ): Record<string, number> {
    if (typeof o === "number") {
      if (Number.isFinite(o)) out[prefix] = o;
      return out;
    }
    if (Array.isArray(o)) {
      o.forEach((v, i) => numericLeaves(v, `${prefix}[${i}]`, out));
      return out;
    }
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o))
        numericLeaves(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return out;
  }

  /** Assert two outcomes carry numbers-identical results (same engine, same data). */
  function expectSameNumbers(dataset: unknown, editable: unknown) {
    const d = numericLeaves(dataset);
    const e = numericLeaves(editable);
    const common = Object.keys(d).filter((k) => k in e);
    expect(common.length).toBeGreaterThan(2);
    for (const k of common) expect(d[k]).toBeCloseTo(e[k], 10);
  }

  it("linear regression: WIDE XY matches the editable XY run", async () => {
    const xv = [1, 2, 3, 4, 5, 6.5, 7.2];
    const yv = [2.1, 3.9, 6.2, 7.8, 10.1, 13.0, 14.4];
    FIXTURE = {
      columns: ["x", "y"],
      rows: [
        ...xv.map((v, i) => [v, yv[i]] as Cell[]),
        [null, 9.9],
        [3.3, "nope"],
      ],
    };
    const dataset = await runAnalysisOnDataset(
      HANDLE,
      spec("linearRegression", ["x", "y"]),
      sidecar(["x", "y"]),
    );
    const editable = runAnalysis(spec("linearRegression", ["cy"]), editableXY(xv, yv));
    expect(dataset.ok).toBe(true);
    expect(editable.ok).toBe(true);
    expectSameNumbers(dataset, editable);
  });

  it("dose-response: WIDE XY matches the editable XY run (defaults to 4PL)", async () => {
    // A monotone sigmoid-ish dose / response so the 4PL fit converges.
    const xv = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100];
    const yv = [2, 5, 12, 28, 50, 72, 88, 95, 98];
    FIXTURE = { columns: ["dose", "resp"], rows: xv.map((v, i) => [v, yv[i]] as Cell[]) };
    const dataset = await runAnalysisOnDataset(
      HANDLE,
      spec("doseResponse", ["dose", "resp"]),
      sidecar(["dose", "resp"]),
    );
    const editable = runAnalysis(spec("doseResponse", ["cy"]), editableXY(xv, yv));
    expect(dataset.ok).toBe(true);
    expect(editable.ok).toBe(true);
    expectSameNumbers(dataset, editable);
  });

  it("logistic regression: WIDE XY (binary Y) matches the editable XY run", async () => {
    const xv = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const yv = [0, 0, 0, 0, 1, 0, 1, 1, 1, 1];
    FIXTURE = { columns: ["x", "y"], rows: xv.map((v, i) => [v, yv[i]] as Cell[]) };
    const dataset = await runAnalysisOnDataset(
      HANDLE,
      spec("logisticRegression", ["x", "y"]),
      sidecar(["x", "y"]),
    );
    const editable = runAnalysis(spec("logisticRegression", ["cy"]), editableXY(xv, yv));
    expect(dataset.ok).toBe(true);
    expect(editable.ok).toBe(true);
    expectSameNumbers(dataset, editable);
  });

  it("ROC curve: WIDE XY (score + 0/1 label) matches the editable XY run", async () => {
    const xv = [0.1, 0.4, 0.35, 0.8, 0.2, 0.9, 0.55, 0.7, 0.3, 0.6];
    const yv = [0, 0, 1, 1, 0, 1, 1, 1, 0, 0];
    FIXTURE = { columns: ["score", "label"], rows: xv.map((v, i) => [v, yv[i]] as Cell[]) };
    const dataset = await runAnalysisOnDataset(
      HANDLE,
      spec("rocCurve", ["score", "label"]),
      sidecar(["score", "label"]),
    );
    const editable = runAnalysis(spec("rocCurve", ["cy"]), editableXY(xv, yv));
    expect(dataset.ok).toBe(true);
    expect(editable.ok).toBe(true);
    expectSameNumbers(dataset, editable);
  });

  // --- Whole-table multi-column parity (two-way ANOVA, contingency, survival,
  //     nested). Tidy data goes dataset -> reader -> synthetic table; compared to a
  //     hand-built canonical editable table holding the same numbers. ---

  function content(
    table_type: string,
    columns: DataHubDocContent["columns"],
    rows: { id: string; cells: Record<string, CellValue> }[],
  ): DataHubDocContent {
    return {
      meta: { id: "t1", name: "T", project_ids: [], folder_path: null, table_type: table_type as DataHubDocContent["meta"]["table_type"], created_at: "" },
      columns,
      rows,
      analyses: [],
      plots: [],
    };
  }

  it("two-way ANOVA: tidy value+2 factors matches the editable grouped run", async () => {
    FIXTURE = {
      columns: ["val", "fa", "fb"],
      rows: [
        [10.5, "D1", "Ctrl"], [11.2, "D1", "Ctrl"],
        [15.3, "D1", "Trt"], [14.8, "D1", "Trt"],
        [12.1, "D2", "Ctrl"], [13.4, "D2", "Ctrl"],
        [18.9, "D2", "Trt"], [19.2, "D2", "Trt"],
      ],
    };
    const dataset = await runAnalysisOnDataset(
      HANDLE,
      spec("twoWayAnova", ["val", "fa", "fb"], { postHocFactor: "none" }),
      sidecar(["val", "fa", "fb"]),
    );
    const editable = runAnalysis(
      spec("twoWayAnova", [], { postHocFactor: "none" }),
      content(
        "grouped",
        [
          { id: "rowlabel", name: "Factor A", role: "x", dataType: "text" },
          { id: "ec0", name: "Ctrl", role: "y", dataType: "number", datasetId: "dc", subcolumnKind: "replicate" },
          { id: "ec1", name: "Ctrl", role: "y", dataType: "number", datasetId: "dc", subcolumnKind: "replicate" },
          { id: "et0", name: "Trt", role: "y", dataType: "number", datasetId: "dt", subcolumnKind: "replicate" },
          { id: "et1", name: "Trt", role: "y", dataType: "number", datasetId: "dt", subcolumnKind: "replicate" },
        ],
        [
          { id: "r1", cells: { rowlabel: "D1", ec0: 10.5, ec1: 11.2, et0: 15.3, et1: 14.8 } },
          { id: "r2", cells: { rowlabel: "D2", ec0: 12.1, ec1: 13.4, et0: 18.9, et1: 19.2 } },
        ],
      ),
    );
    expect(dataset.ok).toBe(true);
    expect(editable.ok).toBe(true);
    expectSameNumbers(dataset, editable);
  });

  it("contingency: tidy two categoricals matches the editable count-matrix run", async () => {
    FIXTURE = {
      columns: ["exposure", "outcome"],
      rows: [
        ["Exp", "Dis"], ["Exp", "Dis"], ["Exp", "Dis"], ["Exp", "No"],
        ["Unexp", "Dis"], ["Unexp", "No"], ["Unexp", "No"], ["Unexp", "No"],
      ],
    };
    const dataset = await runAnalysisOnDataset(
      HANDLE,
      spec("contingency", ["exposure", "outcome"]),
      sidecar(["exposure", "outcome"]),
    );
    const editable = runAnalysis(
      spec("contingency", []),
      content(
        "contingency",
        [
          { id: "rowlabel", name: "Row factor", role: "x", dataType: "text" },
          { id: "c0", name: "Dis", role: "y", dataType: "number" },
          { id: "c1", name: "No", role: "y", dataType: "number" },
        ],
        [
          { id: "r1", cells: { rowlabel: "Exp", c0: 3, c1: 1 } },
          { id: "r2", cells: { rowlabel: "Unexp", c0: 1, c1: 3 } },
        ],
      ),
    );
    expect(dataset.ok).toBe(true);
    expect(editable.ok).toBe(true);
    expectSameNumbers(dataset, editable);
  });

  const survRows: Array<[number, number, string]> = [
    [10.5, 1, "Control"], [15.2, 0, "Control"], [9.1, 1, "Control"], [20, 0, "Control"],
    [8.3, 1, "Treated"], [20.1, 1, "Treated"], [12, 1, "Treated"], [18, 0, "Treated"],
  ];
  const survEditable = () =>
    content(
      "survival",
      [
        { id: "time", name: "Time", role: "x", dataType: "number" },
        { id: "event", name: "Event", role: "y", dataType: "number" },
        { id: "group", name: "Group", role: "group", dataType: "text" },
      ],
      survRows.map(([t, e, g], i) => ({ id: `s${i}`, cells: { time: t, event: e, group: g } })),
    );

  it("Kaplan-Meier: tidy time+event+group matches the editable survival run", async () => {
    FIXTURE = { columns: ["t", "e", "g"], rows: survRows.map((r) => [...r] as Cell[]) };
    const dataset = await runAnalysisOnDataset(
      HANDLE,
      spec("kaplanMeier", ["t", "e", "g"]),
      sidecar(["t", "e", "g"]),
    );
    const editable = runAnalysis(spec("kaplanMeier", []), survEditable());
    expect(dataset.ok).toBe(true);
    expect(editable.ok).toBe(true);
    expectSameNumbers(dataset, editable);
  });

  it("Cox regression: tidy time+event+group matches the editable survival run", async () => {
    FIXTURE = { columns: ["t", "e", "g"], rows: survRows.map((r) => [...r] as Cell[]) };
    const dataset = await runAnalysisOnDataset(
      HANDLE,
      spec("coxRegression", ["t", "e", "g"]),
      sidecar(["t", "e", "g"]),
    );
    const editable = runAnalysis(spec("coxRegression", []), survEditable());
    expect(dataset.ok).toBe(true);
    expect(editable.ok).toBe(true);
    expectSameNumbers(dataset, editable);
  });

  it("nested t-test: tidy value+group+subgroup matches the editable nested run", async () => {
    FIXTURE = {
      columns: ["val", "grp", "sub"],
      rows: [
        [5.2, "Control", "S1"], [5.5, "Control", "S1"], [5.1, "Control", "S1"],
        [6.1, "Control", "S2"], [6.3, "Control", "S2"], [6.0, "Control", "S2"],
        [8.3, "Drug", "S3"], [8.1, "Drug", "S3"], [8.5, "Drug", "S3"],
        [7.9, "Drug", "S4"], [8.2, "Drug", "S4"], [7.8, "Drug", "S4"],
      ],
    };
    const dataset = await runAnalysisOnDataset(
      HANDLE,
      spec("nestedTTest", ["val", "grp", "sub"]),
      sidecar(["val", "grp", "sub"]),
    );
    const editable = runAnalysis(
      spec("nestedTTest", []),
      content(
        "nested",
        [
          { id: "g0s0", name: "S1", role: "y", dataType: "number", datasetId: "d0", subcolumnKind: "replicate", groupName: "Control" },
          { id: "g0s1", name: "S2", role: "y", dataType: "number", datasetId: "d0", subcolumnKind: "replicate", groupName: "Control" },
          { id: "g1s0", name: "S3", role: "y", dataType: "number", datasetId: "d1", subcolumnKind: "replicate", groupName: "Drug" },
          { id: "g1s1", name: "S4", role: "y", dataType: "number", datasetId: "d1", subcolumnKind: "replicate", groupName: "Drug" },
        ],
        [
          { id: "r0", cells: { g0s0: 5.2, g0s1: 6.1, g1s0: 8.3, g1s1: 7.9 } },
          { id: "r1", cells: { g0s0: 5.5, g0s1: 6.3, g1s0: 8.1, g1s1: 8.2 } },
          { id: "r2", cells: { g0s0: 5.1, g0s1: 6.0, g1s0: 8.5, g1s1: 7.8 } },
        ],
      ),
    );
    expect(dataset.ok).toBe(true);
    expect(editable.ok).toBe(true);
    expectSameNumbers(dataset, editable);
  });

  it("nested one-way ANOVA: tidy 3 groups matches the editable nested run", async () => {
    FIXTURE = {
      columns: ["val", "grp", "sub"],
      rows: [
        [5.2, "A", "S1"], [5.5, "A", "S1"], [6.1, "A", "S2"], [6.3, "A", "S2"],
        [8.3, "B", "S3"], [8.1, "B", "S3"], [7.9, "B", "S4"], [8.2, "B", "S4"],
        [11.1, "C", "S5"], [10.8, "C", "S5"], [12.0, "C", "S6"], [11.7, "C", "S6"],
      ],
    };
    const dataset = await runAnalysisOnDataset(
      HANDLE,
      spec("nestedOneWayAnova", ["val", "grp", "sub"]),
      sidecar(["val", "grp", "sub"]),
    );
    const editable = runAnalysis(
      spec("nestedOneWayAnova", []),
      content(
        "nested",
        [
          { id: "a0", name: "S1", role: "y", dataType: "number", datasetId: "dA", subcolumnKind: "replicate", groupName: "A" },
          { id: "a1", name: "S2", role: "y", dataType: "number", datasetId: "dA", subcolumnKind: "replicate", groupName: "A" },
          { id: "b0", name: "S3", role: "y", dataType: "number", datasetId: "dB", subcolumnKind: "replicate", groupName: "B" },
          { id: "b1", name: "S4", role: "y", dataType: "number", datasetId: "dB", subcolumnKind: "replicate", groupName: "B" },
          { id: "c0", name: "S5", role: "y", dataType: "number", datasetId: "dC", subcolumnKind: "replicate", groupName: "C" },
          { id: "c1", name: "S6", role: "y", dataType: "number", datasetId: "dC", subcolumnKind: "replicate", groupName: "C" },
        ],
        [
          { id: "r0", cells: { a0: 5.2, a1: 6.1, b0: 8.3, b1: 7.9, c0: 11.1, c1: 12.0 } },
          { id: "r1", cells: { a0: 5.5, a1: 6.3, b0: 8.1, b1: 8.2, c0: 10.8, c1: 11.7 } },
        ],
      ),
    );
    expect(dataset.ok).toBe(true);
    expect(editable.ok).toBe(true);
    expectSameNumbers(dataset, editable);
  });

  it("group-pair selection: a two-group test on a 3-level column compares exactly the chosen pair", async () => {
    // Control vs DrugA on a column that also has DrugB. Without a pair the runner
    // would take the first two seen (Control, DrugA here); we assert the engine
    // actually receives Control and DrugA and NOT DrugB, and that the result
    // equals the editable two-column run on exactly those two groups.
    const control = [10, 12, 11, 9, 13];
    const drugA = [18, 20, 19, 17, 21];
    const drugB = [30, 31, 29, 32, 28];
    FIXTURE = {
      columns: ["resp", "arm"],
      rows: [
        ...control.map((v) => [v, "Control"] as Cell[]),
        ...drugA.map((v) => [v, "DrugA"] as Cell[]),
        ...drugB.map((v) => [v, "DrugB"] as Cell[]),
      ],
    };

    const datasetOutcome = await runAnalysisOnDataset(
      HANDLE,
      spec("unpairedTTest", ["resp"]),
      sidecar(["resp", "arm"]),
      { groupByColumn: "arm", groupPair: ["Control", "DrugA"] },
    );

    // The editable lane on JUST Control + DrugA (DrugB excluded entirely).
    const editableOutcome = runAnalysis(
      spec("unpairedTTest", ["c0", "c1"]),
      editableWide([
        { name: "Control", values: control },
        { name: "DrugA", values: drugA },
      ]),
    );

    expect(datasetOutcome.ok).toBe(true);
    expect(editableOutcome.ok).toBe(true);
    // The groups the engine compared are exactly Control + DrugA, in order.
    const dr = datasetOutcome as unknown as { groups?: { name: string }[] };
    expect(dr.groups?.map((g) => g.name)).toEqual(["Control", "DrugA"]);
    const d = statsOf(datasetOutcome);
    const e = statsOf(editableOutcome);
    expect(d.statistic).toBeCloseTo(e.statistic, 10);
    expect(d.pValue).toBeCloseTo(e.pValue, 10);
    expect(d.df).toBeCloseTo(e.df, 10);
  });

  it("group-pair selection: choosing the OTHER pair changes which levels are compared", async () => {
    // Same fixture, pair = Control vs DrugB. The compared groups and the result
    // must differ from the Control vs DrugA run, proving the pair actually steers
    // the comparison rather than always taking the first two levels.
    const control = [10, 12, 11, 9, 13];
    const drugA = [18, 20, 19, 17, 21];
    const drugB = [30, 31, 29, 32, 28];
    FIXTURE = {
      columns: ["resp", "arm"],
      rows: [
        ...control.map((v) => [v, "Control"] as Cell[]),
        ...drugA.map((v) => [v, "DrugA"] as Cell[]),
        ...drugB.map((v) => [v, "DrugB"] as Cell[]),
      ],
    };

    const outcome = await runAnalysisOnDataset(
      HANDLE,
      spec("unpairedTTest", ["resp"]),
      sidecar(["resp", "arm"]),
      { groupByColumn: "arm", groupPair: ["Control", "DrugB"] },
    );
    expect(outcome.ok).toBe(true);
    const dr = outcome as unknown as { groups?: { name: string }[] };
    expect(dr.groups?.map((g) => g.name)).toEqual(["Control", "DrugB"]);

    const editable = runAnalysis(
      spec("unpairedTTest", ["c0", "c1"]),
      editableWide([
        { name: "Control", values: control },
        { name: "DrugB", values: drugB },
      ]),
    );
    const d = statsOf(outcome);
    const e = statsOf(editable);
    expect(d.statistic).toBeCloseTo(e.statistic, 10);
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
