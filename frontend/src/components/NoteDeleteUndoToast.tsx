"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { notesApi } from "@/lib/local-api";
import {
  subscribeNoteDeleted,
  type NoteDeleteToastPayload,
} from "@/lib/notes/delete-toast-bus";

/**
 * Lab head UX polish manager Bug 3 (2026-05-24): bottom-center toast
 * surface for the "you just soft-deleted a note" flow.
 *
 * Listens on the module-scoped `delete-toast-bus`. When a delete fires
 * (NotesPanel, NoteDetailPopup, and anywhere else that calls
 * `emitNoteDeleted` after `notesApi.delete`), this component shows a
 * 10-second toast with an "Undo" action. Clicking Undo calls
 * `notesApi.restore` which lifts the note out of `notes_trash/` back
 * into `notes/` at the same id, then runs the caller-provided cache
 * invalidator so the lists repopulate.
 *
 * Mounted once in AppShell so every note-delete in the app gets the
 * same toast without each delete call site needing its own state.
 */
const TOAST_TTL_MS = 10000;

export default function NoteDeleteUndoToast() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<NoteDeleteToastPayload | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    return subscribeNoteDeleted((payload) => {
      setToast(payload);
      setRestoring(false);
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleUndo = useCallback(async () => {
    if (!toast || restoring) return;
    setRestoring(true);
    try {
      const restored = await notesApi.restore(toast.noteId, toast.owner);
      if (restored) {
        toast.onRestored?.();
        // Also bust the standard caches the delete path would have invalidated
        // so any panel not subscribed to a custom onRestored still updates.
        queryClient.invalidateQueries({ queryKey: ["notes"] });
        queryClient.invalidateQueries({ queryKey: ["lab-notes"] });
        queryClient.invalidateQueries({ queryKey: ["lab", "notes-shared"] });
        queryClient.invalidateQueries({ queryKey: ["lab", "notes"] });
      } else {
        console.warn(
          "[NoteDeleteUndoToast] restore returned null for id",
          toast.noteId,
        );
      }
    } catch (err) {
      console.warn("[NoteDeleteUndoToast] restore failed", err);
    } finally {
      setToast(null);
    }
  }, [toast, restoring, queryClient]);

  if (!toast) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[110] bg-surface-overlay text-foreground border border-border rounded-lg ros-popover-shadow px-4 py-3 flex items-center gap-3 max-w-md"
      role="status"
      aria-live="polite"
      data-testid="note-delete-undo-toast"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="flex-shrink-0 text-foreground-muted"
      >
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </svg>
      <span className="text-body flex-1 truncate">
        Deleted{" "}
        <span className="font-medium">
          {toast.noteTitle || `note ${toast.noteId}`}
        </span>
      </span>
      <button
        type="button"
        onClick={() => void handleUndo()}
        disabled={restoring}
        className="text-meta font-semibold text-amber-600 hover:text-amber-700 dark:text-amber-300 dark:hover:text-amber-200 underline-offset-2 hover:underline disabled:opacity-50"
        data-testid="note-delete-undo-button"
      >
        {restoring ? "Restoring…" : "Undo"}
      </button>
      <button
        type="button"
        onClick={() => setToast(null)}
        aria-label="Dismiss"
        className="text-foreground-muted hover:text-foreground p-0.5 flex-shrink-0"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
