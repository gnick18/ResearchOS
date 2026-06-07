"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { filesApi } from "@/lib/local-api";
import { fileService } from "@/lib/file-system/file-service";
import { fileEvents } from "@/lib/attachments/file-events";
import { stripAttachmentReferences } from "@/lib/attachments/strip-references";
import { FileExtBadge } from "@/lib/utils/file-icons";
import Tooltip from "./Tooltip";
import AttachmentViewerModal from "./AttachmentViewerModal";

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
  /** Legacy attachments directory (the retired Files panel wrote here as
   *  `NotesPDFs/` / `ResultsPDFs/`). The unified strip reads non-image files
   *  from here too (the UNION read) so nothing previously attached is
   *  orphaned. New uploads never land here; this is read-only legacy. */
  legacyPdfsDir?: string;
  className?: string;
  /** Context label used in empty-state copy. Defaults to "experiment". */
  recordType?: "experiment" | "note" | "method" | "list" | "purchase";
  /** Strip the markdown ref(s) for a just-deleted file from the body. Only
   *  wired on editing surfaces; absent on read-only strips. */
  onBodyChange?: (next: string) => void;
}

interface StripEntry {
  filename: string;
  /** Path inside the markdown's directory (`Files/{filename}` for the
   *  primary set; the legacy folder name for union-read legacy files). */
  relativePath: string;
  /** Full FS path, used to view / delete the file. */
  fullPath: string;
  /** Whether this file lives in the primary `Files/` folder (draggable +
   *  ref-strippable) or the legacy folder (view / delete only). */
  source: "files" | "legacy";
  inDocument: boolean;
}

const isRenderableFile = (filename: string): boolean => {
  const ext = filename.toLowerCase().split(".").pop() || "";
  return ["pdf", "png", "jpg", "jpeg", "gif", "svg", "webp", "md", "txt"].includes(ext);
};

function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() || "";
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

