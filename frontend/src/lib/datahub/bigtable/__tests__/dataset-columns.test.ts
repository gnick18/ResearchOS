/**
 * dataset-columns.test.ts (DataHub-largetables lane, Phase 3a)
 *
 * Unit tests for the DuckDB column readers' SQL shape + array coercion. DuckDB
 * cannot run under vitest, so query() is mocked to capture the emitted SQL and to
 * serve a fixed in-memory table. This proves the readers build a column-projecting
 * SELECT (no aggregate, the validation gate) and coerce cells to finite numbers
 * exactly like the editable lane's columnValues (null / non-numeric dropped,
 * numeric strings parsed, listwise alignment for the aligned reader).
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, expect, it, vi } from "vitest";

let CAPTURED_SQL = "";
let SERVE: Record<string, unknown>[] = [];

vi.mock("../duckdb-client", () => ({
  query: vi.fn(async (sql: string) => {
    CAPTURED_SQL = sql;
    return {
      toArray: () => SERVE,
      schema: { fields: [] },
    };
  }),
  init: vi.fn(async () => {}),
  registerParquetBuffer: vi.fn(async () => {}),
  dropFileBuffer: vi.fn(async () => {}),
  copyQueryToParquet: vi.fn(async () => new Uint8Array()),
}));

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

import {
  readColumn,
  readColumnAligned,
  readColumnByGroup,
} from "../dataset-columns";
import type { OpenDatasetHandle } from "../dataset-view";

const HANDLE: OpenDatasetHandle = {
  id: "ds1",
  fileName: "ds1.parquet",
  owner: "u1",
  columnNames: ["a", "b"],
};

describe("dataset-columns readers", () => {
  it("readColumn projects the column and drops null / non-numeric, parses numeric strings", async () => {
    SERVE = [{ v: 1 }, { v: null }, { v: "2.5" }, { v: "nope" }, { v: NaN }, { v: 3 }];
    const out = await readColumn(HANDLE, "weight");
    expect(out).toEqual([1, 2.5, 3]);
    // The validation gate: the SQL only PROJECTS, it does not aggregate.
    expect(CAPTURED_SQL).toContain('"weight"');
    expect(CAPTURED_SQL).toMatch(/read_parquet\('ds1\.parquet'\)/);
    expect(CAPTURED_SQL).not.toMatch(/\b(AVG|SUM|COUNT|STDDEV|VAR|MEDIAN)\s*\(/i);
  });

  it("readColumn coerces a 64-bit BigInt column to numbers", async () => {
    SERVE = [{ v: BigInt(10) }, { v: BigInt(20) }, { v: null }];
    const out = await readColumn(HANDLE, "n");
    expect(out).toEqual([10, 20]);
  });

  it("readColumnAligned drops any row null / non-numeric in ANY column (listwise)", async () => {
    SERVE = [
      { c0: 1, c1: 4 },
      { c0: null, c1: 5 }, // dropped (c0 null)
      { c0: 2, c1: "x" }, // dropped (c1 non-numeric)
      { c0: 3, c1: 6 },
    ];
    const out = await readColumnAligned(HANDLE, ["a", "b"]);
    expect(out).toEqual([
      [1, 4],
      [3, 6],
    ]);
  });

  it("readColumnByGroup partitions the value column by category in first-seen order", async () => {
    SERVE = [
      { v: 1, g: "B" },
      { v: 2, g: "A" },
      { v: 3, g: "B" },
      { v: null, g: "A" }, // dropped (null value)
      { v: 4, g: null }, // dropped (null group)
      { v: 5, g: "A" },
    ];
    const out = await readColumnByGroup(HANDLE, "value", "group");
    expect(out).toEqual([
      { label: "B", values: [1, 3] },
      { label: "A", values: [2, 5] },
    ]);
  });
});
