import { describe, expect, it } from "vitest";
import type {
  CellValue,
  ColumnDef,
  DataHubDocContent,
} from "@/lib/datahub/model/types";
import {
  fractionOfTotal,
  normalize,
  removeBaseline,
  runTransform,
  transformValues,
  transpose,
} from "./transforms";

/**
 * Build a Column-table content from a column-major matrix. columns is an array of
 * [name, values[]]; each inner array is that column's cells down the rows. All
 * columns must be the same length (the row count).
 */
function columnTable(
  columns: Array<[string, CellValue[]]>,
  opts: { firstIsX?: boolean } = {},
): DataHubDocContent {
  const cols: ColumnDef[] = columns.map(([name], i) => ({
    id: `c${i}`,
    name,
    role: opts.firstIsX && i === 0 ? "x" : "y",
    dataType: opts.firstIsX && i === 0 ? "text" : "number",
  }));
  const rowCount = columns.length ? columns[0][1].length : 0;
  const rows = Array.from({ length: rowCount }, (_, r) => {
    const cells: Record<string, CellValue> = {};
    columns.forEach(([, values], i) => {
      cells[`c${i}`] = values[r];
    });
    return { id: `r${r}`, cells };
  });
  return {
    meta: {
      id: "1",
      name: "t",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: "",
    },
    columns: cols,
    rows,
    analyses: [],
    plots: [],
  };
}

/** Read one column's cells out of a content as a plain array (row order). */
function col(content: DataHubDocContent, columnId: string): CellValue[] {
  return content.rows.map((r) => r.cells[columnId] ?? null);
}

describe("transform (apply a function to Y values)", () => {
  const src = columnTable([["A", [1, 10, 100, 1000]]]);

  it("log10 of powers of ten", () => {
    const out = transformValues(src, { func: "log10" });
    expect(col(out, "c0")).toEqual([0, 1, 2, 3]);
  });

  it("ln matches Math.log", () => {
    const out = transformValues(columnTable([["A", [Math.E, 1]]]), { func: "ln" });
    expect((col(out, "c0")[0] as number)).toBeCloseTo(1, 12);
    expect(col(out, "c0")[1]).toBe(0);
  });

  it("log2 of powers of two", () => {
    const out = transformValues(columnTable([["A", [1, 2, 8]]]), { func: "log2" });
    expect(col(out, "c0")).toEqual([0, 1, 3]);
  });

  it("sqrt and square", () => {
    expect(col(transformValues(columnTable([["A", [4, 9]]]), { func: "sqrt" }), "c0")).toEqual([2, 3]);
    expect(col(transformValues(columnTable([["A", [3, -2]]]), { func: "square" }), "c0")).toEqual([9, 4]);
  });

  it("reciprocal (1/Y)", () => {
    const out = transformValues(columnTable([["A", [2, 4]]]), { func: "reciprocal" });
    expect(col(out, "c0")).toEqual([0.5, 0.25]);
  });

  it("linear applies Y*k + b (covers times-k and plus-k)", () => {
    const out = transformValues(columnTable([["A", [1, 2, 3]]]), {
      func: "linear",
      k: 2,
      b: 5,
    });
    expect(col(out, "c0")).toEqual([7, 9, 11]);
    // Defaults: k=1, b=0 is identity.
    const id = transformValues(columnTable([["A", [3]]]), { func: "linear" });
    expect(col(id, "c0")).toEqual([3]);
  });

  describe("domain guards yield null, never throw", () => {
    it("log of a non-positive value is null", () => {
      const out = transformValues(columnTable([["A", [0, -5, 10]]]), { func: "log10" });
      expect(col(out, "c0")).toEqual([null, null, 1]);
    });
    it("sqrt of a negative value is null", () => {
      const out = transformValues(columnTable([["A", [-1, 4]]]), { func: "sqrt" });
      expect(col(out, "c0")).toEqual([null, 2]);
    });
    it("reciprocal of zero is null", () => {
      const out = transformValues(columnTable([["A", [0, 5]]]), { func: "reciprocal" });
      expect(col(out, "c0")).toEqual([null, 0.2]);
    });
  });

  it("null and non-numeric cells pass through as null", () => {
    const out = transformValues(columnTable([["A", [1, null, "x" as CellValue, 10]]]), {
      func: "log10",
    });
    expect(col(out, "c0")).toEqual([0, null, null, 1]);
  });
});

