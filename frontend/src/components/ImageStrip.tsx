"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import { imageEvents } from "@/lib/attachments/image-events";
import { listImagesInFolder, type FolderImageEntry } from "@/lib/attachments/image-folder";
import ImageMetadataPopup from "./ImageMetadataPopup";

/** MIME-style key for drag-and-drop. Defined here so the editor can pick it
 *  out without coupling. */
export const STRIP_DRAG_MIME = "application/x-research-os-image";

export interface StripDragPayload {
  /** Filename within the task's Images/ folder. */
  filename: string;
  /** Source `basePath` (the strip's task), used by the trash drop-zone to
   *  know which file to delete. */
  basePath: string;
  /** Optional caption pulled from the sidecar at drag-start. */
  caption?: string;
}

interface ImageStripProps {
  /** Raw markdown source — used to figure out which linked files are
   *  actually referenced in the document (vs. linked-only). */
  content: string;
  /** Directory the markdown file lives in (e.g. `users/Grant/results/task-3`).
   *  We list `${basePath}/Images/` for the primary thumbnail set, and resolve
   *  relative srcs against it. */
  basePath?: string;
  /** Triggered when the user clicks "Jump to occurrence" inside the metadata
   *  popup. Parent (markdown editor) scrolls the preview to the image. */
  onJumpToImage?: (filename: string) => void;
  className?: string;
}

interface StripEntry {
  filename: string;
  /** Path inside the markdown's directory (always `Images/{filename}`). */
  relativePath: string;
  /** Full FS path, used to resolve a blob URL. */
  fullPath: string;
  inDocument: boolean;
  sidecarCaption?: string;
}

const MD_REGEX = /!\[[^\]]*\]\(([^)\s]+)/g;
const HTML_REGEX = /<img\s+[^>]*src=["']([^"']+)["']/gi;

function imagesReferencedInMarkdown(markdown: string): Set<string> {
  const referenced = new Set<string>();
  const collect = (regex: RegExp) => {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(markdown)) !== null) {
      let src = m[1];
      if (src.startsWith("./")) src = src.slice(2);
      if (src.startsWith("Images/")) {
        const name = src.slice("Images/".length);
        if (!name.includes("/")) referenced.add(name);
      }
    }
  };
  collect(new RegExp(MD_REGEX.source, "g"));
  collect(new RegExp(HTML_REGEX.source, "gi"));
  return referenced;
}

/**
 * Horizontal scrollable strip of every image **linked** to the current task —
 * meaning every image file in the task's `Images/` folder, whether or not the
 * markdown body references it yet. Images that ARE referenced in the body get
 * a normal appearance; images that exist on disk but aren't in the doc yet
 * (e.g. just arrived via Telegram) get a small blue dot to flag them.
 */
