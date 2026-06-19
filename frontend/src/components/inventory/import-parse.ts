// Spreadsheet-import parser + mapper for the inventory cold-start flow (the
// "paste your existing spreadsheet" path, mockup 2026-06-07-inventory-import).
// Three pure, fully-tested steps the dialog drives:
//   parseTable(text)        clipboard / CSV text -> { headers, rows }
//   autoMapColumns(headers) fuzzy header match  -> per-column target field
//   buildImportRows(...)    rows + mapping       -> typed item + stock previews
//
// No new dependency: we parse TSV (what Excel / Google Sheets put on the
// clipboard) or comma CSV ourselves, handling simple quoted fields with
// embedded delimiters / newlines well enough for real exports. House style: no
// em-dashes, no emojis, no mid-sentence colons.

import type {
  InventoryCategory,
  InventoryItemCreate,
  InventoryStockCreate,
} from "@/lib/types";
import { dateInputToIso } from "./inventory-ui";

// ── The fixed set of inventory fields a column can map to ────────────────────
// "skip" means the column is ignored. "name" is the only required target.

export type ImportField =
  | "name"
  | "vendor"
  | "catalog_number"
  | "cas"
  | "container_count"
  | "container_label"
  | "expiration_date"
  | "received_date"
  | "lot_number"
  | "location_text"
  | "notes"
  | "product_barcode"
  | "skip";

/** Human label for each mappable field, used by the mapping <select>. Mirrors
 *  the mockup wording. */
export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  name: "Name",
  vendor: "Vendor",
  catalog_number: "Catalog number",
  cas: "CAS number",
  container_count: "Container count",
  container_label: "Container word",
  expiration_date: "Expiration date",
  received_date: "Received date",
  lot_number: "Lot number",
  location_text: "Location",
  notes: "Notes",
  product_barcode: "Product barcode",
  skip: "Skip this column",
};

/** Ordered list for the per-column <select> options. `name` first, `skip` last. */
export const IMPORT_FIELD_ORDER: ImportField[] = [
  "name",
  "vendor",
  "catalog_number",
  "cas",
  "container_count",
  "container_label",
  "expiration_date",
  "received_date",
  "lot_number",
  "location_text",
  "notes",
  "product_barcode",
  "skip",
];

/** A header-index -> field mapping. One entry per parsed column. */
export type ColumnMapping = ImportField[];

// ── Step 1: parse the pasted clipboard text / CSV file ───────────────────────

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/**
 * Decide the delimiter. Excel / Sheets put TSV on the clipboard, so a tab in
 * the first non-empty line wins immediately. Otherwise we fall back to comma
 * (the file-upload CSV path). Semicolon is a common European CSV variant, so we
 * pick it when the first line has semicolons but no commas.
 */
function detectDelimiter(text: string): "\t" | "," | ";" {
  const firstLine = text.split(/\r\n|\r|\n/).find((l) => l.length > 0) ?? "";
  if (firstLine.includes("\t")) return "\t";
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  if (semis > 0 && commas === 0) return ";";
  return ",";
}

/**
 * A delimiter-aware, quote-aware splitter. Walks the whole text once so a
 * quoted field can carry an embedded delimiter OR a newline (the CSV spec).
 * Doubled quotes inside a quoted field ("") become a literal quote. Returns the
 * grid of cells; trailing fully-empty lines are dropped.
 */
