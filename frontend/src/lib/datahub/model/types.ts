/**
 * datahub/model/types.ts
 *
 * Data Hub types live HERE, NOT in the shared lib/types.ts. A parallel session
 * runs an AI-helper autogen pass over lib/types.ts; keeping the Data Hub model
 * out of that file avoids autogen collisions while this layer is in flight.
 *
 * Data Hub is a free open-source GraphPad Prism style analysis surface. A "Data
 * Hub document" (a workbook) holds a typed data TABLE (columns + rows of cells),
 * a set of reproducible ANALYSES (the analysis CHOICE plus params plus cached
 * result), and a set of PLOTS (which columns / analysis to draw plus styling).
 * The whole document is version-controlled via Loro at the CELL level (see
 * datahub-doc.ts), so two people editing different cells converge.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

/**
 * The Prism-style table archetypes Data Hub targets. "column" and "xy" are the
 * priority; "grouped" and "survival" are declared so the model and the on-disk
 * shape do not need a migration when those table kinds land.
 */
export type DataHubTableType = "column" | "xy" | "grouped" | "survival";

/**
 * The role a column plays in the table. Prism groups replicate subcolumns under
 * a parent Y dataset, so a column carries an optional datasetId (the Y dataset
 * it belongs to) and a subcolumnKind (replicate vs a computed summary column).
 */
export type ColumnRole = "x" | "y" | "group" | "subcolumn";

/** The cell value type a column holds. */
export type ColumnDataType = "number" | "text" | "date";

/**
 * A computed-summary subcolumn kind (mean / sd / sem / n) or a raw replicate.
 * Lets the grid model Prism subcolumns (replicates grouped under a Y dataset).
 */
export type SubcolumnKind = "replicate" | "mean" | "sd" | "sem" | "n";

/**
 * How a Column table stores its data. The default (absent) is "replicates", the
 * current behavior where each group column holds raw replicate measurements down
 * the rows. The two summary modes let a researcher who only has the published /
 * recorded summary (no raw replicates) enter the group descriptives directly,
 * which is the Prism "Enter and plot error values already calculated elsewhere"
 * data format. We split SD vs SEM into two explicit modes (rather than a single
 * "summary" mode plus a spread-kind flag) because the spread kind is fixed for
 * the whole table in Prism's UI, and a per-table mode keeps the engine dispatch
 * and the future grid header unambiguous.
 *
 * SUMMARY STORAGE (the data-shape decision, documented for the grid + serializer):
 * In a summary mode each GROUP is a parent Y dataset (a datasetId) carrying THREE
 * subcolumns, one ColumnDef each, with role "subcolumn":
 *   - subcolumnKind "mean"  holds the group mean
 *   - subcolumnKind "sd" OR "sem" holds the spread (which one is fixed by the
 *     table's entryFormat, so "mean-sd-n" uses "sd" and "mean-sem-n" uses "sem")
 *   - subcolumnKind "n"     holds the replicate count
 * The three subcolumns share the SAME datasetId (the group identity) and the
 * table holds a SINGLE row, so each group is one (mean, spread, n) triple read
 * out of that row's three cells. This reuses the existing ColumnRole "subcolumn",
 * SubcolumnKind, datasetId, and the cell-level row model unchanged, so the Loro
 * serializer and the per-cell CRDT merge need no new container. A group's display
 * name is the parent dataset's name, carried on every subcolumn ColumnDef as its
 * `name` (the three subcolumns of one group share a name; readGroupSummary reads
 * it off the mean column). One row keeps the model minimal; a multi-row summary
 * layout would imply replicate-of-summaries, which Prism does not have here.
 */
export type EntryFormat = "replicates" | "mean-sd-n" | "mean-sem-n";

/** A single column definition (one entry in the table's column list). */
export interface ColumnDef {
  id: string;
  name: string;
  role: ColumnRole;
  dataType: ColumnDataType;
  /** The Y dataset this column belongs to (for replicate / summary subcolumns). */
  datasetId?: string;
  /** What this column holds when it is a subcolumn of a Y dataset. */
  subcolumnKind?: SubcolumnKind;
}

/** A cell value as stored in a row. */
export type CellValue = number | string | null;

/**
 * One table row, a cell map keyed by columnId. Giving each row its own cell map
 * is what yields CELL-LEVEL CRDT merge (two people editing different cells of
 * the same or different rows converge cleanly).
 */
