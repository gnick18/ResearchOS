"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { filesApi } from "@/lib/local-api";
import { fileEvents } from "@/lib/attachments/file-events";

/** MIME-style key for drag-and-drop. Defined here so the editor can pick it
 *  out without coupling. Mirrors `STRIP_DRAG_MIME` in ImageStrip. */
export const FILE_STRIP_DRAG_MIME = "application/x-research-os-file";

export interface FileStripDragPayload {
  /** Filename within the task's Files/ folder. */
  filename: string;
  /** Source `basePath` (the strip's task). */
  basePath: string;
}

interface FileStripProps {
  /** Raw markdown source — used to figure out which linked files are
   *  actually referenced in the document (vs. linked-only). */
  content: string;
  /** Directory the markdown file lives in (e.g. `users/Grant/results/task-3`).
   *  We list `${basePath}/Files/`. */
  basePath?: string;
  className?: string;
}

interface StripEntry {
  filename: string;
  /** Path inside the markdown's directory (always `Files/{filename}`). */
  relativePath: string;
  inDocument: boolean;
}

const MD_LINK_REGEX = /\[[^\]]*\]\(([^)\s]+)/g;
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"]);

function filesReferencedInMarkdown(markdown: string): Set<string> {
  const referenced = new Set<string>();
  let m: RegExpExecArray | null;
  const regex = new RegExp(MD_LINK_REGEX.source, "g");
  while ((m = regex.exec(markdown)) !== null) {
    let src = m[1];
    if (src.startsWith("./")) src = src.slice(2);
    if (src.startsWith("Files/")) {
      const trimmed = src.split("#")[0].split("?")[0];
      const name = trimmed.slice("Files/".length);
      if (name && !name.includes("/")) referenced.add(name);
    }
  }
  return referenced;
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

/** Emoji icon for a filename's extension. Mirrors the convention used in
 *  TaskDetailPopup's PdfAttachmentsPanel (`getFileIcon`). */
function fileIcon(filename: string): string {
  const ext = getExtension(filename);
  if (ext === "pdf") return "📕";
  if (ext === "md") return "📝";
  if (ext === "txt") return "📄";
  if (["doc", "docx"].includes(ext)) return "📘";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📗";
  if (["ppt", "pptx"].includes(ext)) return "📙";
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext)) return "🗜️";
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "🎵";
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "🎬";
  if (["json", "xml", "yml", "yaml"].includes(ext)) return "🧾";
  return "📎";
}

/**
 * Horizontal scrollable strip of every non-image file in the current task's
 * `Files/` folder. Files referenced in the markdown body get a normal
 * appearance; files that exist on disk but aren't linked yet get a small
 * blue dot to flag them. Drag an entry into the editor to insert a markdown
 * hyperlink (`[filename](Files/{name})`).
 *
 * v1 keeps things minimal: no metadata popup, no caption, no sidecar.
 * Inspection/metadata can come later if a use case shows up.
 */
export default function FileStrip({
  content,
  basePath,
  className,
}: FileStripProps) {
  const [folderEntries, setFolderEntries] = useState<string[]>([]);

  const referencedNames = useMemo(() => filesReferencedInMarkdown(content), [content]);

  const refresh = useCallback(async () => {
    if (!basePath) {
      setFolderEntries([]);
      return;
    }
    try {
      const items = await filesApi.listDirectory(`${basePath}/Files`);
      const names = items
        .filter((item) => item.type === "file")
        .map((item) => item.name)
        .filter((name) => !IMAGE_EXTS.has(getExtension(name)));
      setFolderEntries(names);
    } catch {
      setFolderEntries([]);
    }
  }, [basePath]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on deps change
    void refresh();
  }, [refresh]);

  // Refresh on window focus (e.g. files dropped via a different app/tab)
  // and when a fileEvents broadcast targets this strip's basePath.
  useEffect(() => {
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    const offAttached = fileEvents.onAttached((detail) => {
      if (detail.basePath === basePath) void refresh();
    });
    const offDeleted = fileEvents.onDeleted((detail) => {
      if (detail.basePath === basePath) void refresh();
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      offAttached();
      offDeleted();
    };
  }, [refresh, basePath]);

  const entries: StripEntry[] = useMemo(() => {
    const items: StripEntry[] = folderEntries.map((name) => ({
      filename: name,
      relativePath: `Files/${name}`,
      inDocument: referencedNames.has(name),
    }));
    return items.sort((a, b) => {
      if (a.inDocument !== b.inDocument) return a.inDocument ? 1 : -1;
      return a.filename.localeCompare(b.filename);
    });
  }, [folderEntries, referencedNames]);

  const wrapperClass = `sticky bottom-0 z-10 ${className ?? ""}`.trim();

  if (entries.length === 0) {
    return (
      <div className={wrapperClass}>
        <p className="text-xs text-gray-400 italic px-3 py-2 bg-gray-50 border-t border-gray-200">
          No files attached to this experiment yet. Drag a file in or use the Add File button.
        </p>
      </div>
    );
  }

  const linkedOnlyCount = entries.filter((e) => !e.inDocument).length;

  return (
    <div className={wrapperClass}>
      <div className="flex items-center gap-2 px-3 py-2 overflow-x-auto bg-gray-50 border-t border-gray-200">
        <span className="text-xs text-gray-500 font-medium flex-shrink-0 mr-1">
          {entries.length} file{entries.length === 1 ? "" : "s"}
          {linkedOnlyCount > 0 && (
            <span className="ml-1 text-blue-600">({linkedOnlyCount} unlinked)</span>
          )}
        </span>
        {entries.map((entry) => {
          const payload: FileStripDragPayload = {
            filename: entry.filename,
            basePath: basePath ?? "",
          };
          const tooltip = entry.inDocument
            ? entry.filename
            : `${entry.filename} — not yet linked. Drag into the document to insert.`;
          return (
            <div
              key={entry.filename}
              draggable={!!basePath}
              onDragStart={(e) => {
                e.dataTransfer.setData(FILE_STRIP_DRAG_MIME, JSON.stringify(payload));
                e.dataTransfer.setData(
                  "text/plain",
                  // URL-encode just the filename so spaces (and other reserved
                  // chars) produce a CommonMark-valid link destination when
                  // the receiving editor falls back to the text/plain payload.
                  `[${entry.filename}](Files/${encodeURIComponent(entry.filename)})`
                );
                e.dataTransfer.effectAllowed = "copyMove";
                fileEvents.emitDragStart({
                  basePath: basePath ?? "",
                  filename: entry.filename,
                });
              }}
              onDragEnd={() => fileEvents.emitDragEnd()}
              className="group relative flex-shrink-0 w-28 h-16 rounded-md border border-gray-200 bg-white overflow-hidden hover:border-blue-400 hover:ring-2 hover:ring-blue-200 transition-all cursor-grab active:cursor-grabbing flex items-center gap-2 px-2"
              title={tooltip}
            >
              <span className="text-2xl flex-shrink-0" aria-hidden="true">
                {fileIcon(entry.filename)}
              </span>
              <span className="text-[10px] text-gray-700 truncate flex-1" title={entry.filename}>
                {entry.filename}
              </span>
              {!entry.inDocument && (
                <span
                  className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-white"
                  aria-label="Linked but not in document"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
