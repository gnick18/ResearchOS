/**
 * dataset-store.test.ts (DataHub-largetables lane, Increment 1)
 *
 * Round-trip tests for the large-dataset on-disk shape. The fileService boundary
 * is mocked with a tiny in-memory map (the same seam the other Data Hub api tests
 * mock), so the real sidecar build / write / read logic is exercised without disk
 * and without DuckDB (the worker cannot run under vitest, see the report note).
 *
 * Also covers the pure ingest profiling helpers (profileSchema / rowsForParquet)
 * since they need no DuckDB.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory backing stores for the mocked fileService.
const jsonFiles = new Map<string, unknown>();
const blobFiles = new Map<string, Blob>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    async ensureDir() {
      return null;
    },
    async readJson<T>(path: string): Promise<T | null> {
      return (jsonFiles.get(path) as T) ?? null;
    },
    async writeJson<T>(path: string, data: T): Promise<void> {
      jsonFiles.set(path, JSON.parse(JSON.stringify(data)));
    },
    async writeFileFromBlob(path: string, blob: Blob): Promise<void> {
      blobFiles.set(path, blob);
    },
    async readFileAsBlob(path: string): Promise<Blob | null> {
      return blobFiles.get(path) ?? null;
    },
    async deleteDirectory(path: string): Promise<boolean> {
      let hit = false;
      for (const key of [...jsonFiles.keys()]) {
        if (key.startsWith(path + "/")) {
          jsonFiles.delete(key);
          hit = true;
        }
      }
      for (const key of [...blobFiles.keys()]) {
        if (key.startsWith(path + "/")) {
          blobFiles.delete(key);
          hit = true;
        }
      }
      return hit;
    },
  },
}));

import {
  buildSidecar,
  datasetParquetPath,
  datasetSidecarPath,
  deleteDataset,
  persistDataset,
  readDatasetParquet,
  readDatasetSidecar,
  saveDatasetAnalysis,
  removeSavedAnalysis,
  sidecarFromJson,
  writeDatasetSidecar,
} from "../dataset-store";
import { profileSchema, rowsForParquet } from "../ingest";
import type { DatasetColumn, IngestInput } from "../types";
import { DATASET_SCHEMA_VERSION } from "../types";

beforeEach(() => {
  jsonFiles.clear();
  blobFiles.clear();
});

const schema: DatasetColumn[] = [
  { name: "well", type: "text", nullCount: 0, sample: ["A1", "A2"] },
  { name: "ct", type: "number", nullCount: 1, sample: [22.4, 23.1] },
];

describe("buildSidecar", () => {
  it("derives colCount, stamps version, defaults the recipe seam", () => {
    const s = buildSidecar({
      id: "7",
      name: "qPCR run",
      schema,
      rowCount: 42000,
      source: { kind: "import-file", originalFilename: "run.csv" },
    });
    expect(s.schemaVersion).toBe(DATASET_SCHEMA_VERSION);
    expect(s.colCount).toBe(2);
    expect(s.rowCount).toBe(42000);
    expect(s.recipe).toEqual([]);
    expect(s.project_ids).toEqual([]);
    expect(s.folder_path).toBeNull();
    expect(typeof s.created_at).toBe("string");
    expect(typeof s.updated_at).toBe("string");
  });
});

describe("dataset sidecar round-trip", () => {
  it("write then read recovers schema, counts, source, recipe", async () => {
    const s = buildSidecar({
      id: "7",
      name: "qPCR run",
      schema,
      rowCount: 42000,
      source: { kind: "import-file", originalFilename: "run.csv" },
      project_ids: ["proj-1"],
      folder_path: "assays",
    });
    await writeDatasetSidecar("alice", s);

    const back = await readDatasetSidecar("alice", "7");
    expect(back).not.toBeNull();
    expect(back!.id).toBe("7");
    expect(back!.name).toBe("qPCR run");
    expect(back!.schema).toEqual(schema);
    expect(back!.rowCount).toBe(42000);
    expect(back!.colCount).toBe(2);
    expect(back!.source).toEqual({ kind: "import-file", originalFilename: "run.csv" });
    expect(back!.recipe).toEqual([]);
    expect(back!.project_ids).toEqual(["proj-1"]);
    expect(back!.folder_path).toBe("assays");
  });

  it("writes the sidecar at users/<owner>/datahub/<id>/dataset.json", async () => {
    const s = buildSidecar({
      id: "9",
      name: "x",
      schema,
      rowCount: 1500,
      source: { kind: "paste" },
    });
    await writeDatasetSidecar("bob", s);
    expect(datasetSidecarPath("bob", "9")).toBe("users/bob/datahub/9/dataset.json");
    expect(jsonFiles.has("users/bob/datahub/9/dataset.json")).toBe(true);
  });

  it("read returns null when absent", async () => {
    await expect(readDatasetSidecar("alice", "nope")).resolves.toBeNull();
  });
});

describe("savedAnalyses round-trip (Phase 3a, additive)", () => {
  it("a sidecar with no saved analyses serializes WITHOUT the field", async () => {
    const s = buildSidecar({
      id: "20",
      name: "x",
      schema,
      rowCount: 100,
      source: { kind: "paste" },
    });
    await writeDatasetSidecar("alice", s);
    const onDisk = jsonFiles.get("users/alice/datahub/20/dataset.json") as Record<
      string,
      unknown
    >;
    expect("savedAnalyses" in onDisk).toBe(false);
    const back = await readDatasetSidecar("alice", "20");
    expect(back!.savedAnalyses).toBeUndefined();
  });

  it("saveDatasetAnalysis adds, replaces by id, and removeSavedAnalysis drops the field when empty", async () => {
    const s = buildSidecar({
      id: "21",
      name: "x",
      schema,
      rowCount: 100,
      source: { kind: "paste" },
    });
    await writeDatasetSidecar("alice", s);

    const a1 = {
      id: "an-1",
      type: "unpairedTTest",
      params: { tail: "two-sided" },
      inputs: { columnIds: ["weight"] },
      groupByColumn: "group",
      resultCache: null,
      resultStale: false,
      created_at: "2026-06-13T00:00:00.000Z",
    };
    let updated = await saveDatasetAnalysis("alice", "21", a1);
    expect(updated!.savedAnalyses).toHaveLength(1);
    expect(updated!.savedAnalyses![0]).toEqual(a1);

    // Replace by id (re-run with new params).
    const a1b = { ...a1, params: { tail: "greater" }, resultCache: { p: 0.01 } };
    updated = await saveDatasetAnalysis("alice", "21", a1b);
    expect(updated!.savedAnalyses).toHaveLength(1);
    expect(updated!.savedAnalyses![0].params).toEqual({ tail: "greater" });

    // A second analysis appends.
    const a2 = { ...a1, id: "an-2", type: "oneWayAnova" };
    updated = await saveDatasetAnalysis("alice", "21", a2);
    expect(updated!.savedAnalyses).toHaveLength(2);

    // Round-trips through disk.
    const back = await readDatasetSidecar("alice", "21");
    expect(back!.savedAnalyses).toHaveLength(2);

    // Removing the last entry drops the field entirely (back to pre-3a shape).
    await removeSavedAnalysis("alice", "21", "an-1");
    const after1 = await readDatasetSidecar("alice", "21");
    expect(after1!.savedAnalyses).toHaveLength(1);
    await removeSavedAnalysis("alice", "21", "an-2");
    const onDisk = jsonFiles.get("users/alice/datahub/21/dataset.json") as Record<
      string,
      unknown
    >;
    expect("savedAnalyses" in onDisk).toBe(false);
  });
});

describe("sidecarFromJson tolerance", () => {
  it("fills a missing recipe and derives colCount additively", () => {
    const s = sidecarFromJson({
      id: "1",
      name: "legacy",
      schema,
      rowCount: 2000,
      source: { kind: "paste" },
    });
    expect(s).not.toBeNull();
    expect(s!.recipe).toEqual([]);
    expect(s!.colCount).toBe(2);
  });

  it("rejects a non-sidecar object", () => {
    expect(sidecarFromJson(null)).toBeNull();
    expect(sidecarFromJson({ foo: 1 })).toBeNull();
    expect(sidecarFromJson({ id: "1" })).toBeNull();
  });
});

describe("persistDataset + deleteDataset", () => {
  it("writes parquet bytes + sidecar and reads the parquet back", async () => {
    const s = buildSidecar({
      id: "3",
      name: "big",
      schema,
      rowCount: 5000,
      source: { kind: "paste" },
    });
    const parquetBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    await persistDataset("alice", s, parquetBytes);

    expect(datasetParquetPath("alice", "3")).toBe("users/alice/datahub/3/data.parquet");
    const blob = await readDatasetParquet("alice", "3");
    expect(blob).not.toBeNull();
    const back = new Uint8Array(await blob!.arrayBuffer());
    expect([...back]).toEqual([1, 2, 3, 4]);

    expect(await readDatasetSidecar("alice", "3")).not.toBeNull();
  });

  it("keeps the untouched original beside data.parquet when provided", async () => {
    const s = buildSidecar({
      id: "4",
      name: "imp",
      schema,
      rowCount: 5000,
      source: { kind: "import-file", originalFilename: "orig.csv" },
    });
    await persistDataset("alice", s, new Uint8Array([9]).buffer, {
      filename: "orig.csv",
      bytes: new TextEncoder().encode("a,b\n1,2\n").buffer,
    });
    const orig = await readDatasetParquet("alice", "4"); // parquet present
    expect(orig).not.toBeNull();
    expect(blobFiles.has("users/alice/datahub/4/orig.csv")).toBe(true);
  });

  it("deleteDataset removes the whole directory", async () => {
    const s = buildSidecar({
      id: "5",
      name: "gone",
      schema,
      rowCount: 5000,
      source: { kind: "paste" },
    });
    await persistDataset("alice", s, new Uint8Array([1]).buffer);
    expect(await readDatasetSidecar("alice", "5")).not.toBeNull();
    const removed = await deleteDataset("alice", "5");
    expect(removed).toBe(true);
    expect(await readDatasetSidecar("alice", "5")).toBeNull();
    expect(await readDatasetParquet("alice", "5")).toBeNull();
  });
});

describe("ingest profiling helpers (pure, no DuckDB)", () => {
  const input: IngestInput = {
    name: "t",
    columns: [
      { id: "col-1", name: "well", dataType: "text" },
      { id: "col-2", name: "ct", dataType: "number" },
    ],
    rows: [
      { id: "row-1", cells: { "col-1": "A1", "col-2": 22.4 } },
      { id: "row-2", cells: { "col-1": "A2", "col-2": null } },
      { id: "row-3", cells: { "col-1": "", "col-2": 23.1 } },
    ],
    source: { kind: "paste" },
  };

  it("profileSchema counts nulls and samples non-null values", () => {
    const out = profileSchema(input);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: "well", type: "text", nullCount: 1 });
    expect(out[0].sample).toEqual(["A1", "A2"]);
    expect(out[1]).toMatchObject({ name: "ct", type: "number", nullCount: 1 });
    expect(out[1].sample).toEqual([22.4, 23.1]);
  });

  it("rowsForParquet keys by column NAME and maps empty/undefined to null", () => {
    const out = rowsForParquet(input);
    expect(out).toEqual([
      { well: "A1", ct: 22.4 },
      { well: "A2", ct: null },
      { well: null, ct: 23.1 },
    ]);
  });
});
