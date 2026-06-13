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

// Type-only import (erased at compile, so it adds no runtime dependency and no
// runtime cycle). A derived table's recipe is a list of pipeline TransformOp.
import type { TransformOp } from "@/lib/datahub/transform/pipeline";

/**
 * The Prism-style table archetypes Data Hub targets. "column" and "xy" are the
 * priority; "grouped", "survival", and "contingency" are declared so the model
 * and the on-disk shape do not need a migration when those table kinds land.
 *
 * A "contingency" table is an R x C grid of non-negative integer counts. Its row
 * headers and column headers are both editable text labels (the two factors), and
 * the cells hold counts. The engine runs a chi-square test of independence and,
 * for a 2x2 layout, Fisher's exact test plus relative-risk / odds-ratio measures.
 *
 * A "nested" table is a hierarchical design. Each top-level GROUP (a treatment)
 * holds SUBGROUPS (biological replicates, e.g. animals), each holding REPLICATE
 * values (technical replicates, e.g. cells). The engine runs the nested t-test (2
 * groups) and the nested one-way ANOVA (3 or more groups), treating the subgroup
 * as the unit of biological replication so the technical replicates are not
 * pseudo-replicated.
 *
 * An "info" sheet is NOT a data grid at all. It is a documentation page that
 * lives in the Data Hub rail next to the tables, so the context of a dataset
 * (what it is, where it came from, the instrument, key constants) travels with
 * the data. It holds a free-text markdown BODY plus an optional list of named
 * CONSTANTS (name / value / optional note), and it runs no statistic, draws no
 * figure, and offers no analysis. Its content lives in the additive `info` field
 * on DataHubDocContent rather than the columns / rows grid.
 */
export type DataHubTableType =
  | "column"
  | "xy"
  | "grouped"
  | "survival"
  | "contingency"
  | "nested"
  | "partsOfWhole"
  | "info";

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

/**
 * The Prism-style Data Processing transforms a DERIVED table can apply to a
 * source table. A derived table's columns/rows are COMPUTED from its source
 * (see DerivedFrom), not hand-entered. The exact math of each transform lives in
 * datahub/transforms.ts (one pure function per kind); this union is the stored
 * discriminator so a derived document records which transform produced it.
 */
export type TransformKind =
  | "transform"
  | "normalize"
  | "transpose"
  | "removeBaseline"
  | "fractionOfTotal";

/**
 * The live link from a DERIVED table back to its SOURCE table. A document that
 * carries this on its meta is a derived table: its columns/rows are recomputed
 * from the source document's CURRENT content every time the derived document is
 * opened (see the DATA-SHAPE NOTE on DataHubDocument.derivedFrom). A document
 * WITHOUT derivedFrom is a normal entered table, byte-identical to today.
 *
 * DATA-SHAPE (widened in phase 2 to a PIPELINE recipe, back-compat):
 *
 * A derived table now stores a PIPELINE (an ordered recipe of TransformOp), not
 * a single transform. The widened shape is:
 *   - sources is the ORDERED list of source table ids. sources[0] is the PRIMARY
 *     source the recipe runs over; join / union ops reference the rest by id.
 *   - recipe is the ordered TransformOp[] the pipeline engine runs (see
 *     transform/engine.ts). The five Prism column transforms are now TransformOp
 *     variants too (folded in phase 2 chunk 1), so a single-op recipe expresses
 *     exactly what the legacy single-transform link expressed.
 *
 * LEGACY READ (back-compat, byte-stable):
 *
 * A document written before phase 2 carries the OLD single-op fields and no
 * recipe. It reads as a single-op pipeline, sources = [sourceTableId] and
 * recipe = [ the one folded TransformOp built from transform + params ], and
 * recomputes to the IDENTICAL result it produced before (the folded op delegates
 * to the same transforms.ts function). resolveRecipe() does this normalization;
 * the serializer keeps writing nothing extra for an unchanged legacy doc, so it
 * stays byte-stable on disk, and only a NEW recipe writes the new keys.
 *
 *   - sourceTableId / transform / params are the LEGACY single-op fields. They
 *     are optional now because a new recipe-shaped link omits them. The exact
 *     math of each TransformKind lives in datahub/transforms.ts.
 */
