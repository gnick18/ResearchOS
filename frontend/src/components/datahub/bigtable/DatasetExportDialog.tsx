"use client";

// DatasetExportDialog (DataHub-largetables lane, Phase 4).
//
// One-click export of the CURRENT dataset view to CSV or Parquet. The dialog lets
// the user pick a format (Parquet default, the columnar format the lane stores),
// and, when an active transform recipe shapes the dataset, whether to export the
// transformed slice or the raw dataset. A live row count reflects that choice, and
// a soft warning shows past a million rows (no hard cap, the user can still
// proceed). Download streams the result out of DuckDB via exportDatasetView and
// hands the bytes to downloadBlob.
//
// SCOPE. This is a READ path. DuckDB only MOVES the rows out (SELECT * over the
// active view); no statistic is computed or altered. The export is the same
// filtered / transformed slice the preview grid shows.
//
// House style: a popup reads as a contained surface (bg-surface-overlay + border),
// the primary CTA uses .bg-brand-action text-white, <Icon> only, Tooltip for
// icon-only buttons, no emojis / em-dashes / mid-sentence colons. No soft-lock,
// the backdrop, the close button, and Escape all dismiss.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import type { DatasetSidecar } from "@/lib/datahub/bigtable/types";
import {
  countRows,
  exportDatasetView,
  type OpenDatasetHandle,
} from "@/lib/datahub/bigtable/dataset-view";
import { downloadBlob } from "@/lib/deposit/bundle";

type ExportFormat = "parquet" | "csv";

/** The row count past which a soft warning shows. No hard cap, just a heads-up
 *  that a very large export takes a moment and a big file. */
const LARGE_ROW_THRESHOLD = 1_000_000;

/** Slugify a dataset name into a safe file-stem (lowercase, dashes, no leading /
 *  trailing dashes). A blank name falls back to "dataset". */
function slug(name: string): string {
  const s = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "dataset";
}

/** A compact UTC timestamp stamp (YYYYMMDD-HHMMSS) for the filename, so repeated
 *  exports never collide. */
function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export default function DatasetExportDialog({
  open,
  sidecar,
  handle,
  onClose,
}: {
  open: boolean;
  sidecar: DatasetSidecar;
  /** The dataset opened into DuckDB (from DatasetView). Null while opening. */
  handle: OpenDatasetHandle | null;
  onClose: () => void;
}) {
  const hasRecipe = sidecar.recipe.length > 0;

  const [format, setFormat] = useState<ExportFormat>("parquet");
  // Only meaningful when the dataset has an active recipe; default on so the
  // export matches what the preview grid shows.
  const [includeRecipe, setIncludeRecipe] = useState(true);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The recipe actually applied to this export: the dataset's recipe when the user
  // keeps the transform, otherwise undefined (raw dataset).
  const appliedRecipe = useMemo(
    () => (hasRecipe && includeRecipe ? sidecar.recipe : undefined),
    [hasRecipe, includeRecipe, sidecar.recipe],
  );

  // Reset on open.
  useEffect(() => {
    if (!open) return;
    setFormat("parquet");
    setIncludeRecipe(true);
    setError(null);
  }, [open]);

  // Escape closes (no soft-lock).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Live row count, reflecting the include-recipe choice. The raw count is the
  // authoritative sidecar value, the recipe count comes from the engine.
  useEffect(() => {
    if (!open || !handle) {
      setRowCount(null);
      return;
    }
    if (!appliedRecipe) {
      setRowCount(sidecar.rowCount);
      return;
    }
    let cancelled = false;
    setCounting(true);
    countRows(handle, appliedRecipe)
      .then((n) => {
        if (!cancelled) setRowCount(n);
      })
      .catch(() => {
        if (!cancelled) setRowCount(null);
      })
      .finally(() => {
        if (!cancelled) setCounting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, handle, appliedRecipe, sidecar.rowCount]);

  if (!open) return null;

  const ext = format === "csv" ? "csv" : "parquet";
  const mime = format === "csv" ? "text/csv" : "application/x-parquet";
  const isLarge = rowCount !== null && rowCount > LARGE_ROW_THRESHOLD;

  const runExport = async () => {
    if (!handle || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const bytes = await exportDatasetView(handle, appliedRecipe, format);
      const blob = new Blob([bytes], { type: mime });
      downloadBlob(blob, `${slug(sidecar.name)}-${stamp()}.${ext}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The export could not run.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      data-testid="dataset-export-dialog"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Export dataset"
        className="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-lg border border-border bg-surface-overlay shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <Icon name="download" className="h-4 w-4 text-foreground-muted" />
          <h2 className="text-body font-semibold text-foreground">Export dataset</h2>
          <span className="flex-1" />
          <Tooltip label="Close">
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="rounded-md p-1 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
            >
              <Icon name="close" className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <p className="text-meta text-foreground-muted">
            Download the current view of {sidecar.name || "this dataset"}. The file
            is built locally, nothing is uploaded.
          </p>

          {/* Format */}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-meta font-semibold text-foreground">Format</legend>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="export-format"
                checked={format === "parquet"}
                onChange={() => setFormat("parquet")}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-body text-foreground">Parquet</span>
                <span className="block text-meta text-foreground-muted">
                  Columnar, keeps types, smaller for large tables.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="export-format"
                checked={format === "csv"}
                onChange={() => setFormat("csv")}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-body text-foreground">CSV</span>
                <span className="block text-meta text-foreground-muted">
                  Plain text, opens anywhere, larger and untyped.
                </span>
              </span>
            </label>
          </fieldset>

          {/* Include recipe, only when a transform is active */}
          {hasRecipe ? (
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={includeRecipe}
                onChange={(e) => setIncludeRecipe(e.target.checked)}
                className="mt-0.5"
                data-testid="dataset-export-include-recipe"
              />
              <span className="min-w-0">
                <span className="block text-body text-foreground">
                  Apply the active transform
                </span>
                <span className="block text-meta text-foreground-muted">
                  Export the filtered, transformed slice. Uncheck to export the raw
                  dataset.
                </span>
              </span>
            </label>
          ) : null}

          {/* Live row count */}
          <p className="text-meta text-foreground-muted" data-testid="dataset-export-rowcount">
            {counting
              ? "Counting rows..."
              : rowCount === null
                ? "Opening the dataset..."
                : `${rowCount.toLocaleString()} ${rowCount === 1 ? "row" : "rows"} will export.`}
          </p>

          {/* Large-export warning (no hard cap) */}
          {isLarge ? (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-meta text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
              data-testid="dataset-export-large-warning"
            >
              That is over a million rows. The export still runs, it just takes a
              moment and produces a large file.
            </div>
          ) : null}

          {error ? (
            <div className="rounded-md border border-red-500/40 bg-red-500/[0.06] px-3 py-2 text-meta text-foreground">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="ros-btn-neutral px-3 py-1.5 text-meta font-medium text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={runExport}
            disabled={handle === null || exporting}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-action px-3 py-1.5 text-meta font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            data-testid="dataset-export-download"
          >
            <Icon name="download" className="h-3.5 w-3.5" />
            {exporting ? "Exporting..." : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}
