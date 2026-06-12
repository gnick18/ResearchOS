// Tests for the summary-stats entry format (subcolumn foundation, chunk 1).
//
// Covers the typed accessor (readGroupSummary), the builder, the write helper,
// the absent-format default (byte-identical to "replicates"), and the Loro
// round-trip of the entryFormat meta field through seed -> projection.

import { describe, it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";

import type { DataHubDocContent } from "./model/types";
import {
  buildSummaryColumnTable,
  entryFormatOf,
  isSummaryFormat,
  readAllGroupSummaries,
  readGroupSummary,
  spreadKindOf,
  summaryColumnId,
  summaryGroupIds,
  writeGroupSummaryCells,
} from "./summary-table";
import {
  seedDataHubDoc,
  getDataHubContent,
  setEntryFormat,
} from "../loro/datahub-doc";

/** A summary Column table content with two groups (mean-sd-n). */
function summaryContent(format: "mean-sd-n" | "mean-sem-n" = "mean-sd-n"): DataHubDocContent {
  const built = buildSummaryColumnTable(
    [
      { datasetId: "g1", name: "Control", mean: 5.2, spread: 0.4, n: 6 },
      { datasetId: "g2", name: "Treated", mean: 6.1, spread: 0.5, n: 5 },
    ],
    format,
  );
  return {
    meta: {
      id: "1",
      name: "Summary table",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      entryFormat: format,
      created_at: "2026-06-11T00:00:00Z",
    },
    columns: built.columns,
    rows: built.rows,
    analyses: [],
    plots: [],
  };
}

/** A plain replicates Column table (no entryFormat). */
function replicatesContent(): DataHubDocContent {
  return {
    meta: {
      id: "2",
      name: "Replicates table",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: "2026-06-11T00:00:00Z",
    },
    columns: [
      { id: "col-1", name: "Group 1", role: "y", dataType: "number" },
      { id: "col-2", name: "Group 2", role: "y", dataType: "number" },
    ],
    rows: [
      { id: "row-1", cells: { "col-1": 1, "col-2": 2 } },
      { id: "row-2", cells: { "col-1": 3, "col-2": 4 } },
    ],
    analyses: [],
    plots: [],
  };
}

describe("summary-table format helpers", () => {
  it("isSummaryFormat is true only for the two summary modes", () => {
    expect(isSummaryFormat("mean-sd-n")).toBe(true);
    expect(isSummaryFormat("mean-sem-n")).toBe(true);
    expect(isSummaryFormat("replicates")).toBe(false);
    expect(isSummaryFormat(undefined)).toBe(false);
  });

  it("entryFormatOf defaults an absent field to replicates", () => {
    expect(entryFormatOf(replicatesContent())).toBe("replicates");
    expect(entryFormatOf(summaryContent("mean-sd-n"))).toBe("mean-sd-n");
    expect(entryFormatOf(summaryContent("mean-sem-n"))).toBe("mean-sem-n");
  });

  it("spreadKindOf maps each format to its stored spread", () => {
    expect(spreadKindOf("mean-sd-n")).toBe("sd");
    expect(spreadKindOf("mean-sem-n")).toBe("sem");
  });

  it("summaryColumnId is deterministic per dataset + kind", () => {
    expect(summaryColumnId("g1", "mean")).toBe("g1-mean");
    expect(summaryColumnId("g1", "sd")).toBe("g1-sd");
    expect(summaryColumnId("g2", "n")).toBe("g2-n");
  });
});

describe("buildSummaryColumnTable", () => {
  it("builds three subcolumns per group sharing the dataset id", () => {
    const built = buildSummaryColumnTable(
      [{ datasetId: "g1", name: "Control", mean: 5, spread: 1, n: 4 }],
      "mean-sd-n",
    );
    expect(built.columns).toHaveLength(3);
    expect(built.columns.every((c) => c.role === "subcolumn")).toBe(true);
    expect(built.columns.every((c) => c.datasetId === "g1")).toBe(true);
    expect(built.columns.map((c) => c.subcolumnKind)).toEqual(["mean", "sd", "n"]);
    expect(built.rows).toHaveLength(1);
    expect(built.rows[0].cells["g1-mean"]).toBe(5);
    expect(built.rows[0].cells["g1-sd"]).toBe(1);
    expect(built.rows[0].cells["g1-n"]).toBe(4);
  });

  it("uses sem subcolumns for the mean-sem-n format", () => {
    const built = buildSummaryColumnTable(
      [{ datasetId: "g1", name: "Control", mean: 5, spread: 0.3, n: 4 }],
      "mean-sem-n",
    );
    expect(built.columns.map((c) => c.subcolumnKind)).toEqual(["mean", "sem", "n"]);
    expect(built.rows[0].cells["g1-sem"]).toBe(0.3);
  });

  it("seeds blank cells when values are omitted", () => {
    const built = buildSummaryColumnTable(
      [{ datasetId: "g1", name: "Control" }],
      "mean-sd-n",
    );
    expect(built.rows[0].cells["g1-mean"]).toBeNull();
    expect(built.rows[0].cells["g1-sd"]).toBeNull();
    expect(built.rows[0].cells["g1-n"]).toBeNull();
  });
});

describe("readGroupSummary", () => {
  it("reads each group's mean / spread / n with the table spread kind", () => {
    const content = summaryContent("mean-sd-n");
    expect(summaryGroupIds(content)).toEqual(["g1", "g2"]);
    const g1 = readGroupSummary(content, "g1");
    expect(g1).toEqual({
      datasetId: "g1",
      name: "Control",
      mean: 5.2,
      spread: 0.4,
      spreadKind: "sd",
      n: 6,
    });
    const g2 = readGroupSummary(content, "g2");
    expect(g2?.mean).toBe(6.1);
    expect(g2?.spreadKind).toBe("sd");
    expect(g2?.n).toBe(5);
  });

  it("reports spreadKind sem for a mean-sem-n table", () => {
    const content = summaryContent("mean-sem-n");
    expect(readGroupSummary(content, "g1")?.spreadKind).toBe("sem");
  });

  it("returns null for an unknown group id", () => {
    expect(readGroupSummary(summaryContent(), "nope")).toBeNull();
  });

  it("reads null for blank or non-numeric cells", () => {
    const built = buildSummaryColumnTable(
      [{ datasetId: "g1", name: "Control" }],
      "mean-sd-n",
    );
    const content: DataHubDocContent = {
      meta: {
        id: "3",
        name: "blank",
        project_ids: [],
        folder_path: null,
        table_type: "column",
        entryFormat: "mean-sd-n",
        created_at: "2026-06-11T00:00:00Z",
      },
      columns: built.columns,
      rows: built.rows,
      analyses: [],
      plots: [],
    };
    const g1 = readGroupSummary(content, "g1");
    expect(g1?.mean).toBeNull();
    expect(g1?.spread).toBeNull();
    expect(g1?.n).toBeNull();
  });

  it("readAllGroupSummaries returns every group in order", () => {
    const all = readAllGroupSummaries(summaryContent());
    expect(all.map((g) => g.datasetId)).toEqual(["g1", "g2"]);
  });
});

describe("writeGroupSummaryCells", () => {
  it("patches one group's cells without mutating the input", () => {
    const content = summaryContent("mean-sd-n");
    const next = writeGroupSummaryCells(content, "g1", { mean: 9.9, n: 10 });
    // Original untouched (pure).
    expect(readGroupSummary(content, "g1")?.mean).toBe(5.2);
    // New content reflects the patch; the unpatched spread is preserved.
    expect(readGroupSummary(next, "g1")?.mean).toBe(9.9);
    expect(readGroupSummary(next, "g1")?.n).toBe(10);
    expect(readGroupSummary(next, "g1")?.spread).toBe(0.4);
    // The other group is untouched.
    expect(readGroupSummary(next, "g2")?.mean).toBe(6.1);
  });

  it("clears a cell when patched with null", () => {
    const content = summaryContent("mean-sd-n");
    const next = writeGroupSummaryCells(content, "g1", { spread: null });
    expect(readGroupSummary(next, "g1")?.spread).toBeNull();
  });

  it("is a no-op for an unknown group id", () => {
    const content = summaryContent();
    expect(writeGroupSummaryCells(content, "nope", { mean: 1 })).toBe(content);
  });
});

describe("entryFormat Loro round-trip", () => {
  it("a summary-format document round-trips through seed -> projection", () => {
    const content = summaryContent("mean-sem-n");
    const doc = new LoroDoc();
    doc.import(seedDataHubDoc(content));
    const back = getDataHubContent(doc, "1");
    expect(back.meta.entryFormat).toBe("mean-sem-n");
    // The summary subcolumns + single row survive the round-trip.
    expect(back.columns).toHaveLength(6);
    expect(back.rows).toHaveLength(1);
    expect(readGroupSummary(back, "g1")?.mean).toBe(5.2);
    expect(readGroupSummary(back, "g1")?.spreadKind).toBe("sem");
  });

  it("an absent entryFormat projects without the field (byte-identical default)", () => {
    const content = replicatesContent();
    const doc = new LoroDoc();
    doc.import(seedDataHubDoc(content));
    const back = getDataHubContent(doc, "2");
    expect(back.meta.entryFormat).toBeUndefined();
    expect(entryFormatOf(back)).toBe("replicates");
  });

  it("seeding a replicates document is byte-identical with or without the new field", () => {
    // The seed must not write the entry_format key for a replicates document, so
    // the snapshot bytes match a document that never knew the field existed.
    const a = seedDataHubDoc(replicatesContent());
    const withExplicit: DataHubDocContent = {
      ...replicatesContent(),
      meta: { ...replicatesContent().meta, entryFormat: "replicates" },
    };
    const b = seedDataHubDoc(withExplicit);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("setEntryFormat sets and clears the meta key", () => {
    const doc = new LoroDoc();
    doc.import(seedDataHubDoc(replicatesContent()));
    setEntryFormat(doc, "mean-sd-n");
    doc.commit();
    expect(getDataHubContent(doc, "2").meta.entryFormat).toBe("mean-sd-n");
    setEntryFormat(doc, "replicates");
    doc.commit();
    expect(getDataHubContent(doc, "2").meta.entryFormat).toBeUndefined();
  });
});
