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
  sdFromSem,
  semFromSd,
  replicatesToSummaryPlan,
  summaryToReplicatesPlan,
  convertSpreadKindPlan,
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

describe("entry-format conversions", () => {
  /** A replicates Column table with two groups of three known replicates. */
  function repThreeEach(): DataHubDocContent {
    return {
      meta: {
        id: "10",
        name: "Reps",
        project_ids: [],
        folder_path: null,
        table_type: "column",
        created_at: "2026-06-11T00:00:00Z",
      },
      columns: [
        { id: "col-1", name: "Control", role: "y", dataType: "number" },
        { id: "col-2", name: "Treated", role: "y", dataType: "number" },
      ],
      rows: [
        { id: "row-1", cells: { "col-1": 2, "col-2": 10 } },
        { id: "row-2", cells: { "col-1": 4, "col-2": 12 } },
        { id: "row-3", cells: { "col-1": 6, "col-2": 14 } },
      ],
      analyses: [],
      plots: [],
    };
  }

  it("sdFromSem and semFromSd round-trip with a known n", () => {
    // n = 4 so sqrt(n) = 2 exactly; SEM = SD / 2, SD = SEM * 2.
    expect(semFromSd(0.8, 4)).toBeCloseTo(0.4, 12);
    expect(sdFromSem(0.4, 4)).toBeCloseTo(0.8, 12);
    // A round trip returns the original spread.
    expect(sdFromSem(semFromSd(1.5, 9) as number, 9)).toBeCloseTo(1.5, 12);
    // Missing / invalid n yields null rather than a divide by an unknown count.
    expect(semFromSd(1, null)).toBeNull();
    expect(sdFromSem(1, 0)).toBeNull();
  });

  it("replicatesToSummaryPlan computes the right mean / sd / n per group", () => {
    const plan = replicatesToSummaryPlan(repThreeEach(), "mean-sd-n");
    const content: DataHubDocContent = {
      ...repThreeEach(),
      meta: { ...repThreeEach().meta, entryFormat: "mean-sd-n" },
      columns: plan.columns,
      rows: plan.rows,
    };
    // Each group keeps its column id as the dataset id and its name.
    expect(summaryGroupIds(content)).toEqual(["col-1", "col-2"]);
    const g1 = readGroupSummary(content, "col-1");
    // mean(2,4,6) = 4; sample sd of (2,4,6) = 2; n = 3.
    expect(g1?.mean).toBeCloseTo(4, 12);
    expect(g1?.spread).toBeCloseTo(2, 12);
    expect(g1?.n).toBe(3);
    expect(g1?.name).toBe("Control");
    const g2 = readGroupSummary(content, "col-2");
    // mean(10,12,14) = 12; sample sd = 2; n = 3.
    expect(g2?.mean).toBeCloseTo(12, 12);
    expect(g2?.spread).toBeCloseTo(2, 12);
    expect(g2?.n).toBe(3);
  });

  it("replicatesToSummaryPlan stores SEM for the mean-sem-n format", () => {
    const plan = replicatesToSummaryPlan(repThreeEach(), "mean-sem-n");
    const content: DataHubDocContent = {
      ...repThreeEach(),
      meta: { ...repThreeEach().meta, entryFormat: "mean-sem-n" },
      columns: plan.columns,
      rows: plan.rows,
    };
    const g1 = readGroupSummary(content, "col-1");
    // SEM = SD / sqrt(n) = 2 / sqrt(3).
    expect(g1?.spreadKind).toBe("sem");
    expect(g1?.spread).toBeCloseTo(2 / Math.sqrt(3), 12);
  });

  it("convertSpreadKindPlan converts SD to SEM losslessly with the stored n", () => {
    // Build an SD table: spread = 0.8, n = 4 so SEM should be 0.4.
    const sd = buildSummaryColumnTable(
      [{ datasetId: "g1", name: "A", mean: 5, spread: 0.8, n: 4 }],
      "mean-sd-n",
    );
    const sdContent: DataHubDocContent = {
      meta: {
        id: "11",
        name: "sd",
        project_ids: [],
        folder_path: null,
        table_type: "column",
        entryFormat: "mean-sd-n",
        created_at: "2026-06-11T00:00:00Z",
      },
      columns: sd.columns,
      rows: sd.rows,
      analyses: [],
      plots: [],
    };
    const plan = convertSpreadKindPlan(sdContent, "mean-sem-n");
    const semContent: DataHubDocContent = {
      ...sdContent,
      meta: { ...sdContent.meta, entryFormat: "mean-sem-n" },
      columns: plan.columns,
      rows: plan.rows,
    };
    const g1 = readGroupSummary(semContent, "g1");
    expect(g1?.spreadKind).toBe("sem");
    expect(g1?.mean).toBe(5);
    expect(g1?.n).toBe(4);
    expect(g1?.spread).toBeCloseTo(0.4, 12);

    // And back to SD returns the original spread (round trip).
    const back = convertSpreadKindPlan(semContent, "mean-sd-n");
    const sdBack: DataHubDocContent = {
      ...semContent,
      meta: { ...semContent.meta, entryFormat: "mean-sd-n" },
      columns: back.columns,
      rows: back.rows,
    };
    expect(readGroupSummary(sdBack, "g1")?.spread).toBeCloseTo(0.8, 12);
  });

  it("summaryToReplicatesPlan keeps each group's mean as a single replicate", () => {
    const plan = summaryToReplicatesPlan(summaryContent("mean-sd-n"), 6);
    // Two groups -> two replicate columns, named for the groups, plain "y" role.
    expect(plan.columns).toHaveLength(2);
    expect(plan.columns.map((c) => c.name)).toEqual(["Control", "Treated"]);
    expect(plan.columns.every((c) => c.role === "y")).toBe(true);
    // The first row carries each group's entered mean; the rest are blank.
    const c1 = plan.columns[0].id;
    const c2 = plan.columns[1].id;
    expect(plan.rows[0].cells[c1]).toBe(5.2);
    expect(plan.rows[0].cells[c2]).toBe(6.1);
    expect(plan.rows[1].cells[c1]).toBeNull();
    expect(plan.rows).toHaveLength(6);
  });
});
