"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { blobUrlResolver, encodeAttachmentRefPath } from "@/lib/utils/blob-url-resolver";
import { imageEvents } from "@/lib/attachments/image-events";
import { listImagesInFolder, hasImageExtension, type FolderImageEntry } from "@/lib/attachments/image-folder";
import { deleteImageFromBase } from "@/lib/attachments/move-image";
import { stripAttachmentReferences } from "@/lib/attachments/strip-references";
import { fileService } from "@/lib/file-system/file-service";
import ImageMetadataPopup from "./ImageMetadataPopup";
import AnnotatedImage from "./AnnotatedImage";
import AttachmentViewerModal from "./AttachmentViewerModal";
import Tooltip from "./Tooltip";
import dynamic from "next/dynamic";
import { usePreloadOnIdle } from "@/lib/perf/use-preload-on-idle";

// Konva touches window/canvas and breaks SSR, so the annotator is client-only
// and lazy-loaded; it mounts only when the user opens it from a thumbnail's
// pen button.
const ImageAnnotatorModal = dynamic(() => import("./ImageAnnotatorModal"), {
  ssr: false,
});

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
  /** Legacy attachments directory (the retired Files panel wrote here as
   *  `NotesPDFs/` / `ResultsPDFs/`). The unified strip reads image files from
   *  here too (the UNION read) so nothing previously attached is orphaned.
   *  New uploads never land here; legacy images are view / delete only. */
  legacyPdfsDir?: string;
  /** Triggered when the user clicks "Jump to occurrence" inside the metadata
   *  popup. Parent (markdown editor) scrolls the preview to the image. */
  onJumpToImage?: (filename: string) => void;
  className?: string;
  /** Context label used in empty-state copy. Defaults to "experiment". */
  recordType?: "experiment" | "note" | "method" | "list" | "purchase";
  /** Strip the markdown ref(s) for a just-deleted image from the body. Only
   *  wired on editing surfaces; absent on read-only strips. */
  onBodyChange?: (next: string) => void;
}

