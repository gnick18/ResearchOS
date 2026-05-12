"use client";

import { useEffect, useState } from "react";
import { fileService } from "@/lib/file-system/file-service";
import { imageEvents } from "@/lib/attachments/image-events";
import { sidecarPath } from "@/lib/attachments/image-folder";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";

interface ImageTrashDropZoneProps {
  /** The currently-loaded markdown so we can strip image references when an
   *  image is deleted. */
  value: string;
  /** Update the markdown body when references are stripped. */
  onChange: (next: string) => void;
  /** Base path of the currently-open task (e.g. `users/Grant/results/task-5`).
   *  Drops from other tasks are ignored. */
  basePath?: string;
}

interface DraggingImage {
  basePath: string;
  filename: string;
  caption?: string;
}

const STRIP_DRAG_MIME = "application/x-research-os-image";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove every `![...](Images/<filename>)` and `<img ... src="...Images/<filename>...">`
 *  reference from a markdown body. */
function stripReferences(markdown: string, filename: string): string {
  const esc = escapeRegExp(filename);
  // Markdown image: ![alt](Images/foo.png "optional title")
  const mdRe = new RegExp(`!\\[[^\\]]*\\]\\([^)]*Images/${esc}[^)]*\\)\\s*`, "g");
  // HTML img tag
  const htmlRe = new RegExp(
    `<img\\s+[^>]*src=["'][^"']*Images/${esc}[^"']*["'][^>]*>\\s*`,
    "gi"
  );
  return markdown.replace(mdRe, "").replace(htmlRe, "");
}

export default function ImageTrashDropZone({
  value,
  onChange,
  basePath,
}: ImageTrashDropZoneProps) {
  const [dragging, setDragging] = useState<DraggingImage | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const unsubStart = imageEvents.onDragStart((d) => {
      setDragging({ basePath: d.basePath, filename: d.filename, caption: d.caption });
    });
    const unsubEnd = imageEvents.onDragEnd(() => {
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
      className={`fixed bottom-20 right-6 z-[120] flex flex-col items-center justify-center w-24 h-24 rounded-2xl border-2 border-dashed transition-all ${
        over
          ? "border-red-500 bg-red-100 scale-110 shadow-lg"
          : "border-red-300 bg-red-50/90 backdrop-blur-sm"
      }`}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes(STRIP_DRAG_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setOver(false);
        const raw = e.dataTransfer.getData(STRIP_DRAG_MIME);
        if (!raw) return;
        let parsed: DraggingImage | null = null;
        try {
          parsed = JSON.parse(raw) as DraggingImage;
        } catch {
          return;
        }
        if (!parsed?.filename) return;
        if (parsed.basePath !== basePath) return;

        const ok = window.confirm(
          `Delete "${parsed.filename}" from this experiment?\n\nThis removes the file from disk and strips any references from the note.`
        );
        if (!ok) return;

        const fullPath = `${basePath}/Images/${parsed.filename}`;
        const sidecar = sidecarPath(basePath, parsed.filename);
        try {
          await fileService.deleteFile(fullPath);
          await fileService.deleteFile(sidecar);
        } catch (err) {
          console.error("[trash] failed to delete file(s)", err);
        }
        blobUrlResolver.revokePath(fullPath);
        const next = stripReferences(value, parsed.filename);
        if (next !== value) onChange(next);
        imageEvents.emitDeleted({ basePath, filename: parsed.filename });
      }}
    >
      <span className="text-3xl" aria-hidden>
        🗑
      </span>
      <span className="text-[10px] text-red-700 font-medium mt-1">
        Drop to delete
      </span>
    </div>
  );
}