function splitGrid(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delim) {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // Normalize CRLF / CR to a single row break.
      if (text[i + 1] === "\n") i += 1;
      pushRow();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Flush the final field / row (no trailing newline).
  if (field.length > 0 || row.length > 0) pushRow();

  // Drop rows that are entirely empty (e.g. a trailing blank line).
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

/**
 * Parse pasted clipboard text or CSV file text into a header row + data rows.
 * Auto-detects TSV vs CSV. Cells are trimmed. The first non-empty line is the
 * header. An empty / header-only paste yields empty `rows`.
 */
export function parseTable(text: string): ParsedTable {
  const normalized = (text ?? "").replace(/^﻿/, ""); // strip BOM
  if (normalized.trim().length === 0) return { headers: [], rows: [] };
  const delim = detectDelimiter(normalized);
  const grid = splitGrid(normalized, delim).map((r) => r.map((c) => c.trim()));
  if (grid.length === 0) return { headers: [], rows: [] };
  const [headerRow, ...dataRows] = grid;
  const headers = headerRow.map((h) => h.trim());
  // Pad / truncate each data row to the header width so the mapping lines up.
  const width = headers.length;
  const rows = dataRows.map((r) => {
    const out = r.slice(0, width);
    while (out.length < width) out.push("");
    return out;
  });
  return { headers, rows };
}

// ── Step 2: auto-map columns by fuzzy header match ───────────────────────────

// Ordered rules. First match wins, so the more specific patterns lead. Each is
// tested against the lower-cased, trimmed header.
const HEADER_RULES: ReadonlyArray<readonly [RegExp, ImportField]> = [
  [/\bcas\b|cas\s*(no|number|#)/, "cas"],
  [/\bcat(alog|alogue)?\b|cat\s*#|cat\.?\s*(no|number)|part\s*(no|number|#)|\bsku\b/, "catalog_number"],
  [/vendor|supplier|brand|manufactur|maker/, "vendor"],
  [/barcode|upc|ean|gtin/, "product_barcode"],
  [/expir|exp\.?\s*date|use\s*by|best\s*before/, "expiration_date"],
  [/received|arriv|date\s*in|acquir/, "received_date"],
  [/lot|batch/, "lot_number"],
  [/location|freezer|fridge|storage|shelf|box|room|position|place/, "location_text"],
  [/count|qty|quantity|vials?|tubes?|bottles?|boxes|plates?|amount\s*on\s*hand|on\s*hand|in\s*stock|number\s*of/, "container_count"],
  [/container|unit\s*type|package|vessel/, "container_label"],
  [/note|comment|remark|description/, "notes"],
  [/name|item|reagent|product|chemical|material|title/, "name"],
];

/** Map a single header string to a field, or "skip" when nothing matches. */
export function autoMapHeader(header: string): ImportField {
  const h = header.trim().toLowerCase();
  if (h.length === 0) return "skip";
  for (const [re, field] of HEADER_RULES) {
    if (re.test(h)) return field;
  }
  return "skip";
}

/**
 * Auto-map every header. If no column matched `name`, promote the first
 * still-unmapped (skipped) column to `name` so the user has a required field to
 * confirm rather than a dead-end. A column already taken by another field is
 * never reused for name. Duplicate non-name matches are allowed (the last write
 * of a field wins in buildImportRows, which is fine for messy real exports).
 */
export function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping = headers.map((h) => autoMapHeader(h));
  if (!mapping.includes("name")) {
    const firstSkip = mapping.indexOf("skip");
    if (firstSkip !== -1) mapping[firstSkip] = "name";
  }
  return mapping;
}

// ── Step 3: build the typed preview rows ─────────────────────────────────────

/** A NEW-item shape without the sharing / owner fields the API fills in. */
export type ImportItemDraft = Pick<
  InventoryItemCreate,
  | "name"
  | "category"
  | "catalog_number"
  | "vendor"
  | "cas"
  | "container_label"
  | "notes"
  | "product_barcode"
>;

/** A first-stock shape without `item_id` (resolved at import time). */
export type ImportStockDraft = Omit<InventoryStockCreate, "item_id">;

export interface ImportRow {
  item: ImportItemDraft;
  stock: ImportStockDraft;
  /** Non-fatal notes shown in the preview (a 0 count, an unparseable date). A
   *  row with the "no name, will skip" issue is excluded from the import. */
  issues: string[];
  /** False when the row has no name and must be skipped. */
  valid: boolean;
}

const ISSUE_NO_NAME = "no name, will skip";

/** Parse a count cell to a non-negative int. Blank defaults to 1; 0 is allowed.
 *  Returns the count plus an optional issue string for the preview. */
function parseCount(raw: string): { count: number; issue: string | null } {
  const v = raw.trim();
  if (v.length === 0) return { count: 1, issue: null };
  // Tolerate "3 vials", "x2", thousands separators.
  const m = v.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return { count: 1, issue: `could not read count "${raw}", using 1` };
  const n = Math.floor(Number(m[0]));
  if (!Number.isFinite(n) || n < 0) {
    return { count: 1, issue: `could not read count "${raw}", using 1` };
  }
  if (n === 0) return { count: 0, issue: null };
  return { count: n, issue: null };
}

// Common spreadsheet date shapes beyond the yyyy-mm-dd that dateInputToIso
// already takes. We normalize to yyyy-mm-dd then hand off to dateInputToIso so
// the storage format matches the rest of inventory.
function toDateInput(raw: string): string | null {
  const v = raw.trim();
  if (v.length === 0) return null;
  // Already yyyy-mm-dd (or yyyy/mm/dd).
  let m = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // mm/dd/yyyy or m/d/yyyy (US) and dd/mm/yyyy ambiguity: assume US month-first,
  // the dominant export format, but fall back to day-first when month > 12.
  m = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3];
    let mo = a;
    let d = b;
    if (a > 12 && b <= 12) {
      mo = b;
      d = a;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  // Anything else (e.g. "Aug 1, 2026"): let Date try, then reformat.
  const parsed = new Date(v);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const mo = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return null;
}

/** Parse one date cell to a stored ISO (or null), plus an optional issue. */
function parseDate(
  raw: string,
  fieldLabel: string,
): { iso: string | null; issue: string | null } {
  const v = raw.trim();
  if (v.length === 0) return { iso: null, issue: null };
  const input = toDateInput(v);
  if (input === null) {
    return { iso: null, issue: `could not read ${fieldLabel} "${raw}"` };
  }
  const iso = dateInputToIso(input);
  if (iso === null) {
    return { iso: null, issue: `could not read ${fieldLabel} "${raw}"` };
  }
  return { iso, issue: null };
}

function nullable(value: string): string | null {
  const v = value.trim();
  return v.length > 0 ? v : null;
}

/**
 * Build typed preview rows from the parsed grid + a column mapping. Each input
 * row becomes one item draft plus one first-stock draft. Counts default to 1
 * (0 allowed), dates are tolerant of common formats, category defaults to
 * "reagent". A row with no mapped / non-empty name gets the ISSUE_NO_NAME issue
 * and is marked invalid (the import skips it).
 *
 * `defaultCategory` lets the dialog offer a category override later; it
 * defaults to "reagent" per the mockup.
 */
export function buildImportRows(
  rows: string[][],
  mapping: ColumnMapping,
  defaultCategory: InventoryCategory = "reagent",
): ImportRow[] {
  // Index of each field in the mapping (last column wins for a duplicated
  // field, which is fine for messy exports).
  const colOf = (field: ImportField): number => mapping.lastIndexOf(field);
  const cellAt = (row: string[], field: ImportField): string => {
    const idx = colOf(field);
    return idx >= 0 && idx < row.length ? (row[idx] ?? "") : "";
  };

  return rows.map((row) => {
    const issues: string[] = [];
    const name = cellAt(row, "name").trim();

    const { count, issue: countIssue } = parseCount(cellAt(row, "container_count"));
    if (countIssue) issues.push(countIssue);
    if (count === 0) issues.push("count is 0, stock will read empty");

    const exp = parseDate(cellAt(row, "expiration_date"), "expiration date");
    if (exp.issue) issues.push(exp.issue);
    const rec = parseDate(cellAt(row, "received_date"), "received date");
    if (rec.issue) issues.push(rec.issue);

    const item: ImportItemDraft = {
      name,
      category: defaultCategory,
      catalog_number: nullable(cellAt(row, "catalog_number")),
      vendor: nullable(cellAt(row, "vendor")),
      cas: nullable(cellAt(row, "cas")),
      container_label: nullable(cellAt(row, "container_label")),
      notes: nullable(cellAt(row, "notes")),
      product_barcode: nullable(cellAt(row, "product_barcode")),
    };

    const stock: ImportStockDraft = {
      container_count: count,
      expiration_date: exp.iso,
      received_date: rec.iso,
      lot_number: nullable(cellAt(row, "lot_number")),
      location_text: nullable(cellAt(row, "location_text")),
    };

    const valid = name.length > 0;
    if (!valid) issues.unshift(ISSUE_NO_NAME);

    return { item, stock, issues, valid };
  });
}

// ── Merge-don't-duplicate matching ───────────────────────────────────────────

/** A normalized key for matching an import row to an existing item, so a
 *  re-imported reagent merges as a new stock instead of duplicating. Matches on
 *  name + catalog number, both case-folded and whitespace-collapsed. Catalog is
 *  part of the key only when present on BOTH sides, so two different lots of the
 *  same name without catalogs still merge by name. */
export function matchKey(
  name: string | null | undefined,
  catalog: string | null | undefined,
): string {
  const n = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const c = (catalog ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return c.length > 0 ? `${n} ${c}` : n;
}

/** Count how many valid import rows would merge into an existing item vs create
 *  a new one, for the after-summary preview. `existing` is the set of match
 *  keys already in the inventory. Pure, so it is unit-testable without the API. */
export function summarizeMerge(
  rows: ImportRow[],
  existingKeys: Set<string>,
): { newItems: number; mergedStocks: number } {
  let newItems = 0;
  let mergedStocks = 0;
  // Track keys created within THIS import so two rows of the same new item also
  // collapse to one item + two stocks (not two items).
  const seen = new Set<string>(existingKeys);
  for (const r of rows) {
    if (!r.valid) continue;
    const key = matchKey(r.item.name, r.item.catalog_number);
    if (seen.has(key)) {
      mergedStocks += 1;
    } else {
      newItems += 1;
      seen.add(key);
    }
  }
  return { newItems, mergedStocks };
}