/** Stream a non-renderable file to the browser's download flow. */
async function downloadFile(path: string, name: string): Promise<void> {
  try {
    const fileData = await filesApi.readFile(path);
    const binaryString = atob(fileData.content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: getMimeType(name) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    alert("Failed to download file");
  }
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

// fileIcon replaced by shared FileExtBadge component (see lib/utils/file-icons.tsx)

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
  legacyPdfsDir,
  className,
  recordType = "experiment",
  onBodyChange,
}: FileStripProps) {
  const [folderEntries, setFolderEntries] = useState<string[]>([]);
  const [legacyEntries, setLegacyEntries] = useState<string[]>([]);
  const [viewing, setViewing] = useState<{ path: string; name: string } | null>(null);

  const referencedNames = useMemo(() => filesReferencedInMarkdown(content), [content]);

  const refresh = useCallback(async () => {
    // Primary `Files/` folder — drag-to-insert + ref-strippable.
    if (basePath) {
      try {
        const items = await filesApi.listDirectory(`${basePath}/Files`);
        setFolderEntries(
          items
            .filter((item) => item.type === "file")
            .map((item) => item.name)
            .filter((name) => !IMAGE_EXTS.has(getExtension(name)))
        );
      } catch {
        setFolderEntries([]);
      }
    } else {
      setFolderEntries([]);
    }
    // Legacy `NotesPDFs/` / `ResultsPDFs/` folder — UNION read so files
    // attached through the retired Files panel still appear. View / delete
    // only (no drag-to-insert: they don't live under `Files/`).
    if (legacyPdfsDir) {
      try {
        const items = await filesApi.listDirectory(legacyPdfsDir);
        setLegacyEntries(
          items
            .filter((item) => item.type === "file")
            .map((item) => item.name)
            .filter((name) => !IMAGE_EXTS.has(getExtension(name)))
        );
      } catch {
        setLegacyEntries([]);
      }
    } else {
      setLegacyEntries([]);
    }
  }, [basePath, legacyPdfsDir]);

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
      if (detail.basePath === basePath || detail.basePath === legacyPdfsDir) void refresh();
    });
    const offDeleted = fileEvents.onDeleted((detail) => {
      if (detail.basePath === basePath || detail.basePath === legacyPdfsDir) void refresh();
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      offAttached();
      offDeleted();
    };
  }, [refresh, basePath, legacyPdfsDir]);

  const entries: StripEntry[] = useMemo(() => {
    const items: StripEntry[] = [
      ...folderEntries.map((name): StripEntry => ({
        filename: name,
        relativePath: `Files/${name}`,
        fullPath: basePath ? `${basePath}/Files/${name}` : `Files/${name}`,
        source: "files",
        inDocument: referencedNames.has(name),
      })),
      ...legacyEntries.map((name): StripEntry => ({
        filename: name,
        relativePath: name,
        fullPath: legacyPdfsDir ? `${legacyPdfsDir}/${name}` : name,
        source: "legacy",
        // Legacy files aren't under `Files/`, so the document-reference probe
        // (which only matches `Files/…`) never flags them as in-document.
        inDocument: false,
      })),
    ];
    return items.sort((a, b) => {
      if (a.inDocument !== b.inDocument) return a.inDocument ? 1 : -1;
      return a.filename.localeCompare(b.filename);
    });
  }, [folderEntries, legacyEntries, basePath, legacyPdfsDir, referencedNames]);

  // Click a tile: renderable files open the inline viewer; everything else
  // downloads. Mirrors the retired PdfAttachmentsPanel behavior.
  const handleView = useCallback((entry: StripEntry) => {
    if (isRenderableFile(entry.filename)) {
      setViewing({ path: entry.fullPath, name: entry.filename });
    } else {
      void downloadFile(entry.fullPath, entry.filename);
    }
  }, []);

  // Delete from disk, strip any inline `Files/{name}` refs from the body, and
  // broadcast so sibling strips re-list. `Files/`-scoped strip only fires the
  // ref-strip; legacy files have no `Files/` ref to remove.
  const handleDelete = useCallback(
    async (entry: StripEntry) => {
      if (!confirm(`Delete "${entry.filename}"?`)) return;
      try {
        const ok = await fileService.deleteFile(entry.fullPath);
        if (!ok) {
          alert("Failed to delete file");
          return;
        }
        if (entry.source === "files" && onBodyChange) {
          onBodyChange(stripAttachmentReferences(content, entry.filename, "Files"));
        }
        const emitBase = entry.source === "files" ? basePath : legacyPdfsDir;
        if (emitBase) fileEvents.emitDeleted({ basePath: emitBase, filename: entry.filename });
        void refresh();
      } catch {
        alert("Failed to delete file");
      }
    },
    [basePath, legacyPdfsDir, content, onBodyChange, refresh]
  );

  const wrapperClass = `sticky bottom-0 z-10 ${className ?? ""}`.trim();

  if (entries.length === 0) {
    return (
      <div className={wrapperClass}>
        <p className="text-meta text-foreground-muted italic px-3 py-2 bg-surface-sunken border-t border-border">
          No files attached to this {recordType} yet. Drag a file in or use the Add File button.
        </p>
      </div>
    );
  }

  const linkedOnlyCount = entries.filter((e) => !e.inDocument).length;

  return (
    <div className={wrapperClass}>
      <div className="flex items-center gap-2 px-3 py-2 overflow-x-auto bg-surface-sunken border-t border-border">
        <span className="text-meta text-foreground-muted font-medium flex-shrink-0 mr-1">
          {entries.length} file{entries.length === 1 ? "" : "s"}
          {linkedOnlyCount > 0 && (
            <span className="ml-1 text-blue-600">({linkedOnlyCount} unlinked)</span>
          )}
        </span>
        {entries.map((entry) => {
          const draggable = entry.source === "files" && !!basePath;
          const payload: FileStripDragPayload = {
            filename: entry.filename,
            basePath: basePath ?? "",
          };
          const tooltip = entry.inDocument
            ? `${entry.filename} — click to view`
            : draggable
              ? `${entry.filename} — click to view, or drag into the document to insert.`
              : `${entry.filename} — click to view.`;
          return (
            <div
              key={entry.fullPath}
              draggable={draggable}
              onDragStart={
                draggable
                  ? (e) => {
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
                    }
                  : undefined
              }
              onDragEnd={draggable ? () => fileEvents.emitDragEnd() : undefined}
              onClick={() => handleView(entry)}
              className={`group relative flex-shrink-0 w-28 h-16 rounded-md border border-border bg-surface-raised overflow-hidden hover:border-blue-400 hover:ring-2 hover:ring-blue-200 transition-all flex items-center gap-2 px-2 ${
                draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
              }`}
              title={tooltip}
            >
              <FileExtBadge filename={entry.filename} />
              <span className="text-meta text-foreground truncate flex-1" title={entry.filename}>
                {entry.filename}
              </span>
              {!entry.inDocument && entry.source === "files" && (
                <span
                  className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-white"
                  aria-label="Linked but not in document"
                />
              )}
              <Tooltip label="Delete file" placement="top">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDelete(entry);
                  }}
                  aria-label={`Delete ${entry.filename}`}
                  data-force-hover-controls-target
                  className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 p-1 text-foreground-muted hover:text-red-600 hover:bg-red-50 rounded transition-all bg-white/80"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          );
        })}
      </div>
      {viewing && (
        <AttachmentViewerModal
          path={viewing.path}
          name={viewing.name}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
