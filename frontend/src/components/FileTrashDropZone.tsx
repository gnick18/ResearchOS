"use client";

import { useEffect, useState } from "react";
import { fileService } from "@/lib/file-system/file-service";
import { fileEvents } from "@/lib/attachments/file-events";
import { stripAttachmentReferences } from "@/lib/attachments/strip-references";
import { FILE_STRIP_DRAG_MIME } from "./FileStrip";

interface FileTrashDropZoneProps {
  /** Currently-loaded markdown so we can strip file-link references when a
   *  file is deleted. */
  value: string;
  /** Update the markdown body when references are stripped. */
  onChange: (next: string) => void;
  /** Base path of the currently-active editor tab (e.g.
   *  `users/Grant/results/task-5/notes`). Drops from other tasks / other
   *  tabs are ignored so the user can't accidentally nuke the sibling
   *  tab's attachments. */
  basePath?: string;
}

interface DraggingFile {
  basePath: string;
  filename: string;
}

export default function FileTrashDropZone({
  value,
  onChange,
  basePath,
}: FileTrashDropZoneProps) {
  const [dragging, setDragging] = useState<DraggingFile | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const unsubStart = fileEvents.onDragStart((d) => {
      setDragging({ basePath: d.basePath, filename: d.filename });
    });
    const unsubEnd = fileEvents.onDragEnd(() => {
      setDragging(null);
      setOver(false);
    });
    return () => {
      unsubStart();
      unsubEnd();
    };
  }, []);

  if (!dragging || !basePath || dragging.basePath !== basePath) return null;

  return (
    <div
      // Offset slightly higher than the image trash zone so both can coexist
      // if a future flow ever surfaces them simultaneously. Today only one
      // strip emits drag events at a time.
      className={`fixed bottom-20 right-6 z-[120] flex flex-col items-center justify-center w-24 h-24 rounded-2xl border-2 border-dashed transition-all ${
        over
          ? "border-red-500 bg-red-100 dark:bg-red-500/15 scale-110 shadow-lg"
          : "border-red-300 dark:border-red-500/30 bg-red-50/90 backdrop-blur-sm"
      }`}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes(FILE_STRIP_DRAG_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setOver(false);
        const raw = e.dataTransfer.getData(FILE_STRIP_DRAG_MIME);
        if (!raw) return;
        let parsed: DraggingFile | null = null;
        try {
          parsed = JSON.parse(raw) as DraggingFile;
        } catch {
          return;
        }
        if (!parsed?.filename) return;
        if (parsed.basePath !== basePath) return;

        const ok = window.confirm(
          `Delete "${parsed.filename}" from this experiment?\n\nThis removes the file from disk and strips any links from the note.`
        );
        if (!ok) return;

        const fullPath = `${basePath}/Files/${parsed.filename}`;
        try {
          await fileService.deleteFile(fullPath);
        } catch (err) {
          console.error("[file-trash] failed to delete file", err);
        }
        const next = stripAttachmentReferences(value, parsed.filename, "Files");
        if (next !== value) onChange(next);
        fileEvents.emitDeleted({ basePath, filename: parsed.filename });
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-8 h-8 text-red-600 dark:text-red-300"
        aria-hidden
      >
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </svg>
      <span className="text-meta text-red-700 dark:text-red-300 font-medium mt-1">
        Drop to delete
      </span>
    </div>
  );
}
