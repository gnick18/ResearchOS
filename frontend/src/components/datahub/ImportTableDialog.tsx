"use client";

// Import data dialog (Data Hub import slice). Brings spreadsheet data into a new
// Column table two ways, both needing zero new dependencies:
//   - paste straight from Excel or Google Sheets (the clipboard is tab-separated
//     text), or
//   - pick a .csv / .tsv / .txt file (read as text).
// A live preview of the detected table lets the user confirm the shape, with a
// "first row is header" toggle and a "transpose" toggle for the common case where
// the paste arrives in the wrong orientation. On confirm the page seeds a Column
// table through the same api / store mutators a fresh table uses.
//
// A binary .xlsx workbook is NOT parsed here (it needs a binary reader, a
// deferred follow-up); picking one shows a friendly "save as CSV or paste"
// message instead.
//
// House style: a popup reads as a contained surface (bg-surface-overlay + border),
// the primary CTA uses .btn-brand, <Icon> only, no emojis / em-dashes /
// mid-sentence colons.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "@/lib/types";
import type { ColumnDef, RowRecord } from "@/lib/datahub/model/types";
import {
  importTextToTable,
  isXlsxFile,
  XLSX_COMING_SOON_MESSAGE,
} from "@/lib/datahub/import-table";

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  // The detected table, recomputed live as the text / toggles change. Auto-detect
  // the header unless the user overrode it.
  const detected = useMemo(() => {
    if (text.trim() === "") return null;
    return importTextToTable(text, {
      header: headerOverride ?? undefined,
      transpose,
    });
  }, [text, headerOverride, transpose]);

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

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setFileNote(null);
    if (isXlsxFile(file)) {
      setFileNote(XLSX_COMING_SOON_MESSAGE);
      return;
    }
    const content = await file.text();
    setText(content);
    setHeaderOverride(null);
    setTranspose(false);
    // Seed the table name from the file name (minus extension) when the user has
    // not typed one yet, so a CSV import lands with a sensible default name.
    if (name.trim() === "") {
      const base = file.name.replace(/\.[^.]+$/, "").trim();
      if (base !== "") setName(base);
    }
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
            }}
            rows={5}
            placeholder={
              "Copy a block of cells and paste here.\nControl\tDrug A\n10\t55\n20\t60"
            }
            data-testid="datahub-import-paste"
            className="mt-1 w-full resize-y rounded-md border border-border bg-surface-raised px-2.5 py-2 font-mono text-meta text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
          />

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
            >
              Choose CSV file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain,.xlsx,.xls"
              className="hidden"
              data-testid="datahub-import-file"
              onChange={(e) => {
                void handleFile(e.target.files?.[0] ?? null);
                // Allow re-picking the same file.
                e.currentTarget.value = "";
              }}
            />
            <span className="text-meta text-foreground-muted">
              CSV, TSV, or TXT. Reads as text, your data never leaves the browser.
            </span>
          </div>

          {fileNote && (
            <p
              className="mt-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground-muted"
              data-testid="datahub-import-xlsx-note"
            >
              {fileNote}
            </p>
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
            className="rounded-md border border-border px-3 py-1.5 text-body font-medium text-foreground-muted hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="btn-brand rounded-md px-3 py-1.5 text-body font-medium disabled:opacity-50"
            data-testid="datahub-import-create"
          >
            Create table
          </button>
        </div>
      </div>
    </div>
  );
}
