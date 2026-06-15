"use client";

import { useCallback, useState } from "react";
import FileDropzone from "@/components/ui/FileDropzone";

interface UploadStepProps {
  file: File | null;
  onSelectFile: (file: File) => void;
  onClear: () => void;
  errorMessage?: string | null;
}

// Soft cap above which we warn the user that the in-browser parser
// (JSZip + linkedom DOM) may OOM the tab. The parser holds the entire ZIP
// in memory as Uint8Arrays plus a linkedom DOM tree per page, so multi-GB
// notebooks can blow past Chrome's per-tab heap ceiling. The user can still
// proceed — we just want them to know what they're signing up for.
const MAX_RECOMMENDED_ZIP_BYTES = 500 * 1024 * 1024; // 500 MB

function isZipFile(file: File): boolean {
  if (file.name.toLowerCase().endsWith(".zip")) return true;
  const type = file.type;
  return type === "application/zip" || type === "application/x-zip-compressed";
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function UploadStep({
  file,
  onSelectFile,
  onClear,
  errorMessage,
}: UploadStepProps) {
  const [localError, setLocalError] = useState<string | null>(null);

  const acceptFile = useCallback(
    (candidate: File) => {
      if (!isZipFile(candidate)) {
        setLocalError(
          `That file (${candidate.name}) isn't a .zip. Pick the LabArchives Offline Notebook ZIP.`,
        );
        return;
      }
      setLocalError(null);
      onSelectFile(candidate);
    },
    [onSelectFile],
  );

  const onFiles = useCallback(
    (files: File[]) => {
      const picked = files[0];
      if (picked) acceptFile(picked);
    },
    [acceptFile],
  );

  const visibleError = errorMessage ?? localError;
  const oversized = file !== null && file.size > MAX_RECOMMENDED_ZIP_BYTES;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-body font-semibold text-foreground">
          Upload the offline notebook ZIP.
        </h3>
        <p className="text-meta text-foreground-muted mt-1">
          Drop the file you downloaded from your LabArchives confirmation
          email, or pick it from your file system.
        </p>
      </div>

      <FileDropzone
        onFiles={onFiles}
        accept=".zip,application/zip,application/x-zip-compressed"
        multiple={false}
        hint="ZIP archive"
        onReject={setLocalError}
        ariaLabel="Upload the offline notebook ZIP"
      />

      {file && (
        <div className="rounded-lg border border-border bg-surface-raised p-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-body font-medium text-foreground truncate">{file.name}</p>
            <p className="text-meta text-foreground-muted">{formatBytes(file.size)}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setLocalError(null);
              onClear();
            }}
            className="text-meta text-foreground-muted hover:text-foreground px-2 py-1 rounded"
          >
            Remove
          </button>
        </div>
      )}

      {oversized && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-3 py-2 text-meta text-amber-900 dark:text-amber-300"
        >
          <p className="font-medium">
            Large notebook — import may run out of memory.
          </p>
          <p className="mt-1">
            This ZIP is {formatBytes(file!.size)}. Notebooks larger than{" "}
            {formatBytes(MAX_RECOMMENDED_ZIP_BYTES)} may exceed your browser&apos;s
            memory and cause the import to fail. If you hit a crash, try splitting
            the notebook in LabArchives before exporting.
          </p>
        </div>
      )}

      {visibleError && (
        <p className="text-meta text-red-600 dark:text-red-300 break-words">{visibleError}</p>
      )}
    </div>
  );
}
