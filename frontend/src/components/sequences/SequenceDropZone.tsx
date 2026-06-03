"use client";

// bulk import bot — drag-and-drop bulk import target for the sequence library.
// Wraps the library in a full-area drop target that accepts dropped FILES and
// FOLDERS. On drop it walks the DataTransfer items via webkitGetAsEntry() and
// recurses any FileSystemDirectoryEntry, collecting every descendant File, then
// hands the flat File[] back to the page (which filters + funnels them through
// the EXISTING import loop). Shows a calm dashed-border overlay while dragging.

import { useCallback, useRef, useState, type ReactNode } from "react";

/** Minimal shape of the entry API we touch (the lib DOM types are partial /
 *  vendor-specific across browsers). */
interface FsEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (cb: (entries: FsEntryLike[]) => void, err?: (e: unknown) => void) => void;
  };
}

/** Promise wrapper for FileSystemFileEntry.file(). */
function entryToFile(entry: FsEntryLike): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) {
      resolve(null);
      return;
    }
    entry.file(
      (f) => resolve(f),
      () => resolve(null),
    );
  });
}

/** Promise wrapper for one readEntries() batch. readEntries returns results in
 *  chunks (commonly 100) and signals "done" with an empty array, so callers
 *  must loop until they get an empty batch. */
function readEntriesBatch(
  reader: { readEntries: (cb: (e: FsEntryLike[]) => void, err?: (e: unknown) => void) => void },
): Promise<FsEntryLike[]> {
  return new Promise((resolve) => {
    reader.readEntries(
      (entries) => resolve(entries),
      () => resolve([]),
    );
  });
}

/** Recursively flatten one dropped entry (file or directory) into Files. */
async function flattenEntry(entry: FsEntryLike): Promise<File[]> {
  if (entry.isFile) {
    const f = await entryToFile(entry);
    return f ? [f] : [];
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const out: File[] = [];
    // Loop until a batch comes back empty (readEntries paginates).
    for (;;) {
      const batch = await readEntriesBatch(reader);
      if (batch.length === 0) break;
      for (const child of batch) {
        const nested = await flattenEntry(child);
        out.push(...nested);
      }
    }
    return out;
  }
  return [];
}

/** Walk a DataTransferItemList, recursing folders, into a flat File[].
 *  Exported for clarity; the pure extension filtering lives in lib/bulk-import. */
export async function filesFromDataTransferItems(
  items: DataTransferItemList,
): Promise<File[]> {
  const entries: FsEntryLike[] = [];
  const fallbackFiles: File[] = [];
  // Snapshot synchronously — the DataTransferItemList is invalidated after the
  // drop handler returns / first await.
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind !== "file") continue;
    const getAsEntry = (
      item as DataTransferItem & {
        webkitGetAsEntry?: () => FsEntryLike | null;
      }
    ).webkitGetAsEntry;
    const entry = getAsEntry ? getAsEntry.call(item) : null;
    if (entry) {
      entries.push(entry);
    } else {
      // Browser without the entry API: fall back to a flat file (no folders).
      const f = item.getAsFile();
      if (f) fallbackFiles.push(f);
    }
  }
  if (entries.length === 0) return fallbackFiles;
  const collected: File[] = [...fallbackFiles];
  for (const entry of entries) {
    collected.push(...(await flattenEntry(entry)));
  }
  return collected;
}

/** Dashed import-target overlay glyph (downward tray). Inline SVG, no emojis. */
function DropIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/** True when a drag carries files (vs. text / element drags we ignore). */
function dragHasFiles(e: React.DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  // types is a DOMStringList in some browsers and string[] in others.
  return Array.from(types as ArrayLike<string>).includes("Files");
}

export default function SequenceDropZone({
  onFiles,
  disabled = false,
  className,
  children,
}: {
  /** Called with the flattened File[] from a drop (folders recursed). */
  onFiles: (files: File[]) => void;
  /** When true, drops are ignored (e.g. an import is already running). */
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  // dragenter / dragleave fire for every child element; count depth so the
  // overlay only clears when the cursor truly leaves the zone.
  const depth = useRef(0);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !dragHasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    [disabled],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !dragHasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    },
    [disabled],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !dragHasFiles(e)) return;
      e.preventDefault();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    [disabled],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (disabled || !dragHasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const dt = e.dataTransfer;
      if (!dt) return;
      // Prefer the items API (gives us folders); fall back to flat files.
      if (dt.items && dt.items.length > 0) {
        const files = await filesFromDataTransferItems(dt.items);
        if (files.length > 0) onFiles(files);
      } else if (dt.files && dt.files.length > 0) {
        onFiles(Array.from(dt.files));
      }
    },
    [disabled, onFiles],
  );

  return (
    <div
      className={`relative ${className ?? ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-sky-50/90 p-3">
          <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-sky-400 px-6 py-8 text-center">
            <DropIcon className="h-8 w-8 text-sky-500" />
            <p className="text-sm font-medium text-sky-700">
              Drop sequence files or a folder to import
            </p>
            <p className="text-xs text-sky-600">
              GenBank, FASTA, and SnapGene files; other files are skipped.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
