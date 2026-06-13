// datahub/bigtable/label-columns.ts
//
// Which dataset columns may be offered as a discrete grouping LABEL for the
// "split by a label" control on the dataset-lane figure dialog (DatasetPlotDialog).
//
// A grouping label is a categorical column with a small set of repeated values
// (treatment, operator, plate). Two kinds of column must NOT be offered:
//   - numeric columns (those are the value / x columns, never a label),
//   - date columns (a date is continuous, not a discrete category).
//
// The date case is the subtle one: a raw CSV date column is profiled as "text"
// (it only becomes a real "date" type after a parse-date recipe op), so it can't
// be excluded by its schema type alone. We detect it from the column's sample
// values instead, which keeps a continuous date out of the picker without
// excluding a legitimate high-cardinality categorical (a plate well, an id).
//
// No em-dashes, no emojis, no mid-sentence colons.

import type { DatasetColumn } from "./types";

// YYYY-MM-DD / YYYY/MM/DD (optionally a trailing time) or MM-DD-YYYY / MM/DD/YYYY.
const DATE_LIKE =
  /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T].*)?$|^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/;

/**
 * A column reads as date-like when it has at least one non-empty sample and every
 * non-empty sample matches a date shape. An empty sample set returns false (do not
 * over-exclude when we have nothing to judge by).
 */
export function looksLikeDateColumn(col: DatasetColumn): boolean {
  const vals = col.sample
    .filter((v) => v !== null && v !== undefined)
    .map((v) => String(v).trim())
    .filter((v) => v !== "");
  if (vals.length === 0) return false;
  return vals.every((v) => DATE_LIKE.test(v));
}

/**
 * The names of columns usable as a "split by a label" grouping label: text
 * columns that are not date-like. Numeric and date columns are excluded.
 */
export function labelColumnNames(schema: DatasetColumn[]): string[] {
  return schema
    .filter((c) => c.type === "text" && !looksLikeDateColumn(c))
    .map((c) => c.name);
}
