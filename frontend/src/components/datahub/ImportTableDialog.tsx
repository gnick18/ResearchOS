"use client";

// Import data dialog (Data Hub import slice). Brings spreadsheet data into a new
// Column table three ways:
//   - paste straight from Excel or Google Sheets (the clipboard is tab-separated
//     text),
//   - pick a .csv / .tsv / .txt file (read as text), or
//   - pick a binary .xlsx / .xls / .xlsm workbook (read with exceljs, loaded
//     lazily so the reader only ships when someone actually imports one).
// A live preview of the detected table lets the user confirm the shape, with a
// "first row is header" toggle and a "transpose" toggle for the common case where
// the paste arrives in the wrong orientation. A workbook with more than one sheet
// adds a sheet picker, since one file can hold several tables. On confirm the page
// seeds a Column table through the same api / store mutators a fresh table uses.
//
// Honest scope for workbooks: we read the cell values and formula results and
// re-plot natively. Embedded Excel charts and cell styles are not preserved, so a
// workbook brings in its numbers and the user re-creates the graph in Data Hub.
//
// House style: a popup reads as a contained surface (bg-surface-overlay + border),
// the primary CTA uses .bg-brand-action text-white transition-colors hover:bg-brand-action/90, <Icon> only, no emojis / em-dashes /
// mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import FileDropzone from "@/components/ui/FileDropzone";
import type { Project } from "@/lib/types";
import type { ColumnDef, RowRecord } from "@/lib/datahub/model/types";
import { importTextToTable, isXlsxFile } from "@/lib/datahub/import-table";
import {
  parseXlsx,
  detectSheetTable,
  type SheetGrid,
} from "@/lib/datahub/import-xlsx";

export interface ImportTableSubmit {
  name: string;
  /** "" means Unfiled (no project link); otherwise a stringified project id. */
  collectionId: string;
  columns: ColumnDef[];
  rows: RowRecord[];
}

/** How many preview rows to render so a big paste does not blow up the dialog. */
const PREVIEW_ROWS = 8;

