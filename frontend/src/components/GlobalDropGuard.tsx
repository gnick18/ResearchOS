"use client";

import { useEffect, useState } from "react";

/**
 * Top-level interceptor that prevents native OS file drops from falling
 * through to Chrome's default "open the file" behavior anywhere in the
 * app. When a drop lands on a surface that didn't handle it, this catches
 * the native event at the window level and shows a friendly toast at the
 * drop location pointing the user toward an attachment-supporting surface.
 *
 * Surfaces that DO handle drops (LiveMarkdownEditor in Lab Notes / Results
 * / methods page / NoteDetailPopup; the TaskDetailPopup universal handler)
 * stopPropagation on valid drops, so the native event never reaches the
 * window-level listeners here.
 */
export default function GlobalDropGuard() {
  const [toast, setToast] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      // preventDefault on dragover is required for the drop event to fire.
      // Without this, Chrome rejects the target and falls through to default
      // (opening the file in a new tab) — the original symptom.
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    const handleDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      setToast({ x: e.clientX, y: e.clientY });
      window.setTimeout(() => setToast(null), 3500);
    };
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, []);

  if (!toast) return null;
  return (
    <div
      className="fixed z-[60] max-w-sm rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg pointer-events-none"
      style={{
        left: Math.max(8, Math.min(toast.x + 12, (typeof window !== "undefined" ? window.innerWidth : 1024) - 400)),
        top: Math.max(8, Math.min(toast.y + 12, (typeof window !== "undefined" ? window.innerHeight : 768) - 100)),
      }}
    >
      Files can only be attached inside a task, note, or method. Open one and drop the file inside.
    </div>
  );
}
