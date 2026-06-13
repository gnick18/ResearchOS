/**
 * datahub-doc.ts
 *
 * The CELL-LEVEL Loro model for a single Data Hub document (a workbook). Unlike
 * purchase-doc (a flat field map) this is a GRID plus side records, so the model
 * is built from movable lists of small maps rather than one field map.
 *
 * Containers:
 *   - "meta" LoroMap: title, table_type, created_at, and the "collab_doc_id" key
 *     (the SAME key notes / tasks / purchases use). The seed never writes
 *     collab_doc_id; it is minted later on the shared context, entity-agnostic.
 *   - "columns" LoroMovableList of LoroMap: one entry per ColumnDef. Movable so
 *     reordering a column is a clean CRDT move op, not a delete + reinsert.
 *   - "rows" LoroMovableList of LoroMap: one entry per row. Each row map holds an
 *     "id" key plus one key PER columnId carrying that cell's value
 *     (number | string | null). This is the key requirement: a per-cell LoroMap
 *     key gives CELL-LEVEL merge (two people editing different cells of the same
 *     row converge, last-write-wins on the SAME cell) and clean row
 *     insert / delete / reorder via the movable list. No whole-table snapshots.
 *   - "analyses" LoroMovableList of LoroMap: one entry per AnalysisSpec. params /
 *     inputs / resultCache are non-scalar, stored as JSON-serialized strings
 *     (mirroring how purchase-doc serializes flagged / attachments). resultStale
 *     is a boolean scalar.
 *   - "plots" LoroMovableList of LoroMap: one entry per PlotSpec. style / source
 *     JSON-serialized.
 *
 * Determinism (the fork-fix invariant, mirroring seedPurchaseDoc / seedNoteDoc):
 * the seed uses the fixed seedActorId, materializes containers in a fixed order
 * (meta, columns, rows, analyses, plots), inserts list entries in input order,
 * and writes each entry's keys in a fixed declared order, in a single commit. Two
 * devices seeding identical content produce byte-equal output and converge rather
 * than fork.
 *
 * The cell keys (columnId) are NOT a fixed declared set (they are data-driven),
 * so a row map writes its scalar "id" first, then its cell keys in the order the
 * columns list declares them, derived from the content. Determinism holds as long
 * as both devices seed from the same DataHubDocContent (same column order, same
 * row cell maps), which is the same precondition every seed already requires.
 *
 * Mutators (setCell, addRow, ...) do NOT commit; callers commit (debounced) via
 * the handle, exactly like setPurchaseField.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { LoroDoc, LoroMap, LoroMovableList } from "loro-crdt";
import { seedActorId } from "./seed";
import type {
  AnalysisSpec,
  CellValue,
  ColumnDef,
  ColumnDataType,
  ColumnRole,
  DataHubDocContent,
  DataHubDocument,
  DataHubTableType,
  DerivedFrom,
  EntryFormat,
  PlotSpec,
  RowRecord,
  SubcolumnKind,
} from "@/lib/datahub/model/types";

// ---------------------------------------------------------------------------
// Container names (locked; parity tests bind to these).
// ---------------------------------------------------------------------------

export const META_KEY = "meta";
/**
 * The meta key holding a Column table's entry format ("mean-sd-n" / "mean-sem-n").
 * Absent means "replicates" (the default), so the projection only emits the field
 * when the key is present and a replicates document never carries the key.
 */
export const ENTRY_FORMAT_KEY = "entry_format";
/**
 * The meta key holding a DERIVED table's source link, JSON-serialized (the
 * DerivedFrom shape is non-scalar, so it is stored as a string the way analysis
 * params are). Absent means a normal entered table, so the seed only writes the
 * key when derivedFrom is present and an entered document never carries it. This
 * keeps the live link travelling with the doc through the CRDT and the mirror.
 */
export const DERIVED_FROM_KEY = "derived_from";
/**
 * The meta key holding the EXCLUDED cell set, JSON-serialized (a string array of
 * `"${rowId}:${columnId}"` keys, a non-scalar so stored as a string the way the
 * derived link is). Absent / empty means nothing is excluded, so the seed only
 * writes the key when the set is non-empty and a table with no exclusions carries
 * no key, keeping it byte-identical to before this field existed. The excluded
 * set travels with the doc through the CRDT and the mirror like the other meta.
 */
