"use client";

// Bulk spreadsheet import for inventory (the cold-start path, mockup
// 2026-06-07-inventory-import). Three steps inside a LivingPopup:
//   1. Paste   a textarea (Excel / Sheets clipboard TSV) OR a CSV file upload.
//   2. Map     auto-mapped columns with a per-column <select> override; Name
//              is required.
//   3. Preview a typed table with per-row issues, plus the merge-don't-
//              duplicate toggle, then import.
// After import a summary card reports items added / stocks created / skipped.
//
// All parsing is local (import-parse.ts); nothing leaves the machine. Writes go
// through inventoryItemsApi / inventoryStocksApi only. House style: <Icon>
// only, brand + semantic dark-mode tokens, Tooltip on icon-only buttons, no
// emojis / em-dashes / mid-sentence colons.

import { useMemo, useState } from "react";

import { Icon } from "@/components/icons";
import FileDropzone from "@/components/ui/FileDropzone";
import { inventoryItemsApi, inventoryStocksApi } from "@/lib/local-api";
import type { InventoryItem } from "@/lib/types";
import {
  IMPORT_FIELD_LABEL,
  IMPORT_FIELD_ORDER,
  autoMapColumns,
  buildImportRows,
  matchKey,
  parseTable,
} from "./import-parse";
import type {
  ColumnMapping,
  ImportField,
  ImportRow,
} from "./import-parse";
import { containerCountLabel, formatDate } from "./inventory-ui";

interface ImportInventoryDialogProps {
  /** Existing items, used for the merge-don't-duplicate match (by name +
   *  catalog). Pass the user's own items (not shared-in records). */
  existingItems: InventoryItem[];
  onCancel: () => void;
  /** Called after a successful import so the page can invalidate its queries. */
  onDone: () => void;
}

type Step = "paste" | "map" | "preview" | "result";

interface ImportResult {
  itemsAdded: number;
  stocksCreated: number;
  skipped: number;
}

const SAMPLE = `Name\tVendor\tCatalog #\tVials\tExpires\tLocation
Q5 Polymerase\tNEB\tM0491S\t3\t2026-08-01\t-80 door, left
Taq Polymerase\tNEB\tM0273S\t2\t2026-09-12\t-20 shelf 2
Ampicillin\tSigma\tA9518\t0\t2027-01-01\t4C fridge B`;

