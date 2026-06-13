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
// PHASE 2a wiring: the transform builder compiles a TransformOp recipe to a
// single SQL string that becomes the FROM clause here (a derived dataset is a
// stored query, spec section 9), so preview / paging runs the recipe ON DEMAND
// against the registered source Parquet, materializing only the visible window. A
// handle opened with no recipe pages the raw Parquet exactly as before. The full
// transformed result is materialized to a new data.parquet only when the user
// Saves as a new dataset (saveRecipeAsDataset below).
//
// No em-dashes, no emojis, no mid-sentence colons.

import {
  init,
  query,
  registerParquetBuffer,
  dropFileBuffer,
  copyQueryToParquet,
} from "./duckdb-client";
import { recipeToSql } from "@/lib/datahub/transform/sql-codegen";
import type { TransformOp } from "@/lib/datahub/transform/pipeline";
import {
  readDatasetParquet,
  buildSidecar,
  persistDataset,
  readDatasetSidecar,
  writeDatasetSidecar,
} from "./dataset-store";
import type { DatasetColumn, DatasetSidecar } from "./types";

/** A handle to an opened dataset: the virtual file name registered in DuckDB. */
export interface OpenDatasetHandle {
  /** The dataset id this handle reads. */
  id: string;
  /** The registered virtual-file name the engine scans (read_parquet target). */
  fileName: string;
  /** The owner whose disk the parquet was read from. */
  owner: string;
  /** The dataset's column names, threaded so a recipe's derive / drop / rename
   *  compiles correctly (the SQL generator needs the running column list). */
  columnNames: string[];
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

/**
 * A UNIQUE virtual-file name per open call. It must not be merely id-stable: a
 * remount (React strict-mode double-invoke, Fast Refresh, or a fast dataset
 * switch) runs the new mount's openDataset and the old mount's closeDataset
 * against the SAME engine singleton, so an id-stable name lets the stale cleanup
 * drop the buffer the new mount just registered, and every query then fails with
 * "No files found". A per-open suffix keeps each mount's buffer independent.
 */
function fileNameFor(id: string): string {
  return `dataset_${id}_${Date.now()}_${Math.random().toString(36).slice(2)}.parquet`;
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
  return {
    id: sidecar.id,
    fileName,
    owner,
    columnNames: sidecar.schema.map((c) => c.name),
  };
}

/** Free a dataset's registered buffer (best effort), on view close. */
export async function closeDataset(handle: OpenDatasetHandle): Promise<void> {
  await dropFileBuffer(handle.fileName);
}

/**
 * The FROM source for a handle: read_parquet over the registered virtual file,
 * OR the recipe compiled to a sub-query when a recipe is supplied. This is the
 * ONE swap-point for a recipe-compiled sub-query (spec section 9). With no recipe
 * (or an empty one) it is the raw read_parquet, so an un-transformed preview is
 * byte-for-byte the previous behavior. With a recipe it is
 * `(<recipe-sql over read_parquet>)`, so paging wraps it as
 * `SELECT ... FROM (<recipe>) LIMIT n OFFSET m` and the full result is never
 * materialized for the preview.
 */
function fromSource(handle: OpenDatasetHandle, recipe?: TransformOp[]): string {
  const base = `read_parquet('${handle.fileName}')`;
  if (!recipe || recipe.length === 0) return base;
  const sql = recipeToSql(recipe, base, { columnNames: handle.columnNames });
  return `(${sql})`;
}

/**
 * Read a window of rows as plain objects, projected to the chosen columns (or all
 * columns when `columns` is empty), optionally THROUGH a transform recipe. Pages
 * via LIMIT / OFFSET so only the visible window ever crosses into the main thread
 * (spec section 5). With a recipe the recipe runs on demand against the source
 * Parquet and only the window is materialized. Row objects are keyed by COLUMN
 * NAME, matching the result schema the grid renders.
 */
export async function readRowWindow(
  handle: OpenDatasetHandle,
  offset: number,
  limit: number,
  columns: string[] = [],
  recipe?: TransformOp[],
): Promise<Record<string, unknown>[]> {
  const projection =
    columns.length > 0 ? columns.map(quoteIdent).join(", ") : "*";
  const sql = `SELECT ${projection} FROM ${fromSource(handle, recipe)} LIMIT ${Math.max(
    0,
    Math.floor(limit),
  )} OFFSET ${Math.max(0, Math.floor(offset))}`;
  const table = await query(sql);
  // toArray() yields one plain object per row, keyed by column name. We map to a
  // shallow copy so nothing holds a reference into the Arrow batch memory.
  return table.toArray().map((r) => ({ ...(r as Record<string, unknown>) }));
}

/**
 * Count rows live from the engine, optionally through a recipe. The sidecar
 * rowCount is authoritative for an un-transformed dataset; this gives the
 * affected / result row count after a recipe (the count can change under a
 * filter / dedupe / groupby), used for the builder's affected-row estimate.
 */
export async function countRows(
  handle: OpenDatasetHandle,
  recipe?: TransformOp[],
): Promise<number> {
  const table = await query(
    `SELECT COUNT(*) AS n FROM ${fromSource(handle, recipe)}`,
  );
  const row = table.toArray()[0] as { n: unknown } | undefined;
  const n = row ? Number(row.n) : 0;
  return Number.isFinite(n) ? n : 0;
}

/**
 * The column names a recipe's result carries, read live from the engine over a
 * zero-row window. The builder uses this to render the live-preview header (a
 * derive adds a column, a select narrows them) without materializing data.
 */
export async function recipeResultColumns(
  handle: OpenDatasetHandle,
  recipe?: TransformOp[],
): Promise<string[]> {
  const sql = `SELECT * FROM ${fromSource(handle, recipe)} LIMIT 0`;
  const table = await query(sql);
  return table.schema.fields.map((f) => f.name);
}

/**
 * Save the current recipe as a NEW derived dataset (spec section 9). Until this
 * is called the recipe is an ephemeral live query (nothing cached). This
 * materializes the full transformed result to a new data.parquet via
 * copyQueryToParquet (DuckDB streams `COPY (query) TO`), profiles the result
 * schema + row count, and persists a sidecar whose lineage records the source
 * dataset id plus the recipe. The new id is minted by the caller (shares the
 * datahub counter), passed in.
 */
export async function saveRecipeAsDataset(
  handle: OpenDatasetHandle,
  newId: string,
  name: string,
  recipe: TransformOp[],
  options: { project_ids?: string[]; folder_path?: string | null } = {},
): Promise<DatasetSidecar> {
  await init();
  const recipeSql = recipeToSql(recipe, `read_parquet('${handle.fileName}')`, {
    columnNames: handle.columnNames,
  });
  // Materialize the full transformed result to Parquet bytes (streamed by DuckDB,
  // only the COPY transient touches the worker filesystem, never browser cache).
  const parquet = await copyQueryToParquet(recipeSql);

  // Profile the result schema + count by reading metadata off the fresh bytes:
  // register, read a zero-row window for columns, count rows. Then drop the temp.
  const tmpName = `__save_${newId}_${Date.now()}.parquet`;
  await registerParquetBuffer(tmpName, parquet.slice(0));
  let schema: DatasetColumn[] = [];
  let rowCount = 0;
  try {
    const head = await query(`SELECT * FROM read_parquet('${tmpName}') LIMIT 5`);
    const sampleRows = head.toArray().map((r) => ({ ...(r as Record<string, unknown>) }));
    schema = head.schema.fields.map((f) => {
      const samples = sampleRows
        .map((r) => r[f.name])
        .filter((v) => v !== null && v !== undefined)
        .slice(0, 5)
        .map((v) => (typeof v === "number" ? v : String(v)));
      return {
        name: f.name,
        type: arrowTypeToDataHubType(String(f.type)),
        nullCount: 0,
        sample: samples,
      };
    });
    const cnt = await query(`SELECT COUNT(*) AS n FROM read_parquet('${tmpName}')`);
    const cr = cnt.toArray()[0] as { n: unknown } | undefined;
    rowCount = cr ? Number(cr.n) : 0;
  } finally {
    await dropFileBuffer(tmpName);
  }

  const sidecar = buildSidecar({
    id: newId,
    name,
    schema,
    rowCount: Number.isFinite(rowCount) ? rowCount : 0,
    source: { kind: "derived", sourceDatasetIds: [handle.id] },
    recipe,
    project_ids: options.project_ids,
    folder_path: options.folder_path,
  });
  await persistDataset(handle.owner, sidecar, parquet);
  return sidecar;
}

/**
 * Persist a recipe ONTO the open dataset's own sidecar (in-place rule pipeline),
 * without materializing a copy. Used when the user wants the dataset to keep
 * applying the rules on every open rather than spinning off a new dataset. The
 * recipe runs on demand against the same data.parquet (spec section 9).
 */
export async function saveRecipeInPlace(
  owner: string,
  id: string,
  recipe: TransformOp[],
): Promise<void> {
  const sidecar = await readDatasetSidecar(owner, id);
  if (!sidecar) return;
  await writeDatasetSidecar(owner, { ...sidecar, recipe, updated_at: new Date().toISOString() });
}

/** Map a DuckDB / Arrow type string to the Data Hub data type for the sidecar
 *  schema. Numbers (int / float / decimal) -> number, everything else -> text,
 *  matching the editable lane's coarse two-type model. */
function arrowTypeToDataHubType(arrowType: string): DatasetColumn["type"] {
  const t = arrowType.toLowerCase();
  if (
    t.includes("int") ||
    t.includes("float") ||
    t.includes("double") ||
    t.includes("decimal")
  ) {
    return "number";
  }
  return "text";
}