export interface RowRecord {
  id: string;
  cells: Record<string, CellValue>;
}

/**
 * A reproducible analysis operation. Stores the CHOICE (analysis type, params,
 * which columns feed it) plus a cached result, NOT just the result, so the
 * analysis re-runs deterministically against the engine when inputs change.
 * resultStale flags that the cache is out of date relative to the current data.
 */
export interface AnalysisSpec {
  id: string;
  /**
   * An optional user-given display name for this analysis (rail rename). Absent
   * on every analysis made before rename existed, in which case the rail shows
   * the computed type label instead. Additive and back-compat.
   */
  name?: string;
  /** The engine analysis identifier (e.g. "unpairedTTest", "oneWayAnova"). */
  type: string;
  /** Analysis-specific parameters (tails, post-hoc method, alpha, etc.). */
  params: Record<string, unknown>;
  /** Which columns / datasets feed the analysis (column ids, grouping, etc.). */
  inputs: Record<string, unknown>;
  /** The last computed engine result, or null when never run. */
  resultCache: unknown | null;
  /** True when the data changed since resultCache was computed. */
  resultStale: boolean;
}

/**
 * A plot. Stores which columns / analysis it draws (source) plus full styling
 * (style). Both are open records the plotting layer interprets.
 */
export interface PlotSpec {
  id: string;
  /**
   * An optional user-given display name for this figure (rail rename). Absent on
   * every figure made before rename existed, in which case the rail shows the
   * figure title or the computed kind label instead. Additive and back-compat.
   */
  name?: string;
  /** The plot kind (e.g. "bar", "scatter", "xy", "survival"). */
  type: string;
  /** Full styling (colors, axes, error bars, fonts, legend, etc.). */
  style: Record<string, unknown>;
  /** Which columns / analysis the plot draws. */
  source: Record<string, unknown>;
}

/**
 * The document / workbook metadata shape, the LIST / catalog projection. This is
 * what the readable `.json` mirror stores so dataHubApi.list does not need to
 * open every Loro snapshot. project_ids is N-to-M (mirror sequences); folder_path
 * is subfolder organization (mirror Method.folder_path).
 */
export interface DataHubDocument {
  id: string;
  name: string;
  /** Collection membership: the projects this document is linked to (N-to-M). */
  project_ids: string[];
  /** Subfolder organization within a project, or null for the project root. */
  folder_path: string | null;
  table_type: DataHubTableType;
  /**
   * How a Column table stores its data. Optional and additive. Absent means
   * "replicates" (the current behavior, raw replicates down the rows), so a
   * document written before this field existed reads back byte-identical. Only
   * meaningful for table_type "column"; ignored for the other archetypes.
   */
  entryFormat?: EntryFormat;
  created_at: string;
  last_edited_by?: string;
  last_edited_at?: string;
}

/**
 * The full document content as plain JSON: the inverse of seedDataHubDoc. The
 * meta block plus the columns, rows, analyses, and plots. This is the projection
 * getDataHubContent returns and the shape the readable mirror can re-derive.
 */
export interface DataHubDocContent {
  meta: DataHubDocument;
  columns: ColumnDef[];
  rows: RowRecord[];
  analyses: AnalysisSpec[];
  plots: PlotSpec[];
}

/**
 * Create payload for dataHubApi.create. id and timestamps are minted by the API.
 * Optional content seeds the initial table / analyses / plots; omitted means an
 * empty document.
 */
export interface DataHubCreate {
  name: string;
  table_type: DataHubTableType;
  /** Optional Column-table entry format; absent means "replicates". */
  entryFormat?: EntryFormat;
  project_ids?: string[];
  folder_path?: string | null;
  columns?: ColumnDef[];
  rows?: RowRecord[];
  analyses?: AnalysisSpec[];
  plots?: PlotSpec[];
}

/**
 * Update payload for dataHubApi.update. Every field optional; only present
 * fields are written. Metadata-only updates (rename, re-link projects, move
 * folder) avoid touching the table.
 */
export interface DataHubUpdate {
  name?: string;
  table_type?: DataHubTableType;
  /** Optional Column-table entry format; absent leaves the stored value as is. */
  entryFormat?: EntryFormat;
  project_ids?: string[];
  folder_path?: string | null;
  last_edited_by?: string;
  last_edited_at?: string;
  columns?: ColumnDef[];
  rows?: RowRecord[];
  analyses?: AnalysisSpec[];
  plots?: PlotSpec[];
}
