"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { fileService } from "@/lib/file-system/file-service";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import { imageEvents } from "@/lib/attachments/image-events";
import { sidecarPath, type ImageSidecar } from "@/lib/attachments/image-folder";
import { useAppStore, type ActiveTask } from "@/lib/store";
import AnnotatedImage from "@/components/AnnotatedImage";
import { OcrReveal } from "@/components/OcrImage";
import LivingPopup from "@/components/ui/LivingPopup";

// Konva touches window/canvas and breaks SSR, so the annotator is loaded
// client-only. It mounts lazily only when the user clicks "Annotate".
const ImageAnnotatorModal = dynamic(() => import("@/components/ImageAnnotatorModal"), {
  ssr: false,
});

interface ImageMetadataPopupProps {
  basePath: string;
  filename: string;
  /** Whether the image is referenced in the markdown body — controls whether
   *  the "Jump to occurrence" button is enabled. */
  inDocument: boolean;
  /** Triggered when the user clicks "Jump to occurrence in note". */
  onJump?: (filename: string) => void;
  /** When provided, the popup shows a rename input. The callback should
   *  perform the actual file move + emit events; throw to surface an error
   *  in the popup. */
  onRename?: (newFilename: string) => Promise<void>;
  /** When provided, the popup shows a "Delete file" button in the footer. */
  onDelete?: () => Promise<void>;
  /** When provided AND an experiment popup is open, the metadata popup shows
   *  a primary "Move to <experiment>" button so the user can file an inbox
   *  arrival without bouncing between dialogs. */
  onMoveToActive?: (task: ActiveTask) => Promise<void>;
  onClose: () => void;
}

