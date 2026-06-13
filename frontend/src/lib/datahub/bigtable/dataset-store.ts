// datahub/bigtable/dataset-store.ts
//
// Disk read / write for the Data Hub large-dataset lane (DataHub-largetables
// lane, Increment 1). A dataset lives in its OWN directory at
// users/<owner>/datahub/<id>/ holding the optional untouched original import,
// the data.parquet working copy, and the dataset.json sidecar (see ./types).
//
// All disk I/O goes through the existing fileService atomic primitives
// (writeJson / writeFileFromBlob / readJson / readFileAsBlob), so the dataset
// lane gets the same atomic-write + cache behavior as the rest of the app.
//
// THIS IS A NEW, ADDITIVE, NAMESPACED ON-DISK SHAPE. It lives alongside the
// editable lane's `<id>.loro` / `<id>.json` mirror and never alters it. The
// existing list API only reads top-level `*.json` files under the datahub dir,
// so a dataset DIRECTORY (`<id>/`) does not collide with it.
//
// PURE vs I/O. The sidecar (de)serialization is split into pure functions
// (buildSidecar / sidecarFromJson) so the round-trip is unit-testable against an
// in-memory file service without DuckDB (the worker cannot run under vitest).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";
import { dataHubDir } from "@/lib/loro/datahub-sidecar-store";
import {
  DATASET_SCHEMA_VERSION,
  DATA_PARQUET_FILENAME,
  DATASET_SIDECAR_FILENAME,
  type DatasetColumn,
  type DatasetSidecar,
  type DatasetSource,
} from "./types";
import type { TransformOp } from "@/lib/datahub/transform/pipeline";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** The per-dataset directory: users/<owner>/datahub/<id>/. */
export function datasetDir(owner: string, id: string): string {
  return `${dataHubDir(owner)}/${id}`;
}
/** The data.parquet working-copy path inside a dataset dir. */
export function datasetParquetPath(owner: string, id: string): string {
  return `${datasetDir(owner, id)}/${DATA_PARQUET_FILENAME}`;
}
/** The dataset.json sidecar path inside a dataset dir. */
export function datasetSidecarPath(owner: string, id: string): string {
  return `${datasetDir(owner, id)}/${DATASET_SIDECAR_FILENAME}`;
}
/** The untouched original-import path inside a dataset dir. */
export function datasetOriginalPath(
  owner: string,
  id: string,
  filename: string,
): string {
  return `${datasetDir(owner, id)}/${filename}`;
}

// ---------------------------------------------------------------------------
// Pure sidecar build / parse (unit-testable, no I/O)
// ---------------------------------------------------------------------------

/** Inputs for assembling a sidecar. Pure, so no fileService dependency. */
export interface BuildSidecarInput {
  id: string;
  name: string;
  schema: DatasetColumn[];
  rowCount: number;
  source: DatasetSource;
  recipe?: TransformOp[];
  project_ids?: string[];
  folder_path?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Assemble a DatasetSidecar from its parts. Pure: derives colCount from the
 * schema, stamps the schema version, defaults the recipe to an empty pipeline
 * (the Increment 2 seam), and fills timestamps. No disk access.
 */
export function buildSidecar(input: BuildSidecarInput): DatasetSidecar {
  const now = new Date().toISOString();
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    id: input.id,
    name: input.name,
    schema: input.schema,
    rowCount: input.rowCount,
    colCount: input.schema.length,
    source: input.source,
    recipe: input.recipe ?? [],
    project_ids: input.project_ids ?? [],
    folder_path: input.folder_path ?? null,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
  };
}

/**
 * Normalize a parsed-from-disk JSON object into a DatasetSidecar, tolerating an
 * older / partial shape additively (missing recipe reads as an empty pipeline,
 * missing colCount derives from the schema). Returns null when the object is not
 * a recognizable sidecar.
 */
export function sidecarFromJson(raw: unknown): DatasetSidecar | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<DatasetSidecar>;
  if (typeof o.id !== "string" || !Array.isArray(o.schema)) return null;
  const schema = o.schema as DatasetColumn[];
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    id: o.id,
    name: typeof o.name === "string" ? o.name : "",
    schema,
    rowCount: typeof o.rowCount === "number" ? o.rowCount : 0,
    colCount: typeof o.colCount === "number" ? o.colCount : schema.length,
    source: (o.source as DatasetSource) ?? { kind: "paste" },
    recipe: Array.isArray(o.recipe) ? (o.recipe as TransformOp[]) : [],
    project_ids: Array.isArray(o.project_ids) ? o.project_ids : [],
    folder_path: typeof o.folder_path === "string" ? o.folder_path : null,
    created_at: typeof o.created_at === "string" ? o.created_at : "",
    updated_at: typeof o.updated_at === "string" ? o.updated_at : "",
  };
}

// ---------------------------------------------------------------------------
// Disk I/O (through fileService atomic primitives)
// ---------------------------------------------------------------------------

/** Write (or overwrite) the dataset.json sidecar. */
export async function writeDatasetSidecar(
  owner: string,
  sidecar: DatasetSidecar,
): Promise<void> {
  await fileService.writeJson(datasetSidecarPath(owner, sidecar.id), sidecar);
}

/** Read the dataset.json sidecar, or null when absent / unrecognizable. */
export async function readDatasetSidecar(
  owner: string,
  id: string,
): Promise<DatasetSidecar | null> {
  const raw = await fileService.readJson<unknown>(datasetSidecarPath(owner, id));
  return sidecarFromJson(raw);
}

/** Write (or overwrite) the data.parquet working copy from a byte buffer. */
export async function writeDatasetParquet(
  owner: string,
  id: string,
  parquet: ArrayBuffer | Blob,
): Promise<void> {
  const blob = parquet instanceof Blob ? parquet : new Blob([parquet]);
  await fileService.writeFileFromBlob(datasetParquetPath(owner, id), blob);
}

/** Read the data.parquet working copy as a Blob, or null when absent. */
export async function readDatasetParquet(
  owner: string,
  id: string,
): Promise<Blob | null> {
  return fileService.readFileAsBlob(datasetParquetPath(owner, id));
}

/** Write the untouched original import file beside data.parquet. */
export async function writeDatasetOriginal(
  owner: string,
  id: string,
  filename: string,
  bytes: ArrayBuffer | Blob,
): Promise<void> {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes]);
  await fileService.writeFileFromBlob(
    datasetOriginalPath(owner, id, filename),
    blob,
  );
}

/**
 * Persist a full dataset to disk: the sidecar plus the data.parquet plus the
 * optional untouched original. The Parquet itself is built by the DuckDB client
 * upstream (see ./ingest); this function only writes the bytes it is handed, so
 * it stays DuckDB-free and unit-testable.
 */
export async function persistDataset(
  owner: string,
  sidecar: DatasetSidecar,
  parquet: ArrayBuffer | Blob,
  original?: { filename: string; bytes: ArrayBuffer | Blob },
): Promise<void> {
  await writeDatasetParquet(owner, sidecar.id, parquet);
  if (original) {
    await writeDatasetOriginal(owner, sidecar.id, original.filename, original.bytes);
  }
  // Sidecar last, so a half-written dataset never lists as complete.
  await writeDatasetSidecar(owner, sidecar);
}

/** Remove a dataset's entire directory (sidecar + parquet + original). */
export async function deleteDataset(owner: string, id: string): Promise<boolean> {
  return fileService.deleteDirectory(datasetDir(owner, id));
}
