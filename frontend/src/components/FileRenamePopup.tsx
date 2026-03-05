"use client";

import React, { useState, useEffect, useRef } from "react";

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

  // Extract file extension and base name
  const lastDotIndex = file.name.lastIndexOf(".");
  const originalExtension = lastDotIndex !== -1 ? file.name.slice(lastDotIndex) : "";
  const originalBaseName = lastDotIndex !== -1 ? file.name.slice(0, lastDotIndex) : file.name;

  useEffect(() => {
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{isImage ? "🖼️" : "📎"}</span>
            <div>
              <h3 className="text-base font-semibold text-gray-900">
                Rename {isImage ? "Image" : "File"}?
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Would you like to rename this file before uploading?
              </p>
            </div>
          </div>
        </div>

        {/* File preview info */}
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="flex items-center gap-3">
              {isImage && (
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-200 flex-shrink-0">
                  <img
                    src={URL.createObjectURL(file)}
                    alt="Preview"
                    className="w-full h-full object-cover"
                    onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 truncate" title={file.name}>
                  {file.name}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatFileSize(file.size)} • {file.type || "Unknown type"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Rename input */}
        <div className="px-5 py-4">
          <label className="block text-xs font-medium text-gray-500 mb-2">
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
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <span className="text-sm text-gray-400 flex-shrink-0">
              {originalExtension}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Press Enter to confirm, Escape to cancel
          </p>
        </div>

        {/* Actions */}
        <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onSkip}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Keep Original
            </button>
            <button
              onClick={handleConfirm}
              disabled={!newName.trim()}
              className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