export default function ImageMetadataPopup({
  basePath,
  filename,
  inDocument,
  onJump,
  onRename,
  onDelete,
  onMoveToActive,
  onClose,
}: ImageMetadataPopupProps) {
  const activeTask = useAppStore((s) => s.activeTask);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sidecar, setSidecar] = useState<ImageSidecar | null>(null);
  const [description, setDescription] = useState("");
  const [renameInput, setRenameInput] = useState(filename);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [annotating, setAnnotating] = useState(false);

  // Escape close is owned by LivingPopup (closeOnEscape). Suspended while the
  // annotator overlay is open so its own Escape (deselect, then close) wins.

  const sidecarFsPath = sidecarPath(basePath, filename);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fullPath = `${basePath}/Images/${filename}`;
      const url = await blobUrlResolver.getBlobUrl(fullPath);
      if (cancelled) return;
      setPreviewUrl(url);
      const existing = await fileService.readJson<ImageSidecar>(sidecarFsPath);
      if (cancelled) return;
      setSidecar(existing);
      setDescription(existing?.description ?? "");
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [basePath, filename, sidecarFsPath]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const next: ImageSidecar = {
        ...sidecar,
        description: description.trim() || undefined,
      };
      await fileService.writeJson(sidecarFsPath, next);
      imageEvents.emitMetadataChanged({ basePath, filename });
      onClose();
    } catch {
      alert("Failed to save metadata.");
    } finally {
      setSaving(false);
    }
  };

  const handleJump = () => {
    onJump?.(filename);
    onClose();
  };

  const handleRename = async () => {
    if (!onRename) return;
    const next = renameInput.trim();
    setRenameError(null);
    if (!next) {
      setRenameError("Filename can't be empty.");
      return;
    }
    if (next === filename) {
      setRenameError("That's already the filename.");
      return;
    }
    setRenaming(true);
    try {
      await onRename(next);
      onClose();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Rename failed.");
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    const ok = window.confirm(
      `Delete "${filename}"? The file and its sidecar are removed from disk.`
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await onDelete();
      onClose();
    } catch (err) {
      console.error("[image-metadata] delete failed", err);
      alert(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  };

  const handleMoveToActive = async () => {
    if (!onMoveToActive || !activeTask) return;
    setMoving(true);
    try {
      // Persist any pending metadata edits first so they ride along with the
      // file move. If the move fails, the sidecar update is still useful.
      const next: ImageSidecar = {
        ...sidecar,
        description: description.trim() || undefined,
      };
      await fileService.writeJson(sidecarFsPath, next);
      await onMoveToActive(activeTask);
      onClose();
    } catch (err) {
      console.error("[image-metadata] move failed", err);
      alert(err instanceof Error ? err.message : "Move failed.");
    } finally {
      setMoving(false);
    }
  };

  return (
    <>
    <LivingPopup
      open
      onClose={onClose}
      label="Image details"
      widthClassName="max-w-2xl"
      card={false}
      blur
      // The annotator owns Escape and outside-clicks while it is open, so the
      // metadata popup must not also close on those then.
      closeOnEscape={!annotating}
      closeOnScrimClick={!annotating}
    >
      <div className="bg-surface-overlay rounded-xl ros-popup-card-shadow w-full overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-surface-sunken flex items-center justify-between">
          <h3 className="text-title font-semibold text-foreground truncate" title={filename}>
            {filename}
          </h3>
          <button
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground text-heading leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex">
          {/* Preview */}
          <div className="w-1/2 bg-surface-sunken flex items-center justify-center min-h-[280px] max-h-[60vh] overflow-hidden">
            {previewUrl ? (
              // AnnotatedImage (not a bare <img>) so the annotation overlay
              // renders in the preview too, and updates live via imageEvents
              // when the user annotates from this same popup.
              <AnnotatedImage
                src={previewUrl}
                basePath={basePath}
                filename={filename}
                alt={filename}
                className="max-w-full max-h-[60vh] object-contain"
              />
            ) : (
              <span className="text-meta text-foreground-muted">Loading preview…</span>
            )}
          </div>

          {/* Metadata + actions */}
          <div className="w-1/2 px-5 py-4 flex flex-col overflow-y-auto max-h-[60vh]">
            {!loaded ? (
              <p className="text-body text-foreground-muted">Loading…</p>
            ) : (
              <>
                <div className="space-y-3">
                  <div>
                    <label className="block text-meta font-medium text-foreground-muted mb-1">
                      Description
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={4}
                      placeholder="What does this image show? Conditions, time, etc."
                      className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                    />
                  </div>
                  {/* Extracted text from a scanned handwriting note. Renders
                      nothing when the image has no .ocr.json sidecar. */}
                  <OcrReveal basePath={basePath} filename={filename} />
                  {onRename && (
                    <div className="pt-2 border-t border-border">
                      <label className="block text-meta font-medium text-foreground-muted mb-1">
                        Filename
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={renameInput}
                          onChange={(e) => {
                            setRenameInput(e.target.value);
                            setRenameError(null);
                          }}
                          className="flex-1 px-3 py-2 border border-border rounded-lg text-body font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={handleRename}
                          disabled={renaming || renameInput.trim() === filename || !renameInput.trim()}
                          className="ros-btn-raise px-3 py-2 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-lg transition-colors disabled:opacity-40"
                        >
                          {renaming ? "Renaming…" : "Rename"}
                        </button>
                      </div>
                      {renameError && (
                        <p className="mt-1 text-meta text-red-600 dark:text-red-300">{renameError}</p>
                      )}
                    </div>
                  )}
                  {sidecar?.source && (
                    <div className="text-meta text-foreground-muted pt-1 space-y-0.5">
                      <p>
                        Source: <span className="font-mono">{sidecar.source}</span>
                      </p>
                      {sidecar.receivedAt && (
                        <p>Received: {new Date(sidecar.receivedAt).toLocaleString()}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Primary actions live in the open right-hand space (pinned to
                    the bottom of the column) instead of a cramped footer bar. */}
                <div className="mt-auto pt-4 space-y-2">
                  <button
                    type="button"
                    onClick={() => setAnnotating(true)}
                    disabled={!loaded || !previewUrl}
                    className="ros-btn-raise w-full flex items-center justify-center gap-2 px-4 py-2.5 text-body font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {/* Pencil icon (custom inline SVG, no icon library). */}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
                    </svg>
                    Annotate
                  </button>
                  <button
                    type="button"
                    onClick={handleJump}
                    disabled={!inDocument}
                    title={
                      inDocument
                        ? "Scroll the rendered note to this image"
                        : "This image isn't in the note yet — drag it in first"
                    }
                    className="w-full px-4 py-2 text-body text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-brand-action/15 hover:bg-blue-100 dark:hover:bg-brand-action/20 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ↪ Jump to occurrence in note
                  </button>
                  {onDelete && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="w-full px-4 py-2 text-body text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-40"
                    >
                      {deleting ? "Deleting…" : "Delete file"}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="px-5 py-3 bg-surface-sunken border-t border-border flex items-center justify-end gap-2">
            {onMoveToActive && activeTask && (
              <button
                type="button"
                onClick={handleMoveToActive}
                disabled={moving || !loaded}
                title={`File this image into Experiment ${activeTask.id} (${activeTask.name})`}
                className="ros-btn-raise px-4 py-2 text-body text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 font-medium"
              >
                {moving ? "Moving…" : `Move to ${activeTask.name}`}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !loaded}
              className="ros-btn-raise px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
        </div>
      </div>
    </LivingPopup>

      {/* The annotator is a full-screen overlay; it renders OUTSIDE LivingPopup
          so the card's zoom transform cannot clip it, and at a higher z so it
          sits above the metadata popup (see its z-[450] root). */}
      {annotating && (
        <ImageAnnotatorModal
          basePath={basePath}
          filename={filename}
          resolvedSrc={previewUrl ?? undefined}
          onClose={() => setAnnotating(false)}
        />
      )}
    </>
  );
}
