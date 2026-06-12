// Tests for the group-aware column CRUD core (grid-crud phase 2a follow-up).
// Covers the group-level guards (last group / last replicate) and the new-column
// shapes a Grouped table's group menu produces (delete / duplicate group, add /
// remove replicate, insert group). A Grouped table's columns are replicate
// subcolumns bound into datasetId groups, so these helpers keep the groups EVEN
// where the generic per-column helpers would tear them; the page menus are thin
// wrappers around the guards and shapes proven here.

import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";

import type {
  ColumnDef,
  DataHubDocContent,
  DataHubDocument,
  RowRecord,
} from "@/lib/datahub/model/types";
import {
  buildAddedReplicate,
  buildDuplicateGroupPlan,
  buildInsertGroupColumns,
  canDeleteGroup,
  canRemoveReplicate,
  groupColumnIds,
  groupEndIndex,
  groupReplicateCount,
  groupStartIndex,
  nextGroupName,
  replicateToRemove,
} from "@/lib/datahub/grouped-grid-crud";
import {
  seedDataHubDoc,
  getDataHubContent,
  addColumnAt,
  removeColumnWithCells,
  setCell,
} from "@/lib/loro/datahub-doc";

// --- fixtures --------------------------------------------------------------

function meta(): DataHubDocument {
  return {
    id: "t1",
    name: "Test",
    project_ids: [],
    folder_path: null,
    table_type: "grouped",
    created_at: "2026-06-11T00:00:00.000Z",
  };
}

/**
 * A Grouped table with `groups` groups of `reps` replicates each, plus one
 * labeled row carrying a distinct value per replicate cell (so a value copy is
 * observable). Column ids are g{G}-r{R}; the row-label column is "rowlabel".
 */
function groupedTable(groups = 2, reps = 2): DataHubDocContent {
  const columns: ColumnDef[] = [
    { id: "rowlabel", name: "Row", role: "x", dataType: "text" },
  ];
  const cells: Record<string, number | string | null> = { rowlabel: "A" };
  let v = 1;
  for (let g = 0; g < groups; g++) {
    for (let r = 0; r < reps; r++) {
      const id = `g${g + 1}-r${r + 1}`;
      columns.push({
        id,
        name: `Group ${g + 1}`,
        role: "y",
        dataType: "number",
        datasetId: `g${g + 1}`,
        subcolumnKind: "replicate",
      });
      cells[id] = v++;
    }
  }
  const rows: RowRecord[] = [{ id: "r1", cells }];
  return { meta: meta(), columns, rows, analyses: [], plots: [] };
}

// --- delete-group guard ----------------------------------------------------

describe("canDeleteGroup", () => {
  it("allows deleting a group when more than one remains", () => {
    expect(canDeleteGroup(groupedTable(2), "g1")).toBe(true);
  });

  it("blocks deleting the last remaining group", () => {
    expect(canDeleteGroup(groupedTable(1), "g1")).toBe(false);
  });

  it("is false for an unknown datasetId", () => {
    expect(canDeleteGroup(groupedTable(2), "nope")).toBe(false);
  });
});

// --- remove-replicate guard ------------------------------------------------

describe("canRemoveReplicate", () => {
  it("allows removing a replicate when more than one remains", () => {
    expect(canRemoveReplicate(groupedTable(2, 2), "g1")).toBe(true);
  });

  it("blocks removing the last replicate of a group", () => {
    expect(canRemoveReplicate(groupedTable(2, 1), "g1")).toBe(false);
  });

  it("is false for an unknown datasetId", () => {
    expect(canRemoveReplicate(groupedTable(2, 2), "nope")).toBe(false);
  });
});

// --- replicate count + next name -------------------------------------------

describe("groupReplicateCount / nextGroupName", () => {
  it("reads the replicate count off the first group", () => {
    expect(groupReplicateCount(groupedTable(2, 3))).toBe(3);
  });

  it("names the next group counting existing groups", () => {
    expect(nextGroupName(groupedTable(2))).toBe("Group 3");
    expect(nextGroupName(groupedTable(1))).toBe("Group 2");
  });
});

// --- group column ids + index helpers --------------------------------------

describe("groupColumnIds / index helpers", () => {
  it("lists a group's replicate column ids in declared order", () => {
    expect(groupColumnIds(groupedTable(2, 2), "g1")).toEqual(["g1-r1", "g1-r2"]);
    expect(groupColumnIds(groupedTable(2, 2), "g2")).toEqual(["g2-r1", "g2-r2"]);
  });

  it("returns [] for an unknown datasetId", () => {
    expect(groupColumnIds(groupedTable(2), "nope")).toEqual([]);
  });

  it("groupStartIndex is the absolute index of the first replicate column", () => {
    // columns are [rowlabel, g1-r1, g1-r2, g2-r1, g2-r2]
    expect(groupStartIndex(groupedTable(2, 2), "g1")).toBe(1);
    expect(groupStartIndex(groupedTable(2, 2), "g2")).toBe(3);
  });

  it("groupEndIndex is the index right after the last replicate column", () => {
    expect(groupEndIndex(groupedTable(2, 2), "g1")).toBe(3);
    expect(groupEndIndex(groupedTable(2, 2), "g2")).toBe(5);
  });

  it("index helpers are -1 for an unknown datasetId", () => {
    expect(groupStartIndex(groupedTable(2), "nope")).toBe(-1);
    expect(groupEndIndex(groupedTable(2), "nope")).toBe(-1);
  });
});

// --- duplicate-group plan --------------------------------------------------

