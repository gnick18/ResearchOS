"use client";

import { useCallback, useEffect, useState } from "react";
import { type ExportProgressUi } from "@/components/ExportFormatDialog";
import {
  exportExperiments,
  exportExperimentsToFile,
  downloadResult,
  estimateMultiExportSize,
  type ExportSizeEstimate,
} from "@/lib/export/orchestrate";
import type { ExportFormat } from "@/lib/export/types";
import { buildCombinedPdf } from "@/lib/export/combined-pdf";
import { taskKey, type Task } from "@/lib/types";

/**
 * Multi-select experiment export, lifted verbatim out of the retired
 * `/search` page so the Workbench experiments surface (its new home) reuses
 * the EXACT same handlers instead of a copy-paste. Drives the shared
 * `ExportFormatDialog`: a select-mode toggle, a checked-key set, a soft
 * size-estimate warning, and the three export paths — zip-of-files
 * (`exportSelected`), stream-to-disk (`exportSelectedToFile`), and one
 * navigable combined PDF (`exportSelectedCombined`). The on-disk formats and
 * orchestrator wiring are untouched; this is purely the page-level glue that
 * used to live in `app/search/page.tsx`.
 *
 * The caller owns the universe of experiments and passes the live list in;
 * the hook owns selection + dialog state. `currentUser` is threaded into the
 * orchestrator exactly as before (it stamps the bundle author).
 */
export function useExperimentExport(
  experiments: Task[],
  currentUser: string,
) {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sizeEstimate, setSizeEstimate] =
    useState<ExportSizeEstimate | null>(null);
  const [progress, setProgress] = useState<ExportProgressUi | null>(null);

  const toggleSelection = useCallback((task: Task) => {
    const key = taskKey(task);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const enterSelectMode = useCallback(() => setSelectMode(true), []);

  const cancelSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedKeys(new Set());
  }, []);

  const openDialog = useCallback(() => setDialogOpen(true), []);
  const closeDialog = useCallback(() => setDialogOpen(false), []);

  // The selected experiments, resolved from the live list. Filtering against
  // the passed-in universe (rather than caching the Task objects at select
  // time) keeps the export payload current if the underlying data refreshes.
  const selectedTasks = experiments.filter((t) =>
    selectedKeys.has(taskKey(t)),
  );

  // Cheap up-front size walk so the export dialog can show a soft warning for
  // big multi-selects. Runs when the dialog opens; cleared when it closes. The
  // estimate is bounded by attachment file-system metadata reads — no byte
  // content is loaded.
  useEffect(() => {
    if (!dialogOpen) {
      setSizeEstimate(null);
      return;
    }
    const tasksToExport = experiments.filter((t) =>
      selectedKeys.has(taskKey(t)),
    );
    if (tasksToExport.length < 2) return;
    let cancelled = false;
    estimateMultiExportSize(tasksToExport)
      .then((estimate) => {
        if (!cancelled) setSizeEstimate(estimate);
      })
      .catch(() => {
        // Estimate failures are non-fatal — the dialog just won't show a size
        // hint or the large-export warning.
      });
    return () => {
      cancelled = true;
    };
  }, [dialogOpen, experiments, selectedKeys]);

  const exportSelected = useCallback(
    async (format: ExportFormat) => {
      const tasksToExport = experiments.filter((t) =>
        selectedKeys.has(taskKey(t)),
      );
      if (tasksToExport.length === 0) return;

      setExporting(true);
      setProgress(null);
      try {
        const result = await exportExperiments(
          tasksToExport,
          format,
          currentUser,
          (p) =>
            setProgress({
              current: p.current,
              total: p.total,
              taskName: p.task.name,
              zipPercent: p.zipPercent,
            }),
        );
        downloadResult(result);
        setDialogOpen(false);
        cancelSelectMode();
      } catch (error) {
        console.error("Export failed:", error);
        alert(
          `Failed to export: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      } finally {
        setExporting(false);
        setProgress(null);
      }
    },
    [experiments, selectedKeys, currentUser, cancelSelectMode],
  );

  // FSA streaming-to-disk variant. Same payload prep + progress wiring as
  // `exportSelected`, but pipes bytes straight into the user-chosen file via
  // `showSaveFilePicker` so the full archive never materializes as a Blob.
  // Only invoked when the dialog renders the Save-to-disk section (gated on
  // `supportsFileSystemAccessSave()` and `taskCount > 1`).
  const exportSelectedToFile = useCallback(
    async (format: ExportFormat) => {
      const tasksToExport = experiments.filter((t) =>
        selectedKeys.has(taskKey(t)),
      );
      if (tasksToExport.length < 2) return;
      setExporting(true);
      setProgress(null);
      try {
        const { saved } = await exportExperimentsToFile(
          tasksToExport,
          format,
          currentUser,
          (p) =>
            setProgress({
              current: p.current,
              total: p.total,
              taskName: p.task.name,
              zipPercent: p.zipPercent,
            }),
        );
        if (saved) {
          setDialogOpen(false);
          cancelSelectMode();
        }
        // saved === false ⇒ user cancelled the picker; keep the dialog open so
        // they can retry or pick a different format.
      } catch (error) {
        console.error("Export-to-file failed:", error);
        alert(
          `Failed to save: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      } finally {
        setExporting(false);
        setProgress(null);
      }
    },
    [experiments, selectedKeys, currentUser, cancelSelectMode],
  );

  // Combined-PDF path. Merges every selected experiment into ONE navigable PDF
  // (cover + clickable index + bookmarks) via `buildCombinedPdf` instead of the
  // default zip-of-individual-PDFs. Every selected item is kind "experiment";
  // the builder also supports notes for other callers.
  const exportSelectedCombined = useCallback(async () => {
    const tasksToExport = experiments.filter((t) =>
      selectedKeys.has(taskKey(t)),
    );
    if (tasksToExport.length === 0) return;

    setExporting(true);
    setProgress(null);
    try {
      const blob = await buildCombinedPdf({
        title:
          tasksToExport.length === 1
            ? tasksToExport[0].name
            : `${tasksToExport.length} experiments`,
        items: tasksToExport.map((t) => ({
          kind: "experiment" as const,
          id: t.id,
        })),
      });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadResult({
        blob,
        filename: `combined-${stamp}.pdf`,
        mimeType: "application/pdf",
      });
      setDialogOpen(false);
      cancelSelectMode();
    } catch (error) {
      console.error("Combined PDF export failed:", error);
      alert(
        `Failed to export combined PDF: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    } finally {
      setExporting(false);
      setProgress(null);
    }
  }, [experiments, selectedKeys, cancelSelectMode]);

  return {
    // selection state
    selectMode,
    selectedKeys,
    selectedCount: selectedKeys.size,
    selectedTasks,
    toggleSelection,
    enterSelectMode,
    cancelSelectMode,
    // dialog state
    dialogOpen,
    openDialog,
    closeDialog,
    exporting,
    sizeEstimate,
    progress,
    // export handlers (wire straight into ExportFormatDialog)
    exportSelected,
    exportSelectedToFile,
    exportSelectedCombined,
  };
}