describe("normalize (relative to a per-column baseline)", () => {
  const src = columnTable([
    ["A", [1, 2, 4]],
    ["B", [10, 30, 60]],
  ]);

  it("percent of column max is the default", () => {
    const out = normalize(src);
    // A: max 4 -> 25, 50, 100. B: max 60 -> ~16.67, 50, 100.
    expect(col(out, "c0")).toEqual([25, 50, 100]);
    expect((col(out, "c1")[0] as number)).toBeCloseTo(16.6667, 3);
    expect(col(out, "c1")[2]).toBe(100);
  });

  it("percent of column sum", () => {
    const out = normalize(columnTable([["A", [1, 3]]]), { mode: "sum" });
    // sum 4 -> 25, 75, summing to 100.
    expect(col(out, "c0")).toEqual([25, 75]);
  });

  it("percent of the first value", () => {
    const out = normalize(columnTable([["A", [2, 1, 4]]]), { mode: "first" });
    // first 2 -> 100, 50, 200.
    expect(col(out, "c0")).toEqual([100, 50, 200]);
  });

  it("minMax scales 0..100 between min and max", () => {
    const out = normalize(columnTable([["A", [10, 20, 30]]]), { mode: "minMax" });
    expect(col(out, "c0")).toEqual([0, 50, 100]);
  });

  it("a degenerate baseline yields null, not a divide by zero", () => {
    // sum of zero
    expect(col(normalize(columnTable([["A", [0, 0]]]), { mode: "sum" }), "c0")).toEqual([null, null]);
    // flat column for minMax (min === max)
    expect(col(normalize(columnTable([["A", [5, 5]]]), { mode: "minMax" }), "c0")).toEqual([null, null]);
  });
});

describe("transpose (swap rows and columns)", () => {
  it("swaps a 2x3 column table and keeps old headers as row labels", () => {
    const src = columnTable([
      ["A", [1, 2, 3]],
      ["B", [4, 5, 6]],
    ]);
    const out = transpose(src);
    // Result is a column table: one label column plus one column per old row (3).
    expect(out.meta.table_type).toBe("column");
    expect(out.columns.length).toBe(1 + 3);
    expect(out.rows.length).toBe(2); // one row per old column A, B
    // The label column carries the old column names.
    expect(col(out, "t_label")).toEqual(["A", "B"]);
    // Old column A's values 1,2,3 spread across the three new columns of row 0.
    expect(out.rows[0].cells["t_col_0"]).toBe(1);
    expect(out.rows[0].cells["t_col_1"]).toBe(2);
    expect(out.rows[0].cells["t_col_2"]).toBe(3);
    expect(out.rows[1].cells["t_col_0"]).toBe(4);
  });

  it("uses a header column for the new column titles and drops it as a data row", () => {
    const src = columnTable(
      [
        ["Label", ["x" as CellValue, "y" as CellValue]],
        ["A", [1, 2]],
      ],
      { firstIsX: true },
    );
    const out = transpose(src, { headerColumnId: "c0" });
    // New columns named from the Label column values: "x", "y".
    const names = out.columns.slice(1).map((c) => c.name);
    expect(names).toEqual(["x", "y"]);
    // The header column is not also emitted as a data row, so only "A" remains.
    expect(col(out, "t_label")).toEqual(["A"]);
  });
});