export default function ImportInventoryDialog({
  existingItems,
  onCancel,
  onDone,
}: ImportInventoryDialogProps) {
  const [step, setStep] = useState<Step>("paste");
  const [text, setText] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [mergeExisting, setMergeExisting] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const parsed = useMemo(() => parseTable(text), [text]);

  // Existing match keys for the merge toggle, computed from the user's items.
  const existingKeys = useMemo(() => {
    const set = new Set<string>();
    for (const it of existingItems) {
      set.add(matchKey(it.name, it.catalog_number));
    }
    return set;
  }, [existingItems]);

  // The typed preview, rebuilt whenever the mapping changes on the map / preview
  // steps.
  const previewRows = useMemo<ImportRow[]>(() => {
    if (parsed.rows.length === 0 || mapping.length === 0) return [];
    return buildImportRows(parsed.rows, mapping);
  }, [parsed.rows, mapping]);

  const validRows = useMemo(
    () => previewRows.filter((r) => r.valid),
    [previewRows],
  );
  const skippedCount = previewRows.length - validRows.length;
  const nameMapped = mapping.includes("name");

  // ── Step transitions ───────────────────────────────────────────────────────
  const goToMap = () => {
    setError(null);
    if (parsed.headers.length === 0) {
      setError("Paste a spreadsheet with a header row, or choose a CSV file.");
      return;
    }
    if (parsed.rows.length === 0) {
      setError("No data rows found below the header.");
      return;
    }
    setMapping(autoMapColumns(parsed.headers));
    setStep("map");
  };

  const goToPreview = () => {
    setError(null);
    if (!nameMapped) {
      setError("Map one column to Name before continuing.");
      return;
    }
    setStep("preview");
  };

  const loadSample = () => {
    setText(SAMPLE);
    setError(null);
  };

  const onFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(typeof reader.result === "string" ? reader.result : "");
      setError(null);
    };
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  };

  const setColumn = (index: number, field: ImportField) => {
    setMapping((prev) => {
      const next = [...prev];
      next[index] = field;
      return next;
    });
  };

  // ── Import execution ───────────────────────────────────────────────────────
  const runImport = async () => {
    setImporting(true);
    setError(null);
    try {
      // Resolve the merge target. Start from the existing items keyed by
      // name+catalog; add items created during THIS run so two rows of the same
      // new item collapse to one item + two stocks.
      const itemIdByKey = new Map<string, number>();
      if (mergeExisting) {
        for (const it of existingItems) {
          itemIdByKey.set(matchKey(it.name, it.catalog_number), it.id);
        }
      }

      let itemsAdded = 0;
      let stocksCreated = 0;

      for (const row of validRows) {
        const key = matchKey(row.item.name, row.item.catalog_number);
        let itemId = mergeExisting ? itemIdByKey.get(key) : undefined;

        if (itemId === undefined) {
          const created = await inventoryItemsApi.create({
            name: row.item.name,
            category: row.item.category,
            catalog_number: row.item.catalog_number ?? null,
            vendor: row.item.vendor ?? null,
            cas: row.item.cas ?? null,
            container_label: row.item.container_label ?? null,
            notes: row.item.notes ?? null,
            product_barcode: row.item.product_barcode ?? null,
          });
          itemId = created.id;
          itemsAdded += 1;
          // So a later row of the same new item merges as a stock.
          itemIdByKey.set(key, itemId);
        }

        await inventoryStocksApi.create({
          item_id: itemId,
          container_count: row.stock.container_count,
          expiration_date: row.stock.expiration_date ?? null,
          received_date: row.stock.received_date ?? null,
          lot_number: row.stock.lot_number ?? null,
          location_text: row.stock.location_text ?? null,
        });
        stocksCreated += 1;
      }

      setResult({ itemsAdded, stocksCreated, skipped: skippedCount });
      setStep("result");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not finish the import.",
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-6 sm:p-7">
      <h2 className="text-title font-semibold text-foreground">
        {step === "result" ? "Imported" : "Import inventory"}
      </h2>

      {step !== "result" && <StepStrip step={step} />}

      {error && (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-meta text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      )}

      {step === "paste" && (
        <PasteStep
          text={text}
          onText={setText}
          onLoadSample={loadSample}
          onFile={onFile}
          onReject={setError}
        />
      )}

      {step === "map" && (
        <MapStep
          headers={parsed.headers}
          sampleRow={parsed.rows[0] ?? []}
          autoMapped={autoMapColumns(parsed.headers)}
          mapping={mapping}
          onSetColumn={setColumn}
        />
      )}

      {step === "preview" && (
        <PreviewStep
          rows={previewRows}
          validCount={validRows.length}
          skippedCount={skippedCount}
          mergeExisting={mergeExisting}
          onToggleMerge={setMergeExisting}
          existingKeys={existingKeys}
        />
      )}

      {step === "result" && result && (
        <ResultStep result={result} />
      )}

      {/* Footer actions */}
      <div className="mt-6 flex items-center justify-between gap-2">
        {step === "paste" && (
          <>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-border px-4 py-2 text-body text-foreground hover:bg-surface-sunken"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={goToMap}
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-body"
            >
              Next, map columns
              <Icon name="chevronRight" className="h-4 w-4" />
            </button>
          </>
        )}

        {step === "map" && (
          <>
            <button
              type="button"
              onClick={() => setStep("paste")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-body text-foreground hover:bg-surface-sunken"
            >
              <Icon name="chevronLeft" className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={goToPreview}
              disabled={!nameMapped}
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-body disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next, preview
              <Icon name="chevronRight" className="h-4 w-4" />
            </button>
          </>
        )}

        {step === "preview" && (
          <>
            <button
              type="button"
              onClick={() => setStep("map")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-body text-foreground hover:bg-surface-sunken"
            >
              <Icon name="chevronLeft" className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={runImport}
              disabled={importing || validRows.length === 0}
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-body disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="check" className="h-4 w-4" />
              {importing
                ? "Importing."
                : `Import ${validRows.length} item${
                    validRows.length === 1 ? "" : "s"
                  }`}
            </button>
          </>
        )}

        {step === "result" && (
          <button
            type="button"
            onClick={onDone}
            className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 mx-auto inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-body"
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}

// ── Step strip (1 Paste, 2 Map, 3 Preview) ───────────────────────────────────
function StepStrip({ step }: { step: Step }) {
  const order: Step[] = ["paste", "map", "preview"];
  const current = order.indexOf(step);
  const labels: Record<string, string> = {
    paste: "Paste",
    map: "Map columns",
    preview: "Preview",
  };
  return (
    <div className="mt-3 flex items-center gap-2 text-meta text-foreground-muted">
      {order.map((s, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <span key={s} className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1.5 ${
                on ? "font-semibold text-brand-action" : ""
              }`}
            >
              <span
                className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[10px] ${
                  on
                    ? "border-brand-action bg-brand-action text-white"
                    : done
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-border"
                }`}
              >
                {done ? <Icon name="check" className="h-2.5 w-2.5" /> : i + 1}
              </span>
              {labels[s]}
            </span>
            {i < order.length - 1 && (
              <span className="h-px w-3.5 bg-border" />
            )}
          </span>
        );
      })}
    </div>
  );
}

// ── Step 1: paste ────────────────────────────────────────────────────────────
function PasteStep({
  text,
  onText,
  onLoadSample,
  onFile,
  onReject,
}: {
  text: string;
  onText: (v: string) => void;
  onLoadSample: () => void;
  onFile: (f: File | null) => void;
  onReject: (message: string) => void;
}) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-meta text-foreground-muted">
        Copy your inventory rows in Excel or Google Sheets, including the header
        row, then paste here. The first row is the column names.
      </p>
      <textarea
        value={text}
        onChange={(e) => onText(e.target.value)}
        placeholder="Paste your spreadsheet rows here."
        className="min-h-[140px] w-full rounded-lg border border-dashed border-border bg-surface-sunken px-3 py-3 font-mono text-[12px] text-foreground placeholder:text-foreground-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-action"
        spellCheck={false}
      />

      <div className="my-3 flex items-center gap-3 text-meta text-foreground-muted">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <FileDropzone
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
        onFiles={(files) => onFile(files[0] ?? null)}
        onReject={onReject}
        label="Choose a CSV file"
        hint="CSV, TSV"
      />

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-meta text-emerald-700 dark:text-emerald-300">
          <Icon name="check" className="h-3.5 w-3.5" />
          Your spreadsheet never leaves your computer. Parsed locally.
        </p>
        <button
          type="button"
          onClick={onLoadSample}
          className="shrink-0 text-meta font-medium text-brand-action hover:underline"
        >
          Load sample
        </button>
      </div>
    </div>
  );
}

// ── Step 2: map columns ──────────────────────────────────────────────────────
function MapStep({
  headers,
  sampleRow,
  autoMapped,
  mapping,
  onSetColumn,
}: {
  headers: string[];
  sampleRow: string[];
  autoMapped: ColumnMapping;
  mapping: ColumnMapping;
  onSetColumn: (index: number, field: ImportField) => void;
}) {
  return (
    <div className="mt-4">
      <p className="mb-3 text-meta text-foreground-muted">
        We auto-matched by header. Adjust any that look wrong. Only Name is
        required.
      </p>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-meta">
          <thead>
            <tr className="bg-surface-sunken text-foreground-muted">
              <th className="px-3 py-2 text-left font-semibold">Your column</th>
              <th className="px-3 py-2 text-left font-semibold">Sample</th>
              <th className="px-3 py-2 text-left font-semibold">Maps to</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((header, i) => {
              const field = mapping[i] ?? "skip";
              const wasAuto =
                autoMapped[i] !== "skip" && field === autoMapped[i];
              return (
                <tr
                  key={`${header}-${i}`}
                  className="border-t border-border align-middle"
                >
                  <td className="px-3 py-2 text-foreground">
                    {header || <span className="text-foreground-muted">(blank)</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-foreground-muted">
                    {sampleRow[i] || ""}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={field}
                        onChange={(e) =>
                          onSetColumn(i, e.target.value as ImportField)
                        }
                        className="rounded-md border border-border bg-surface px-2 py-1 text-meta text-foreground focus:outline-none focus:ring-2 focus:ring-brand-action"
                      >
                        {IMPORT_FIELD_ORDER.map((f) => (
                          <option key={f} value={f}>
                            {IMPORT_FIELD_LABEL[f]}
                          </option>
                        ))}
                      </select>
                      {field === "name" ? (
                        <span className="text-[11px] text-rose-600 dark:text-rose-300">
                          required
                        </span>
                      ) : wasAuto ? (
                        <span className="text-[11px] text-emerald-700 dark:text-emerald-300">
                          auto
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-meta text-foreground-muted">
        Unmapped fields just stay empty, the count-first model is fine with
        that. Default category is Reagent.
      </p>
    </div>
  );
}

// ── Step 3: preview ──────────────────────────────────────────────────────────
function PreviewStep({
  rows,
  validCount,
  skippedCount,
  mergeExisting,
  onToggleMerge,
  existingKeys,
}: {
  rows: ImportRow[];
  validCount: number;
  skippedCount: number;
  mergeExisting: boolean;
  onToggleMerge: (v: boolean) => void;
  existingKeys: Set<string>;
}) {
  // When merge is OFF, a row whose name+catalog already exists will create a
  // fully duplicate item. Flag those so the duplication is visible before the
  // user commits (we never block, just warn).
  const isDuplicateRow = (row: ImportRow) =>
    !mergeExisting &&
    row.valid &&
    existingKeys.has(matchKey(row.item.name, row.item.catalog_number));
  const duplicateCount = rows.filter(isDuplicateRow).length;

  return (
    <div className="mt-4">
      <p className="mb-3 text-meta text-foreground-muted">
        {validCount} item{validCount === 1 ? "" : "s"} ready
        {skippedCount > 0
          ? `, ${skippedCount} row${skippedCount === 1 ? "" : "s"} skipped`
          : ""}
        . Each row becomes an item plus one stock.
      </p>

      {duplicateCount > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-meta text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <Icon name="alert" className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            {duplicateCount} item{duplicateCount === 1 ? "" : "s"} already exist
            {duplicateCount === 1 ? "s" : ""} in your inventory, importing
            anyway. Turn on merge below to add new stock instead of duplicates.
          </span>
        </div>
      )}
      <div className="max-h-[280px] overflow-auto rounded-lg border border-border">
        <table className="w-full text-meta">
          <thead className="sticky top-0">
            <tr className="bg-surface-sunken text-foreground-muted">
              <th className="px-3 py-2 text-left font-semibold">Name</th>
              <th className="px-3 py-2 text-left font-semibold">Vendor</th>
              <th className="px-3 py-2 text-left font-semibold">Count</th>
              <th className="px-3 py-2 text-left font-semibold">Expires</th>
              <th className="px-3 py-2 text-left font-semibold">Location</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className={`border-t border-border ${
                  row.valid ? "" : "opacity-60"
                }`}
              >
                <td className="px-3 py-2 text-foreground">
                  {row.valid ? (
                    row.item.name
                  ) : (
                    <span className="text-foreground-muted">(no name)</span>
                  )}
                </td>
                <td className="px-3 py-2 text-foreground-muted">
                  {row.item.vendor ?? ""}
                </td>
                <td className="px-3 py-2 text-foreground-muted">
                  {containerCountLabel(
                    row.stock.container_count ?? 0,
                    row.item.container_label,
                  )}
                </td>
                <td className="px-3 py-2 text-foreground-muted">
                  {formatDate(row.stock.expiration_date)}
                </td>
                <td className="px-3 py-2 text-foreground-muted">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>{row.stock.location_text ?? ""}</span>
                    {isDuplicateRow(row) && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                        <Icon name="alert" className="h-3 w-3" />
                        already in inventory, will create a duplicate
                      </span>
                    )}
                    {row.issues.map((issue, j) => (
                      <span
                        key={j}
                        className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                      >
                        <Icon name="alert" className="h-3 w-3" />
                        {issue}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <label className="mt-3 flex cursor-pointer items-start gap-2 text-meta text-foreground">
        <input
          type="checkbox"
          checked={mergeExisting}
          onChange={(e) => onToggleMerge(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border text-brand-action focus:ring-brand-action"
        />
        <span>
          Merge rows matching an existing item (by name and catalog) as a new
          stock instead of a duplicate.
        </span>
      </label>
    </div>
  );
}

// ── Result summary ───────────────────────────────────────────────────────────
function ResultStep({ result }: { result: ImportResult }) {
  return (
    <div className="mt-4 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
        <Icon name="check" className="h-6 w-6" />
      </div>
      <div className="mt-2 flex gap-3">
        <SummaryCard
          n={result.itemsAdded}
          label="items added"
          accent="text-emerald-700 dark:text-emerald-300"
        />
        <SummaryCard n={result.stocksCreated} label="stocks created" />
        <SummaryCard
          n={result.skipped}
          label="skipped"
          accent="text-foreground-muted"
        />
      </div>
    </div>
  );
}

function SummaryCard({
  n,
  label,
  accent,
}: {
  n: number;
  label: string;
  accent?: string;
}) {
  return (
    <div className="flex-1 rounded-lg border border-border px-3 py-3 text-center">
      <div className={`text-heading font-bold ${accent ?? "text-foreground"}`}>
        {n}
      </div>
      <div className="text-meta text-foreground-muted">{label}</div>
    </div>
  );
}
