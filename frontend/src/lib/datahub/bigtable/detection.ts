// datahub/bigtable/detection.ts
//
// The pure threshold helper that decides whether a table belongs in the
// large-dataset lane (DataHub-largetables lane, Increment 1). Wired at the
// import boundary so a large import routes to the dataset lane before a single
// row reaches the cell-level Loro store (spec section 2, decision section 9).
//
// This is the ROUTING SEAM only. The manual "Switch to large-dataset mode"
// control and the one-time explainer card are Increment 2 UI; this increment
// just exposes the programmatic decision.
//
// No em-dashes, no emojis, no mid-sentence colons.

/**
 * The row-count threshold above which a table auto-routes to the dataset lane.
 * Roughly 1,000 rows (Grant chose lower deliberately, to push most non-trivial
 * tables into the fast lane by default, spec section 9). Tunable here; the
 * manual switch (Increment 2) covers anyone who wants either lane regardless.
 */
export const LARGE_TABLE_ROW_THRESHOLD = 1000;

/**
 * A column-count ceiling that also trips the dataset lane. The editable grid
 * renders a chip per column and a cell-level CRDT per cell, so a very wide table
 * is as fatal as a very tall one (spec section 1). A table with this many
 * columns or more routes to the dataset lane even when it is short. The wide-
 * column TIERS (the schema browser, pattern selection) are Increment 2; this is
 * just the routing trip.
 */
export const LARGE_TABLE_COL_THRESHOLD = 256;

/**
 * Pure decision: does a table of the given size belong in the large-dataset
 * lane? True when it crosses EITHER the row threshold or the column threshold.
 * No side effects, no I/O, so it is trivially unit-testable and safe to call on
 * the hot import path.
 */
export function isLargeTable(rowCount: number, colCount: number): boolean {
  return (
    rowCount >= LARGE_TABLE_ROW_THRESHOLD ||
    colCount >= LARGE_TABLE_COL_THRESHOLD
  );
}
