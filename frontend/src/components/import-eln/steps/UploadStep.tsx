"use client";

import { useCallback, useRef, useState } from "react";

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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
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

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files?.[0];
      e.target.value = "";
      if (picked) acceptFile(picked);
    },
    [acceptFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) acceptFile(dropped);
    },
    [acceptFile],
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const visibleError = errorMessage ?? localError;
  const oversized = file !== null && file.size > MAX_RECOMMENDED_ZIP_BYTES;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">
          Upload the offline notebook ZIP.
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          Drop the file you downloaded from your LabArchives confirmation
          email, or pick it from your file system.
        </p>
      </div>

      <label
        htmlFor="eln-upload-input"
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer transition-colors px-6 py-10 text-center ${
          dragOver
            ? "border-blue-400 bg-blue-50"
            : "border-gray-300 hover:border-gray-400 bg-gray-50"
        }`}
      >
        <input
          id="eln-upload-input"
          ref={inputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          className="hidden"
          onChange={onInputChange}
        />
        <p className="text-sm text-gray-700">
          Drag and drop a <code className="px-1 py-0.5 bg-white border border-gray-200 rounded text-[11px]">.zip</code> here
        </p>
        <p className="text-xs text-gray-500">or click to pick a file</p>
      </label>

      {file && (
        <div className="rounded-lg border border-gray-200 bg-white p-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
            <p className="text-xs text-gray-500">{formatBytes(file.size)}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setLocalError(null);
              onClear();
            }}
            className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1 rounded"
          >
            Remove
          </button>
        </div>
      )}

      {oversized && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
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
        <p className="text-xs text-red-600 break-words">{visibleError}</p>
      )}
    </div>
  );
}
