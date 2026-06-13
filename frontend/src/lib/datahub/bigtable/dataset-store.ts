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
  type SavedDatasetAnalysis,
} from "./types";
import type { TransformOp } from "@/lib/datahub/transform/pipeline";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Allocate the next id for a dataset from the owner's `_counters.json`, sharing
 * the SAME "datahub" counter the editable lane mints from (api.ts nextDataHubId),
 * so a dataset and an editable table never collide on an id. Mirrored here (not
 * imported) because api.ts keeps nextDataHubId private; this reads / bumps the
 * exact same counter key.
 */
export async function nextDatasetId(owner: string): Promise<string> {
  const path = `users/${owner}/_counters.json`;
  const counters =
    (await fileService.readJson<Record<string, number>>(path)) ?? {};
  const current = (counters.datahub || 0) + 1;
  counters.datahub = current;
  await fileService.writeJson(path, counters);
  return String(current);
}

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
  /** Saved analyses (Phase 3a). Optional and additive; absent stays absent. */
  savedAnalyses?: SavedDatasetAnalysis[];
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
    // Only carry savedAnalyses when present, so a sidecar without any analyses
    // serializes byte-identical to the pre-Phase-3a shape (the field is absent).
    ...(input.savedAnalyses && input.savedAnalyses.length > 0
      ? { savedAnalyses: input.savedAnalyses }
      : {}),
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
    // Additive: keep savedAnalyses only when the parsed object carries a non-empty
    // array, so a sidecar written before Phase 3a reads back with the field absent.
    ...(Array.isArray(o.savedAnalyses) && o.savedAnalyses.length > 0
      ? { savedAnalyses: o.savedAnalyses as SavedDatasetAnalysis[] }
      : {}),
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

/**
 * Persist (add or replace) a saved analysis on a dataset's sidecar, in place. Read
 * the current sidecar, upsert the entry by id, bump updated_at, write it back.
 * Additive: a sidecar with no prior savedAnalyses gains the field; replacing the
 * only entry with nothing is handled by removeSavedAnalysis. Returns the updated
 * sidecar, or null when the dataset is missing.
 */
export async function saveDatasetAnalysis(
  owner: string,
  id: string,
  analysis: SavedDatasetAnalysis,
): Promise<DatasetSidecar | null> {
  const sidecar = await readDatasetSidecar(owner, id);
  if (!sidecar) return null;
  const prior = sidecar.savedAnalyses ?? [];
  const idx = prior.findIndex((a) => a.id === analysis.id);
  const next =
    idx >= 0
      ? prior.map((a) => (a.id === analysis.id ? analysis : a))
      : [...prior, analysis];
  const updated: DatasetSidecar = {
    ...sidecar,
    savedAnalyses: next,
    updated_at: new Date().toISOString(),
  };
  await writeDatasetSidecar(owner, updated);
  return updated;
}

/**
 * Remove a saved analysis by id from a dataset's sidecar. When the last entry is
 * removed the savedAnalyses field is dropped so the sidecar serializes back to the
 * pre-Phase-3a shape. Returns the updated sidecar, or null when the dataset is
 * missing.
 */
export async function removeSavedAnalysis(
  owner: string,
  id: string,
  analysisId: string,
): Promise<DatasetSidecar | null> {
  const sidecar = await readDatasetSidecar(owner, id);
  if (!sidecar) return null;
  const next = (sidecar.savedAnalyses ?? []).filter((a) => a.id !== analysisId);
  const updated: DatasetSidecar = { ...sidecar, updated_at: new Date().toISOString() };
  if (next.length > 0) updated.savedAnalyses = next;
  else delete updated.savedAnalyses;
  await writeDatasetSidecar(owner, updated);
  return updated;
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

/**
 * List every dataset sidecar for one owner. A dataset lives in its own DIRECTORY
 * under the datahub dir (`<id>/`), distinct from the editable lane's top-level
 * `<id>.json` mirror files, so we enumerate sub-directories and open the sidecar
 * inside each. Directories without a readable dataset.json are skipped (a half
 * written or non-dataset dir), so the catalog never lists a broken entry.
 *
 * Increment 2 wiring: the Data Hub rail and the dataset-view opener read this to
 * show datasets alongside editable-lane tables. Owner-scoped, mirroring
 * dataHubApi's per-owner mirror reads.
 */
export async function listDatasets(owner: string): Promise<DatasetSidecar[]> {
  const dirs = await fileService.listDirectories(dataHubDir(owner));
  const out: DatasetSidecar[] = [];
  for (const id of dirs) {
    const sidecar = await readDatasetSidecar(owner, id);
    if (sidecar) out.push(sidecar);
  }
  return out;
}
