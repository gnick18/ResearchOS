// cell-exclusion.ts
//
// Excluded values (the Prism "exclude an outlier" affordance) for Data Hub. A
// researcher right-clicks a data cell and marks it EXCLUDED. The cell keeps its
// entered value (it is not deleted, and it stays visible and editable in the
// grid), but every analysis and every plot treats it as ABSENT, exactly like an
// empty cell, so it drops out of the group's value array, the mean / SD / SEM /
// n, the error bars, and the jittered replicate dots.
//
// The set is stored on meta.excludedCells as an array of `"${rowId}:${columnId}"`
// keys (see the DATA-SHAPE NOTE on DataHubDocument). Absent or empty means
// nothing is excluded, byte-identical to a table written before this existed.
// Excluding only filters the input set, it never changes any test's math, so no
// scipy validation gate is needed.
//
// Pure + browser-safe. The value-reading helpers (columnValues, xyPairs,
// twoWayObservations, survivalGroups) call isCellExcluded to skip an excluded
// cell at read time, so the engine and the plot geometry never see the value.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type { DataHubDocContent } from "@/lib/datahub/model/types";

/** The stored key for one cell (row id + column id), the excludedCells members. */
export function excludedKey(rowId: string, columnId: string): string {
  return `${rowId}:${columnId}`;
}

/** The excluded-key set for a document, read off meta.excludedCells. Returns a
 *  fresh Set (never shared) so a caller can mutate it freely. An absent / empty
 *  field yields an empty set, the byte-identical default. */
export function excludedSet(content: DataHubDocContent): Set<string> {
  const raw = content.meta.excludedCells;
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((k): k is string => typeof k === "string"));
}

/** True when a given cell is excluded from analyses and plots. */
export function isCellExcluded(
  content: DataHubDocContent,
  rowId: string,
  columnId: string,
): boolean {
  const raw = content.meta.excludedCells;
  if (!Array.isArray(raw) || raw.length === 0) return false;
  return raw.includes(excludedKey(rowId, columnId));
}

/**
 * Toggle one cell's exclusion and return the UPDATED key list (sorted for a
 * deterministic, byte-stable serialization). Pure: it does not mutate the input
 * content. The caller persists the returned list through the Loro commit path
 * (setExcludedCells), mirroring how a cell edit commits. An excluded cell that
 * is toggled again is included; an included cell becomes excluded.
 */
export function toggleCellExclusion(
  content: DataHubDocContent,
  rowId: string,
  columnId: string,
): string[] {
  const set = excludedSet(content);
  const key = excludedKey(rowId, columnId);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  // Sorted so the serialized array is deterministic regardless of toggle order,
  // which keeps two devices that exclude the same cells byte-equal.
  return [...set].sort();
}
