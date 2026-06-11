// Survival-table view model for the Data Hub grid (more-table-types slice).
//
// A Survival table records time-to-event data. Each ROW is one subject with a
// time, an event indicator (1 = the event happened at that time, 0 = the subject
// was right censored, still event-free when last seen), and an optional group
// label so two or more arms can be compared. The engine turns these rows into
// Kaplan-Meier curves and, when there are two or more groups, a log-rank test.
//
// The model reuses the existing column shape: a role-"x" numeric Time column, a
// role-"y" numeric Event column (0 / 1), and a role-"group" text Group column.
// This module seeds a fresh table, finds those three columns, and groups the
// rows into the (time, event) observations the engine consumes.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type {
  CellValue,
  ColumnDef,
  DataHubDocContent,
  RowRecord,
} from "@/lib/datahub/model/types";
import type { SurvivalObservation } from "@/lib/datahub/engine";

export const TIME_COLUMN_ID = "time";
export const EVENT_COLUMN_ID = "event";
export const GROUP_COLUMN_ID = "group";

/** A resolved survival group: its label and its (time, event) observations. */
export interface SurvivalGroup {
  name: string;
  observations: SurvivalObservation[];
}

export const DEFAULT_SURVIVAL_ROWS = 8;

function seedRowId(i: number): string {
  return `row-${i + 1}`;
}

/**
 * Build the columns + rows for a fresh, empty Survival table: a Time column, an
 * Event column (1 = event, 0 = censored), and a Group column for comparing arms.
 * Every cell starts null.
 */
export function buildEmptySurvivalTable(
  rows = DEFAULT_SURVIVAL_ROWS,
): { columns: ColumnDef[]; rows: RowRecord[] } {
  const columns: ColumnDef[] = [
    { id: TIME_COLUMN_ID, name: "Time", role: "x", dataType: "number" },
    { id: EVENT_COLUMN_ID, name: "Event", role: "y", dataType: "number" },
    { id: GROUP_COLUMN_ID, name: "Group", role: "group", dataType: "text" },
  ];
  const rowRecords: RowRecord[] = [];
  for (let i = 0; i < rows; i++) {
    const cells: Record<string, CellValue> = {};
    for (const col of columns) cells[col.id] = null;
    rowRecords.push({ id: seedRowId(i), cells });
  }
  return { columns, rows: rowRecords };
}

export function timeColumn(content: DataHubDocContent): ColumnDef | null {
  return (
    content.columns.find((c) => c.id === TIME_COLUMN_ID) ??
    content.columns.find((c) => c.role === "x") ??
    null
  );
}

export function eventColumn(content: DataHubDocContent): ColumnDef | null {
  return (
    content.columns.find((c) => c.id === EVENT_COLUMN_ID) ??
    content.columns.find((c) => c.role === "y") ??
    null
  );
}

export function groupColumn(content: DataHubDocContent): ColumnDef | null {
  return (
    content.columns.find((c) => c.id === GROUP_COLUMN_ID) ??
    content.columns.find((c) => c.role === "group") ??
    null
  );
}

function asNumber(v: CellValue | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asLabel(v: CellValue | undefined): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/**
 * Group the rows into survival arms. A row contributes when its Time is finite
 * and its Event is 0 or 1. Rows are split by the Group column label; when the
 * group column is empty (or every label is blank), all rows fall into a single
 * unnamed arm, which yields one Kaplan-Meier curve and no log-rank test.
 */
export function survivalGroups(content: DataHubDocContent): SurvivalGroup[] {
  const timeCol = timeColumn(content);
  const eventCol = eventColumn(content);
  if (!timeCol || !eventCol) return [];
  const grpCol = groupColumn(content);

  const order: string[] = [];
  const byName = new Map<string, SurvivalObservation[]>();
  for (const row of content.rows) {
    const time = asNumber(row.cells[timeCol.id]);
    const ev = asNumber(row.cells[eventCol.id]);
    if (time === null || (ev !== 0 && ev !== 1)) continue;
    const label = grpCol ? asLabel(row.cells[grpCol.id]) : "";
    const key = label === "" ? "All subjects" : label;
    let arr = byName.get(key);
    if (!arr) {
      arr = [];
      byName.set(key, arr);
      order.push(key);
    }
    arr.push({ time, event: ev });
  }
  return order.map((name) => ({ name, observations: byName.get(name)! }));
}

/** True when the table has enough data for a Kaplan-Meier estimate (one arm
 *  with at least one observation). */
export function hasSurvivalData(content: DataHubDocContent): boolean {
  const groups = survivalGroups(content);
  return groups.some((g) => g.observations.length > 0);
}

/** True when the content describes a Survival table. */
export function isSurvivalTable(content: DataHubDocContent): boolean {
  return content.meta.table_type === "survival";
}
