/**
 * dataset-export.test.ts (DataHub-largetables lane, Phase 4)
 *
 * Covers the one-click export read path:
 *  - exportDatasetView builds `SELECT * FROM <fromSource>` and routes to CSV vs
 *    Parquet by format.
 *  - Passing the active recipe exports the FILTERED / TRANSFORMED slice (fromSource
 *    wraps the recipe sub-query); omitting it exports the raw read_parquet.
 *  - copyQueryToCsv vs copyQueryToParquet are mocked, so we assert the SELECT shape
 *    handed to each and which one runs, without touching the DuckDB worker.
 *
 * This is a READ path. DuckDB only moves rows out; no statistic is computed. The
 * test asserts SQL SHAPE and routing, the validation gate is untouched.
 *
 * dataset-view.ts pulls in the DuckDB client + file-service at import time, so we
 * stub those exactly as dataset-view.test.ts does.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const csvSpy = vi.fn(async (_sql: string) => new Uint8Array([1, 2, 3]).buffer);
const parquetSpy = vi.fn(async (_sql: string) => new Uint8Array([4, 5, 6]).buffer);

vi.mock("../duckdb-client", () => ({
  query: vi.fn(async () => ({ toArray: () => [], schema: { fields: [] } })),
  init: vi.fn(async () => {}),
  registerParquetBuffer: vi.fn(async () => {}),
  dropFileBuffer: vi.fn(async () => {}),
  copyQueryToParquet: (sql: string) => parquetSpy(sql),
  copyQueryToCsv: (sql: string) => csvSpy(sql),
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

// recipeToSql is exercised through fromSource. We stub it to a recognizable string
// so the test can assert the recipe sub-query is wrapped into the FROM, without
// depending on the full SQL codegen (covered by its own tests).
vi.mock("@/lib/datahub/transform/sql-codegen", () => ({
  recipeToSql: (_recipe: unknown, base: string) => `${base} /* recipe */`,
}));

import { exportDatasetView, type OpenDatasetHandle } from "../dataset-view";
import type { TransformOp } from "@/lib/datahub/transform/pipeline";

const handle: OpenDatasetHandle = {
  id: "ds1",
  fileName: "dataset_ds1.parquet",
  owner: "me",
  columnNames: ["a", "b"],
};

// A non-empty recipe. Its shape does not matter here (recipeToSql is stubbed), only
// that fromSource treats a non-empty array as "wrap the recipe sub-query".
const recipe = [{ kind: "filter" }] as unknown as TransformOp[];

beforeEach(() => {
  csvSpy.mockClear();
  parquetSpy.mockClear();
});

describe("exportDatasetView (export the current view)", () => {
  it("routes parquet format to copyQueryToParquet, CSV is not called", async () => {
    const buf = await exportDatasetView(handle, undefined, "parquet");
    expect(parquetSpy).toHaveBeenCalledTimes(1);
    expect(csvSpy).not.toHaveBeenCalled();
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("routes csv format to copyQueryToCsv, Parquet is not called", async () => {
    const buf = await exportDatasetView(handle, undefined, "csv");
    expect(csvSpy).toHaveBeenCalledTimes(1);
    expect(parquetSpy).not.toHaveBeenCalled();
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("exports the RAW dataset (read_parquet, no recipe wrap) when the recipe is omitted", async () => {
    await exportDatasetView(handle, undefined, "parquet");
    const sql = parquetSpy.mock.calls[0][0] as string;
    expect(sql).toBe("SELECT * FROM read_parquet('dataset_ds1.parquet')");
    expect(sql).not.toContain("/* recipe */");
  });

  it("exports the FILTERED slice (recipe sub-query wrapped into FROM) when a recipe is passed", async () => {
    await exportDatasetView(handle, recipe, "csv");
    const sql = csvSpy.mock.calls[0][0] as string;
    expect(sql).toBe(
      "SELECT * FROM (read_parquet('dataset_ds1.parquet') /* recipe */)",
    );
  });

  it("treats an empty recipe as raw (no wrap), matching the un-transformed preview", async () => {
    await exportDatasetView(handle, [], "parquet");
    const sql = parquetSpy.mock.calls[0][0] as string;
    expect(sql).toBe("SELECT * FROM read_parquet('dataset_ds1.parquet')");
  });
});
