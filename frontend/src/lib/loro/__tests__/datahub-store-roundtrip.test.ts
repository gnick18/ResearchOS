// Real-folder persistence round-trip for a Data Hub document.
//
// The blind spot before launch was whether a full edit cycle survives a RELOAD:
// the bytes land on disk and a fresh open reads them back. The /datahub page
// opens a handle, edits, commits (debounced), and lets close() flush; the
// handle's commit is exactly persistDataHubDoc, and a fresh open is
// loadOrRebuildDataHubDoc. This test drives that persist -> reload -> persist
// cycle against an in-memory fileService (the same interface a connected File
// System Access folder backs), so the Loro seed, cell mutators, snapshot
// export, and reload import all run for real. fileService is the only seam
// mocked.
//
// (The thin DataHubDocHandle wrapper around these calls is not imported here on
// purpose: pulling in datahub-store's loro-codemirror / collab graph flips the
// loro WASM build in the node test env in a way that breaks Blob.arrayBuffer,
// a test-environment quirk unrelated to the persistence logic under test.)
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DataHubDocContent } from "@/lib/datahub/model/types";

const blobs = new Map<string, Uint8Array>();
const jsons = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    ensureDir: vi.fn(async () => null),
    readFileAsBlob: vi.fn(async (path: string) => {
      const v = blobs.get(path);
      return v === undefined ? null : new Blob([v.buffer as ArrayBuffer]);
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

import {
  getDataHubContent,
  setCell,
  setAnalysis,
  setPlot,
} from "@/lib/loro/datahub-doc";
import {
  persistDataHubContent,
  persistDataHubDoc,
  loadOrRebuildDataHubDoc,
} from "@/lib/loro/datahub-sidecar-store";

const OWNER = "alex";
const ID = "7";

function seedContent(): DataHubDocContent {
  return {
    meta: {
      id: ID,
      name: "Viability assay",
      project_ids: ["3"],
      folder_path: "Assays",
      table_type: "column",
      created_at: "2026-06-11T00:00:00.000Z",
    },
    columns: [
      { id: "col-1", name: "Control", role: "y", dataType: "number" },
      { id: "col-2", name: "Drug", role: "y", dataType: "number" },
    ],
    rows: [
      { id: "row-1", cells: { "col-1": 10, "col-2": 40 } },
      { id: "row-2", cells: { "col-1": 20, "col-2": 50 } },
    ],
    analyses: [],
    plots: [],
  };
}

describe("Data Hub store: real-folder persistence round-trip", () => {
  beforeEach(() => {
    blobs.clear();
    jsons.clear();
  });

  it("a cell edit saved to disk survives a reload", async () => {
    // Create the document on "disk" (both sidecar .loro and .json mirror).
    await persistDataHubContent(OWNER, ID, seedContent());

    // Open it (rebuild the live doc from disk), edit a cell the way the grid
    // does, then save (what the handle's debounced commit runs).
    const doc1 = await loadOrRebuildDataHubDoc(OWNER, ID);
    setCell(doc1, "row-1", "col-2", 99);
    doc1.commit();
    await persistDataHubDoc(OWNER, ID, doc1);

    // Reload: a fresh open must read the persisted bytes back.
    const doc2 = await loadOrRebuildDataHubDoc(OWNER, ID);
    const reloaded = getDataHubContent(doc2, ID);

    expect(reloaded.rows.find((r) => r.id === "row-1")?.cells["col-2"]).toBe(99);
    // The rest of the table is intact.
    expect(reloaded.columns.map((c) => c.name)).toEqual(["Control", "Drug"]);
    expect(reloaded.rows).toHaveLength(2);
    expect(reloaded.rows.find((r) => r.id === "row-2")?.cells["col-1"]).toBe(20);
    expect(reloaded.meta.table_type).toBe("column");
  });

  it("a stored analysis spec survives a reload", async () => {
    await persistDataHubContent(OWNER, ID, seedContent());

    const doc1 = await loadOrRebuildDataHubDoc(OWNER, ID);
    setAnalysis(doc1, {
      id: "analysis-1",
      type: "unpairedTTest",
      params: { tails: 2 },
      inputs: { columnIds: ["col-1", "col-2"] },
      resultCache: { kind: "ttest", pValue: 0.01 },
      resultStale: false,
    });
    doc1.commit();
    await persistDataHubDoc(OWNER, ID, doc1);

    const doc2 = await loadOrRebuildDataHubDoc(OWNER, ID);
    const reloaded = getDataHubContent(doc2, ID);

    expect(reloaded.analyses).toHaveLength(1);
    const a = reloaded.analyses[0];
    expect(a.type).toBe("unpairedTTest");
    expect((a.inputs as { columnIds: string[] }).columnIds).toEqual([
      "col-1",
      "col-2",
    ]);
    expect((a.resultCache as { pValue: number }).pValue).toBe(0.01);
  });

  it("the .json catalog mirror (project + folder) survives a reload", async () => {
    await persistDataHubContent(OWNER, ID, seedContent());
    // Edit a cell and re-save the doc; the catalog fields live in the mirror
    // and must not be lost when only the table changes.
    const doc1 = await loadOrRebuildDataHubDoc(OWNER, ID);
    setCell(doc1, "row-2", "col-2", 77);
    doc1.commit();
    await persistDataHubDoc(OWNER, ID, doc1);

    // The mirror keeps project_ids / folder_path (read straight from disk).
    const mirror = jsons.get(`users/${OWNER}/datahub/${ID}.json`) as
      | { meta: { project_ids: string[]; folder_path: string | null } }
      | undefined;
    expect(mirror?.meta.project_ids).toEqual(["3"]);
    expect(mirror?.meta.folder_path).toBe("Assays");
  });

  // The phase-2b rail-rename data-shape: the optional display name on an analysis
  // and a figure must survive a real persist -> reload cycle through the Loro
  // snapshot, and a nameless spec must come back without a name (label fallback).
  it("a renamed analysis + figure name survives a reload; nameless falls back", async () => {
    await persistDataHubContent(OWNER, ID, seedContent());

    const doc1 = await loadOrRebuildDataHubDoc(OWNER, ID);
    // One named analysis, one named figure (the rail rename), plus a nameless
    // figure that must stay nameless on reload.
    setAnalysis(doc1, {
      id: "analysis-named",
      name: "Primary t-test",
      type: "unpairedTTest",
      params: {},
      inputs: {},
      resultCache: null,
      resultStale: false,
    });
    setPlot(doc1, {
      id: "plot-named",
      name: "Figure 1",
      type: "columnScatter",
      style: { title: "" },
      source: {},
    });
    setPlot(doc1, {
      id: "plot-bare",
      type: "columnBar",
      style: { title: "" },
      source: {},
    });
    doc1.commit();
    await persistDataHubDoc(OWNER, ID, doc1);

    const doc2 = await loadOrRebuildDataHubDoc(OWNER, ID);
    const reloaded = getDataHubContent(doc2, ID);

    const a = reloaded.analyses.find((x) => x.id === "analysis-named")!;
    expect(a.name).toBe("Primary t-test");
    const named = reloaded.plots.find((p) => p.id === "plot-named")!;
    expect(named.name).toBe("Figure 1");
    // The nameless figure round-trips WITHOUT a name key, so the rail falls back
    // to the computed kind label.
    const bare = reloaded.plots.find((p) => p.id === "plot-bare")!;
    expect("name" in bare).toBe(false);
  });
});
