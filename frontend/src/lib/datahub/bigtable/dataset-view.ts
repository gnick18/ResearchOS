"use client";

// datahub/bigtable/dataset-view.ts
//
// The read surface for the Data Hub large-dataset lane (DataHub-largetables lane,
// Increment 2). It opens a persisted dataset into the lazy DuckDB engine and
// exposes the small set of READ-ONLY moves the preview grid needs: a paged window
// of rows (LIMIT / OFFSET), a single-row lookup for jump-to-row, and a column
// subset projection for the wide-column tiers. It is the one place that turns a
// dataset id into registered Parquet bytes, so the components never touch DuckDB
// or the file service directly.
//
// SCOPE (validation gate, spec section 4). Every query here only MOVES data
// (slice, page, project columns). No statistic is computed for the user; that
// stays on the validated JS engine. This is the data mover for the preview.
//
// Client-only: it loads the DuckDB worker, so it must never run on the server.
//
// TODO(Increment 2 / Phase 2): the transform builder compiles a TransformOp
// recipe to a single SQL string that becomes the FROM clause here (a derived
// dataset is a stored query, spec section 9), so paging runs the recipe on demand
// against the source Parquet. Today we page the raw registered Parquet.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { init, query, registerParquetBuffer, dropFileBuffer } from "./duckdb-client";
import { readDatasetParquet } from "./dataset-store";
import type { DatasetSidecar } from "./types";

/** A handle to an opened dataset: the virtual file name registered in DuckDB. */
export interface OpenDatasetHandle {
  /** The dataset id this handle reads. */
  id: string;
  /** The registered virtual-file name the engine scans (read_parquet target). */
  fileName: string;
  /** The owner whose disk the parquet was read from. */
  owner: string;
}

/**
 * Quote a SQL identifier (column or virtual-file name) by doubling embedded
 * double quotes, the standard SQL escape. Column names come from a user's
 * imported header, so they can contain spaces or punctuation and MUST be quoted.
 * This is identifier quoting only; values never flow through here (the preview
 * is read-only, no value interpolation).
 */
export function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** A single virtual-file name per dataset id, stable so re-opens reuse it. */
function fileNameFor(id: string): string {
  return `dataset_${id}.parquet`;
}

/**
 * Open a dataset for reading: ensure the engine is up, read the data.parquet
 * bytes from the owner's disk, and register them as a virtual file the engine can
 * scan. Idempotent at the DuckDB layer (re-registering the same name overwrites).
 * Throws when the parquet is missing, so the caller can render an honest error
 * rather than a blank grid.
 */
export async function openDataset(
  owner: string,
  sidecar: DatasetSidecar,
): Promise<OpenDatasetHandle> {
  await init();
  const blob = await readDatasetParquet(owner, sidecar.id);
  if (!blob) {
    throw new Error(
      `[bigtable/dataset-view] data.parquet missing for dataset ${sidecar.id}`,
    );
  }
  const buffer = await blob.arrayBuffer();
  const fileName = fileNameFor(sidecar.id);
  await registerParquetBuffer(fileName, buffer);
  return { id: sidecar.id, fileName, owner };
}

/** Free a dataset's registered buffer (best effort), on view close. */
export async function closeDataset(handle: OpenDatasetHandle): Promise<void> {
  await dropFileBuffer(handle.fileName);
}

/**
 * The FROM source for a handle: read_parquet over the registered virtual file.
 * Centralized so the transform-builder seam (Phase 2) can swap this for a
 * recipe-compiled sub-query without touching every call site.
 */
function fromSource(handle: OpenDatasetHandle): string {
  return `read_parquet('${handle.fileName}')`;
}

/**
 * Read a window of rows as plain objects, projected to the chosen columns (or all
 * columns when `columns` is empty). Pages via LIMIT / OFFSET so only the visible
 * window ever crosses into the main thread (spec section 5). Row objects are
 * keyed by COLUMN NAME, matching the Parquet schema the grid renders.
 */
export async function readRowWindow(
  handle: OpenDatasetHandle,
  offset: number,
  limit: number,
  columns: string[] = [],
): Promise<Record<string, unknown>[]> {
  const projection =
    columns.length > 0 ? columns.map(quoteIdent).join(", ") : "*";
  const sql = `SELECT ${projection} FROM ${fromSource(handle)} LIMIT ${Math.max(
    0,
    Math.floor(limit),
  )} OFFSET ${Math.max(0, Math.floor(offset))}`;
  const table = await query(sql);
  // toArray() yields one plain object per row, keyed by column name. We map to a
  // shallow copy so nothing holds a reference into the Arrow batch memory.
  return table.toArray().map((r) => ({ ...(r as Record<string, unknown>) }));
}

/**
 * Count rows live from the engine. Used as a cross-check against the sidecar
 * rowCount; the sidecar value is authoritative for the chip ("N of TOTAL"), this
 * is here for the rare derived-source case where the recipe changes the count.
 */
export async function countRows(handle: OpenDatasetHandle): Promise<number> {
  const table = await query(`SELECT COUNT(*) AS n FROM ${fromSource(handle)}`);
  const row = table.toArray()[0] as { n: unknown } | undefined;
  const n = row ? Number(row.n) : 0;
  return Number.isFinite(n) ? n : 0;
}