export const EXCLUDED_CELLS_KEY = "excluded_cells";
export const COLUMNS_KEY = "columns";
export const ROWS_KEY = "rows";
export const ANALYSES_KEY = "analyses";
export const PLOTS_KEY = "plots";

/** The reserved row-map key holding the row id (everything else is a cell). */
const ROW_ID_KEY = "id";

/** Fixed declared key order for a column map entry. */
const COLUMN_FIELD_KEYS = [
  "id",
  "name",
  "role",
  "dataType",
  "datasetId",
  "subcolumnKind",
] as const;

/** Fixed declared key order for an analysis map entry (scalars + serialized). */
const ANALYSIS_SCALAR_KEYS = ["id", "type", "resultStale"] as const;
const ANALYSIS_PARAMS_KEY = "params";
const ANALYSIS_INPUTS_KEY = "inputs";
const ANALYSIS_RESULT_KEY = "resultCache";
/** Optional analysis display name (absent until the user renames it). */
const ANALYSIS_NAME_KEY = "name";

/** Fixed declared key order for a plot map entry. */
const PLOT_SCALAR_KEYS = ["id", "type"] as const;
const PLOT_STYLE_KEY = "style";
const PLOT_SOURCE_KEY = "source";
/** Optional figure display name (absent until the user renames it). */
const PLOT_NAME_KEY = "name";

// ---------------------------------------------------------------------------
// Internal helpers (parse / read)
// ---------------------------------------------------------------------------

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Parse a JSON-serialized value, returning the fallback on absence / corruption. */
function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Cell values are number | string | null only; anything else normalizes to null. */
function asCell(v: unknown): CellValue {
  if (typeof v === "number" || typeof v === "string") return v;
  return null;
}

// ---------------------------------------------------------------------------
// Entry writers (used by the seed and the mutators)
// ---------------------------------------------------------------------------

/** Write a column's fields into a (freshly inserted) column map, fixed order. */
function writeColumn(map: LoroMap, col: ColumnDef): void {
  map.set("id", col.id);
  map.set("name", col.name ?? "");
  map.set("role", col.role);
  map.set("dataType", col.dataType);
  // Optional keys normalize to null so two devices seed identical bytes whether
  // or not a given column omits them.
  map.set("datasetId", col.datasetId ?? null);
  map.set("subcolumnKind", col.subcolumnKind ?? null);
  // groupName is the Nested table's top-level group label. It is written ONLY
  // when present, so a column that never carries it (every non-nested table)
  // stays byte-identical to a document written before this field existed.
  if (col.groupName !== undefined) map.set("groupName", col.groupName);
}

/**
 * Write a row into a (freshly inserted) row map: the "id" scalar first, then one
 * key per cell in the declared cell-key order. The caller passes the ordered
 * cell key list so the insertion sequence is deterministic across devices.
 */
function writeRow(map: LoroMap, row: RowRecord, cellKeyOrder: string[]): void {
  map.set(ROW_ID_KEY, row.id);
  for (const colId of cellKeyOrder) {
    const present = Object.prototype.hasOwnProperty.call(row.cells, colId);
    map.set(colId, present ? asCell(row.cells[colId]) : null);
  }
}

/** Write an analysis spec into a (freshly inserted) map, fixed order. The
 *  optional display name is only written when present so a spec without a name
 *  serializes byte-for-byte the same as before rename existed. */
function writeAnalysis(map: LoroMap, a: AnalysisSpec): void {
  map.set("id", a.id);
  map.set("type", a.type);
  map.set("resultStale", a.resultStale ?? false);
  // The name key is only present when set. On an in-place upsert (rename, then a
  // rename back to blank) the stale key is deleted so the projection drops it and
  // the rail falls back to the computed label.
  if (typeof a.name === "string") map.set(ANALYSIS_NAME_KEY, a.name);
  else if (map.get(ANALYSIS_NAME_KEY) !== undefined) map.delete(ANALYSIS_NAME_KEY);
  map.set(ANALYSIS_PARAMS_KEY, JSON.stringify(a.params ?? {}));
  map.set(ANALYSIS_INPUTS_KEY, JSON.stringify(a.inputs ?? {}));
  map.set(ANALYSIS_RESULT_KEY, JSON.stringify(a.resultCache ?? null));
}

