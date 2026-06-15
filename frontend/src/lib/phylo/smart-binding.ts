// Tree Studio Phase 4: Smart Data Binding (auto-detect joinable tables +
// the add-data wizard). See docs/proposals/2026-06-14-phylo-phase4-smart-data-binding.md.
//
// This is the DETERMINISTIC ENGINE the locked design rests on: detect which
// Data Hub tables in a collection can overlay the open tree, rank them by how
// many tips they join, enumerate the overlay geoms each column can drive, and
// MERGE a chosen table's columns into the tree's tip-keyed metadata so the
// existing per-column overlays (heat / bars / dots / point / strip) bind to
// them. ONE engine, two front doors: the /phylo GUI wizard and a BeakerBot
// inline tool both call these pure functions; the model only narrates, the
// engine does every join-rate calc, possible-plots enumeration, and the merge.
//
// Pure data, browser-safe, no DOM, no React, no I/O. The component layer loads
// the candidate table contents (async dataHubApi) and hands them in; the engine
// never fetches. Mirrors the pure + unit-tested discipline of layer-schema.ts.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { leaves, type TreeNode } from "./parse";
import { matchMetadataToTips } from "./layout";
import { classifyColumn, type ColumnKind } from "./color-scale";
import type { DataHubDocContent } from "@/lib/datahub/model/types";

/**
 * The overlay geoms the wizard can add from a joined column. These all bind a
 * single metadata column through makePanel (heat reads `columns`, the rest read
 * `column`), so the merged column drives them with no new render path.
 */
export type OverlayGeom = "bars" | "heat" | "dots" | "point" | "strip";

/** The geoms each column kind can drive, recommended-first. Numeric magnitudes
 *  read as bars / heat / dots / point; categories read as a color strip. */
const NUMERIC_GEOMS: OverlayGeom[] = ["bars", "heat", "dots", "point"];
const CATEGORICAL_GEOMS: OverlayGeom[] = ["strip"];

/** One overlayable column of a candidate table + the geoms it can drive. */
export interface OverlaySuggestion {
  columnId: string;
  columnName: string;
  columnKind: ColumnKind;
  /** Overlay geoms this column can drive, recommended-first. */
  geoms: OverlayGeom[];
  /** The default geom (the gallery's pre-selected / first thumbnail). */
  recommendedGeom: OverlayGeom;
}

/** A Data Hub table that can overlay the open tree, with its best join + overlays. */
export interface JoinCandidate {
  tableId: string;
  tableName: string;
  /** The column that joins the most tips (the auto-picked key, editable later). */
  joinColumnId: string;
  joinColumnName: string;
  /** Fraction 0..1 of tree tips this table joins on its best column. */
  joinRate: number;
  /** Exact tip counts behind the "joins N of M tips" chip. */
  matchedTips: number;
  totalTips: number;
  /** The non-join columns that can become overlays, with their drivable geoms. */
  overlays: OverlaySuggestion[];
}

/** A candidate table handed to the engine (the component loads `content`). */
export interface CandidateTable {
  id: string;
  name: string;
  content: DataHubDocContent;
}

/** Stringify a content's rows keyed by COLUMN ID (the join + classify key). A
 *  null / undefined cell becomes "" so a missing value never forces a column
 *  categorical (mirrors color-scale's blank rule). */
function stringRows(content: DataHubDocContent): Record<string, string>[] {
  return content.rows.map((r) => {
    const o: Record<string, string> = {};
    for (const c of content.columns) {
      const v = r.cells[c.id];
      o[c.id] = v == null ? "" : String(v);
    }
    return o;
  });
}

/** Map each tree tip id to the table row that joins it on `joinColumnId`, using
 *  the shared three-pass tip matcher (exact / normalized / token). */
function perTipRows(
  tree: TreeNode,
  content: DataHubDocContent,
  joinColumnId: string,
): Map<number, Record<string, string>> {
  return matchMetadataToTips(tree, stringRows(content), joinColumnId).matched;
}

