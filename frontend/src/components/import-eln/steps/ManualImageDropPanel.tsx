"use client";

import { useCallback, useRef, useState } from "react";
import type { FetchedImage } from "@/lib/labarchives/api-client";
import type { MissingInlineImage } from "@/lib/import/eln/types";
import {
  collectDroppedFiles,
  expandZips,
  matchDroppedFilesToMissing,
  type DropMatchResult,
  type DroppedFile,
} from "@/lib/import/imageDropMatcher";

interface Props {
  /** All Form-B inline-image refs from the parsed notebook. The drop UI
   *  matches against these by filename. */
  missing: MissingInlineImage[];
  /** Fired whenever the user-staged set of matches changes (after every
   *  successful drop / pick / clear). The map is keyed by
   *  `MissingInlineImage.originalUrl` and ready to feed straight into the
   *  apply pipeline. Empty map = no matches staged. */
  onMatchesChange: (byUrl: Map<string, FetchedImage>) => void;
  /** Optional className to override or extend the wrapper. */
  className?: string;
  /** Override the prompt copy for the drop zone (e.g. the DevTools-script
   *  card customizes this to say "Drop the ZIP here"). */
  promptText?: string;
}

/**
 * Reusable file-or-folder drop zone for credentials-free image rehydration.
 * Renders a drop target, accepts:
 *  - Raw image files (drag from Finder/Explorer, or click-to-pick).
 *  - A folder of images (drag-drop with subfolder recursion).
 *  - A `.zip` containing images (e.g. the DevTools-script output).
 *
 * Matched files become a `Map<originalUrl, FetchedImage>` that flows
 * through the existing apply pipeline; unmatched dropped files and
 * unmatched missing-image refs are surfaced to the user for transparency
 * but neither is fatal.
 */
export default function ManualImageDropPanel({
  missing,
  onMatchesChange,
  className,
  promptText,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [match, setMatch] = useState<DropMatchResult | null>(null);
  const [zipErrors, setZipErrors] = useState<Array<{ name: string; message: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const ingest = useCallback(
    async (dropped: DroppedFile[]) => {
      setProcessing(true);
      setError(null);
      try {
        const { files, zipErrors: zErrs } = await expandZips(dropped);
        const result = matchDroppedFilesToMissing(files, missing);
        setMatch(result);
        setZipErrors(zErrs);
        onMatchesChange(result.byUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to process dropped files.");
        setMatch(null);
        setZipErrors([]);
        onMatchesChange(new Map());
      } finally {
        setProcessing(false);
      }
    },
    [missing, onMatchesChange],
  );

  const onInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      const dropped: DroppedFile[] = [];
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const f = list[i];
          // `webkitRelativePath` is populated when the user picks a folder
          // via <input webkitdirectory>. Plain file picks leave it empty.
          const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
          dropped.push({ file: f, displayPath: rel || f.name });
        }
      }
      // Reset value so picking the same file twice in a row still fires.
      e.target.value = "";
      if (dropped.length > 0) {
        await ingest(dropped);
      }
    },
    [ingest],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const dropped = await collectDroppedFiles(e.dataTransfer);
      if (dropped.length > 0) {
        await ingest(dropped);
      }
    },
    [ingest],
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

  const handleClear = useCallback(() => {
    setMatch(null);
    setZipErrors([]);
    setError(null);
    onMatchesChange(new Map());
  }, [onMatchesChange]);

  const matchedCount = match?.matched.length ?? 0;
  const unmatchedCount = match?.unmatched.length ?? 0;
  const unusedCount = match?.unusedFiles.length ?? 0;

  return (
    <div className={className}>
      <label
        htmlFor="manual-image-drop-input"
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`block rounded-xl border-2 border-dashed cursor-pointer transition-colors px-5 py-6 text-center ${
          dragOver
            ? "border-blue-400 bg-blue-50"
            : "border-gray-300 hover:border-gray-400 bg-gray-50"
        } ${processing ? "opacity-60 pointer-events-none" : ""}`}
      >
        {/* The "webkitdirectory" attribute is non-standard but supported by
            every major browser; React doesn't know about it so we have to
            spread it through a typed-cast props object. */}
        <input
          id="manual-image-drop-input"
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.zip,application/zip,application/x-zip-compressed"
          className="hidden"
          onChange={onInputChange}
          {...({ webkitdirectory: undefined } as Record<string, unknown>)}
        />
        <p className="text-sm text-gray-700">
          {promptText ?? "Drop a folder, individual images, or a .zip here"}
        </p>
        <p className="text-xs text-gray-500 mt-1">or click to pick files</p>
      </label>

      {processing && (
        <p className="mt-2 text-xs text-gray-600">Processing dropped files…</p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {match && !processing && (
        <div className="mt-3 space-y-2">
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs space-y-1">
            <p className="text-emerald-800">
              <span className="font-medium">{matchedCount}</span> image
              {matchedCount === 1 ? "" : "s"} matched and ready to import.
            </p>
            {unmatchedCount > 0 && (
              <p className="text-gray-700">
                <span className="font-medium">{unmatchedCount}</span> still
                missing — these will keep using the &quot;missing image&quot; placeholder.
              </p>
            )}
            {unusedCount > 0 && (
              <p className="text-amber-800">
                <span className="font-medium">{unusedCount}</span> dropped file
                {unusedCount === 1 ? "" : "s"} didn&apos;t match any expected image and will be ignored.
              </p>
            )}
            {zipErrors.length > 0 && (
              <p className="text-red-700">
                Couldn&apos;t read {zipErrors.length} ZIP archive
                {zipErrors.length === 1 ? "" : "s"}:{" "}
                {zipErrors.map((z) => z.name).join(", ")}.
              </p>
            )}
          </div>

          {unusedCount > 0 && (
            <details className="text-xs text-gray-600">
              <summary className="cursor-pointer select-none">
                Show unused files ({unusedCount})
              </summary>
              <ul className="mt-1 max-h-28 overflow-y-auto pl-4 list-disc">
                {match.unusedFiles.slice(0, 50).map((u, idx) => (
                  <li key={`${u.name}-${idx}`} className="truncate">
                    {u.name}
                  </li>
                ))}
                {match.unusedFiles.length > 50 && (
                  <li className="italic">
                    …and {match.unusedFiles.length - 50} more
                  </li>
                )}
              </ul>
            </details>
          )}

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={handleClear}
              className="text-xs text-gray-600 hover:text-gray-900 underline"
            >
              Clear and try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
