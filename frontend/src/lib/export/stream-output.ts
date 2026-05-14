// frontend/src/lib/export/stream-output.ts
//
// Streaming output helpers for the multi-experiment export wrapper.
//
// The single-experiment export path (raw/html/pdf) buffers a few MB of
// notes + a handful of attachments into a Blob — fine. The MULTI-experiment
// wrapper in `orchestrate.ts:packMulti`, however, used to call
// `zip.generateAsync({ type: "blob" })` which buffers the entire archive
// (every experiment's bytes × every image × every PDF) in RAM before the
// download starts. For 50-100 image-heavy experiments that can blow the
// browser heap.
//
// This module gives `orchestrate.ts` two improvements:
//
// 1. `packZipStreaming` — uses JSZip's `generateInternalStream` to emit
//    chunks. Instead of one giant Blob, we accumulate `Blob[]` chunks and
//    `new Blob(parts)` at the end. The browser's Blob impl stores parts by
//    reference (no copy) so the peak working set is roughly ONE chunk
//    (~64 KB) plus the original per-experiment ExportResult blobs that
//    JSZip is reading from — not 2× the full archive size like
//    `generateAsync` does.
//
// 2. `streamZipToDisk` — uses the File System Access API
//    (`showSaveFilePicker` → `createWritable` → write chunks) to stream
//    DIRECTLY to disk, avoiding any in-memory Blob materialization
//    altogether. Only Chromium-based browsers expose `showSaveFilePicker`;
//    Firefox + Safari fall back to the Blob path.
//
// 3. `estimateMultiExportSize` — walks the on-disk attachment folders for
//    a list of tasks and sums the file sizes so the UI can show a soft
//    warning before kicking off a very-large export.

import JSZip from "jszip";
import type { Task } from "@/lib/types";
import { fileService } from "@/lib/file-system/file-service";
import { findExistingTaskResultsBase } from "@/lib/tasks/results-paths";

// ---------------------------------------------------------------------------
// Size estimation
// ---------------------------------------------------------------------------

/**
 * Rough per-task overhead (notes.md + results.md + manifest JSON + method
 * JSON entries) when no attachments are present. ~32 KB covers a typical
 * notes/results body. The estimate is a SOFT warning threshold, not a hard
 * limit, so being slightly off is fine.
 */
const PER_TASK_TEXT_OVERHEAD_BYTES = 32 * 1024;

export interface ExportSizeEstimate {
  // Number of attachments across all tasks (images + files, both notes
  // and results folders).
  attachmentCount: number;
  // Sum of every attachment's on-disk size in bytes, plus a per-task
  // overhead for the text content (notes/results.md + manifest).
  totalBytes: number;
  // Per-task breakdown so the UI can highlight the heaviest experiments
  // if it wants. Keyed by task.id (so duplicates across owners collide,
  // but the wrapper itself dedupes by task object identity).
  perTaskBytes: Array<{ taskId: number; bytes: number }>;
}

/**
 * Estimate the on-disk size of the eventual multi-export by walking each
 * task's results folder and summing the file sizes. ZIP compression makes
 * the actual download smaller but text-heavy notebooks compress more than
 * image-heavy ones, so the uncompressed sum is a conservative ceiling —
 * good for an OOM-warning heuristic.
 *
 * This walks the file tree with `FileSystemFileHandle.getFile()` which is
 * cheap (no bytes are read; only the file metadata).
 */
export async function estimateMultiExportSize(
  tasks: Task[],
): Promise<ExportSizeEstimate> {
  let attachmentCount = 0;
  let totalBytes = 0;
  const perTaskBytes: Array<{ taskId: number; bytes: number }> = [];

  for (const task of tasks) {
    let taskBytes = PER_TASK_TEXT_OVERHEAD_BYTES;
    const base = await findExistingTaskResultsBase(task);
    if (base) {
      // Walk the four attachment dirs: {base}/notes/{Images,Files} +
      // {base}/results/{Images,Files}. The legacy outer base layout
      // ({base}/{Images,Files} sans tab) is also walked so legacy data
      // gets counted.
      const dirs = [
        `${base}/notes/Images`,
        `${base}/notes/Files`,
        `${base}/results/Images`,
        `${base}/results/Files`,
        `${base}/Images`,
        `${base}/Files`,
      ];
      for (const dir of dirs) {
        let names: string[] = [];
        try {
          names = await fileService.listFiles(dir);
        } catch {
          continue;
        }
        for (const name of names) {
          if (name.startsWith(".")) continue;
          try {
            const blob = await fileService.readFileAsBlob(`${dir}/${name}`);
            if (!blob) continue;
            taskBytes += blob.size;
            attachmentCount += 1;
          } catch {
            // skip — file vanished mid-walk, can't size it
          }
        }
      }
    }
    perTaskBytes.push({ taskId: task.id, bytes: taskBytes });
    totalBytes += taskBytes;
  }

  return { attachmentCount, totalBytes, perTaskBytes };
}

