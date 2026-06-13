"use client";

// datahub/bigtable/ingest.ts
//
// The ingest path for the Data Hub large-dataset lane (DataHub-largetables lane,
// Increment 1). Takes parsed table data (the detectTable output shape from
// import-table.ts / import-xlsx.ts: columns + rows) and, for a large table,
// writes it to the dataset lane (build data.parquet via DuckDB, write
// dataset.json, keep the untouched original) INSTEAD of the cell-level Loro
// store. This is the routing seam the import boundary calls.
//
// The actual import dialog wiring (the explainer card, the status chip, the
// manual switch) is Increment 2 UI. This module exposes the programmatic path
// so a large import can be routed today, gated behind isBigTableEnabled().
//
// Client-only: it loads the DuckDB worker, so it must never run on the server.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { isBigTableEnabled } from "@/lib/datahub/config";
import type { ColumnDataType } from "@/lib/datahub/model/types";
import { isLargeTable } from "./detection";
import { buildParquetFromRows } from "./duckdb-client";
import { buildSidecar, persistDataset } from "./dataset-store";
import type { DatasetColumn, DatasetSidecar, IngestInput } from "./types";

/** Map a few sample values for a column, skipping nulls, capped small. */
function sampleColumn(
  rows: IngestInput["rows"],
  columnId: string,
  cap = 5,
): (string | number | null)[] {
  const out: (string | number | null)[] = [];
  for (const r of rows) {
    const v = r.cells[columnId];
    if (v === null || v === undefined || v === "") continue;
    out.push(v as string | number);
    if (out.length >= cap) break;
  }
  return out;
}

/** Count null / empty cells in a column. */
function nullCount(rows: IngestInput["rows"], columnId: string): number {
  let n = 0;
  for (const r of rows) {
    const v = r.cells[columnId];
    if (v === null || v === undefined || v === "") n++;
  }
  return n;
}

/**
 * Profile the parsed columns into the sidecar schema (name / type / nullCount /
 * sample). Pure over the input, so it is exercised by the dataset-store tests
 * without DuckDB.
 */
export function profileSchema(input: IngestInput): DatasetColumn[] {
  return input.columns.map((c) => ({
    name: c.name,
    type: c.dataType as ColumnDataType,
    nullCount: nullCount(input.rows, c.id),
    sample: sampleColumn(input.rows, c.id),
  }));
}

/**
 * Turn the row records (cell map keyed by columnId) into plain objects keyed by
 * COLUMN NAME, the shape arrow's tableFromJSON expects, so the Parquet columns
 * carry the human-readable names. Pure.
 */
export function rowsForParquet(
  input: IngestInput,
): Record<string, string | number | null>[] {
  return input.rows.map((r) => {
    const obj: Record<string, string | number | null> = {};
    for (const c of input.columns) {
      const v = r.cells[c.id];
      obj[c.name] = v === undefined || v === "" ? null : v;
    }
    return obj;
  });
}

/**
 * Should this parsed table route to the dataset lane? True only when the lane is
 * enabled AND the table crosses the size threshold. The import boundary calls
 * this to decide between the editable Loro lane and the dataset lane.
 */
export function shouldRouteToDatasetLane(input: IngestInput): boolean {
  if (!isBigTableEnabled()) return false;
  return isLargeTable(input.rows.length, input.columns.length);
}

/**
 * Ingest a parsed table into the dataset lane: profile the schema, build the
 * data.parquet via DuckDB, persist the parquet + sidecar (+ the untouched
 * original when present), and return the written sidecar. The id is minted by
 * the caller (so it shares the editable lane's per-user counter allocator, see
 * api.ts nextDataHubId) and passed in.
 *
 * TODO(Increment 2): the manual "Switch to large-dataset mode" conversion path
 * (re-materialize a Loro table into a dataset) and the reverse re-hydration call
 * into this same persist surface.
 */
export async function ingestToDatasetLane(
  owner: string,
  id: string,
  input: IngestInput,
): Promise<DatasetSidecar> {
  const schema = profileSchema(input);
  const parquet = await buildParquetFromRows(rowsForParquet(input));

  const sidecar = buildSidecar({
    id,
    name: input.name,
    schema,
    rowCount: input.rows.length,
    source: input.source,
    project_ids: input.project_ids,
    folder_path: input.folder_path,
  });

  await persistDataset(
    owner,
    sidecar,
    parquet,
    input.originalFile
      ? { filename: input.originalFile.filename, bytes: input.originalFile.bytes }
      : undefined,
  );

  return sidecar;
}
