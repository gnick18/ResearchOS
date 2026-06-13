// Resolver tests for the Parts-of-whole table view model: the empty-table seed,
// the grid -> categories + percent-of-total resolution (ignoring blank and
// excluded cells), the sum-to-100 invariant, the zero / blank-total guard, and a
// cross-check that the percent matches the wrangling engine's fractionOfTotal
// (asPercent) so the two conventions never drift.
//
// There is NO inferential statistic here (no test, no p-value), so this is the
// descriptive exception to the scipy validation gate: the percent is exact
// arithmetic and is covered by these self-checking unit tests, not a pinned
// oracle.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";

import type {
  CellValue,
  DataHubDocContent,
  DataHubDocument,
  RowRecord,
} from "@/lib/datahub/model/types";
import {
  buildEmptyPartsOfWholeTable,
  CATEGORY_LABEL_COLUMN_ID,
  VALUE_COLUMN_ID,
  categoryLabelColumn,
  valueColumn,
  partsOfWhole,
  presentParts,
  hasPartsOfWholeData,
  isPartsOfWholeTable,
  DEFAULT_PARTS_OF_WHOLE_ROWS,
} from "@/lib/datahub/parts-of-whole-table";
import { fractionOfTotal } from "@/lib/datahub/transforms";
import { excludedKey } from "@/lib/datahub/cell-exclusion";

const META: DataHubDocument = {
  id: "1",
  name: "Cell type composition",
  project_ids: [],
  folder_path: null,
  table_type: "partsOfWhole",
  created_at: "2026-06-12T00:00:00.000Z",
};

function content(
  rows: RowRecord[],
  excludedCells: string[] = [],
): DataHubDocContent {
  const { columns } = buildEmptyPartsOfWholeTable(0);
  return {
    meta: { ...META, excludedCells },
    columns,
    rows,
    analyses: [],
    plots: [],
  };
}

function row(id: string, label: string, value: CellValue): RowRecord {
  return {
    id,
    cells: { [CATEGORY_LABEL_COLUMN_ID]: label, [VALUE_COLUMN_ID]: value },
  };
}

describe("buildEmptyPartsOfWholeTable", () => {
  it("seeds a label column, one value column, and the default category rows", () => {
    const { columns, rows } = buildEmptyPartsOfWholeTable();
    expect(columns).toHaveLength(2);
    expect(columns[0]).toMatchObject({ id: CATEGORY_LABEL_COLUMN_ID, role: "x" });
    expect(columns[1]).toMatchObject({ id: VALUE_COLUMN_ID, role: "y" });
    expect(rows).toHaveLength(DEFAULT_PARTS_OF_WHOLE_ROWS);
    expect(rows[0].cells[CATEGORY_LABEL_COLUMN_ID]).toBe("Category 1");
    expect(rows[0].cells[VALUE_COLUMN_ID]).toBeNull();
  });

  it("resolves the label and value columns", () => {
    const c = content([]);
    expect(categoryLabelColumn(c)?.id).toBe(CATEGORY_LABEL_COLUMN_ID);
    expect(valueColumn(c)?.id).toBe(VALUE_COLUMN_ID);
  });
});

