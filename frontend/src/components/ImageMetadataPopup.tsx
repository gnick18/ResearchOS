"use client";

import { useEffect, useState } from "react";
import { fileService } from "@/lib/file-system/file-service";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import { imageEvents } from "@/lib/attachments/image-events";
import { sidecarPath, type ImageSidecar } from "@/lib/attachments/image-folder";
import { useAppStore, type ActiveTask } from "@/lib/store";

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

function parseTags(input: string): string[] {
  return input
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function formatTags(tags: string[] | undefined): string {
  return tags?.join(", ") ?? "";
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
  const [caption, setCaption] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [renameInput, setRenameInput] = useState(filename);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

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
      setCaption(existing?.caption ?? "");
      setDescription(existing?.description ?? "");
      setTagsInput(formatTags(existing?.tags));
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
        caption: caption.trim() || undefined,
        description: description.trim() || undefined,
        tags: parseTags(tagsInput),
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
        caption: caption.trim() || undefined,
        description: description.trim() || undefined,
        tags: parseTags(tagsInput),
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
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this popup
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="image-metadata"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 truncate" title={filename}>
            {filename}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex">
          {/* Preview */}
          <div className="w-1/2 bg-gray-100 flex items-center justify-center min-h-[280px] max-h-[60vh] overflow-hidden">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={filename} className="max-w-full max-h-[60vh] object-contain" />
            ) : (
              <span className="text-xs text-gray-400">Loading preview…</span>
            )}
          </div>

          {/* Metadata form */}
          <div className="w-1/2 px-5 py-4 space-y-3 overflow-y-auto max-h-[60vh]">
            {!loaded ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Caption
                  </label>
                  <input
                    type="text"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Used as alt-text when dragged into the note"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    placeholder="What does this image show? Conditions, time, etc."
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Tags
                  </label>
                  <input
                    type="text"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="comma, separated, tags"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {onRename && (
                  <div className="pt-2 border-t border-gray-100">
                    <label className="block text-xs font-medium text-gray-500 mb-1">
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
                        className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={handleRename}
                        disabled={renaming || renameInput.trim() === filename || !renameInput.trim()}
                        className="px-3 py-2 text-xs text-white bg-gray-700 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-40"
                      >
                        {renaming ? "Renaming…" : "Rename"}
                      </button>
                    </div>
                    {renameError && (
                      <p className="mt-1 text-xs text-red-600">{renameError}</p>
                    )}
                  </div>
                )}
                {sidecar?.source && (
                  <div className="text-xs text-gray-400 pt-1 space-y-0.5">
                    <p>
                      Source: <span className="font-mono">{sidecar.source}</span>
                    </p>
                    {sidecar.receivedAt && (
                      <p>Received: {new Date(sidecar.receivedAt).toLocaleString()}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleJump}
              disabled={!inDocument}
              className="px-3 py-2 text-xs text-blue-700 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={
                inDocument
                  ? "Scroll the rendered note to this image"
                  : "This image isn't in the note yet — drag it in first"
              }
            >
              ↪ Jump to occurrence in note
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-2 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Delete file"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onMoveToActive && activeTask && (
              <button
                type="button"
                onClick={handleMoveToActive}
                disabled={moving || !loaded}
                title={`File this image into Experiment ${activeTask.id} (${activeTask.name})`}
                className="px-4 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 font-medium"
              >
                {moving ? "Moving…" : `Move to ${activeTask.name}`}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !loaded}
              className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
