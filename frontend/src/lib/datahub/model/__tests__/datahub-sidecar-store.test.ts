// Tests for the Data Hub sidecar store (Phase 0 data model). fileService is
// mocked with an in-memory file map (blobs for .loro, objects for .json).

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DataHubDocContent } from "../types";

const blobs = new Map<string, Uint8Array>();
const jsons = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    ensureDir: vi.fn(async () => null),
    readFileAsBlob: vi.fn(async (path: string) => {
      const v = blobs.get(path);
      if (v === undefined) return null;
      return new Blob([v.buffer as ArrayBuffer]);
    }),
    writeFileFromBlob: vi.fn(async (path: string, blob: Blob) => {
      blobs.set(path, new Uint8Array(await blob.arrayBuffer()));
    }),
    readJson: vi.fn(async (path: string) =>
      jsons.has(path) ? jsons.get(path) : null,
    ),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      jsons.set(path, data);
    }),
    deleteFile: vi.fn(async (path: string) => {
      const had = jsons.has(path) || blobs.has(path);
      jsons.delete(path);
      blobs.delete(path);
      return had;
    }),
  },
}));

import { LoroDoc } from "loro-crdt";
import { seedDataHubDoc, getDataHubContent, setCell } from "../../../loro/datahub-doc";
import {
  loadOrRebuildDataHubDoc,
  persistDataHubDoc,
  persistDataHubContent,
  deleteDataHubFiles,
  dataHubSidecarPath,
  dataHubJsonPath,
} from "../../../loro/datahub-sidecar-store";

const OWNER = "alex";
const ID = "7";
const SIDECAR = dataHubSidecarPath(OWNER, ID);
const JSON_PATH = dataHubJsonPath(OWNER, ID);

function makeContent(over: Partial<DataHubDocContent> = {}): DataHubDocContent {
  return {
    meta: {
      id: ID,
      name: "Assay",
      project_ids: ["proj-a"],
      folder_path: "raw",
      table_type: "xy",
      created_at: "2026-06-10T00:00:00Z",
      last_edited_by: "alex",
      last_edited_at: "2026-06-10T01:00:00Z",
    },
    columns: [
      { id: "c-x", name: "Dose", role: "x", dataType: "number" },
      { id: "c-y", name: "Response", role: "y", dataType: "number" },
    ],
    rows: [{ id: "r1", cells: { "c-x": 1, "c-y": 50 } }],
    analyses: [],
    plots: [],
    ...over,
  };
}

describe("datahub-sidecar-store", () => {
  beforeEach(() => {
    blobs.clear();
    jsons.clear();
  });

  it("rebuilds from the .json mirror when no sidecar exists", async () => {
    jsons.set(JSON_PATH, makeContent());
    const doc = await loadOrRebuildDataHubDoc(OWNER, ID);
    const projected = getDataHubContent(doc, ID);
    expect(projected.columns.map((c) => c.id)).toEqual(["c-x", "c-y"]);
    expect(projected.rows[0].cells["c-y"]).toBe(50);
  });

  it("seeds an empty document when neither sidecar nor mirror exists", async () => {
    const doc = await loadOrRebuildDataHubDoc(OWNER, ID);
    const projected = getDataHubContent(doc, ID);
    expect(projected.columns).toEqual([]);
    expect(projected.rows).toEqual([]);
  });

  it("persistDataHubContent writes BOTH the sidecar and the full mirror", async () => {
    const content = makeContent();
    await persistDataHubContent(OWNER, ID, content);
    expect(blobs.has(SIDECAR)).toBe(true);
    const mirror = jsons.get(JSON_PATH) as DataHubDocContent;
    // The mirror carries the catalog fields the doc does not store.
    expect(mirror.meta.project_ids).toEqual(["proj-a"]);
    expect(mirror.meta.folder_path).toBe("raw");
    expect(mirror.meta.last_edited_by).toBe("alex");
  });

  it("persistDataHubDoc preserves the mirror catalog fields across a cell edit", async () => {
    // Seed the mirror + sidecar with catalog fields.
    await persistDataHubContent(OWNER, ID, makeContent());

    // Open the doc, edit a cell, persist via the doc path.
    const doc = new LoroDoc();
    doc.import(seedDataHubDoc(makeContent()));
    setCell(doc, "r1", "c-y", 999);
    doc.commit();
    await persistDataHubDoc(OWNER, ID, doc);

    const mirror = jsons.get(JSON_PATH) as DataHubDocContent;
    // The cell edit is reflected.
    expect(mirror.rows[0].cells["c-y"]).toBe(999);
    // The catalog fields survived even though the doc never stored them.
    expect(mirror.meta.project_ids).toEqual(["proj-a"]);
    expect(mirror.meta.folder_path).toBe("raw");
    expect(mirror.meta.last_edited_by).toBe("alex");
  });

  it("prefers the sidecar over the mirror when both exist", async () => {
    await persistDataHubContent(OWNER, ID, makeContent({ rows: [{ id: "r1", cells: { "c-x": 1, "c-y": 7 } }] }));
    // Tamper the mirror so we can tell which source loadOrRebuild used.
    jsons.set(JSON_PATH, makeContent({ rows: [{ id: "r1", cells: { "c-x": 1, "c-y": 999 } }] }));
    const reloaded = await loadOrRebuildDataHubDoc(OWNER, ID);
    expect(getDataHubContent(reloaded).rows[0].cells["c-y"]).toBe(7);
  });

  it("deleteDataHubFiles removes both files", async () => {
    await persistDataHubContent(OWNER, ID, makeContent());
    expect(blobs.has(SIDECAR)).toBe(true);
    expect(jsons.has(JSON_PATH)).toBe(true);
    const had = await deleteDataHubFiles(OWNER, ID);
    expect(had).toBe(true);
    expect(blobs.has(SIDECAR)).toBe(false);
    expect(jsons.has(JSON_PATH)).toBe(false);
  });
});
