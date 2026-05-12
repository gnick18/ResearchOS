"use client";

import { useEffect, useState } from "react";
import { fileService } from "@/lib/file-system/file-service";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import { imageEvents } from "@/lib/attachments/image-events";
import { sidecarPath, type ImageSidecar } from "@/lib/attachments/image-folder";

interface ImageMetadataPopupProps {
  basePath: string;
  filename: string;
  /** Whether the image is referenced in the markdown body — controls whether
   *  the "Jump to occurrence" button is enabled. */
  inDocument: boolean;
  /** Triggered when the user clicks "Jump to occurrence in note". */
  onJump?: (filename: string) => void;
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
  onClose,
}: ImageMetadataPopupProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sidecar, setSidecar] = useState<ImageSidecar | null>(null);
  const [caption, setCaption] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
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

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm"
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
              <span className="text-gray-300 text-5xl">🖼</span>
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
          <div className="flex items-center gap-2">
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
