"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { sequencesApi } from "@/lib/local-api";
import {
  subscribeSequenceDeleted,
  type SequenceDeleteToastPayload,
} from "@/lib/sequences/delete-toast-bus";

/**
 * seq delete trash bot (2026-06-04): bottom-center Undo toast for the "you
 * just soft-deleted one or more sequences" flow. Mirrors NoteDeleteUndoToast.
 *
 * Listens on the module-scoped `sequence-delete-toast-bus`. When a single or
 * bulk delete fires (the /sequences page calls `emitSequenceDeleted` after
 * `sequencesApi.delete`), this component shows a 10-second toast with an
 * "Undo" action. Clicking Undo calls `sequencesApi.restore` for every id in
 * the payload (which lifts both `{id}.gb` + `{id}.meta.json` out of
 * `_trash/sequences/` back into the live library), then runs the caller's
 * cache invalidator so the list repopulates.
 *
 * Mounted once in AppShell so every sequence delete in the app gets the same
 * toast without each call site managing its own state.
 */
const TOAST_TTL_MS = 10000;

export default function SequenceDeleteUndoToast() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<SequenceDeleteToastPayload | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    return subscribeSequenceDeleted((payload) => {
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
      let restoredAny = false;
      for (const id of toast.ids) {
        try {
          const restored = await sequencesApi.restore(id, toast.owner);
          if (restored) restoredAny = true;
        } catch (err) {
          console.warn(
            "[SequenceDeleteUndoToast] restore failed for id",
            id,
            err,
          );
        }
      }
      if (restoredAny) {
        toast.onRestored?.();
        queryClient.invalidateQueries({ queryKey: ["sequences"] });
      }
    } finally {
      setToast(null);
    }
  }, [toast, restoring, queryClient]);

  if (!toast) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[110] bg-gray-900 text-white rounded-lg shadow-xl px-4 py-3 flex items-center gap-3 max-w-md"
      role="status"
      aria-live="polite"
      data-testid="sequence-delete-undo-toast"
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
        className="flex-shrink-0 text-gray-400"
      >
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      </svg>
      <span className="text-body flex-1 truncate">
        Deleted <span className="font-medium">{toast.label}</span>
      </span>
      <button
        type="button"
        onClick={() => void handleUndo()}
        disabled={restoring}
        className="text-meta font-semibold text-amber-300 hover:text-amber-200 underline-offset-2 hover:underline disabled:opacity-50"
        data-testid="sequence-delete-undo-button"
      >
        {restoring ? "Restoring…" : "Undo"}
      </button>
      <button
        type="button"
        onClick={() => setToast(null)}
        aria-label="Dismiss"
        className="text-gray-400 hover:text-white p-0.5 flex-shrink-0"
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