/** Write a plot spec into a (freshly inserted) map, fixed order. The optional
 *  display name is only written when present so a spec without a name serializes
 *  byte-for-byte the same as before rename existed. */
function writePlot(map: LoroMap, p: PlotSpec): void {
  map.set("id", p.id);
  map.set("type", p.type);
  // See writeAnalysis: only present when set, deleted on a rename-to-blank so the
  // figure falls back to its title / kind label.
  if (typeof p.name === "string") map.set(PLOT_NAME_KEY, p.name);
  else if (map.get(PLOT_NAME_KEY) !== undefined) map.delete(PLOT_NAME_KEY);
  map.set(PLOT_STYLE_KEY, JSON.stringify(p.style ?? {}));
  map.set(PLOT_SOURCE_KEY, JSON.stringify(p.source ?? {}));
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/**
 * Build a fresh Loro doc snapshot for a Data Hub document from its content JSON.
 *
 * Deterministic: fixed seed actor, fixed container order, input-order list
 * inserts, fixed per-entry key order, single commit. Two devices seeding the
 * same content produce byte-equal output and converge.
 */
export function seedDataHubDoc(content: DataHubDocContent): Uint8Array {
  const doc = new LoroDoc();
  doc.setPeerId(seedActorId);

  // meta (collab_doc_id is minted later on the shared context). Fixed key order.
  const meta = doc.getMap(META_KEY);
  meta.set("title", content.meta.name ?? "");
  meta.set("table_type", content.meta.table_type);
  // entry_format is written ONLY for the summary modes, so a "replicates" /
  // absent document seeds byte-identically to before this field existed.
  if (
    content.meta.entryFormat === "mean-sd-n" ||
    content.meta.entryFormat === "mean-sem-n"
  ) {
    meta.set(ENTRY_FORMAT_KEY, content.meta.entryFormat);
  }
  // derived_from is written ONLY for a derived table, so an entered document
  // seeds byte-identically to before this field existed. JSON-serialized because
  // the DerivedFrom shape is non-scalar. Both link shapes serialize through this
  // one stringify, and each writes only its OWN keys (a legacy single-op link
  // writes sourceTableId / transform / params and stays byte-stable; a phase-2
  // recipe link writes sources / recipe), so an unchanged legacy doc adds nothing
  // new on disk.
  if (content.meta.derivedFrom) {
    meta.set(DERIVED_FROM_KEY, JSON.stringify(content.meta.derivedFrom));
  }
  // excluded_cells is written ONLY when the set is non-empty, so a table with no
  // excluded values seeds byte-identically to before this field existed. Sorted
  // so two devices excluding the same cells produce byte-equal output.
  if (Array.isArray(content.meta.excludedCells) && content.meta.excludedCells.length > 0) {
    const sorted = [...content.meta.excludedCells]
      .filter((k): k is string => typeof k === "string")
      .sort();
    if (sorted.length > 0) {
      meta.set(EXCLUDED_CELLS_KEY, JSON.stringify(sorted));
    }
  }
  meta.set("created_at", content.meta.created_at ?? "");

  // The deterministic cell-key order for every row is the column declaration
  // order from the content. Each row writes its cells in this same order.
  const cellKeyOrder = content.columns.map((c) => c.id);

  const columns = doc.getMovableList(COLUMNS_KEY);
  for (let i = 0; i < content.columns.length; i++) {
    const map = columns.insertContainer(i, new LoroMap());
    writeColumn(map, content.columns[i]);
  }

  const rows = doc.getMovableList(ROWS_KEY);
  for (let i = 0; i < content.rows.length; i++) {
    const map = rows.insertContainer(i, new LoroMap());
    writeRow(map, content.rows[i], cellKeyOrder);
  }

  const analyses = doc.getMovableList(ANALYSES_KEY);
  for (let i = 0; i < content.analyses.length; i++) {
    const map = analyses.insertContainer(i, new LoroMap());
    writeAnalysis(map, content.analyses[i]);
  }

  const plots = doc.getMovableList(PLOTS_KEY);
  for (let i = 0; i < content.plots.length; i++) {
    const map = plots.insertContainer(i, new LoroMap());
    writePlot(map, content.plots[i]);
  }

  doc.commit({ message: "seed datahub document" });
  return doc.export({ mode: "snapshot" });
}

// ---------------------------------------------------------------------------
// Live container accessors
// ---------------------------------------------------------------------------

export function getDataHubMeta(doc: LoroDoc): LoroMap {
  return doc.getMap(META_KEY);
}
export function getColumnsList(doc: LoroDoc): LoroMovableList {
  return doc.getMovableList(COLUMNS_KEY);
}
export function getRowsList(doc: LoroDoc): LoroMovableList {
  return doc.getMovableList(ROWS_KEY);
}
export function getAnalysesList(doc: LoroDoc): LoroMovableList {
  return doc.getMovableList(ANALYSES_KEY);
}
export function getPlotsList(doc: LoroDoc): LoroMovableList {
  return doc.getMovableList(PLOTS_KEY);
}

// ---------------------------------------------------------------------------
// Projection (inverse of seed)
// ---------------------------------------------------------------------------

function projectColumns(doc: LoroDoc): ColumnDef[] {
  const list = getColumnsList(doc);
  const out: ColumnDef[] = [];
  for (let i = 0; i < list.length; i++) {
    const map = list.get(i) as LoroMap | undefined;
    if (!map) continue;
    const id = asString(map.get("id"));
    if (id === null) continue;
    const col: ColumnDef = {
      id,
      name: asString(map.get("name")) ?? "",
      role: (asString(map.get("role")) as ColumnRole) ?? "y",
      dataType: (asString(map.get("dataType")) as ColumnDataType) ?? "number",
    };
    const datasetId = asString(map.get("datasetId"));
    if (datasetId !== null) col.datasetId = datasetId;
    const subKind = asString(map.get("subcolumnKind"));
    if (subKind !== null) col.subcolumnKind = subKind as SubcolumnKind;
    const groupName = asString(map.get("groupName"));
    if (groupName !== null) col.groupName = groupName;
    out.push(col);
  }
  return out;
}

function projectRows(doc: LoroDoc): RowRecord[] {
  const list = getRowsList(doc);
  const out: RowRecord[] = [];
  for (let i = 0; i < list.length; i++) {
    const map = list.get(i) as LoroMap | undefined;
    if (!map) continue;
    const id = asString(map.get(ROW_ID_KEY));
    if (id === null) continue;
    const cells: Record<string, CellValue> = {};
    // Every key except the reserved row id is a cell.
    for (const key of map.keys()) {
      if (key === ROW_ID_KEY) continue;
      cells[key] = asCell(map.get(key));
    }
    out.push({ id, cells });
  }
  return out;
}

function projectAnalyses(doc: LoroDoc): AnalysisSpec[] {
  const list = getAnalysesList(doc);
  const out: AnalysisSpec[] = [];
  for (let i = 0; i < list.length; i++) {
    const map = list.get(i) as LoroMap | undefined;
    if (!map) continue;
    const id = asString(map.get("id"));
    if (id === null) continue;
    const name = asString(map.get(ANALYSIS_NAME_KEY));
    out.push({
      id,
      ...(name !== null ? { name } : {}),
      type: asString(map.get("type")) ?? "",
      params: parseJson<Record<string, unknown>>(map.get(ANALYSIS_PARAMS_KEY), {}),
      inputs: parseJson<Record<string, unknown>>(map.get(ANALYSIS_INPUTS_KEY), {}),
      resultCache: parseJson<unknown>(map.get(ANALYSIS_RESULT_KEY), null),
      resultStale:
        typeof map.get("resultStale") === "boolean"
          ? (map.get("resultStale") as boolean)
          : false,
    });
  }
  return out;
}

function projectPlots(doc: LoroDoc): PlotSpec[] {
  const list = getPlotsList(doc);
  const out: PlotSpec[] = [];
  for (let i = 0; i < list.length; i++) {
    const map = list.get(i) as LoroMap | undefined;
    if (!map) continue;
    const id = asString(map.get("id"));
    if (id === null) continue;
    const name = asString(map.get(PLOT_NAME_KEY));
    out.push({
      id,
      ...(name !== null ? { name } : {}),
      type: asString(map.get("type")) ?? "",
      style: parseJson<Record<string, unknown>>(map.get(PLOT_STYLE_KEY), {}),
      source: parseJson<Record<string, unknown>>(map.get(PLOT_SOURCE_KEY), {}),
    });
  }
  return out;
}

/**
 * Project the live doc back into plain DataHubDocContent (inverse of the seed).
 * The meta block is partial here (the doc only stores title / table_type /
 * created_at); the catalog fields project_ids / folder_path / last_edited_*
 * live in the readable mirror and are filled by the sidecar store, which knows
 * the document id and owner. getDataHubContent fills meta with what the doc
 * holds plus an empty project_ids / null folder_path so the shape is complete.
 */
export function getDataHubContent(doc: LoroDoc, id = ""): DataHubDocContent {
  const meta = getDataHubMeta(doc);
  const docMeta: DataHubDocument = {
    id,
    name: asString(meta.get("title")) ?? "",
    project_ids: [],
    folder_path: null,
    table_type: (asString(meta.get("table_type")) as DataHubTableType) ?? "column",
    created_at: asString(meta.get("created_at")) ?? "",
  };
  // Only emit entryFormat when the key is present and a known summary mode, so a
  // replicates document projects without the field (back-compat byte-identity).
  const entryFormat = asString(meta.get(ENTRY_FORMAT_KEY));
  if (entryFormat === "mean-sd-n" || entryFormat === "mean-sem-n") {
    docMeta.entryFormat = entryFormat as EntryFormat;
  }
  // Only emit derivedFrom when the serialized key is present and parses into a
  // well-formed link, so an entered document projects without the field. A
  // corrupt / partial value is dropped (treated as an entered table) rather than
  // crashing the projection.
  //
  // Two shapes are accepted, and each is projected back with EXACTLY the keys it
  // had on disk, so neither path invents extra keys (byte-stable round-trip):
  //   - PHASE-2 RECIPE: { sources: string[]; recipe: TransformOp[] }. The engine
  //     runs this directly. recipe is passed through verbatim (the engine and the
  //     recompute layer own its op shapes; the serializer treats it as opaque).
  //   - LEGACY SINGLE-OP: { sourceTableId, transform, params }. A pre-phase-2 doc.
  //     resolveRecipe normalizes it to a one-op recipe at recompute time, so this
  //     keeps reading byte-identically to before phase 2.
  const derived = parseJson<DerivedFrom | null>(meta.get(DERIVED_FROM_KEY), null);
  if (
    derived &&
    Array.isArray(derived.sources) &&
    derived.sources.length > 0 &&
    Array.isArray(derived.recipe)
  ) {
    docMeta.derivedFrom = {
      sources: derived.sources.filter((s): s is string => typeof s === "string"),
      recipe: derived.recipe,
    };
  } else if (
    derived &&
    typeof derived.sourceTableId === "string" &&
    typeof derived.transform === "string"
  ) {
    docMeta.derivedFrom = {
      sourceTableId: derived.sourceTableId,
      transform: derived.transform,
      params: (derived.params ?? {}) as Record<string, unknown>,
    };
  }
  // Only emit excludedCells when the serialized key is present and parses into a
  // non-empty string array, so a table with no exclusions projects without the
  // field (back-compat byte-identity). A corrupt value is dropped (treated as no
  // exclusions) rather than crashing the projection.
  const excluded = parseJson<unknown>(meta.get(EXCLUDED_CELLS_KEY), null);
  if (Array.isArray(excluded)) {
    const keys = excluded.filter((k): k is string => typeof k === "string");
    if (keys.length > 0) docMeta.excludedCells = keys;
  }
  return {
    meta: docMeta,
    columns: projectColumns(doc),
    rows: projectRows(doc),
    analyses: projectAnalyses(doc),
    plots: projectPlots(doc),
  };
}

// ---------------------------------------------------------------------------
// Granular mutators (do NOT commit; the handle commits debounced)
// ---------------------------------------------------------------------------

function findRowIndex(list: LoroMovableList, rowId: string): number {
  for (let i = 0; i < list.length; i++) {
    const map = list.get(i) as LoroMap | undefined;
    if (map && map.get(ROW_ID_KEY) === rowId) return i;
  }
  return -1;
}

function findEntryIndex(list: LoroMovableList, id: string): number {
  for (let i = 0; i < list.length; i++) {
    const map = list.get(i) as LoroMap | undefined;
    if (map && map.get("id") === id) return i;
  }
  return -1;
}

/**
 * Set a single cell (one columnId of one row). This is the cell-level write: it
 * touches exactly one key of one row map, so a concurrent edit to any other cell
 * merges cleanly and the SAME cell is last-write-wins. No-op when the row is not
 * found. Does NOT commit.
 */
export function setCell(
  doc: LoroDoc,
  rowId: string,
  columnId: string,
  value: CellValue,
): void {
  if (columnId === ROW_ID_KEY) {
    throw new Error(`[loro] datahub cell column id "${ROW_ID_KEY}" is reserved`);
  }
  const rows = getRowsList(doc);
  const idx = findRowIndex(rows, rowId);
  if (idx < 0) return;
  const map = rows.get(idx) as LoroMap;
  map.set(columnId, value);
}

/**
 * Append a row. cells is the initial cell map (columnId -> value). Inserts a new
 * row map at the end of the rows list. Does NOT commit. Returns the row id.
 */
export function addRow(
  doc: LoroDoc,
  row: RowRecord,
): string {
  const rows = getRowsList(doc);
  const map = rows.insertContainer(rows.length, new LoroMap());
  // Write the id plus each provided cell. Cell order here is the object key
  // order of the provided map; per-row determinism is not required for a live
  // edit (only the seed must be byte-deterministic across devices).
  map.set(ROW_ID_KEY, row.id);
  for (const [colId, value] of Object.entries(row.cells)) {
    if (colId === ROW_ID_KEY) continue;
    map.set(colId, asCell(value));
  }
  return row.id;
}

/**
 * Insert a row at a position. cells is the initial cell map (columnId -> value).
 * The index is clamped to [0, length] so an out-of-range insert appends rather
 * than throwing. Does NOT commit. Returns the row id. This is the positional
 * sibling of addRow (which always appends), used by the grid Insert-row-above /
 * Insert-row-below right-click actions.
 */
export function addRowAt(doc: LoroDoc, row: RowRecord, index: number): string {
  const rows = getRowsList(doc);
  const at = Math.max(0, Math.min(index, rows.length));
  const map = rows.insertContainer(at, new LoroMap());
  map.set(ROW_ID_KEY, row.id);
  for (const [colId, value] of Object.entries(row.cells)) {
    if (colId === ROW_ID_KEY) continue;
    map.set(colId, asCell(value));
  }
  return row.id;
}

/** Delete a row by id. No-op when absent. Does NOT commit. */
export function deleteRow(doc: LoroDoc, rowId: string): void {
  const rows = getRowsList(doc);
  const idx = findRowIndex(rows, rowId);
  if (idx < 0) return;
  rows.delete(idx, 1);
}

/**
 * Move a row to a new index (reorder). No-op when the row is absent. Does NOT
 * commit. Uses the movable list's native move op (a clean CRDT reorder).
 */
export function moveRow(doc: LoroDoc, rowId: string, toIndex: number): void {
  const rows = getRowsList(doc);
  const from = findRowIndex(rows, rowId);
  if (from < 0) return;
  const clamped = Math.max(0, Math.min(toIndex, rows.length - 1));
  if (from === clamped) return;
  rows.move(from, clamped);
}

/** Append a column. Does NOT commit. Returns the column id. */
export function addColumn(doc: LoroDoc, col: ColumnDef): string {
  const columns = getColumnsList(doc);
  const map = columns.insertContainer(columns.length, new LoroMap());
  writeColumn(map, col);
  return col.id;
}

/**
 * Insert a column at a position. The index is clamped to [0, length] so an
 * out-of-range insert appends rather than throwing. Does NOT commit. Returns the
 * column id. The positional sibling of addColumn (which always appends), used by
 * the grid Insert-before / Insert-after and Duplicate right-click actions so the
 * new column lands where the user clicked rather than at the far right.
 */
export function addColumnAt(doc: LoroDoc, col: ColumnDef, index: number): string {
  const columns = getColumnsList(doc);
  const at = Math.max(0, Math.min(index, columns.length));
  const map = columns.insertContainer(at, new LoroMap());
  writeColumn(map, col);
  return col.id;
}

/**
 * Patch an existing column's fields by id (partial). No-op when absent. Does NOT
 * commit. id itself cannot be changed (the patch's id, if any, is ignored as the
 * lookup key).
 */
export function updateColumn(
  doc: LoroDoc,
  columnId: string,
  patch: Partial<Omit<ColumnDef, "id">>,
): void {
  const columns = getColumnsList(doc);
  const idx = findEntryIndex(columns, columnId);
  if (idx < 0) return;
  const map = columns.get(idx) as LoroMap;
  if (patch.name !== undefined) map.set("name", patch.name);
  if (patch.role !== undefined) map.set("role", patch.role);
  if (patch.dataType !== undefined) map.set("dataType", patch.dataType);
  if (patch.datasetId !== undefined) map.set("datasetId", patch.datasetId ?? null);
  if (patch.subcolumnKind !== undefined)
    map.set("subcolumnKind", patch.subcolumnKind ?? null);
  if (patch.groupName !== undefined) map.set("groupName", patch.groupName);
}

/** Delete a column by id. No-op when absent. Does NOT commit. Note: this does
 *  not strip the matching cell key from each row (a cleanup the data layer can
 *  do separately); a stale cell key projects harmlessly only if a column still
 *  references it, and projectRows emits every non-id key, so callers that delete
 *  a column should also clear its cells via setCell(..., null) if they want the
 *  projection to drop it. */
export function removeColumn(doc: LoroDoc, columnId: string): void {
  const columns = getColumnsList(doc);
  const idx = findEntryIndex(columns, columnId);
  if (idx < 0) return;
  columns.delete(idx, 1);
}

/**
 * Delete a column AND drop its cell key from every row, so the projection no
 * longer emits a dangling cell for the removed column. No-op when the column is
 * absent. Does NOT commit. This is the form the grid Delete-column action wants:
 * removeColumn alone leaves a stale cell key on each row (projectRows emits every
 * non-id key), so a later analysis or CSV export could still see the deleted
 * column's values. Stripping the cell keys here keeps the row maps clean.
 */
export function removeColumnWithCells(doc: LoroDoc, columnId: string): void {
  const columns = getColumnsList(doc);
  const idx = findEntryIndex(columns, columnId);
  if (idx < 0) return;
  columns.delete(idx, 1);
  const rows = getRowsList(doc);
  for (let i = 0; i < rows.length; i++) {
    const map = rows.get(i) as LoroMap | undefined;
    if (!map) continue;
    // Only delete the key when present, so we never touch a row that never
    // carried this column (keeps the write set minimal for the CRDT).
    if (map.get(columnId) !== undefined) map.delete(columnId);
  }
}

/** Move a column to a new index (reorder). No-op when absent. Does NOT commit. */
export function moveColumn(doc: LoroDoc, columnId: string, toIndex: number): void {
  const columns = getColumnsList(doc);
  const from = findEntryIndex(columns, columnId);
  if (from < 0) return;
  const clamped = Math.max(0, Math.min(toIndex, columns.length - 1));
  if (from === clamped) return;
  columns.move(from, clamped);
}

/**
 * Upsert an analysis spec by id (set). Replaces in place when the id exists,
 * otherwise appends. Does NOT commit. The serialized fields round-trip through
 * the projection.
 */
export function setAnalysis(doc: LoroDoc, spec: AnalysisSpec): void {
  const list = getAnalysesList(doc);
  const idx = findEntryIndex(list, spec.id);
  if (idx >= 0) {
    const map = list.get(idx) as LoroMap;
    writeAnalysis(map, spec);
    return;
  }
  const map = list.insertContainer(list.length, new LoroMap());
  writeAnalysis(map, spec);
}

/** Remove an analysis spec by id. No-op when absent. Does NOT commit. */
export function removeAnalysis(doc: LoroDoc, analysisId: string): void {
  const list = getAnalysesList(doc);
  const idx = findEntryIndex(list, analysisId);
  if (idx < 0) return;
  list.delete(idx, 1);
}

/**
 * Upsert a plot spec by id (set). Replaces in place when the id exists,
 * otherwise appends. Does NOT commit.
 */
export function setPlot(doc: LoroDoc, spec: PlotSpec): void {
  const list = getPlotsList(doc);
  const idx = findEntryIndex(list, spec.id);
  if (idx >= 0) {
    const map = list.get(idx) as LoroMap;
    writePlot(map, spec);
    return;
  }
  const map = list.insertContainer(list.length, new LoroMap());
  writePlot(map, spec);
}

/** Remove a plot spec by id. No-op when absent. Does NOT commit. */
export function removePlot(doc: LoroDoc, plotId: string): void {
  const list = getPlotsList(doc);
  const idx = findEntryIndex(list, plotId);
  if (idx < 0) return;
  list.delete(idx, 1);
}

/** Set the document title in meta. Does NOT commit. */
export function setTitle(doc: LoroDoc, title: string): void {
  getDataHubMeta(doc).set("title", title);
}

/**
 * Replace the whole table (every column and every row) with a new structure in
 * one op. Clears both movable lists, then reinserts the new columns and rows in
 * declared order with the same per-entry key ordering the seed uses, so the live
 * doc matches what a fresh seed of the same content would produce. Does NOT
 * commit. This is the structural-rewrite path the entry-format switch uses (the
 * grid changes from replicate rows to a single summary row, or back), where a
 * cell-by-cell diff would be far more ops than just reseeding the two lists.
 * Analyses / plots / meta are untouched (an analysis that referenced a now-gone
 * column id simply resolves to no values, which the run layer already handles).
 */
export function replaceTable(
  doc: LoroDoc,
  columns: ColumnDef[],
  rows: RowRecord[],
): void {
  const cellKeyOrder = columns.map((c) => c.id);
  const columnsList = getColumnsList(doc);
  if (columnsList.length > 0) columnsList.delete(0, columnsList.length);
  for (let i = 0; i < columns.length; i++) {
    const map = columnsList.insertContainer(i, new LoroMap());
    writeColumn(map, columns[i]);
  }
  const rowsList = getRowsList(doc);
  if (rowsList.length > 0) rowsList.delete(0, rowsList.length);
  for (let i = 0; i < rows.length; i++) {
    const map = rowsList.insertContainer(i, new LoroMap());
    writeRow(map, rows[i], cellKeyOrder);
  }
}

/**
 * Set (or clear) a Column table's entry format in meta. Does NOT commit. Setting
 * "replicates" deletes the key so the document returns to the byte-identical
 * default rather than carrying an explicit "replicates" marker.
 */
export function setEntryFormat(doc: LoroDoc, format: EntryFormat): void {
  const meta = getDataHubMeta(doc);
  if (format === "mean-sd-n" || format === "mean-sem-n") {
    meta.set(ENTRY_FORMAT_KEY, format);
  } else if (meta.get(ENTRY_FORMAT_KEY) !== undefined) {
    meta.delete(ENTRY_FORMAT_KEY);
  }
}

/**
 * Set (or clear) the EXCLUDED cell set in meta. Does NOT commit. An empty list
 * deletes the key so the document returns to the byte-identical default rather
 * than carrying an explicit empty array. The list is sorted before writing so a
 * device that excludes the same cells in a different order still serializes the
 * same bytes. This is the persistence sibling of toggleCellExclusion (which
 * computes the new list); the grid calls toggle, then this, then commits.
 */
export function setExcludedCells(doc: LoroDoc, keys: string[]): void {
  const meta = getDataHubMeta(doc);
  const sorted = (Array.isArray(keys) ? keys : [])
    .filter((k): k is string => typeof k === "string")
    .sort();
  if (sorted.length > 0) {
    meta.set(EXCLUDED_CELLS_KEY, JSON.stringify(sorted));
  } else if (meta.get(EXCLUDED_CELLS_KEY) !== undefined) {
    meta.delete(EXCLUDED_CELLS_KEY);
  }
}
