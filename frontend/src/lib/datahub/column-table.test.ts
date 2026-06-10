import { describe, expect, it } from "vitest";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import {
  buildEmptyColumnTable,
  cellDisplay,
  columnValues,
  computeAllGroupStats,
  computeGroupStats,
  formatStat,
  groupColumns,
  parseCellInput,
} from "./column-table";

/** Build a one-group, three-row Column-table content for the math checks. */
function oneGroup(values: (number | string | null)[]): DataHubDocContent {
  return {
    meta: {
      id: "1",
      name: "t",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: "",
    },
    columns: [{ id: "c1", name: "Control", role: "y", dataType: "number" }],
    rows: values.map((v, i) => ({ id: `r${i}`, cells: { c1: v } })),
    analyses: [],
    plots: [],
  };
}

describe("column-table model", () => {
  it("seeds a blank Column table with the right shape", () => {
    const { columns, rows } = buildEmptyColumnTable(3, 6);
    expect(columns).toHaveLength(3);
    expect(rows).toHaveLength(6);
    expect(columns[0]).toMatchObject({ role: "y", dataType: "number" });
    // Every cell starts null.
    expect(rows[0].cells[columns[0].id]).toBeNull();
  });

  it("reads only finite numeric values from a column", () => {
    const content = oneGroup([98, "102", "", null, "oops"]);
    expect(columnValues(content, "c1")).toEqual([98, 102]);
  });

  it("computes mean / SD / SEM / n through the engine", () => {
    // describe()'s SD is the SAMPLE SD (n-1). For [2,4,6]: mean 4, SD 2, SEM
    // 2/sqrt(3).
    const content = oneGroup([2, 4, 6]);
    const s = computeGroupStats(content, "c1");
    expect(s.n).toBe(3);
    expect(s.mean).toBeCloseTo(4, 10);
    expect(s.sd).toBeCloseTo(2, 10);
    expect(s.sem).toBeCloseTo(2 / Math.sqrt(3), 10);
  });

  it("returns nulls (not NaN) for degenerate groups", () => {
    expect(computeGroupStats(oneGroup([]), "c1")).toEqual({
      mean: null,
      sd: null,
      sem: null,
      n: 0,
    });
    const single = computeGroupStats(oneGroup([5]), "c1");
    expect(single.n).toBe(1);
    expect(single.mean).toBe(5);
    expect(single.sd).toBeNull();
    expect(single.sem).toBeNull();
  });

  it("recomputes the footer when a cell changes", () => {
    const before = computeGroupStats(oneGroup([10, 20]), "c1");
    expect(before.mean).toBeCloseTo(15, 10);
    // Edit the second replicate 20 -> 30: the mean must move.
    const after = computeGroupStats(oneGroup([10, 30]), "c1");
    expect(after.mean).toBeCloseTo(20, 10);
    expect(after.mean).not.toBeCloseTo(before.mean ?? 0, 5);
  });

  it("computes stats for every group column", () => {
    const content: DataHubDocContent = {
      ...oneGroup([1, 2, 3]),
      columns: [
        { id: "c1", name: "A", role: "y", dataType: "number" },
        { id: "c2", name: "B", role: "y", dataType: "number" },
      ],
      rows: [
        { id: "r0", cells: { c1: 1, c2: 10 } },
        { id: "r1", cells: { c1: 3, c2: 30 } },
      ],
    };
    const all = computeAllGroupStats(content);
    expect(Object.keys(all)).toEqual(["c1", "c2"]);
    expect(all.c1.mean).toBeCloseTo(2, 10);
    expect(all.c2.mean).toBeCloseTo(20, 10);
  });

  it("excludes non-group columns from the grid", () => {
    const content: DataHubDocContent = {
      ...oneGroup([1]),
      columns: [
        { id: "x1", name: "Dose", role: "x", dataType: "number" },
        { id: "y1", name: "Response", role: "y", dataType: "number" },
      ],
    };
    expect(groupColumns(content).map((c) => c.id)).toEqual(["y1"]);
  });

  it("parses cell input into typed values", () => {
    expect(parseCellInput("  ")).toBeNull();
    expect(parseCellInput("42")).toBe(42);
    expect(parseCellInput("3.14")).toBeCloseTo(3.14, 10);
    expect(parseCellInput("notanumber")).toBe("notanumber");
  });

  it("renders cell values and footer stats for display", () => {
    expect(cellDisplay(null)).toBe("");
    expect(cellDisplay(7)).toBe("7");
    expect(formatStat(null)).toBe("-");
    expect(formatStat(1.23456)).toBe("1.23");
  });
});
