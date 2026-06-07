"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notebooksApi } from "@/lib/local-api";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import type { Notebook } from "@/lib/types";

// Notebooks Generalization Phase 2 (notebooks-gen Phase 2 bot, 2026-06-06).
// A small create / rename dialog for PERSONAL notebooks, mirroring the shape
// and voice of StartSharedNotebookDialog. Create routes through
// `notebooksApi.createPersonal`; rename routes through `notebooksApi.updateTitle`.
// Shared-notebook creation keeps its own dedicated person-picker dialog.

interface NotebookFormDialogProps {
  /** "create" makes a new personal notebook; "rename" edits an existing one. */
  mode: "create" | "rename";
  /** Required for rename: the notebook being renamed (seeds the title). */
  notebook?: Notebook;
  onClose: () => void;
  /** Fires with the created / renamed notebook so the parent can react. */
  onSaved: (notebook: Notebook) => void;
}

const CLOSE_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const BOOK_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

export default function NotebookFormDialog({
  mode,
  notebook,
  onClose,
  onSaved,
}: NotebookFormDialogProps) {
  const [title, setTitle] = useState(notebook?.title ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEscapeToClose(onClose);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSave = useCallback(async () => {
    if (busy) return;
    const trimmed = title.trim();
    if (mode === "rename" && !trimmed) {
      setError("Give the notebook a title.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "create") {
        const created = await notebooksApi.createPersonal(
          trimmed ? { title: trimmed } : {},
        );
        onSaved(created);
      } else if (notebook) {
        const updated = await notebooksApi.updateTitle(notebook.id, trimmed);
        if (!updated) throw new Error("Notebook not found");
        onSaved(updated);
      }
    } catch (err) {
      console.error("Failed to save notebook:", err);
      setError("Could not save the notebook. Please try again.");
      setBusy(false);
    }
  }, [busy, title, mode, notebook, onSaved]);

  const heading = mode === "create" ? "New notebook" : "Rename notebook";
  const sub =
    mode === "create"
      ? "A private space to group your notes. Only you can see it until you add a member."
      : "Update this notebook's title.";
  const cta = mode === "create" ? "Create notebook" : "Save title";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-surface-raised shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-brand-action">
              {BOOK_SVG}
            </span>
            <div>
              <h2 className="text-title font-semibold text-foreground">
                {heading}
              </h2>
              <p className="text-meta text-foreground-muted">{sub}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 rounded-lg p-1 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
          >
            {CLOSE_SVG}
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="notebook-form-title"
              className="text-meta font-semibold uppercase tracking-wide text-foreground-muted"
            >
              Title
              {mode === "create" && (
                <span className="font-normal text-foreground-muted">
                  {" "}
                  (optional)
                </span>
              )}
            </label>
            <input
              ref={inputRef}
              id="notebook-form-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
              }}
              placeholder="e.g. Thesis project"
              data-testid="notebook-form-title"
              className="w-full rounded-lg border border-border px-3 py-2 text-body focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/30"
            />
          </div>
          {error && <p className="text-body text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-body font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
            data-testid="notebook-form-save"
            className="btn-brand rounded-lg px-4 py-2 text-body font-medium disabled:opacity-40"
          >
            {busy ? "Saving…" : cta}
          </button>
        </div>
      </div>
    </div>
  );
}