/** The geoms a column kind drives + the recommended default. */
export function geomsForKind(kind: ColumnKind): {
  geoms: OverlayGeom[];
  recommendedGeom: OverlayGeom;
} {
  const geoms = kind === "numeric" ? NUMERIC_GEOMS : CATEGORICAL_GEOMS;
  return { geoms, recommendedGeom: geoms[0] };
}

/** Pick the column that joins the most tips, with its exact matched count. Ties
 *  keep the earliest column (stable). Returns rate 0 when nothing joins. */
function bestJoinColumn(
  tree: TreeNode,
  content: DataHubDocContent,
): { id: string; name: string; matched: number } {
  let bestId = "";
  let bestName = "";
  let bestMatched = -1;
  for (const c of content.columns) {
    const matched = perTipRows(tree, content, c.id).size;
    if (matched > bestMatched) {
      bestMatched = matched;
      bestId = c.id;
      bestName = c.name;
    }
  }
  return { id: bestId, name: bestName, matched: Math.max(bestMatched, 0) };
}

/**
 * Enumerate the overlays a table can drive on the tree, joined on `joinColumnId`.
 * Every column except the join key that carries at least one non-blank value on a
 * matched tip becomes a suggestion, classified numeric / categorical and mapped
 * to its drivable geoms. The join column is excluded (it is the key, not data);
 * columns with no value on any matched tip are skipped (nothing to draw).
 */
export function enumerateOverlays(
  tree: TreeNode,
  content: DataHubDocContent,
  joinColumnId: string,
): OverlaySuggestion[] {
  const matched = perTipRows(tree, content, joinColumnId);
  const out: OverlaySuggestion[] = [];
  for (const c of content.columns) {
    if (c.id === joinColumnId) continue;
    // Skip a column with no value on any joined tip (an all-blank overlay).
    let hasValue = false;
    for (const row of matched.values()) {
      const v = row[c.id];
      if (v !== undefined && v.trim() !== "") {
        hasValue = true;
        break;
      }
    }
    if (!hasValue) continue;
    const kind = classifyColumn(tree, matched, c.id);
    const { geoms, recommendedGeom } = geomsForKind(kind);
    out.push({
      columnId: c.id,
      columnName: c.name,
      columnKind: kind,
      geoms,
      recommendedGeom,
    });
  }
  return out;
}

/**
 * Rank the candidate tables that can overlay the open tree, highest-coverage
 * first. A table is a candidate when its best column joins at least one tip AND
 * it has at least one other column to overlay; tables that join nothing, or that
 * only carry the join key, are dropped. Stable on ties (input order kept).
 */
export function rankJoinCandidates(
  tree: TreeNode,
  tables: CandidateTable[],
): JoinCandidate[] {
  const totalTips = leaves(tree).length;
  const candidates: JoinCandidate[] = [];
  for (const t of tables) {
    const best = bestJoinColumn(tree, t.content);
    if (best.matched === 0) continue; // nothing joins this table
    const overlays = enumerateOverlays(tree, t.content, best.id);
    if (overlays.length === 0) continue; // only the join key, nothing to add
    candidates.push({
      tableId: t.id,
      tableName: t.name,
      joinColumnId: best.id,
      joinColumnName: best.name,
      joinRate: totalTips === 0 ? 0 : best.matched / totalTips,
      matchedTips: best.matched,
      totalTips,
      overlays,
    });
  }
  // Sort by coverage desc, stable (a tie keeps the earlier table).
  return candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.joinRate - a.c.joinRate || a.i - b.i)
    .map((x) => x.c);
}

// --- the metadata merge (the "add" step's plumbing) --------------------------
// Per-column overlays bind to the tree's ONE metadata binding (inline rows keyed
// by tipColumn). To overlay a joined table's columns, merge them into that
// binding on the shared tip key, preserving any existing columns and namespacing
// a name collision. The wizard's "Add N overlays" calls this once, then appends
// one overlay panel (makePanel) per chosen (column, geom).

/** The tree's current inline metadata, or null when nothing is bound yet. */
export interface ExistingMetadata {
  rows: Record<string, string>[];
  tipColumn: string;
}