describe("buildDuplicateGroupPlan", () => {
  it("clones every replicate under a new datasetId, name suffixed copy", () => {
    const plan = buildDuplicateGroupPlan(
      groupedTable(2, 2),
      "g1",
      "gNew",
      (i) => `gNew-r${i + 1}`,
    )!;
    expect(plan.columns).toEqual([
      {
        id: "gNew-r1",
        name: "Group 1 copy",
        role: "y",
        dataType: "number",
        datasetId: "gNew",
        subcolumnKind: "replicate",
      },
      {
        id: "gNew-r2",
        name: "Group 1 copy",
        role: "y",
        dataType: "number",
        datasetId: "gNew",
        subcolumnKind: "replicate",
      },
    ]);
  });

  it("maps each new column to its source column for the value copy", () => {
    const plan = buildDuplicateGroupPlan(
      groupedTable(2, 2),
      "g1",
      "gNew",
      (i) => `gNew-r${i + 1}`,
    )!;
    expect(plan.valueSourceByNewId).toEqual({
      "gNew-r1": "g1-r1",
      "gNew-r2": "g1-r2",
    });
  });

  it("inserts the clone right after the source group", () => {
    // duplicating g1 (ends at index 3) lands the clone at index 3
    const plan = buildDuplicateGroupPlan(
      groupedTable(2, 2),
      "g1",
      "gNew",
      (i) => `gNew-r${i + 1}`,
    )!;
    expect(plan.insertAt).toBe(3);
  });

  it("returns null for an unknown datasetId", () => {
    expect(
      buildDuplicateGroupPlan(groupedTable(2), "nope", "gNew", (i) => `x${i}`),
    ).toBeNull();
  });
});

// --- insert-group columns --------------------------------------------------

describe("buildInsertGroupColumns", () => {
  it("builds a fresh group at the table replicate count, named next", () => {
    const cols = buildInsertGroupColumns(
      groupedTable(2, 3),
      "gNew",
      (i) => `gNew-r${i + 1}`,
    );
    expect(cols).toHaveLength(3);
    for (const col of cols) {
      expect(col).toMatchObject({
        name: "Group 3",
        role: "y",
        dataType: "number",
        datasetId: "gNew",
        subcolumnKind: "replicate",
      });
    }
    expect(cols.map((c) => c.id)).toEqual(["gNew-r1", "gNew-r2", "gNew-r3"]);
  });
});

// --- added replicate -------------------------------------------------------

describe("buildAddedReplicate", () => {
  it("adds one replicate to a group, inserted after its last replicate", () => {
    const added = buildAddedReplicate(groupedTable(2, 2), "g1", "g1-rNew")!;
    expect(added.column).toEqual({
      id: "g1-rNew",
      name: "Group 1",
      role: "y",
      dataType: "number",
      datasetId: "g1",
      subcolumnKind: "replicate",
    });
    expect(added.insertAt).toBe(3);
  });

  it("returns null for an unknown datasetId", () => {
    expect(buildAddedReplicate(groupedTable(2), "nope", "x")).toBeNull();
  });
});

// --- replicate to remove ---------------------------------------------------

describe("replicateToRemove", () => {
  it("removes the last replicate of a multi-replicate group", () => {
    expect(replicateToRemove(groupedTable(2, 3), "g1")).toBe("g1-r3");
  });

  it("returns null when a group is down to its last replicate (guarded)", () => {
    expect(replicateToRemove(groupedTable(2, 1), "g1")).toBeNull();
  });

  it("returns null for an unknown datasetId", () => {
    expect(replicateToRemove(groupedTable(2), "nope")).toBeNull();
  });
});

// --- doc-level integration (the commit-path the page handlers drive) -------

function openSeed(c: DataHubDocContent): LoroDoc {
  const snapshot = seedDataHubDoc(c);
  const doc = new LoroDoc();
  doc.import(snapshot);
  return doc;
}

describe("delete group end to end", () => {
  it("drops every replicate column of the group plus its cells", () => {
    const doc = openSeed(groupedTable(2, 2));
    for (const colId of groupColumnIds(getDataHubContent(doc, "t1"), "g1")) {
      removeColumnWithCells(doc, colId);
    }
    doc.commit();
    const out = getDataHubContent(doc, "t1");
    expect(out.columns.map((c) => c.id)).toEqual(["rowlabel", "g2-r1", "g2-r2"]);
    for (const row of out.rows) {
      expect(Object.prototype.hasOwnProperty.call(row.cells, "g1-r1")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(row.cells, "g1-r2")).toBe(false);
    }
  });
});

describe("duplicate group end to end", () => {
  it("inserts the clone after the source and copies each row's values", () => {
    const doc = openSeed(groupedTable(2, 2));
    const live = getDataHubContent(doc, "t1");
    const plan = buildDuplicateGroupPlan(
      live,
      "g1",
      "gNew",
      (i) => `gNew-r${i + 1}`,
    )!;
    plan.columns.forEach((col, i) => addColumnAt(doc, col, plan.insertAt + i));
    for (const row of live.rows) {
      for (const col of plan.columns) {
        const src = plan.valueSourceByNewId[col.id];
        setCell(doc, row.id, col.id, row.cells[src] ?? null);
      }
    }
    doc.commit();
    const out = getDataHubContent(doc, "t1");
    expect(out.columns.map((c) => c.id)).toEqual([
      "rowlabel",
      "g1-r1",
      "g1-r2",
      "gNew-r1",
      "gNew-r2",
      "g2-r1",
      "g2-r2",
    ]);
    const r1 = out.rows.find((r) => r.id === "r1")!;
    // g1-r1 / g1-r2 seeded 1 / 2, so the clone carries 1 / 2
    expect(r1.cells["gNew-r1"]).toBe(1);
    expect(r1.cells["gNew-r2"]).toBe(2);
  });
});
