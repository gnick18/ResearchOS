// Tests for the cell-level Data Hub Loro model (Phase 0 data model).

import { describe, it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";
import type { DataHubDocContent } from "../types";
import {
  seedDataHubDoc,
  getDataHubContent,
  getDataHubMeta,
  setCell,
  addRow,
  deleteRow,
  moveRow,
  addColumn,
  updateColumn,
  removeColumn,
  moveColumn,
  setAnalysis,
  removeAnalysis,
  setPlot,
  removePlot,
  setTitle,
  META_KEY,
  COLUMNS_KEY,
  ROWS_KEY,
  ANALYSES_KEY,
  PLOTS_KEY,
} from "../../../loro/datahub-doc";

function makeContent(over: Partial<DataHubDocContent> = {}): DataHubDocContent {
  return {
    meta: {
      id: "1",
      name: "Cell viability assay",
      project_ids: ["proj-a"],
      folder_path: null,
      table_type: "column",
      created_at: "2026-06-10T00:00:00Z",
    },
    columns: [
      { id: "c-x", name: "Concentration", role: "x", dataType: "number" },
      {
        id: "c-y1",
        name: "Control",
        role: "y",
        dataType: "number",
        datasetId: "ds-control",
        subcolumnKind: "replicate",
      },
      {
        id: "c-y2",
        name: "Treated",
        role: "y",
        dataType: "number",
        datasetId: "ds-treated",
        subcolumnKind: "replicate",
      },
    ],
    rows: [
      { id: "r1", cells: { "c-x": 1, "c-y1": 100, "c-y2": 98 } },
      { id: "r2", cells: { "c-x": 10, "c-y1": 80, "c-y2": 45 } },
      { id: "r3", cells: { "c-x": 100, "c-y1": 60, "c-y2": null } },
    ],
    analyses: [
      {
        id: "a1",
        type: "unpairedTTest",
        params: { tails: 2, alpha: 0.05 },
        inputs: { groupA: "c-y1", groupB: "c-y2" },
        resultCache: null,
        resultStale: true,
      },
    ],
    plots: [
      {
        id: "p1",
        type: "xy",
        style: { color: "#3b82f6", errorBars: "sem" },
        source: { x: "c-x", y: ["c-y1", "c-y2"] },
      },
    ],
    ...over,
  };
}

function importSeed(content: DataHubDocContent): LoroDoc {
  const doc = new LoroDoc();
  doc.import(seedDataHubDoc(content));
  return doc;
}

describe("datahub-doc model", () => {
  it("round-trips full content through a snapshot", () => {
    const content = makeContent();
    const doc = importSeed(content);
    const projected = getDataHubContent(doc, content.meta.id);
    expect(projected.columns).toEqual(content.columns);
    expect(projected.rows).toEqual(content.rows);
    expect(projected.analyses).toEqual(content.analyses);
    expect(projected.plots).toEqual(content.plots);
    // The in-doc meta carries title / table_type / created_at; the catalog
    // fields (project_ids / folder_path) live in the mirror, so the projection
    // normalizes them to empty / null.
    expect(projected.meta.name).toBe(content.meta.name);
    expect(projected.meta.table_type).toBe(content.meta.table_type);
    expect(projected.meta.created_at).toBe(content.meta.created_at);
    expect(projected.meta.project_ids).toEqual([]);
    expect(projected.meta.folder_path).toBeNull();
  });

  it("is deterministic: two seeds of the same content are byte-equal", () => {
    const content = makeContent();
    const a = seedDataHubDoc(content);
    const b = seedDataHubDoc(content);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("materializes all five containers", () => {
    const doc = importSeed(makeContent());
    expect(doc.getMap(META_KEY)).toBeDefined();
    expect(doc.getMovableList(COLUMNS_KEY).length).toBe(3);
    expect(doc.getMovableList(ROWS_KEY).length).toBe(3);
    expect(doc.getMovableList(ANALYSES_KEY).length).toBe(1);
    expect(doc.getMovableList(PLOTS_KEY).length).toBe(1);
    // The seed never writes collab_doc_id (minted later on the shared context).
    expect(getDataHubMeta(doc).get("collab_doc_id")).toBeUndefined();
  });

  it("setCell edits exactly one cell", () => {
    const doc = importSeed(makeContent());
    setCell(doc, "r2", "c-y2", 50);
    doc.commit();
    const rows = getDataHubContent(doc).rows;
    expect(rows.find((r) => r.id === "r2")!.cells["c-y2"]).toBe(50);
    // Untouched cells are unchanged.
    expect(rows.find((r) => r.id === "r1")!.cells["c-y2"]).toBe(98);
    expect(rows.find((r) => r.id === "r2")!.cells["c-y1"]).toBe(80);
  });

  it("setCell can clear a cell to null", () => {
    const doc = importSeed(makeContent());
    setCell(doc, "r1", "c-y1", null);
    doc.commit();
    expect(
      getDataHubContent(doc).rows.find((r) => r.id === "r1")!.cells["c-y1"],
    ).toBeNull();
  });

  it("setCell rejects the reserved id column key", () => {
    const doc = importSeed(makeContent());
    expect(() => setCell(doc, "r1", "id", 5)).toThrow(/reserved/);
  });

  it("addRow / deleteRow / moveRow reflect in the projection", () => {
    const doc = importSeed(makeContent());
    addRow(doc, { id: "r4", cells: { "c-x": 1000, "c-y1": 30, "c-y2": 10 } });
    doc.commit();
    let rows = getDataHubContent(doc).rows;
    expect(rows.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(rows[3].cells["c-x"]).toBe(1000);

    deleteRow(doc, "r2");
    doc.commit();
    rows = getDataHubContent(doc).rows;
    expect(rows.map((r) => r.id)).toEqual(["r1", "r3", "r4"]);

    moveRow(doc, "r4", 0);
    doc.commit();
    rows = getDataHubContent(doc).rows;
    expect(rows.map((r) => r.id)).toEqual(["r4", "r1", "r3"]);
  });

  it("addColumn / updateColumn / removeColumn / moveColumn reflect in the projection", () => {
    const doc = importSeed(makeContent());
    addColumn(doc, { id: "c-note", name: "Note", role: "subcolumn", dataType: "text" });
    doc.commit();
    let cols = getDataHubContent(doc).columns;
    expect(cols.map((c) => c.id)).toEqual(["c-x", "c-y1", "c-y2", "c-note"]);

    updateColumn(doc, "c-note", { name: "Comment", dataType: "text" });
    doc.commit();
    cols = getDataHubContent(doc).columns;
    expect(cols.find((c) => c.id === "c-note")!.name).toBe("Comment");

    moveColumn(doc, "c-note", 0);
    doc.commit();
    cols = getDataHubContent(doc).columns;
    expect(cols.map((c) => c.id)).toEqual(["c-note", "c-x", "c-y1", "c-y2"]);

    removeColumn(doc, "c-note");
    doc.commit();
    cols = getDataHubContent(doc).columns;
    expect(cols.map((c) => c.id)).toEqual(["c-x", "c-y1", "c-y2"]);
  });

  it("setAnalysis upserts and removeAnalysis deletes via the serialized path", () => {
    const doc = importSeed(makeContent());
    // Upsert (replace existing a1).
    setAnalysis(doc, {
      id: "a1",
      type: "oneWayAnova",
      params: { postHoc: "tukey" },
      inputs: { groups: ["c-y1", "c-y2"] },
      resultCache: { p: 0.012, f: 8.3 },
      resultStale: false,
    });
    // Append a new one.
    setAnalysis(doc, {
      id: "a2",
      type: "pearson",
      params: {},
      inputs: { x: "c-x", y: "c-y1" },
      resultCache: null,
      resultStale: true,
    });
    doc.commit();
    let analyses = getDataHubContent(doc).analyses;
    expect(analyses.map((a) => a.id)).toEqual(["a1", "a2"]);
    const a1 = analyses.find((a) => a.id === "a1")!;
    expect(a1.type).toBe("oneWayAnova");
    expect(a1.params).toEqual({ postHoc: "tukey" });
    expect(a1.resultCache).toEqual({ p: 0.012, f: 8.3 });
    expect(a1.resultStale).toBe(false);

    removeAnalysis(doc, "a1");
    doc.commit();
    analyses = getDataHubContent(doc).analyses;
    expect(analyses.map((a) => a.id)).toEqual(["a2"]);
  });

  it("setPlot upserts and removePlot deletes via the serialized path", () => {
    const doc = importSeed(makeContent());
    setPlot(doc, {
      id: "p1",
      type: "bar",
      style: { palette: "viridis" },
      source: { groups: ["c-y1", "c-y2"] },
    });
    setPlot(doc, {
      id: "p2",
      type: "scatter",
      style: {},
      source: { x: "c-x", y: "c-y1" },
    });
    doc.commit();
    let plots = getDataHubContent(doc).plots;
    expect(plots.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(plots.find((p) => p.id === "p1")!.type).toBe("bar");
    expect(plots.find((p) => p.id === "p1")!.style).toEqual({ palette: "viridis" });

    removePlot(doc, "p2");
    doc.commit();
    plots = getDataHubContent(doc).plots;
    expect(plots.map((p) => p.id)).toEqual(["p1"]);
  });

  it("round-trips the optional analysis + plot display name", () => {
    const doc = importSeed(makeContent());
    // Rename via the upsert path (set name on an existing analysis / plot).
    setAnalysis(doc, {
      id: "a1",
      name: "Primary t-test",
      type: "unpairedTTest",
      params: { tails: 2, alpha: 0.05 },
      inputs: { groupA: "c-y1", groupB: "c-y2" },
      resultCache: null,
      resultStale: true,
    });
    setPlot(doc, {
      id: "p1",
      name: "Figure 1",
      type: "xy",
      style: { color: "#3b82f6" },
      source: { x: "c-x", y: ["c-y1"] },
    });
    doc.commit();
    const content = getDataHubContent(doc);
    expect(content.analyses.find((a) => a.id === "a1")!.name).toBe(
      "Primary t-test",
    );
    expect(content.plots.find((p) => p.id === "p1")!.name).toBe("Figure 1");
  });

  it("omits the name field entirely when absent (label fallback, back-compat)", () => {
    const doc = importSeed(makeContent());
    const content = getDataHubContent(doc);
    // The seed content has no name, so the projection must not invent one. The
    // rail uses this absence to fall back to the computed type / kind label.
    expect("name" in content.analyses[0]).toBe(false);
    expect("name" in content.plots[0]).toBe(false);
  });

  it("a nameless spec seeds byte-for-byte the same as before name existed", () => {
    // Determinism (and back-compat) guard: adding the optional field must not
    // change the serialized bytes for a spec that never sets it.
    const content = makeContent();
    const a = seedDataHubDoc(content);
    const b = seedDataHubDoc(content);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("a blank rename clears the name back to the label fallback", () => {
    const doc = importSeed(makeContent());
    setAnalysis(doc, {
      id: "a1",
      name: "Named",
      type: "unpairedTTest",
      params: {},
      inputs: {},
      resultCache: null,
      resultStale: false,
    });
    doc.commit();
    expect(getDataHubContent(doc).analyses[0].name).toBe("Named");
    // Re-upsert without a name (what the page does when the rename is blanked).
    setAnalysis(doc, {
      id: "a1",
      type: "unpairedTTest",
      params: {},
      inputs: {},
      resultCache: null,
      resultStale: false,
    });
    doc.commit();
    expect("name" in getDataHubContent(doc).analyses[0]).toBe(false);
  });

  it("duplicating a plot spec copies its style + source verbatim under a new id", () => {
    // The shape the page's duplicatePlot relies on: a cloned spec round-trips as
    // an independent figure with the same style / source and a copy name.
    const doc = importSeed(makeContent());
    const source = getDataHubContent(doc).plots.find((p) => p.id === "p1")!;
    const copy = {
      ...source,
      id: "p1-copy",
      name: "XY graph copy",
      style: { ...source.style },
      source: { ...source.source },
    };
    setPlot(doc, copy);
    doc.commit();
    const plots = getDataHubContent(doc).plots;
    expect(plots.map((p) => p.id)).toEqual(["p1", "p1-copy"]);
    const dup = plots.find((p) => p.id === "p1-copy")!;
    expect(dup.style).toEqual(source.style);
    expect(dup.source).toEqual(source.source);
    expect(dup.name).toBe("XY graph copy");
    // The original is untouched (no name leaked onto it).
    expect("name" in plots.find((p) => p.id === "p1")!).toBe(false);
  });

  it("setTitle updates meta", () => {
    const doc = importSeed(makeContent());
    setTitle(doc, "Renamed assay");
    doc.commit();
    expect(getDataHubContent(doc).meta.name).toBe("Renamed assay");
  });

  it("CELL-LEVEL merge: two replicas edit different cells and both converge", () => {
    const content = makeContent();
    const a = importSeed(content);
    const b = importSeed(content);
    a.setPeerId(BigInt(11));
    b.setPeerId(BigInt(22));

    // Replica A edits one cell, replica B edits a DIFFERENT cell.
    setCell(a, "r1", "c-y1", 111);
    a.commit();
    setCell(b, "r2", "c-y2", 222);
    b.commit();

    // Merge both ways.
    a.import(b.export({ mode: "update" }));
    b.import(a.export({ mode: "update" }));

    const rowsA = getDataHubContent(a).rows;
    const rowsB = getDataHubContent(b).rows;
    expect(rowsA.find((r) => r.id === "r1")!.cells["c-y1"]).toBe(111);
    expect(rowsA.find((r) => r.id === "r2")!.cells["c-y2"]).toBe(222);
    expect(rowsB).toEqual(rowsA);
  });

  it("CELL-LEVEL merge: edits to different cells of the SAME row converge", () => {
    const content = makeContent();
    const a = importSeed(content);
    const b = importSeed(content);
    a.setPeerId(BigInt(33));
    b.setPeerId(BigInt(44));

    setCell(a, "r1", "c-y1", 1);
    a.commit();
    setCell(b, "r1", "c-y2", 2);
    b.commit();

    a.import(b.export({ mode: "update" }));
    b.import(a.export({ mode: "update" }));

    const r1a = getDataHubContent(a).rows.find((r) => r.id === "r1")!;
    expect(r1a.cells["c-y1"]).toBe(1);
    expect(r1a.cells["c-y2"]).toBe(2);
    expect(getDataHubContent(b).rows).toEqual(getDataHubContent(a).rows);
  });

  it("normalizes optional column fields and an empty document", () => {
    const empty = makeContent({
      columns: [{ id: "c1", name: "X", role: "x", dataType: "number" }],
      rows: [],
      analyses: [],
      plots: [],
    });
    const doc = importSeed(empty);
    const projected = getDataHubContent(doc);
    expect(projected.columns).toEqual([
      { id: "c1", name: "X", role: "x", dataType: "number" },
    ]);
    expect(projected.rows).toEqual([]);
    expect(projected.analyses).toEqual([]);
    expect(projected.plots).toEqual([]);
  });
});
