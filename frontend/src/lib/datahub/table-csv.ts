// table-csv (datahub-chrome). A small, correct CSV serializer for a Data Hub
// table, so the workspace toolbar can export or copy the open table without a
// backend round-trip. It reads the document content's columns + rows directly,
// so it works for every table archetype (column / xy / grouped / survival): the
// header row is the column names, each data row is the cell values in column
// order, with a leading row-number column to match the on-screen grid.
//
// CSV quoting follows RFC 4180: a field is wrapped in double quotes when it
// contains a comma, a quote, or a newline, and embedded quotes are doubled.
// Numbers serialize as their plain string; null / undefined become an empty
// field, so a blank replicate reads as a blank cell, not the literal "null".
//
// No em-dashes, no emojis, no mid-sentence colons.

import type { CellValue, DataHubDocContent } from "@/lib/datahub/model/types";
import { stripControlChars } from "@/lib/validation/input-hardening";

/** Quote one CSV field per RFC 4180 (only when it needs it). */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** A cell's CSV text. null / undefined is an empty field; numbers stay plain.
 *  String cells have hostile control/directional chars stripped (RTL-override,
 *  null bytes, zero-width chars) so they cannot appear verbatim in a CSV text
 *  cell. HTML special chars are NOT escaped here: CSV uses RFC 4180 quoting for
 *  commas/quotes/newlines -- HTML-escaping would corrupt the data on import. */
function cellText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return typeof value === "string" ? stripControlChars(s) : s;
}

/**
 * Serialize the open table content to a CSV string. The first column is a 1-based
 * row number (matching the grid's leading "#" column); the remaining columns are
 * the table's columns in their declared order, headed by their names.
 */
export function tableContentToCsv(content: DataHubDocContent): string {
  // Strip hostile control / directional chars from user-supplied column names
  // before they go into the CSV header row. RFC 4180 quoting handles commas,
  // quotes, and newlines -- do NOT HTML-escape for CSV (that would corrupt the
  // data; use sanitizeForExport only for HTML/PDF/GenBank sinks).
  const header = ["#", ...content.columns.map((c) => stripControlChars(c.name))];
  const lines: string[] = [header.map(csvField).join(",")];
  content.rows.forEach((row, i) => {
    const fields = [
      String(i + 1),
      ...content.columns.map((c) => cellText(row.cells[c.id])),
    ];
    lines.push(fields.map(csvField).join(","));
  });
  // A trailing newline keeps the file POSIX-clean and round-trips through Excel.
  return lines.join("\r\n") + "\r\n";
}

/** A filesystem-safe slug for a table name, for the download filename. */
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "table";
}

/**
 * Trigger a browser download of the CSV for a table. Builds a Blob and clicks a
 * transient anchor, then revokes the object URL so nothing leaks. Browser-only,
 * so callers should guard against SSR (the toolbar action is client-side).
 */
export function downloadCsv(content: DataHubDocContent, name: string): void {
  if (typeof document === "undefined") return;
  const csv = tableContentToCsv(content);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(name)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
