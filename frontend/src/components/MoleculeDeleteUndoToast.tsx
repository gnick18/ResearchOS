"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/icons";
import { moleculesApi } from "@/lib/chemistry/api";
import {
  subscribeMoleculeDeleted,
  type MoleculeDeleteToastPayload,
} from "@/lib/chemistry/delete-toast-bus";

/**
 * chem-trash bot (2026-06-11): bottom-center Undo toast for the "you just
 * soft-deleted a molecule" flow. Mirrors SequenceDeleteUndoToast.
 *
 * Listens on the module-scoped `molecule-delete-toast-bus`. When a delete fires
 * (MoleculeDetail calls `emitMoleculeDeleted` after `moleculesApi.remove`), this
 * component shows a 10-second toast with an "Undo" action. Clicking Undo calls
 * `moleculesApi.restore` for every id in the payload (which lifts both
 * `{id}.mol` + `{id}.meta.json` out of `_trash/molecules/` back into the live
 * library), then runs the caller's cache invalidator so the list repopulates.
 *
 * Mounted once in AppShell so every molecule delete in the app gets the same
 * toast without each call site managing its own state.
 */
const TOAST_TTL_MS = 10000;

export default function MoleculeDeleteUndoToast() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<MoleculeDeleteToastPayload | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    return subscribeMoleculeDeleted((payload) => {
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
          const restored = await moleculesApi.restore(id, toast.owner);
          if (restored) restoredAny = true;
        } catch (err) {
          console.warn(
            "[MoleculeDeleteUndoToast] restore failed for id",
            id,
            err,
          );
        }
      }
      if (restoredAny) {
        toast.onRestored?.();
        queryClient.invalidateQueries({ queryKey: ["molecules"] });
        queryClient.invalidateQueries({ queryKey: ["project-molecules"] });
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
      data-testid="molecule-delete-undo-toast"
    >
      <Icon name="trash" className="h-4 w-4 flex-shrink-0 text-gray-400" />
      <span className="text-body flex-1 truncate">
        Deleted <span className="font-medium">{toast.label}</span>
      </span>
      <button
        type="button"
        onClick={() => void handleUndo()}
        disabled={restoring}
        className="text-meta font-semibold text-amber-300 hover:text-amber-200 underline-offset-2 hover:underline disabled:opacity-50"
        data-testid="molecule-delete-undo-button"
      >
        {restoring ? "Restoring…" : "Undo"}
      </button>
      <button
        type="button"
        onClick={() => setToast(null)}
        aria-label="Dismiss"
        className="text-gray-400 hover:text-white p-0.5 flex-shrink-0"
      >
        <Icon name="close" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
