"use client";

import { useState, useEffect, useCallback } from "react";
import { attachmentsApi } from "@/lib/api";
import type { ImageMetadata } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

interface ImageGalleryPopupProps {
  isOpen: boolean;
  onClose: () => void;
  experimentId: number;
  experimentName: string;
  experimentDate: string;
  onInsertImage: (markdownPath: string, imageName: string) => void;
}

export default function ImageGalleryPopup({
  isOpen,
  onClose,
  experimentId,
  experimentName,
  experimentDate,
  onInsertImage,
}: ImageGalleryPopupProps) {
  const [images, setImages] = useState<ImageMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<ImageMetadata | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Load images for this experiment
  useEffect(() => {
    if (!isOpen) return;

    const loadImages = async () => {
      setLoading(true);
      setError(null);
      try {
        const imageList = await attachmentsApi.listImages({ experiment_id: experimentId });
        setImages(imageList);
      } catch (err) {
        console.error("Failed to load images:", err);
        setError("Failed to load images. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    loadImages();
  }, [isOpen, experimentId]);

  // Generate preview URL for selected image
  useEffect(() => {
    if (selectedImage) {
      // The path is like "Images/folder/filename"
      // We need to use the github raw endpoint
      const encodedPath = encodeURIComponent(selectedImage.path);
      setPreviewUrl(`${API_BASE}/github/raw?path=${encodedPath}`);
    } else {
      setPreviewUrl(null);
    }
  }, [selectedImage]);

  // Handle clicking on an image to insert
  const handleInsertImage = useCallback(
    (image: ImageMetadata) => {
      // Build the relative markdown path
      // The path is like "Images/folder/filename"
      // For markdown, we need "../../Images/folder/filename" (relative from results/task-{id}/)
      const markdownPath = `../../${image.path}`;
      onInsertImage(markdownPath, image.original_filename || image.filename);
      onClose();
    },
    [onInsertImage, onClose]
  );

  // Handle clicking outside to close
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Handle escape key to close
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
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              📷 Image Gallery
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {experimentName} · {experimentDate}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Image Grid */}
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
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    attachmentsApi.listImages({ experiment_id: experimentId })
                      .then(setImages)
                      .catch(() => setError("Failed to load images."))
                      .finally(() => setLoading(false));
                  }}
                  className="mt-2 px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                >
                  Retry
                </button>
              </div>
            ) : images.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <span className="text-4xl mb-3">🖼️</span>
                <p className="text-sm text-gray-500 mb-1">No images attached yet</p>
                <p className="text-xs text-gray-400">
                  Upload images using the "Add Image" button in the editor
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {images.map((image) => (
                  <div
                    key={image.id}
                    className={`group relative bg-gray-50 border-2 rounded-lg overflow-hidden cursor-pointer transition-all hover:shadow-md ${
                      selectedImage?.id === image.id
                        ? "border-blue-500 ring-2 ring-blue-200"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                    onClick={() => setSelectedImage(image)}
                  >
                    {/* Image Preview */}
                    <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                      <img
                        src={`${API_BASE}/github/raw?path=${encodeURIComponent(image.path)}`}
                        alt={image.original_filename || image.filename}
                        className="max-w-full max-h-full object-contain"
                        onError={(e) => {
                          // Show placeholder on error
                          const target = e.target as HTMLImageElement;
                          target.style.display = "none";
                          target.parentElement!.innerHTML = '<span class="text-4xl">🖼️</span>';
                        }}
                      />
                    </div>
                    
                    {/* Image Info */}
                    <div className="p-2 border-t border-gray-100">
                      <p className="text-xs font-medium text-gray-700 truncate" title={image.original_filename || image.filename}>
                        {image.original_filename || image.filename}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {image.file_size ? formatFileSize(image.file_size) : "Unknown size"}
                      </p>
                    </div>

                    {/* Insert button on hover */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleInsertImage(image);
                      }}
                      className="absolute inset-0 bg-blue-500/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
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

          {/* Preview Panel (shows when image is selected) */}
          {selectedImage && (
            <div className="w-64 border-l border-gray-100 flex flex-col bg-gray-50">
              <div className="p-3 border-b border-gray-100">
                <p className="text-xs font-medium text-gray-700">Preview</p>
              </div>
              
              {/* Preview Image */}
              <div className="flex-1 flex items-center justify-center p-3 overflow-hidden">
                {previewUrl && (
                  <img
                    src={previewUrl}
                    alt={selectedImage.original_filename || selectedImage.filename}
                    className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
                  />
                )}
              </div>

              {/* Image Details */}
              <div className="p-3 border-t border-gray-100 space-y-2">
                <div>
                  <p className="text-[10px] text-gray-400 uppercase">Filename</p>
                  <p className="text-xs text-gray-700 truncate" title={selectedImage.original_filename || selectedImage.filename}>
                    {selectedImage.original_filename || selectedImage.filename}
                  </p>
                </div>
                {selectedImage.file_size && (
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase">Size</p>
                    <p className="text-xs text-gray-700">{formatFileSize(selectedImage.file_size)}</p>
                  </div>
                )}
                {selectedImage.file_type && (
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase">Type</p>
                    <p className="text-xs text-gray-700">{selectedImage.file_type}</p>
                  </div>
                )}
                {selectedImage.uploaded_at && (
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase">Uploaded</p>
                    <p className="text-xs text-gray-700">
                      {new Date(selectedImage.uploaded_at).toLocaleDateString()}
                    </p>
                  </div>
                )}
                
                {/* Insert Button */}
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

        {/* Footer */}
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

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
