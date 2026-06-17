"use client";

import React, { useState, useEffect, useRef } from "react";
import { ImageIcon, PaperclipIcon } from "@/lib/utils/icons";
import { usePopupLayer } from "@/lib/ui/popup-stack";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";

interface FileRenamePopupProps {
  file: File;
  onConfirm: (renamedFile: File) => void;
  onSkip: () => void; // Upload with original name
  onCancel: () => void; // Don't upload this file
}

export default function FileRenamePopup({
  file,
  onConfirm,
  onSkip,
  onCancel,
}: FileRenamePopupProps) {
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Opens during upload over the editor popups, so blur only when bottom-most.
  const { shouldBlur } = usePopupLayer(true, true);

  // Robust Escape: the input's onKeyDown only fires while it has focus, so bind
  // a window-level handler too in case focus ever leaves the input.
  useEscapeToClose(onCancel);

  // Extract file extension and base name
  const lastDotIndex = file.name.lastIndexOf(".");
  const originalExtension = lastDotIndex !== -1 ? file.name.slice(lastDotIndex) : "";
  const originalBaseName = lastDotIndex !== -1 ? file.name.slice(0, lastDotIndex) : file.name;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync controlled input to prop-derived initial value when file changes
    setNewName(originalBaseName);
    // Focus input after mount
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [originalBaseName]);

  const handleConfirm = () => {
    if (!newName.trim()) return;
    
    // Create new filename with extension
    const finalName = newName.trim() + originalExtension;
    
    // Create a new File object with the renamed filename
    const renamedFile = new File([file], finalName, { type: file.type });
    onConfirm(renamedFile);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleConfirm();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImage = file.type.startsWith("image/");

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/30 ${
        shouldBlur ? "backdrop-blur-sm" : ""
      }`}
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this popup
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="file-rename"
    >
      <div
        className="bg-surface-raised rounded-xl ros-popup-card-shadow w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-surface-sunken">
          <div className="flex items-center gap-3">
            {isImage ? <ImageIcon className="w-6 h-6 text-foreground-muted" /> : <PaperclipIcon className="w-6 h-6 text-foreground-muted" />}
            <div>
              <h3 className="text-title font-semibold text-foreground">
                Rename {isImage ? "Image" : "File"}?
              </h3>
              <p className="text-meta text-foreground-muted mt-0.5">
                Give it a clearer name before uploading.
              </p>
            </div>
          </div>
        </div>

        {/* File preview info */}
        <div className="px-5 py-4 border-b border-border">
          <div className="bg-surface-sunken rounded-lg p-3">
            <div className="flex items-center gap-3">
              {isImage && (
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-surface-sunken flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- src is a blob URL from URL.createObjectURL(file); next/image cannot optimize blob URLs */}
                  <img
                    src={URL.createObjectURL(file)}
                    alt="Preview"
                    className="w-full h-full object-cover"
                    onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-body font-medium text-foreground truncate" title={file.name}>
                  {file.name}
                </p>
                <p className="text-meta text-foreground-muted mt-0.5">
                  {formatFileSize(file.size)} • {file.type || "Unknown type"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Rename input */}
        <div className="px-5 py-4">
          <label className="block text-meta font-medium text-foreground-muted mb-2">
            New filename (without extension)
          </label>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter filename..."
              className="flex-1 px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <span className="text-body text-foreground-muted flex-shrink-0">
              {originalExtension}
            </span>
          </div>
          <p className="text-meta text-foreground-muted mt-2">
            Press Enter to confirm, Escape to cancel
          </p>
        </div>

        {/* Actions */}
        <div className="px-5 py-4 bg-surface-sunken border-t border-border flex items-center justify-between gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-body text-foreground-muted hover:text-foreground hover:bg-surface-sunken rounded-lg transition-colors"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onSkip}
              className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg transition-colors"
            >
              Keep Original
            </button>
            <button
              onClick={handleConfirm}
              disabled={!newName.trim()}
              className="ros-btn-raise px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Rename & Upload
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Hook to manage file rename popup state
export function useFileRenamePopup() {
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [resolveRef, setResolveRef] = useState<((file: File | null) => void) | null>(null);

  const requestRename = (file: File): Promise<File | null> => {
    return new Promise((resolve) => {
      setPendingFile(file);
      setResolveRef(() => resolve);
    });
  };

  const handleConfirm = (renamedFile: File) => {
    resolveRef?.(renamedFile);
    setPendingFile(null);
    setResolveRef(null);
  };

  const handleSkip = () => {
    resolveRef?.(pendingFile);
    setPendingFile(null);
    setResolveRef(null);
  };

  const handleCancel = () => {
    resolveRef?.(null);
    setPendingFile(null);
    setResolveRef(null);
  };

  // Return a function component that renders the popup when there's a pending file
  const PopupComponent = () => {
    if (!pendingFile) return null;
    
    return (
      <FileRenamePopup
        file={pendingFile}
        onConfirm={handleConfirm}
        onSkip={handleSkip}
        onCancel={handleCancel}
      />
    );
  };

  return {
    requestRename,
    PopupComponent,
  };
}
