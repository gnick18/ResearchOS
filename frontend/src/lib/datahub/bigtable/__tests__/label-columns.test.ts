import { describe, it, expect } from "vitest";
import {
  looksLikeDateColumn,
  labelColumnNames,
} from "../label-columns";
import type { DatasetColumn } from "../types";

function col(
  name: string,
  type: DatasetColumn["type"],
  sample: (string | number | null)[],
): DatasetColumn {
  return { name, type, nullCount: 0, sample };
}

describe("looksLikeDateColumn", () => {
  it("flags an ISO date column profiled as text (the raw-import case)", () => {
    expect(
      looksLikeDateColumn(col("run_date", "text", ["2026-07-17", "2026-07-28"])),
    ).toBe(true);
  });

  it("flags slash and MM-DD-YYYY date shapes, with a trailing time", () => {
    expect(looksLikeDateColumn(col("d", "text", ["2026/01/02"]))).toBe(true);
    expect(looksLikeDateColumn(col("d", "text", ["07-17-2026"]))).toBe(true);
    expect(
      looksLikeDateColumn(col("d", "text", ["2026-07-17 13:04:00"])),
    ).toBe(true);
  });

  it("does not flag real categorical labels", () => {
    expect(looksLikeDateColumn(col("treatment", "text", ["DrugA", "Control"]))).toBe(
      false,
    );
    expect(looksLikeDateColumn(col("well", "text", ["A1", "H12"]))).toBe(false);
    expect(looksLikeDateColumn(col("operator", "text", ["op1", "op5"]))).toBe(false);
  });

  it("does not over-exclude when there are no samples to judge by", () => {
    expect(looksLikeDateColumn(col("maybe", "text", [null, "  "]))).toBe(false);
    expect(looksLikeDateColumn(col("maybe", "text", []))).toBe(false);
  });

  it("requires EVERY non-empty sample to look like a date", () => {
    // one non-date value means it is not a date column
    expect(
      looksLikeDateColumn(col("mixed", "text", ["2026-07-17", "DrugA"])),
    ).toBe(false);
  });
});

describe("labelColumnNames", () => {
  it("offers text categoricals, excludes numeric and date-like columns", () => {
    const schema: DatasetColumn[] = [
      col("id", "number", [1, 2]),
      col("treatment", "text", ["DrugA", "Control"]),
      col("response", "number", [36.6, 41.1]),
      col("run_date", "text", ["2026-07-17", "2026-07-28"]),
      col("plate", "text", ["P1", "P2"]),
      col("well", "text", ["A1", "H12"]),
      col("operator", "text", ["op1", "op5"]),
    ];
    expect(labelColumnNames(schema)).toEqual([
      "treatment",
      "plate",
      "well",
      "operator",
    ]);
  });

  it("excludes a column already typed as date", () => {
    const schema: DatasetColumn[] = [
      col("when", "date", ["2026-07-17"]),
      col("group", "text", ["A", "B"]),
    ];
    expect(labelColumnNames(schema)).toEqual(["group"]);
  });
});