export default function ImageStrip({
  content,
  basePath,
  onJumpToImage,
  className,
}: ImageStripProps) {
  const [folderEntries, setFolderEntries] = useState<FolderImageEntry[]>([]);
  const [blobUrls, setBlobUrls] = useState<Map<string, string>>(new Map());
  const [popupFilename, setPopupFilename] = useState<string | null>(null);

  const referencedNames = useMemo(() => imagesReferencedInMarkdown(content), [content]);

  const refresh = useCallback(async () => {
    if (!basePath) {
      setFolderEntries([]);
      return;
    }
    try {
      const entries = await listImagesInFolder(basePath);
      setFolderEntries(entries);
    } catch {
      setFolderEntries([]);
    }
  }, [basePath]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on deps change
    void refresh();
  }, [refresh]);

  // Refresh when an image is attached / has its metadata changed / is deleted
  // anywhere in the app (in-app upload, Telegram inbound, metadata popup,
  // trash drop-zone). We compare basePath so unrelated tasks don't re-list.
  useEffect(() => {
    const unsubAttach = imageEvents.onAttached((ev) => {
      if (ev.basePath === basePath) void refresh();
    });
    const unsubMeta = imageEvents.onMetadataChanged((ev) => {
      if (ev.basePath === basePath) void refresh();
    });
    const unsubDelete = imageEvents.onDeleted((ev) => {
      if (ev.basePath === basePath) void refresh();
    });
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      unsubAttach();
      unsubMeta();
      unsubDelete();
      window.removeEventListener("focus", onFocus);
    };
  }, [basePath, refresh]);

  const entries: StripEntry[] = useMemo(() => {
    const items: StripEntry[] = folderEntries.map((e) => ({
      filename: e.name,
      relativePath: `Images/${e.name}`,
      fullPath: basePath ? `${basePath}/Images/${e.name}` : `Images/${e.name}`,
      inDocument: referencedNames.has(e.name),
      sidecarCaption: e.sidecar?.caption,
    }));
    // Stable order: linked-only first (so the user immediately notices new
    // arrivals), then in-document, alphabetical within each group.
    return items.sort((a, b) => {
      if (a.inDocument !== b.inDocument) return a.inDocument ? 1 : -1;
      return a.filename.localeCompare(b.filename);
    });
  }, [folderEntries, referencedNames, basePath]);

  // Resolve blob URLs for everything we're showing.
  useEffect(() => {
    if (entries.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reset when entries cleared
      setBlobUrls(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const next = new Map<string, string>();
      for (const entry of entries) {
        const cached = blobUrlResolver.getCachedUrl(entry.fullPath);
        if (cached) {
          next.set(entry.fullPath, cached);
          continue;
        }
        const url = await blobUrlResolver.getBlobUrl(entry.fullPath);
        if (url) next.set(entry.fullPath, url);
      }
      if (!cancelled) setBlobUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [entries]);

  const wrapperClass = `sticky bottom-0 z-10 ${className ?? ""}`.trim();

  if (entries.length === 0) {
    return (
      <div className={wrapperClass}>
        <p className="text-xs text-gray-400 italic px-3 py-2 bg-gray-50 border-t border-gray-200">
          No images linked to this experiment yet. Send one via Telegram or drag a file in.
        </p>
      </div>
    );
  }

  const linkedOnlyCount = entries.filter((e) => !e.inDocument).length;

  return (
    <div className={wrapperClass}>
      <div className="flex items-center gap-2 px-3 py-2 overflow-x-auto bg-gray-50 border-t border-gray-200">
        <span className="text-xs text-gray-500 font-medium flex-shrink-0 mr-1">
          {entries.length} image{entries.length === 1 ? "" : "s"}
          {linkedOnlyCount > 0 && (
            <span className="ml-1 text-blue-600">({linkedOnlyCount} new)</span>
          )}
        </span>
        {entries.map((entry) => {
          const url = blobUrls.get(entry.fullPath);
          const tooltip = entry.sidecarCaption
            ? `${entry.sidecarCaption} — ${entry.filename}`
            : entry.filename;
          const payload: StripDragPayload = {
            filename: entry.filename,
            basePath: basePath ?? "",
            caption: entry.sidecarCaption,
          };
          return (
            <button
              key={entry.filename}
              type="button"
              draggable={!!basePath}
              onDragStart={(e) => {
                e.dataTransfer.setData(STRIP_DRAG_MIME, JSON.stringify(payload));
                e.dataTransfer.setData(
                  "text/plain",
                  `![${entry.sidecarCaption ?? ""}](Images/${entry.filename})`
                );
                e.dataTransfer.effectAllowed = "copyMove";
                const img = e.currentTarget.querySelector("img");
                if (img) e.dataTransfer.setDragImage(img, 32, 32);
                imageEvents.emitDragStart({
                  basePath: basePath ?? "",
                  filename: entry.filename,
                  caption: entry.sidecarCaption,
                });
              }}
              onDragEnd={() => imageEvents.emitDragEnd()}
              onClick={() => setPopupFilename(entry.filename)}
              className="group relative flex-shrink-0 w-16 h-16 rounded-md border border-gray-200 bg-white overflow-hidden hover:border-blue-400 hover:ring-2 hover:ring-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-grab active:cursor-grabbing"
              title={tooltip}
            >
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={entry.filename} className="w-full h-full object-cover pointer-events-none" />
              ) : (
                <div className="w-full h-full bg-gray-100" />
              )}
              {!entry.inDocument && (
                <span
                  className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-white"
                  aria-label="Linked but not in document"
                />
              )}
              <span className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[9px] text-white bg-black/60 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                {entry.filename}
              </span>
            </button>
          );
        })}
      </div>
      {popupFilename && basePath && (
        <ImageMetadataPopup
          basePath={basePath}
          filename={popupFilename}
          inDocument={referencedNames.has(popupFilename)}
          onJump={onJumpToImage}
          onClose={() => setPopupFilename(null)}
        />
      )}
    </div>
  );
}