describe("partsOfWhole percent of total", () => {
  it("computes value / total * 100 per category and sums the present percents to 100", () => {
    const c = content([
      row("r1", "T cells", 30),
      row("r2", "B cells", 50),
      row("r3", "NK cells", 20),
    ]);
    const { categories, total } = partsOfWhole(c);
    expect(total).toBe(100);
    expect(categories.map((x) => x.percent)).toEqual([30, 50, 20]);
    const sum = categories.reduce((a, x) => a + (x.percent ?? 0), 0);
    expect(sum).toBeCloseTo(100, 10);
  });

  it("sums to 100 even when the raw values do not", () => {
    const c = content([
      row("r1", "A", 1),
      row("r2", "B", 1),
      row("r3", "C", 1),
    ]);
    const { categories } = partsOfWhole(c);
    const sum = categories.reduce((a, x) => a + (x.percent ?? 0), 0);
    expect(sum).toBeCloseTo(100, 10);
    for (const x of categories) expect(x.percent).toBeCloseTo(100 / 3, 10);
  });

  it("reads a string-typed value as a number", () => {
    const c = content([row("r1", "A", "40"), row("r2", "B", "60")]);
    expect(partsOfWhole(c).categories.map((x) => x.percent)).toEqual([40, 60]);
  });

  it("treats a blank value as absent (null percent, dropped from the total)", () => {
    const c = content([
      row("r1", "A", 25),
      row("r2", "B", null),
      row("r3", "C", 75),
    ]);
    const { categories, total } = partsOfWhole(c);
    expect(total).toBe(100);
    expect(categories[0].percent).toBe(25);
    expect(categories[1].percent).toBeNull();
    expect(categories[2].percent).toBe(75);
  });

  it("treats a negative value as absent", () => {
    const c = content([row("r1", "A", -5), row("r2", "B", 20)]);
    const { categories, total } = partsOfWhole(c);
    expect(total).toBe(20);
    expect(categories[0].value).toBeNull();
    expect(categories[0].percent).toBeNull();
    expect(categories[1].percent).toBe(100);
  });

  it("drops an excluded value cell from the total and gives it a null percent", () => {
    const c = content(
      [row("r1", "A", 20), row("r2", "B", 30), row("r3", "C", 50)],
      [excludedKey("r2", VALUE_COLUMN_ID)],
    );
    const { categories, total } = partsOfWhole(c);
    expect(total).toBe(70);
    expect(categories[1].percent).toBeNull();
    expect(categories[0].percent).toBeCloseTo((20 / 70) * 100, 10);
    expect(categories[2].percent).toBeCloseTo((50 / 70) * 100, 10);
  });

  it("returns null percents when the total is zero (no divide by zero)", () => {
    const c = content([row("r1", "A", 0), row("r2", "B", 0)]);
    const { categories, total } = partsOfWhole(c);
    expect(total).toBe(0);
    for (const x of categories) expect(x.percent).toBeNull();
  });

  it("falls back to a positional label when the category cell is blank", () => {
    const c = content([row("r1", "", 10), row("r2", "B", 10)]);
    expect(partsOfWhole(c).categories[0].label).toBe("Category 1");
  });
});

describe("percent matches the fractionOfTotal transform", () => {
  it("agrees with fractionOfTotal (asPercent) over the value column", () => {
    const c = content([
      row("r1", "A", 12),
      row("r2", "B", 33),
      row("r3", "C", 55),
    ]);
    const mine = partsOfWhole(c).categories.map((x) => x.percent);
    // The transform expresses each data value as a percent of its column total,
    // the same column convention partsOfWhole uses on the single value column.
    const derived = fractionOfTotal(c, { scope: "column", asPercent: true });
    const fromTransform = derived.rows.map((r) => {
      const v = r.cells[VALUE_COLUMN_ID];
      return typeof v === "number" ? v : null;
    });
    expect(mine).toHaveLength(fromTransform.length);
    mine.forEach((p, i) => {
      expect(p).not.toBeNull();
      expect(p as number).toBeCloseTo(fromTransform[i] as number, 10);
    });
  });
});

describe("guards", () => {
  it("presentParts keeps only the positive slices", () => {
    const c = content([row("r1", "A", 10), row("r2", "B", 0), row("r3", "C", 5)]);
    expect(presentParts(c).map((x) => x.label)).toEqual(["A", "C"]);
  });

  it("hasPartsOfWholeData is true only with a positive value", () => {
    expect(hasPartsOfWholeData(content([row("r1", "A", 0)]))).toBe(false);
    expect(hasPartsOfWholeData(content([row("r1", "A", 7)]))).toBe(true);
  });

  it("isPartsOfWholeTable matches the table type", () => {
    expect(isPartsOfWholeTable(content([]))).toBe(true);
  });
});
