"use client";

import { useState, useEffect, useCallback } from "react";
import { fileService } from "@/lib/file-system/file-service";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import Tooltip from "./Tooltip";
import { ImageIcon } from "@/lib/utils/icons";

interface ImageGalleryPopupProps {
  isOpen: boolean;
  onClose: () => void;
  experimentId: number;
  experimentName: string;
  experimentDate: string;
  /**
   * Called when the user picks an image. `markdownPath` is the value to put
   * inside `![alt](...)` — relative to the markdown file that's being edited
   * (`results/task-{id}/notes.md` or `results.md`).
   */
  onInsertImage: (markdownPath: string, imageName: string) => void;
}

interface GalleryImage {
  filename: string;
  /** Path on disk under the FSA-mounted folder, e.g. `results/task-3/Images/foo.png` */
  absolutePath: string;
  /** Path to insert in markdown, e.g. `Images/foo.png` */
  insertPath: string;
  size: number;
  lastModified: number;
  blobUrl: string | null;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"]);

function isImageFilename(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Browse-and-insert popup for images already attached to an experiment. Reads
 * directly from `results/task-{id}/Images/` via the File System Access API
 * and inserts the canonical relative path (`Images/{file}`) into the markdown.
 */
export default function ImageGalleryPopup({
  isOpen,
  onClose,
  experimentId,
  experimentName,
  experimentDate,
  onInsertImage,
}: ImageGalleryPopupProps) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<GalleryImage | null>(null);

  const imagesDir = `results/task-${experimentId}/Images`;

  const loadImages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dirHandle = await fileService.getDirectory(imagesDir);
      if (!dirHandle) {
        setImages([]);
        setLoading(false);
        return;
      }
      const entries = await fileService.listFiles(imagesDir);
      const collected: GalleryImage[] = [];
      for (const filename of entries) {
        if (!isImageFilename(filename)) continue;
        const absolutePath = `${imagesDir}/${filename}`;
        const blob = await fileService.readFileAsBlob(absolutePath);
        if (!blob) continue;
        // Prefer the resolver's cached blob URL if we already have one.
        const cached = blobUrlResolver.getCachedUrl(absolutePath);
        const blobUrl = cached ?? (await blobUrlResolver.getBlobUrl(absolutePath));
        const file = await (async () => {
          try {
            return blob as File;
          } catch {
            return null;
          }
        })();
        collected.push({
          filename,
          absolutePath,
          insertPath: `Images/${filename}`,
          size: blob.size,
          lastModified: file && "lastModified" in file ? (file as File).lastModified : 0,
          blobUrl,
        });
      }
      collected.sort((a, b) => a.filename.localeCompare(b.filename));
      setImages(collected);
    } catch (err) {
      console.error("Failed to load images:", err);
      setError("Failed to load images. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [imagesDir]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedImage(null);
    loadImages();
  }, [isOpen, loadImages]);

  const handleInsertImage = useCallback(
    (image: GalleryImage) => {
      onInsertImage(image.insertPath, image.filename);
      onClose();
    },
    [onInsertImage, onClose]
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Image Gallery</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {experimentName} · {experimentDate}
            </p>
          </div>
          <Tooltip label="Close" placement="bottom">
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">
              ✕
            </button>
          </Tooltip>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                <span className="ml-3 text-sm text-gray-500">Loading images...</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <span className="text-3xl mb-2">⚠️</span>
                <p className="text-sm text-red-500">{error}</p>
                <button
                  onClick={loadImages}
                  className="mt-2 px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                >
                  Retry
                </button>
              </div>
            ) : images.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <ImageIcon className="w-10 h-10 text-gray-300 mb-3" />
                <p className="text-sm text-gray-500 mb-1">No images attached yet</p>
                <p className="text-xs text-gray-400">
                  Upload images using the &quot;Add Image&quot; button in the editor
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {images.map((image) => (
                  <div
                    key={image.absolutePath}
                    className={`group relative bg-gray-50 border-2 rounded-lg overflow-hidden cursor-pointer transition-all hover:shadow-md ${
                      selectedImage?.absolutePath === image.absolutePath
                        ? "border-blue-500 ring-2 ring-blue-200"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                    onClick={() => setSelectedImage(image)}
                  >
                    <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                      {image.blobUrl ? (
                        <img
                          src={image.blobUrl}
                          alt={image.filename}
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <ImageIcon className="w-8 h-8 text-gray-300" />
                      )}
                    </div>

                    <div className="p-2 border-t border-gray-100">
                      <p
                        className="text-xs font-medium text-gray-700 truncate"
                        title={image.filename}
                      >
                        {image.filename}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{formatFileSize(image.size)}</p>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleInsertImage(image);
                      }}
                      className="absolute inset-0 bg-blue-500/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      data-force-hover-controls-target
                    >
                      <span className="text-white text-sm font-medium px-3 py-1.5 bg-white/20 rounded-lg">
                        Click to Insert
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedImage && (
            <div className="w-64 border-l border-gray-100 flex flex-col bg-gray-50">
              <div className="p-3 border-b border-gray-100">
                <p className="text-xs font-medium text-gray-700">Preview</p>
              </div>

              <div className="flex-1 flex items-center justify-center p-3 overflow-hidden">
                {selectedImage.blobUrl && (
                  <img
                    src={selectedImage.blobUrl}
                    alt={selectedImage.filename}
                    className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
                  />
                )}
              </div>

              <div className="p-3 border-t border-gray-100 space-y-2">
                <div>
                  <p className="text-[10px] text-gray-400 uppercase">Filename</p>
                  <p className="text-xs text-gray-700 truncate" title={selectedImage.filename}>
                    {selectedImage.filename}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 uppercase">Size</p>
                  <p className="text-xs text-gray-700">{formatFileSize(selectedImage.size)}</p>
                </div>
                {selectedImage.lastModified > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase">Modified</p>
                    <p className="text-xs text-gray-700">
                      {new Date(selectedImage.lastModified).toLocaleDateString()}
                    </p>
                  </div>
                )}

                <button
                  onClick={() => handleInsertImage(selectedImage)}
                  className="w-full mt-2 px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Insert into Document
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400">
            {images.length} image{images.length !== 1 ? "s" : ""} found
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