/**
 * Threshold above which the UI should show a soft warning before
 * kicking off the export. 500 MB of attachments or 50+ experiments is
 * the danger zone for buffering-everything-in-RAM approaches — once we
 * switch to streaming output the actual memory ceiling is much lower,
 * but the warning is still useful so users know they're about to wait
 * a minute and use significant CPU/disk.
 */
export const LARGE_EXPORT_BYTE_THRESHOLD = 500 * 1024 * 1024;
export const LARGE_EXPORT_TASK_COUNT_THRESHOLD = 50;

export function isLargeExport(
  taskCount: number,
  estimate: ExportSizeEstimate,
): boolean {
  return (
    taskCount >= LARGE_EXPORT_TASK_COUNT_THRESHOLD ||
    estimate.totalBytes >= LARGE_EXPORT_BYTE_THRESHOLD
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// Streaming ZIP output
// ---------------------------------------------------------------------------

/**
 * Generate a ZIP from a JSZip instance using `generateInternalStream` and
 * accumulate the output chunks into a `Blob[]`. The final `new Blob(parts)`
 * stores its parts by reference (no copy), so the peak working set is
 * roughly ONE chunk plus the parts list — not 2× the full archive size
 * like `generateAsync` does.
 *
 * Returns a Blob; the caller is responsible for triggering the download
 * (either `streamZipToDisk` for the FSA path or the classic
 * URL.createObjectURL + <a download> path).
 */
export async function packZipStreaming(
  zip: JSZip,
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  const chunks: Blob[] = [];
  return new Promise<Blob>((resolve, reject) => {
    const stream = zip.generateInternalStream({
      type: "blob",
      streamFiles: true,
    });
    stream.on("data", (chunk: Blob, meta: { percent: number }) => {
      chunks.push(chunk);
      if (onProgress) onProgress(meta.percent);
    });
    stream.on("error", (err: Error) => reject(err));
    stream.on("end", () => {
      resolve(new Blob(chunks, { type: "application/zip" }));
    });
    stream.resume();
  });
}

// ---------------------------------------------------------------------------
// File System Access API — direct-to-disk streaming
// ---------------------------------------------------------------------------

interface SaveFilePickerHandle {
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

interface WindowWithFSA extends Window {
  showSaveFilePicker?: (
    options?: SaveFilePickerOptions,
  ) => Promise<SaveFilePickerHandle>;
}

/**
 * True when the current browser exposes the `showSaveFilePicker` API
 * (Chromium-based browsers; Firefox + Safari do not). Used by the UI to
 * decide whether to offer the streaming path.
 */
export function supportsFileSystemAccessSave(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as WindowWithFSA).showSaveFilePicker === "function";
}

/**
 * Stream a JSZip archive directly to disk via the File System Access API.
 * The user gets a native Save-As dialog; we write chunks as they're
 * produced, so the full archive is never resident in memory.
 *
 * Returns `true` if the user picked a destination and the write
 * completed, `false` if they cancelled the picker. Throws on a non-
 * cancellation error (write failed, permission denied, etc.) so the
 * caller can fall back to the in-memory Blob path.
 *
 * Note: the caller MUST check `supportsFileSystemAccessSave()` first.
 * Calling this when the API is unavailable throws synchronously.
 */
export async function streamZipToDisk(
  zip: JSZip,
  suggestedName: string,
  onProgress?: (percent: number) => void,
): Promise<boolean> {
  const win = window as WindowWithFSA;
  if (!win.showSaveFilePicker) {
    throw new Error("showSaveFilePicker not available");
  }
  let handle: SaveFilePickerHandle;
  try {
    handle = await win.showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: "ZIP archive",
          accept: { "application/zip": [".zip"] },
        },
      ],
    });
  } catch (err) {
    // User cancelled the picker — surface as "no write happened" rather
    // than throwing, so the caller doesn't show an error UI for what's
    // a deliberate user action.
    if (err instanceof Error && err.name === "AbortError") return false;
    throw err;
  }

  const writable = await handle.createWritable();
  try {
    await new Promise<void>((resolve, reject) => {
      const stream = zip.generateInternalStream({
        type: "blob",
        streamFiles: true,
      });
      // Sequence writes through a queue so we don't issue overlapping
      // `writable.write` calls (the FSA stream isn't required to handle
      // concurrent writes deterministically).
      let pending: Promise<void> = Promise.resolve();
      stream.on("data", (chunk: Blob, meta: { percent: number }) => {
        pending = pending
          .then(() => writable.write(chunk))
          .then(() => {
            if (onProgress) onProgress(meta.percent);
          });
      });
      stream.on("error", (err: Error) => {
        pending = pending.finally(() => writable.abort().catch(() => {}));
        reject(err);
      });
      stream.on("end", () => {
        pending.then(resolve).catch(reject);
      });
      stream.resume();
    });
    await writable.close();
    return true;
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}
