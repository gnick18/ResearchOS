"use client";

import { useEffect, useRef } from "react";
import type { Notebook } from "@/lib/types";

// Notebooks Generalization Phase 2 (notebooks-gen Phase 2 bot, 2026-06-06).
// A cursor-anchored menu that moves a note into one of the viewer's notebooks
// or removes it from its current notebook. Enforces single-notebook-per-note
// (the parent calls `notebooksApi.moveNoteToNotebook`, which replaces). Used by
// the note-card context menu and the NoteDetailPopup header.

interface MoveToNotebookMenuProps {
  x: number;
  y: number;
  /** The note's current notebook_id, if any (highlighted + a "Remove" option). */
  currentNotebookId: string | null | undefined;
  myNotebooks: Notebook[];
  sharedNotebooks: Notebook[];
  currentUser: string | null | undefined;
  onMove: (notebookId: string | null) => void;
  onClose: () => void;
}

const CHECK_SVG = (
  <svg
    className="ml-auto h-4 w-4 text-brand-action"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export default function MoveToNotebookMenu({
  x,
  y,
  currentNotebookId,
  myNotebooks,
  sharedNotebooks,
  currentUser,
  onMove,
  onClose,
}: MoveToNotebookMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  const sharedLabel = (nb: Notebook): string => {
    if (nb.title?.trim()) return nb.title;
    const others = nb.members.filter((m) => m !== currentUser);
    if (others.length === 1) return `1:1 with ${others[0]}`;
    if (others.length > 1) return `${others.length} members`;
    return "Shared notebook";
  };

  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const left = Math.min(x, vw - 240);
  const top = Math.min(y, vh - 320);

  const hasNotebooks = myNotebooks.length > 0 || sharedNotebooks.length > 0;

  const row = (nb: Notebook, label: string) => {
    const active = currentNotebookId === nb.id;
    return (
      <button
        key={nb.id}
        type="button"
        role="menuitem"
        onClick={() => {
          onMove(nb.id);
          onClose();
        }}
        data-testid={`move-to-${nb.id}`}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-foreground hover:bg-surface-sunken"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {active && CHECK_SVG}
      </button>
    );
  };

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="move-to-notebook-menu"
      className="fixed z-[70] max-h-80 min-w-[200px] overflow-y-auto rounded-lg border border-border bg-surface-raised py-1 shadow-lg"
      style={{ left, top }}
    >
      <p className="px-3 py-1 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
        Move to notebook
      </p>
      {currentNotebookId && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onMove(null);
            onClose();
          }}
          data-testid="move-to-remove"
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-foreground hover:bg-surface-sunken"
        >
          Remove from notebook
        </button>
      )}
      {!hasNotebooks && (
        <p className="px-3 py-2 text-meta italic text-foreground-muted">
          No notebooks yet
        </p>
      )}
      {myNotebooks.length > 0 && (
        <>
          <p className="mt-1 px-3 py-0.5 text-meta text-foreground-muted">
            My notebooks
          </p>
          {myNotebooks.map((nb) => row(nb, nb.title?.trim() || "Untitled notebook"))}
        </>
      )}
      {sharedNotebooks.length > 0 && (
        <>
          <p className="mt-1 px-3 py-0.5 text-meta text-foreground-muted">Shared</p>
          {sharedNotebooks.map((nb) => row(nb, sharedLabel(nb)))}
        </>
      )}
    </div>
  );
}
