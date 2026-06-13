import { describe, expect, it } from "vitest";

import {
  buildEmptyNestedTable,
  nestedGroupColumns,
  nestedGroupNames,
  nestedGroups,
  hasNestedData,
  isNestedTable,
  DEFAULT_NESTED_GROUPS,
  DEFAULT_NESTED_SUBGROUPS,
  DEFAULT_NESTED_REPLICATES,
} from "./nested-table";
import type { DataHubDocContent } from "./model/types";

/** Wrap seeded columns + rows into a minimal Nested DataHubDocContent. */
function content(
  columns: DataHubDocContent["columns"],
  rows: DataHubDocContent["rows"],
  excludedCells?: string[],
): DataHubDocContent {
  return {
    meta: {
      id: "t1",
      name: "Nested test",
      project_ids: [],
      folder_path: null,
      table_type: "nested",
      excludedCells,
      created_at: "2026-06-12T00:00:00Z",
    },
    columns,
    rows,
    analyses: [],
    plots: [],
  };
}

describe("nested-table view model", () => {
  it("seeds a balanced empty table with group + subgroup structure", () => {
    const { columns, rows } = buildEmptyNestedTable();
    // groups x subgroups subgroup columns, all role "y" with a datasetId + groupName.
    expect(columns.length).toBe(
      DEFAULT_NESTED_GROUPS * DEFAULT_NESTED_SUBGROUPS,
    );
    expect(rows.length).toBe(DEFAULT_NESTED_REPLICATES);
    for (const c of columns) {
      expect(c.role).toBe("y");
      expect(c.dataType).toBe("number");
      expect(c.subcolumnKind).toBe("replicate");
      expect(typeof c.datasetId).toBe("string");
      expect(typeof c.groupName).toBe("string");
    }
    // Two distinct group families.
    const families = new Set(columns.map((c) => c.datasetId));
    expect(families.size).toBe(DEFAULT_NESTED_GROUPS);
  });

  it("groups subgroup columns by datasetId and reads the group name off groupName", () => {
    const { columns, rows } = buildEmptyNestedTable(2, 2, 1);
    const doc = content(columns, rows);
    const groups = nestedGroupColumns(doc);
    expect(groups.length).toBe(2);
    expect(groups[0].name).toBe("Group 1");
    expect(groups[1].name).toBe("Group 2");
    expect(groups[0].subgroupColumnIds.length).toBe(2);
    expect(nestedGroupNames(doc)).toEqual(["Group 1", "Group 2"]);
  });

  it("resolves the grid into the nested hierarchy the engine consumes", () => {
    // 2 groups x 2 subgroups x 2 replicates. Fill the cells with known values.
    const { columns } = buildEmptyNestedTable(2, 2, 2);
    const ids = columns.map((c) => c.id); // [g1s1, g1s2, g2s1, g2s2]
    const rows = [
      {
        id: "row-1",
        cells: { [ids[0]]: 1, [ids[1]]: 3, [ids[2]]: 10, [ids[3]]: 30 },
      },
      {
        id: "row-2",
        cells: { [ids[0]]: 2, [ids[1]]: 4, [ids[2]]: 20, [ids[3]]: 40 },
      },
    ];
    const doc = content(columns, rows);
    const groups = nestedGroups(doc);
    expect(groups.length).toBe(2);
    expect(groups[0].subgroups.length).toBe(2);
    // First group, first subgroup reads down its column.
    expect(groups[0].subgroups[0].values).toEqual([1, 2]);
    expect(groups[0].subgroups[1].values).toEqual([3, 4]);
    expect(groups[1].subgroups[0].values).toEqual([10, 20]);
    expect(groups[1].subgroups[1].values).toEqual([30, 40]);
  });

  it("drops an excluded cell from the resolved replicates", () => {
    const { columns } = buildEmptyNestedTable(1, 1, 2);
    const colId = columns[0].id;
    const rows = [
      { id: "row-1", cells: { [colId]: 5 } },
      { id: "row-2", cells: { [colId]: 7 } },
    ];
    const doc = content(columns, rows, [`row-2:${colId}`]);
    const groups = nestedGroups(doc);
    expect(groups[0].subgroups[0].values).toEqual([5]);
  });

  it("reads a blank or non-numeric cell as absent, not zero", () => {
    const { columns } = buildEmptyNestedTable(1, 1, 3);
    const colId = columns[0].id;
    const rows = [
      { id: "row-1", cells: { [colId]: 5 } },
      { id: "row-2", cells: { [colId]: null } },
      { id: "row-3", cells: { [colId]: "x" } },
    ];
    const doc = content(columns, rows);
    expect(nestedGroups(doc)[0].subgroups[0].values).toEqual([5]);
  });

  it("hasNestedData reflects whether any finite replicate is present", () => {
    const { columns, rows } = buildEmptyNestedTable(2, 2, 2);
    expect(hasNestedData(content(columns, rows))).toBe(false);
    const filled = content(columns, [
      { ...rows[0], cells: { ...rows[0].cells, [columns[0].id]: 1 } },
      rows[1],
    ]);
    expect(hasNestedData(filled)).toBe(true);
  });

  it("isNestedTable keys off the table type", () => {
    const { columns, rows } = buildEmptyNestedTable(1, 1, 1);
    expect(isNestedTable(content(columns, rows))).toBe(true);
  });
});