describe("removeBaseline (subtract a baseline)", () => {
  it("subtracts a fixed value", () => {
    const out = removeBaseline(columnTable([["A", [10, 20]]]), {
      mode: "value",
      value: 5,
    });
    expect(col(out, "c0")).toEqual([5, 15]);
  });

  it("subtracts each column's first-row value", () => {
    const out = removeBaseline(
      columnTable([
        ["A", [10, 12, 15]],
        ["B", [100, 90, 80]],
      ]),
      { mode: "firstRow" },
    );
    expect(col(out, "c0")).toEqual([0, 2, 5]);
    expect(col(out, "c1")).toEqual([0, -10, -20]);
  });

  it("subtracts a baseline column from the others and drops that column", () => {
    const src = columnTable([
      ["Base", [1, 2]],
      ["A", [11, 22]],
      ["B", [5, 5]],
    ]);
    const out = removeBaseline(src, { mode: "column", baselineColumnId: "c0" });
    // c0 (Base) is removed; c1 and c2 had the per-row base subtracted.
    expect(out.columns.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(col(out, "c1")).toEqual([10, 20]);
    expect(col(out, "c2")).toEqual([4, 3]);
  });

  it("a missing operand yields null", () => {
    const src = columnTable([
      ["Base", [1, null]],
      ["A", [11, 22]],
    ]);
    const out = removeBaseline(src, { mode: "column", baselineColumnId: "c0" });
    // Row 1 has a null base, so its A cell becomes null.
    expect(col(out, "c1")).toEqual([10, null]);
  });
});

describe("fractionOfTotal (fraction or percent of a total)", () => {
  const src = columnTable([
    ["A", [1, 3]],
    ["B", [2, 2]],
  ]);

  it("fraction of the column total (default scope, fraction not percent)", () => {
    const out = fractionOfTotal(src);
    // A total 4 -> 0.25, 0.75. B total 4 -> 0.5, 0.5.
    expect(col(out, "c0")).toEqual([0.25, 0.75]);
    expect(col(out, "c1")).toEqual([0.5, 0.5]);
  });

  it("percent option multiplies by 100", () => {
    const out = fractionOfTotal(src, { scope: "column", asPercent: true });
    expect(col(out, "c0")).toEqual([25, 75]);
  });

  it("fraction of the row total", () => {
    const out = fractionOfTotal(src, { scope: "row" });
    // Row 0 total 1+2=3 -> 1/3, 2/3. Row 1 total 3+2=5 -> 3/5, 2/5.
    expect((col(out, "c0")[0] as number)).toBeCloseTo(1 / 3, 12);
    expect((col(out, "c1")[0] as number)).toBeCloseTo(2 / 3, 12);
    expect(col(out, "c0")[1]).toBeCloseTo(0.6, 12);
  });

  it("fraction of the grand total", () => {
    const out = fractionOfTotal(src, { scope: "grand" });
    // Grand total 1+3+2+2 = 8.
    expect(col(out, "c0")).toEqual([1 / 8, 3 / 8]);
    expect(col(out, "c1")).toEqual([2 / 8, 2 / 8]);
  });

  it("a zero total yields null", () => {
    const out = fractionOfTotal(columnTable([["A", [0, 0]]]), { scope: "column" });
    expect(col(out, "c0")).toEqual([null, null]);
  });
});

describe("runTransform dispatch", () => {
  const src = columnTable([["A", [1, 10]]]);

  it("routes each kind to its function", () => {
    expect(col(runTransform("transform", src, { func: "log10" }), "c0")).toEqual([0, 1]);
    expect(runTransform("transpose", src, {}).meta.table_type).toBe("column");
    expect(col(runTransform("fractionOfTotal", src, { scope: "column" }), "c0")).toEqual([
      1 / 11,
      10 / 11,
    ]);
  });

  it("an unknown kind is a structural no-op (does not throw)", () => {
    const out = runTransform("nope" as never, src, {});
    expect(out.columns.length).toBe(src.columns.length);
    expect(col(out, "c0")).toEqual([1, 10]);
  });
});