export interface MergeResult {
  /** The new inline metadata rows (existing columns preserved + the merged ones). */
  rows: Record<string, string>[];
  /** The tip-id column for the merged rows (existing kept, else synthesized). */
  tipColumn: string;
  /** Chosen column id -> the final (collision-resolved) name the overlay binds. */
  addedColumns: { columnId: string; name: string }[];
}

/** The synthesized tip-id column name when the tree has no metadata yet. */
const SYNTHETIC_TIP_COLUMN = "tip";

/** Every column name present across a row set (union, order-stable). */
function unionColumnNames(rows: Record<string, string>[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const r of rows)
    for (const k of Object.keys(r))
      if (!seen.has(k)) {
        seen.add(k);
        order.push(k);
      }
  return order;
}

/**
 * Merge chosen columns of a joined table into the tree's inline metadata.
 *
 * - No existing binding: build fresh rows, one per tip (so the tip axis is
 *   complete), keyed by a synthesized "tip" column, carrying the chosen columns
 *   (blank where a tip did not join).
 * - Existing inline binding: keep every existing row + column untouched, add the
 *   chosen columns onto the rows that map to a tip, and append a new row for any
 *   tip that has table data but no existing row.
 * - Name collisions: a chosen column whose name already exists is namespaced as
 *   `<table>:<name>`, then suffixed `(2)`, `(3)` if still taken. The overlay
 *   binds the returned (possibly namespaced) name.
 *
 * Pure: the inputs are never mutated, a fresh row set is returned.
 */
export function mergeTableColumnsIntoMetadata(params: {
  tree: TreeNode;
  existing: ExistingMetadata | null;
  tableName: string;
  content: DataHubDocContent;
  joinColumnId: string;
  columnIds: string[];
}): MergeResult {
  const { tree, existing, tableName, content, joinColumnId, columnIds } = params;
  const perTip = perTipRows(tree, content, joinColumnId);
  const colName = new Map(content.columns.map((c) => [c.id, c.name]));

  const tipColumn = existing ? existing.tipColumn : SYNTHETIC_TIP_COLUMN;

  // Resolve collision-free display names for the chosen columns.
  const taken = new Set<string>(
    existing ? unionColumnNames(existing.rows) : [tipColumn],
  );
  const addedColumns: { columnId: string; name: string }[] = [];
  for (const colId of columnIds) {
    const base = colName.get(colId) ?? colId;
    let name = base;
    if (taken.has(name)) name = `${tableName}:${base}`;
    let n = 2;
    while (taken.has(name)) name = `${tableName}:${base} (${n++})`;
    taken.add(name);
    addedColumns.push({ columnId: colId, name });
  }

  const valueFor = (tipId: number, colId: string): string =>
    perTip.get(tipId)?.[colId] ?? "";

  if (!existing) {
    const rows = leaves(tree).map((tip) => {
      const row: Record<string, string> = { [tipColumn]: tip.name };
      for (const { columnId, name } of addedColumns)
        row[name] = valueFor(tip.id, columnId);
      return row;
    });
    return { rows, tipColumn, addedColumns };
  }

  // Existing binding: index which existing row joins which tip (by reference),
  // so we add columns onto the right rows and know which tips still need one.
  const matchedExisting = matchMetadataToTips(
    tree,
    existing.rows,
    existing.tipColumn,
  ).matched;
  const rowToTip = new Map<Record<string, string>, number>();
  for (const [tipId, row] of matchedExisting) rowToTip.set(row, tipId);

  const rows: Record<string, string>[] = existing.rows.map((r) => {
    const copy = { ...r };
    const tipId = rowToTip.get(r);
    for (const { columnId, name } of addedColumns)
      copy[name] = tipId === undefined ? "" : valueFor(tipId, columnId);
    return copy;
  });

  // Append a row for any tip that has table data but no existing metadata row.
  const covered = new Set(matchedExisting.keys());
  for (const tip of leaves(tree)) {
    if (covered.has(tip.id)) continue;
    if (!perTip.has(tip.id)) continue; // no table data for this tip either
    const row: Record<string, string> = { [tipColumn]: tip.name };
    for (const { columnId, name } of addedColumns)
      row[name] = valueFor(tip.id, columnId);
    rows.push(row);
  }

  return { rows, tipColumn, addedColumns };
}
