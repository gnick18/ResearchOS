import { describe, it, expect } from "vitest";

import type {
  DataHubDocContent,
  DataHubDocument,
  RowRecord,
} from "@/lib/datahub/model/types";
import {
  buildEmptySurvivalTable,
  timeColumn,
  eventColumn,
  groupColumn,
  survivalGroups,
  hasSurvivalData,
} from "@/lib/datahub/survival-table";

const META: DataHubDocument = {
  id: "1",
  name: "Time to event",
  project_ids: [],
  folder_path: null,
  table_type: "survival",
  created_at: "2026-06-10T00:00:00.000Z",
};

function content(rows: RowRecord[]): DataHubDocContent {
  const { columns } = buildEmptySurvivalTable(0);
  return { meta: META, columns, rows, analyses: [], plots: [] };
}

describe("survival-table: empty seed", () => {
  it("seeds Time (x), Event (y), and Group (group) columns", () => {
    const { columns } = buildEmptySurvivalTable();
    expect(columns.map((c) => c.role)).toEqual(["x", "y", "group"]);
    expect(columns.map((c) => c.name)).toEqual(["Time", "Event", "Group"]);
  });

  it("finds each special column", () => {
    const c = content([]);
    expect(timeColumn(c)?.id).toBe("time");
    expect(eventColumn(c)?.id).toBe("event");
    expect(groupColumn(c)?.id).toBe("group");
  });
});

describe("survival-table: grouping rows into arms", () => {
  it("splits rows by the group label and keeps (time, event) pairs", () => {
    const c = content([
      { id: "r1", cells: { time: 5, event: 1, group: "A" } },
      { id: "r2", cells: { time: 8, event: 0, group: "A" } },
      { id: "r3", cells: { time: 6, event: 1, group: "B" } },
    ]);
    const groups = survivalGroups(c);
    expect(groups.map((g) => g.name)).toEqual(["A", "B"]);
    const a = groups.find((g) => g.name === "A")!;
    expect(a.observations).toEqual([
      { time: 5, event: 1 },
      { time: 8, event: 0 },
    ]);
  });

  it("falls back to one unnamed arm when no group is given", () => {
    const c = content([
      { id: "r1", cells: { time: 5, event: 1, group: null } },
      { id: "r2", cells: { time: 8, event: 0, group: null } },
    ]);
    const groups = survivalGroups(c);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("All subjects");
    expect(groups[0].observations).toHaveLength(2);
  });

  it("drops rows with a missing time or a non-0/1 event", () => {
    const c = content([
      { id: "r1", cells: { time: 5, event: 1, group: "A" } },
      { id: "r2", cells: { time: null, event: 1, group: "A" } },
      { id: "r3", cells: { time: 9, event: 2, group: "A" } },
    ]);
    expect(survivalGroups(c)[0].observations).toHaveLength(1);
    expect(hasSurvivalData(c)).toBe(true);
    expect(hasSurvivalData(content([]))).toBe(false);
  });
});