export interface DerivedFrom {
  /** Legacy single-op source id. Present on pre-phase-2 docs; sources[0] mirrors
   *  it on a widened link. */
  sourceTableId?: string;
  /** Legacy single-op transform kind. Present on pre-phase-2 docs only. */
  transform?: TransformKind;
  /** Legacy single-op params. Present on pre-phase-2 docs only. */
  params?: Record<string, unknown>;
  /** Ordered source table ids. sources[0] is the primary; join / union ops
   *  reference the rest. Present on a phase-2 recipe link. */
  sources?: string[];
  /** Ordered pipeline the engine runs. Present on a phase-2 recipe link. */
  recipe?: TransformOp[];
}

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
  /**
   * The top-level GROUP display name, for a NESTED table only. Optional and
   * additive. A nested table models each top-level group (a treatment) as a
   * datasetId-keyed family of SUBGROUP columns (one column per biological
   * replicate, e.g. a mouse); the subgroup label lives on the column `name`, and
   * the parent group's display name is carried here, repeated on every subgroup
   * column of that group (the same way the Grouped table repeats a group name on
   * its replicate columns). Absent for every other table type, so a document
   * written before this field existed reads back byte-identical.
   */
  groupName?: string;
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
  /**
   * DATA-SHAPE NOTE (derived tables, the live link).
   *
   * Optional and additive. Absent means this is a normal ENTERED table (the
   * current behavior, columns/rows are hand-entered and authoritative), so a
   * document written before this field existed reads back byte-identical and the
   * recompute path is never engaged.
   *
   * Present means this is a DERIVED table. Its columns/rows are NOT authored. The
   * persisted columns/rows are a snapshot of the last computed result (so the
   * catalog mirror and any tool reading getContent still sees a valid table), but
   * the SOURCE OF TRUTH is the source document plus this transform. On open the
   * loader fetches the source's CURRENT content by sourceTableId and recomputes
   * the columns/rows in memory, so a derived table always reflects fresh source
   * data (the live link). We hold the recomputed content IN MEMORY ON OPEN rather
   * than trusting the persisted snapshot, which keeps the link live with no cache
   * staleness to reconcile; the persisted snapshot is only a fallback projection
   * for list/getContent and for a deleted-source empty state.
   */
  derivedFrom?: DerivedFrom;
  /**
   * DATA-SHAPE NOTE (excluded values, the outlier set).
   *
   * Optional and additive. The keys of the data cells the researcher has marked
   * as EXCLUDED, each key the string `"${rowId}:${columnId}"` (the same id space
   * the rows and columns use). An excluded cell keeps its entered value (it is
   * not deleted, and it stays visible and editable in the grid), but every
   * analysis and every plot treats it as ABSENT, exactly like an empty cell, so
   * it drops out of the group's value array, the mean / SD / SEM / n, the error
   * bars, and the jittered replicate dots. This is the Prism "exclude an outlier"
   * affordance.
   *
   * Absent or an empty array means nothing is excluded, which is byte-identical
   * to a document written before this field existed (the serializer only writes
   * the key when the set is non-empty, and the projection only emits the field
   * then), so a normal table round-trips unchanged. Excluding only filters the
   * input set, it never changes a test's math, so no scipy validation gate is
   * needed for it.
   */
  excludedCells?: string[];
  created_at: string;
  last_edited_by?: string;
  last_edited_at?: string;
}

/**
 * One named CONSTANT recorded on an Info sheet, a value a researcher writes down
 * for reference (e.g. name "Dilution factor", value "100", note "serial 1:10").
 * Both name and value are free text (the value stays a string so units, ranges,
 * and instrument names round-trip verbatim); the note is an optional aside. v1
 * is DOCUMENTATION ONLY, so a constant is displayed, not yet read by an analysis.
 */
export interface InfoConstant {
  name: string;
  value: string;
  note?: string;
}

/**
 * The documentation payload of an Info sheet (table_type "info"). It holds the
 * free-text markdown BODY plus the optional list of named CONSTANTS. This is the
 * ADDITIVE content field: it is present only on an Info sheet, so every other
 * table type's content (and its on-disk Loro bytes) stays byte-identical to
 * before this field existed. An Info sheet leaves columns / rows / analyses /
 * plots empty and carries all of its content here.
 */
export interface InfoContent {
  /** The free-text markdown documentation body. */
  body: string;
  /** Named reference constants (displayed, not yet used in analyses). */
  constants: InfoConstant[];
}

/**
 * The full document content as plain JSON: the inverse of seedDataHubDoc. The
 * meta block plus the columns, rows, analyses, and plots. This is the projection
 * getDataHubContent returns and the shape the readable mirror can re-derive.
 *
 * The optional `info` field carries an Info sheet's body + constants. It is
 * ADDITIVE and present ONLY on an Info sheet (table_type "info"); absent on every
 * grid table, so a non-info document projects without it and stays byte-identical
 * to before this field existed.
 */
export interface DataHubDocContent {
  meta: DataHubDocument;
  columns: ColumnDef[];
  rows: RowRecord[];
  analyses: AnalysisSpec[];
  plots: PlotSpec[];
  /** Info-sheet documentation (body + constants). Present only on an Info sheet. */
  info?: InfoContent;
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
  /**
   * Optional derived-table link; absent makes a normal entered table. When set,
   * the create caller should also seed the initial computed columns/rows snapshot
   * (the next-phase Transform dialog does this); the recompute path keeps it fresh
   * on every later open.
   */
  derivedFrom?: DerivedFrom;
  project_ids?: string[];
  folder_path?: string | null;
  columns?: ColumnDef[];
  rows?: RowRecord[];
  analyses?: AnalysisSpec[];
  plots?: PlotSpec[];
  /** Optional Info-sheet documentation; present only when creating an Info sheet. */
  info?: InfoContent;
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
  /** Optional derived-table link; absent leaves the stored value as is. */
  derivedFrom?: DerivedFrom;
  project_ids?: string[];
  folder_path?: string | null;
  last_edited_by?: string;
  last_edited_at?: string;
  columns?: ColumnDef[];
  rows?: RowRecord[];
  analyses?: AnalysisSpec[];
  plots?: PlotSpec[];
  /** Optional Info-sheet documentation; absent leaves the stored value as is. */
  info?: InfoContent;
}
