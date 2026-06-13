// datahub/bigtable/column-tiers.ts
//
// Pure helpers for the wide-column manager (DataHub-largetables lane, Increment
// 2, spec section 5, transform-builder mockup surface 2). A dataset's column
// count picks one of three tiers, and Tier C selects columns by a name rule
// (regex). Kept pure (no React, no DuckDB) so it is trivially testable and safe
// to call on render.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type { DatasetColumn } from "./types";

/**
 * The three column tiers.
 *  - "a": up to ~30 columns. Inline chip picker.
 *  - "b": dozens to a few hundred. Searchable column panel.
 *  - "c": hundreds-plus / thousands. No grid by default, schema browser plus
 *    pattern selection.
 */
export type ColumnTier = "a" | "b" | "c";

/** Tier A holds up to this many columns (the chip picker stays usable). */
export const TIER_A_MAX = 30;
/** Tier B holds up to this many columns (a searchable list stays usable). */
export const TIER_B_MAX = 300;

/** Pick the tier for a column count (spec section 5 thresholds). */
export function columnTier(colCount: number): ColumnTier {
  if (colCount <= TIER_A_MAX) return "a";
  if (colCount <= TIER_B_MAX) return "b";
  return "c";
}

/**
 * Compile a user-typed name pattern into a RegExp, or null when it is not a valid
 * pattern (the UI shows "invalid pattern" and matches nothing). A blank pattern
 * compiles to null too, so an empty box matches nothing rather than everything.
 */
export function compilePattern(pattern: string): RegExp | null {
  const trimmed = pattern.trim();
  if (trimmed === "") return null;
  try {
    return new RegExp(trimmed);
  } catch {
    return null;
  }
}

/**
 * The columns whose name matches the compiled pattern. With a null pattern
 * (blank or invalid) nothing matches, so the preview stays empty until the user
 * types a usable rule (the wide-table mirror of "describe the change once").
 */
export function matchColumns(
  columns: DatasetColumn[],
  re: RegExp | null,
): DatasetColumn[] {
  if (!re) return [];
  return columns.filter((c) => re.test(c.name));
}

/** Percent-null label for a column ("12% null"), rounded, from the sidecar. */
export function nullRateLabel(col: DatasetColumn, rowCount: number): string {
  if (rowCount <= 0) return "0% null";
  const pct = Math.round((col.nullCount / rowCount) * 100);
  return `${pct}% null`;
}