export default function ImportTableDialog({
  open,
  projects,
  defaultCollectionId,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  projects: Project[];
  /** Pre-select this collection (the active rail filter), "" for Unfiled. */
  defaultCollectionId: string;
  onCancel: () => void;
  onSubmit: (data: ImportTableSubmit) => void;
}) {
  const [name, setName] = useState("");
  const [collectionId, setCollectionId] = useState(defaultCollectionId);
  const [text, setText] = useState("");
  // null = auto-detect the header; true / false = the user overrode it.
  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null);
  const [transpose, setTranspose] = useState(false);
  const [fileNote, setFileNote] = useState<string | null>(null);
  // Workbook source: the parsed sheets (empty when the source is text / paste),
  // the index of the chosen sheet, and a busy flag while exceljs loads + parses.
  const [sheets, setSheets] = useState<SheetGrid[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [xlsxBusy, setXlsxBusy] = useState(false);

  // Reset the form each open so a prior draft never lingers, and seed the
  // collection from the active rail filter.
  useEffect(() => {
    if (open) {
      setName("");
      setCollectionId(defaultCollectionId);
      setText("");
      setHeaderOverride(null);
      setTranspose(false);
      setFileNote(null);
      setSheets([]);
      setSheetIndex(0);
      setXlsxBusy(false);
    }
  }, [open, defaultCollectionId]);

  // Escape closes the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  // The active workbook sheet (null when the source is text / paste). Clamped so
  // a stale index from a previous file never points past the current sheet list.
  const activeSheet =
    sheets.length > 0
      ? sheets[Math.min(sheetIndex, sheets.length - 1)] ?? null
      : null;

  // The detected table, recomputed live as the source / toggles change. A
  // workbook runs the SAME detectTable on the chosen sheet's grid that the text
  // path runs after parsing, so header and type detection are identical. The
  // header is auto-detected unless the user overrode it.
  const detected = useMemo(() => {
    if (activeSheet) {
      return detectSheetTable(activeSheet.grid, {
        header: headerOverride ?? undefined,
        transpose,
      });
    }
    if (text.trim() === "") return null;
    return importTextToTable(text, {
      header: headerOverride ?? undefined,
      transpose,
    });
  }, [activeSheet, text, headerOverride, transpose]);

  // The effective header reading (the auto value when not overridden) so the
  // toggle shows the right state even before the user touches it.
  const headerChecked = headerOverride ?? detected?.headerUsed ?? false;

  // Surface multi-block sheets honestly: a blank row inside the body usually
  // means several tables were pasted at once, which this importer brings in as
  // one wide table rather than splitting.
  const hasBlankBodyRow = useMemo(() => {
    if (!detected) return false;
    return detected.rows.some((r) =>
      Object.values(r.cells).every((v) => v === null),
    );
  }, [detected]);

  if (!open) return null;

  // Seed the table name from the file name (minus extension) when the user has
  // not typed one yet, so an import lands with a sensible default name.
  const seedNameFromFile = (file: File) => {
    if (name.trim() !== "") return;
    const base = file.name.replace(/\.[^.]+$/, "").trim();
    if (base !== "") setName(base);
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setFileNote(null);

    if (isXlsxFile(file)) {
      // Binary workbook: read the bytes and parse with exceljs (loaded lazily by
      // parseXlsx, so the reader only downloads on a real workbook import).
      setXlsxBusy(true);
      setSheets([]);
      setText("");
      try {
        const buffer = await file.arrayBuffer();
        const workbook = await parseXlsx(buffer);
        const usable = workbook.sheets.filter((s) => s.grid.length > 0);
        if (usable.length === 0) {
          setFileNote(
            "This workbook has no cell data to import. Add some rows in Excel, or paste the cells above.",
          );
          return;
        }
        setSheets(usable);
        setSheetIndex(0);
        setHeaderOverride(null);
        setTranspose(false);
        seedNameFromFile(file);
      } catch {
        setFileNote(
          "This file could not be read as an Excel workbook. Try saving it again as .xlsx, or save it as CSV and pick that instead.",
        );
      } finally {
        setXlsxBusy(false);
      }
      return;
    }

    // Text source (CSV / TSV / TXT): read as text and clear any workbook state.
    const content = await file.text();
    setSheets([]);
    setText(content);
    setHeaderOverride(null);
    setTranspose(false);
    seedNameFromFile(file);
  };

  const trimmedName = name.trim();
  const canSubmit =
    trimmedName.length > 0 &&
    !!detected &&
    detected.columns.length > 0 &&
    detected.rows.length > 0;

  const submit = () => {
    if (!canSubmit || !detected) return;
    onSubmit({
      name: trimmedName,
      collectionId,
      columns: detected.columns,
      rows: detected.rows,
    });
  };

  const previewRows = detected ? detected.rows.slice(0, PREVIEW_ROWS) : [];
  const extraRows =
    detected && detected.rows.length > PREVIEW_ROWS
      ? detected.rows.length - PREVIEW_ROWS
      : 0;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      data-testid="datahub-import-dialog"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import data"
        className="relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-surface-overlay shadow-xl"
      >
        <div className="border-b border-border px-5 pb-4 pt-5">
          <h2 className="text-title font-semibold text-foreground">Import data</h2>
          <p className="mt-1 text-meta text-foreground-muted">
            Paste cells straight from Excel or Google Sheets, or pick a CSV file.
            You enter the numbers once, then the summary and any graph read from
            the new table live.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Name
              </label>
              <input
                type="text"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder="Cell viability assay"
                className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-body text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Collection
              </label>
              <select
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
              >
                <option value="">Unfiled</option>
                {projects.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="mt-4 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
            Paste from Excel or Google Sheets
          </label>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileNote(null);
              // Typing or pasting takes over from a previously picked workbook.
              if (sheets.length > 0) setSheets([]);
            }}
            rows={5}
            placeholder={
              "Copy a block of cells and paste here.\nControl\tDrug A\n10\t55\n20\t60"
            }
            data-testid="datahub-import-paste"
            className="mt-1 w-full resize-y rounded-md border border-border bg-surface-raised px-2.5 py-2 font-mono text-meta text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
          />

          <div className="mt-2">
            <FileDropzone
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain,.xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onFiles={(files) => {
                void handleFile(files[0] ?? null);
              }}
              onReject={(message) => setFileNote(message)}
              disabled={xlsxBusy}
              label={xlsxBusy ? "Reading workbook..." : undefined}
              hint="CSV, TSV, Excel"
              ariaLabel="Choose a file to import"
            />
            <p className="mt-2 text-meta text-foreground-muted">
              CSV, TSV, TXT, or an Excel workbook (.xlsx). Everything is read in
              the browser, your data never leaves your machine.
            </p>
          </div>

          {fileNote && (
            <p
              className="mt-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground-muted"
              data-testid="datahub-import-xlsx-note"
            >
              {fileNote}
            </p>
          )}

          {sheets.length > 1 && (
            <div className="mt-4" data-testid="datahub-import-sheet-picker">
              <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Sheet
              </label>
              <select
                value={sheetIndex}
                onChange={(e) => {
                  setSheetIndex(Number(e.target.value));
                  // A different sheet is a different table, so re-detect fresh.
                  setHeaderOverride(null);
                  setTranspose(false);
                }}
                data-testid="datahub-import-sheet-select"
                className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
              >
                {sheets.map((s, i) => (
                  <option key={`${s.name}-${i}`} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-meta text-foreground-muted">
                This workbook has more than one sheet. Pick the one to import. You
                can import the others into their own tables afterward.
              </p>
            </div>
          )}

          {detected && detected.columns.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap items-center gap-4">
                <span className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
                  Preview
                </span>
                <label className="flex items-center gap-1.5 text-meta text-foreground">
                  <input
                    type="checkbox"
                    checked={headerChecked}
                    onChange={(e) => setHeaderOverride(e.target.checked)}
                    data-testid="datahub-import-header-toggle"
                  />
                  First row is a header
                </label>
                <label className="flex items-center gap-1.5 text-meta text-foreground">
                  <input
                    type="checkbox"
                    checked={transpose}
                    onChange={(e) => setTranspose(e.target.checked)}
                    data-testid="datahub-import-transpose-toggle"
                  />
                  Transpose (swap rows and columns)
                </label>
              </div>

              <div className="overflow-auto rounded-lg border border-border">
                <table
                  className="border-collapse text-meta tabular-nums"
                  data-testid="datahub-import-preview"
                >
                  <thead>
                    <tr>
                      <th className="border border-border bg-surface-sunken px-2 py-1 text-meta font-medium text-foreground-muted">
                        #
                      </th>
                      {detected.columns.map((col) => (
                        <th
                          key={col.id}
                          className="min-w-[72px] border border-border bg-surface-sunken px-2 py-1 text-center text-meta font-semibold text-foreground"
                        >
                          {col.name}
                          <span className="ml-1 font-normal text-foreground-muted">
                            {col.dataType === "number" ? "num" : "text"}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, r) => (
                      <tr key={row.id}>
                        <td className="border border-border bg-surface-sunken px-2 py-0.5 text-center text-meta text-foreground-muted">
                          {r + 1}
                        </td>
                        {detected.columns.map((col) => {
                          const v = row.cells[col.id];
                          return (
                            <td
                              key={col.id}
                              className="border border-border bg-surface-raised px-2 py-0.5 text-center text-foreground"
                            >
                              {v === null || v === undefined ? "" : String(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-2 text-meta text-foreground-muted">
                {detected.columns.length}{" "}
                {detected.columns.length === 1 ? "column" : "columns"} and{" "}
                {detected.rows.length}{" "}
                {detected.rows.length === 1 ? "row" : "rows"} detected
                {extraRows > 0 ? `, showing the first ${PREVIEW_ROWS}` : ""}.
              </p>

              {hasBlankBodyRow && (
                <p className="mt-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground-muted">
                  This block has a blank row in the middle, so it may hold more
                  than one table. Import brings it in as one wide table. Delete the
                  rows you do not want after it lands, or paste each table on its
                  own.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="ros-btn-neutral px-3 py-1.5 text-body font-medium text-foreground-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-3 py-1.5 text-body font-medium disabled:opacity-50"
            data-testid="datahub-import-create"
          >
            Create table
          </button>
        </div>
      </div>
    </div>
  );
}
