// datahub/bigtable/types.ts
//
// The on-disk shape for the Data Hub LARGE-DATASET lane (DataHub-largetables
// lane, Increment 1). This is a NEW, additive, namespaced on-disk shape that
// lives ALONGSIDE the existing editable-lane `<id>.loro` / `<id>.json` mirror,
// never replacing it. A small table stays in the cell-level Loro lane; a large
// table is stored columnar (Parquet) and queried by DuckDB-WASM off the main
// thread. See docs/proposals/2026-06-13-datahub-large-tables.md sections 2-4, 9.
//
// A dataset lives in its OWN directory at users/<owner>/datahub/<id>/ holding:
//   - <original-filename>            the user's untouched import (optional)
//   - data.parquet                   the compact columnar working copy
//   - dataset.json                   the small sidecar (this DatasetSidecar)
//
// The sidecar is the only file the list API opens, mirroring how the editable
// lane keeps a readable `.json` beside the `.loro`.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type { ColumnDataType } from "@/lib/datahub/model/types";
// Type-only, erased at compile time. A stored transform recipe is the same
// pipeline TransformOp list the editable lane uses (decision in spec section 6),
// so derived datasets stay one shared recipe shape. Increment 1 only stores it
// as a placeholder seam; Increment 2 wires the builder + DuckDB execution path.
import type { TransformOp } from "@/lib/datahub/transform/pipeline";

/** The current on-disk schema version for a dataset sidecar. */
export const DATASET_SCHEMA_VERSION = 1 as const;

/** The fixed filenames inside a dataset directory. */
export const DATA_PARQUET_FILENAME = "data.parquet";
export const DATASET_SIDECAR_FILENAME = "dataset.json";

/**
 * One column's schema entry as profiled at ingest. `type` is the Data Hub data
 * type (mapped from the DuckDB / Arrow type), `nullCount` is how many rows are
 * null in this column, and `sample` is a tiny set of example values for the
 * schema browser (Tier C, spec section 5). Kept deliberately small so the
 * sidecar stays cheap to open for the list API.
 */
export interface DatasetColumn {
  /** Column name as it appears in the Parquet schema. */
  name: string;
  /** Data Hub data type, mapped from the columnar source type. */
  type: ColumnDataType;
  /** How many rows are null in this column (profiled at ingest). */
  nullCount: number;
  /** A few example values for the schema browser preview. */
  sample: (string | number | null)[];
}

/**
 * Where a dataset came from. A dataset is either imported from a file (CSV /
 * XLSX, original kept untouched), pasted (text kept, no original file), or
 * derived from another dataset by a transform recipe (stored query, not a copy,
 * the key decision in spec section 9).
 */
export type DatasetSourceKind = "import-file" | "paste" | "derived";

/**
 * Lineage for the dataset. `kind` discriminates the source. For an imported
 * file the `originalFilename` is the untouched copy kept beside data.parquet;
 * for a derived dataset, `sourceDatasetIds` plus the `recipe` ARE the dataset
 * (it is materialized to data.parquet only when the user saves, otherwise the
 * recipe runs on demand against the source, spec section 9).
 */
export interface DatasetSource {
  kind: DatasetSourceKind;
  /**
   * The untouched original import filename (relative to the dataset dir), kept
   * as a research record. Present only for kind "import-file".
   */
  originalFilename?: string;
  /**
   * Source dataset ids a derived dataset was built from. sourceIds[0] is the
   * primary the recipe runs over. Present only for kind "derived".
   */
  sourceDatasetIds?: string[];
}

/**
 * The dataset sidecar (dataset.json). Small, list-API-friendly, holds the
 * schema + counts + lineage + the stored transform recipe. The Parquet file is
 * the data; this is everything ELSE the app needs to know about the dataset
 * without opening DuckDB.
 */
export interface DatasetSidecar {
  /** On-disk schema version, for future additive migrations. */
  schemaVersion: typeof DATASET_SCHEMA_VERSION;
  /** Stable dataset id (shares the id space with the editable-lane `<id>`). */
  id: string;
  /** Human-readable dataset name. */
  name: string;
  /** Per-column schema (name / type / nullCount / sample). */
  schema: DatasetColumn[];
  /** Total row count of the materialized data.parquet. */
  rowCount: number;
  /** Total column count (== schema.length, denormalized for the list view). */
  colCount: number;
  /** Source lineage (import file / paste / derived). */
  source: DatasetSource;
  /**
   * The stored transform recipe (a pipeline of ops). This is the lineage for a
   * derived dataset and, in Increment 2, the rule pipeline applied on the fly.
   * Increment 1 stores it as an additive PLACEHOLDER seam (empty by default);
   * the builder UI + the DuckDB SQL execution path are Increment 2.
   *
   * TODO(Increment 2): wire the operation builder (spec section 6) to populate
   * this, compile it to a DuckDB query, and offer pandas + SQL show-the-code.
   */
  recipe: TransformOp[];
  /** Collection membership, mirroring the editable-lane document. */
  project_ids: string[];
  /** Subfolder organization within a project, or null for the project root. */
  folder_path: string | null;
  /** ISO timestamps. */
  created_at: string;
  updated_at: string;
}

/**
 * A parsed table ready to ingest into the dataset lane: the column definitions
 * and the row records, exactly the output shape of import-table.ts detectTable
 * (columns + rows). Reused so the ingest path shares header / type detection
 * with the editable lane (spec phasing, Phase 0 ingest seam).
 */
export interface IngestInput {
  /** Dataset name (defaults from the import filename upstream). */
  name: string;
  /** Column definitions, from detectTable. */
  columns: { id: string; name: string; dataType: ColumnDataType }[];
  /** Row records, from detectTable: each a cell map keyed by columnId. */
  rows: { id: string; cells: Record<string, string | number | null> }[];
  /** Source lineage for the dataset. */
  source: DatasetSource;
  /** Optional original file bytes to keep untouched (kind "import-file"). */
  originalFile?: { filename: string; bytes: ArrayBuffer | Blob };
  project_ids?: string[];
  folder_path?: string | null;
}