interface StripEntry {
  filename: string;
  /** Path inside the markdown's directory (`Images/{filename}` for the
   *  primary set; the legacy folder name for union-read legacy images). */
  relativePath: string;
  /** Full FS path, used to resolve a blob URL and to delete. */
  fullPath: string;
  /** Whether the image lives under the primary `Images/` folder (draggable +
   *  sidecar-aware) or the legacy folder (view / delete only). */
  source: "images" | "legacy";
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
  legacyPdfsDir,
  onJumpToImage,
  className,
  recordType = "experiment",
  onBodyChange,
}: ImageStripProps) {
  // The user is looking at images and may annotate one, so warm the lazy
  // ImageAnnotatorModal chunk on idle for an instant first open.
  usePreloadOnIdle(() => import("./ImageAnnotatorModal"));
  const [folderEntries, setFolderEntries] = useState<FolderImageEntry[]>([]);
  const [legacyEntries, setLegacyEntries] = useState<string[]>([]);
  const [blobUrls, setBlobUrls] = useState<Map<string, string>>(new Map());
  const [popupFilename, setPopupFilename] = useState<string | null>(null);
  const [annotatingFilename, setAnnotatingFilename] = useState<string | null>(null);
  const [viewingLegacy, setViewingLegacy] = useState<{ path: string; name: string } | null>(null);

  const referencedNames = useMemo(() => imagesReferencedInMarkdown(content), [content]);

  const refresh = useCallback(async () => {
    if (basePath) {
      try {
        setFolderEntries(await listImagesInFolder(basePath));
      } catch {
        setFolderEntries([]);
      }
    } else {
      setFolderEntries([]);
    }
    // UNION read of image files in the legacy `NotesPDFs/` / `ResultsPDFs/`
    // folder so images attached through the retired Files panel still appear.
    if (legacyPdfsDir) {
      try {
        const all = await fileService.listFiles(legacyPdfsDir);
        setLegacyEntries(all.filter((name) => !name.startsWith(".") && hasImageExtension(name)));
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

  // Refresh when an image is attached / has its metadata changed / is deleted
  // anywhere in the app (in-app upload, Telegram inbound, metadata popup,
  // trash drop-zone). We compare basePath so unrelated tasks don't re-list.
  useEffect(() => {
    const matches = (b: string) => b === basePath || b === legacyPdfsDir;
    const unsubAttach = imageEvents.onAttached((ev) => {
      if (matches(ev.basePath)) void refresh();
    });
    const unsubMeta = imageEvents.onMetadataChanged((ev) => {
      if (matches(ev.basePath)) void refresh();
    });
    const unsubDelete = imageEvents.onDeleted((ev) => {
      if (matches(ev.basePath)) void refresh();
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
  }, [basePath, legacyPdfsDir, refresh]);

  const entries: StripEntry[] = useMemo(() => {
    const items: StripEntry[] = [
      ...folderEntries.map((e): StripEntry => ({
        filename: e.name,
        relativePath: `Images/${e.name}`,
        fullPath: basePath ? `${basePath}/Images/${e.name}` : `Images/${e.name}`,
        source: "images",
        inDocument: referencedNames.has(e.name),
        sidecarCaption: e.sidecar?.caption,
      })),
      ...legacyEntries.map((name): StripEntry => ({
        filename: name,
        relativePath: name,
        fullPath: legacyPdfsDir ? `${legacyPdfsDir}/${name}` : name,
        source: "legacy",
        // Legacy images aren't under `Images/`, so the reference probe (which
        // only matches `Images/…`) never flags them as in-document.
        inDocument: false,
      })),
    ];
    // Stable order: linked-only first (so the user immediately notices new
    // arrivals), then in-document, alphabetical within each group.
    return items.sort((a, b) => {
      if (a.inDocument !== b.inDocument) return a.inDocument ? 1 : -1;
      return a.filename.localeCompare(b.filename);
    });
  }, [folderEntries, legacyEntries, referencedNames, basePath, legacyPdfsDir]);

  // Delete an image: primary `Images/` files go through the sidecar-aware
  // helper; legacy `NotesPDFs/` files are a single bare delete. Either way we
  // strip the inline `Images/{name}` ref from the body and broadcast.
  const handleDelete = useCallback(
    async (entry: StripEntry) => {
      if (entry.source === "images" && basePath) {
        await deleteImageFromBase(basePath, entry.filename);
      } else {
        await fileService.deleteFile(entry.fullPath);
        blobUrlResolver.revokePath(entry.fullPath);
        if (legacyPdfsDir) imageEvents.emitDeleted({ basePath: legacyPdfsDir, filename: entry.filename });
      }
      if (onBodyChange) {
        onBodyChange(stripAttachmentReferences(content, entry.filename, "Images"));
      }
      void refresh();
    },
    [basePath, legacyPdfsDir, content, onBodyChange, refresh]
  );

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
      <div className={wrapperClass} data-tour-target="hybrid-editor-image-strip">
        <p className="text-meta text-foreground-muted italic px-3 py-2 bg-surface-sunken border-t border-border">
          No images linked to this {recordType} yet. Snap one with the phone companion or drag a file in.
        </p>
      </div>
    );
  }

  const linkedOnlyCount = entries.filter((e) => !e.inDocument).length;

  return (
    <div className={wrapperClass} data-tour-target="hybrid-editor-image-strip">
      <div className="flex items-center gap-2 px-3 py-2 overflow-x-auto bg-surface-sunken border-t border-border">
        <span className="text-meta text-foreground-muted font-medium flex-shrink-0 mr-1">
          {entries.length} image{entries.length === 1 ? "" : "s"}
          {linkedOnlyCount > 0 && (
            <span className="ml-1 text-blue-600">({linkedOnlyCount} new)</span>
          )}
        </span>
        {entries.map((entry) => {
          const url = blobUrls.get(entry.fullPath);
          const draggable = entry.source === "images" && !!basePath;
          const tooltip = entry.sidecarCaption
            ? `${entry.sidecarCaption} — ${entry.filename}`
            : entry.filename;
          const payload: StripDragPayload = {
            filename: entry.filename,
            basePath: basePath ?? "",
            caption: entry.sidecarCaption,
          };
          return (
            <div
              key={entry.fullPath}
              role="button"
              tabIndex={0}
              draggable={draggable}
              onDragStart={
                draggable
                  ? (e) => {
                      e.dataTransfer.setData(STRIP_DRAG_MIME, JSON.stringify(payload));
                      e.dataTransfer.setData(
                        "text/plain",
                        // Percent-encode the filename so a spaced name produces a
                        // CommonMark-valid destination when the receiving editor
                        // falls back to the text/plain payload (matches FileStrip).
                        `![${entry.sidecarCaption ?? ""}](${encodeAttachmentRefPath("Images", entry.filename)})`
                      );
                      e.dataTransfer.effectAllowed = "copyMove";
                      const img = e.currentTarget.querySelector("img");
                      if (img) e.dataTransfer.setDragImage(img, 32, 32);
                      imageEvents.emitDragStart({
                        basePath: basePath ?? "",
                        filename: entry.filename,
                        caption: entry.sidecarCaption,
                      });
                    }
                  : undefined
              }
              onDragEnd={draggable ? () => imageEvents.emitDragEnd() : undefined}
              onClick={() => {
                // Primary images open the rich metadata popup; legacy images
                // (no sidecar, not under Images/) open the simple viewer.
                if (entry.source === "images") setPopupFilename(entry.filename);
                else setViewingLegacy({ path: entry.fullPath, name: entry.filename });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (entry.source === "images") setPopupFilename(entry.filename);
                  else setViewingLegacy({ path: entry.fullPath, name: entry.filename });
                }
              }}
              className={`group relative flex-shrink-0 w-16 h-16 rounded-md border border-border bg-surface-raised overflow-hidden hover:border-blue-400 hover:ring-2 hover:ring-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${
                draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
              }`}
              title={tooltip}
            >
              {url ? (
                <AnnotatedImage
                  src={url}
                  alt={entry.filename}
                  basePath={basePath ?? undefined}
                  filename={entry.filename}
                  className="w-full h-full object-cover pointer-events-none"
                />
              ) : (
                <div className="w-full h-full bg-surface-sunken" />
              )}
              {!entry.inDocument && (
                <span
                  className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-white"
                  aria-label="Linked but not in document"
                />
              )}
              {entry.source === "images" && basePath && (
                <Tooltip label="Annotate">
                  <button
                    type="button"
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAnnotatingFilename(entry.filename);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    aria-label="Annotate image"
                    className="absolute top-1 left-1 z-10 flex items-center justify-center w-5 h-5 rounded bg-black/55 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:bg-black/80 focus:outline-none focus:ring-1 focus:ring-white"
                  >
                    {/* Pencil icon (custom inline SVG, matches the popup's Annotate). */}
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
                    </svg>
                  </button>
                </Tooltip>
              )}
              {/* Per-tile delete (carries the markdown-ref strip). Legacy
                  images, which can't reach the metadata popup's delete, rely
                  on this affordance too. Placed top-right to clear the
                  top-left Annotate button. */}
              <span
                role="button"
                tabIndex={0}
                aria-label={`Delete ${entry.filename}`}
                data-force-hover-controls-target
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${entry.filename}"?`)) void handleDelete(entry);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    if (confirm(`Delete "${entry.filename}"?`)) void handleDelete(entry);
                  }
                }}
                className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 p-0.5 text-white bg-black/50 hover:bg-red-600 rounded transition-all cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </span>
              <span className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-meta text-white bg-black/60 truncate opacity-0 group-hover:opacity-100 transition-opacity" data-force-hover-controls-target>
                {entry.filename}
              </span>
            </div>
          );
        })}
      </div>
      {popupFilename && basePath && (
        <ImageMetadataPopup
          basePath={basePath}
          filename={popupFilename}
          inDocument={referencedNames.has(popupFilename)}
          onJump={onJumpToImage}
          // Delete from the popup footer: sidecar-aware delete + markdown-ref
          // strip, mirroring the per-tile delete. Only enabled on editing
          // surfaces (where onBodyChange is wired) so read-only strips don't
          // offer destructive controls.
          onDelete={
            onBodyChange
              ? async () => {
                  const target = entries.find((e) => e.filename === popupFilename);
                  if (target) await handleDelete(target);
                }
              : undefined
          }
          onClose={() => setPopupFilename(null)}
        />
      )}
      {annotatingFilename && basePath && (
        <ImageAnnotatorModal
          basePath={basePath}
          filename={annotatingFilename}
          resolvedSrc={blobUrls.get(`${basePath}/Images/${annotatingFilename}`)}
          onClose={() => setAnnotatingFilename(null)}
        />
      )}
      {viewingLegacy && (
        <AttachmentViewerModal
          path={viewingLegacy.path}
          name={viewingLegacy.name}
          onClose={() => setViewingLegacy(null)}
        />
      )}
    </div>
  );
}
