"use client";

// import target bot — the calm "Import into" chooser. When the active
// collection is ambiguous (All Sequences / Unfiled), an import has no implied
// project to land in, so instead of silently dropping the files Unfiled we ask
// once: which project collection should these N sequences link to? Mirrors the
// SequenceConfirmDialog pattern (centered overlay, click-scrim to cancel, calm
// header, footer actions). Pure presentational + confirm/cancel callbacks; the
// caller owns persistNew. No emojis (inline SVG only), no em-dashes.

import { useEffect, useState } from "react";
import LivingPopup from "@/components/ui/LivingPopup";

/** A single destination option in the chooser. The Unfiled choice uses a null
 *  id; a project uses its collection id (stringified project id). */
export interface ImportTargetOption {
  /** null = Unfiled (no project link). */
  id: string | null;
  label: string;
}

export interface ImportTargetRequest {
  /** Sequences ready to persist (drives the count). */
  count: number;
  /** Non-sequence files dropped by the extension filter (folder / drag-drop). */
  skipped: number;
  /** Project options to file into; Unfiled is added by the dialog itself. */
  projects: { id: string; name: string }[];
  /** Persist into the chosen target. `projectId` is null for Unfiled. */
  onConfirm: (projectId: string | null) => void;
  onCancel: () => void;
}

const UNFILED_VALUE = "__unfiled__";

function FolderInIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <polyline points="12 10 12 16" />
      <polyline points="9.5 13.5 12 16 14.5 13.5" />
    </svg>
  );
}

export default function SequenceImportTargetDialog({
  request,
}: {
  request: ImportTargetRequest | null;
}) {
  // Default to Unfiled so the choice is explicit but never destructive.
  const [value, setValue] = useState<string>(UNFILED_VALUE);

  // Reset the selection each time a fresh request opens.
  useEffect(() => {
    if (request) setValue(UNFILED_VALUE);
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        request.onConfirm(value === UNFILED_VALUE ? null : value);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [request, value]);

  if (!request) return null;

  const { count, skipped } = request;
  const seqNoun = count === 1 ? "sequence" : "sequences";
  const skipNote =
    skipped > 0
      ? `${skipped} non-sequence ${skipped === 1 ? "file" : "files"} will be skipped.`
      : null;

  const confirm = () =>
    request.onConfirm(value === UNFILED_VALUE ? null : value);

  return (
    <LivingPopup open onClose={request.onCancel} label="Import into" card={false} widthClassName="max-w-md">
      <div
        className="pointer-events-auto relative w-full overflow-hidden rounded-2xl bg-surface-raised ros-popup-card-shadow"
        data-testid="sequence-import-target-dialog"
        data-tour-popup-occluding="sequence-import-target"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-500/15">
            <FolderInIcon className="h-5 w-5 text-sky-600 dark:text-sky-300" />
          </div>
          <h2 className="text-title font-semibold text-foreground">
            Import {count} {seqNoun} into
          </h2>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
              Collection
            </span>
            <select
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-raised px-2.5 py-2 text-body text-foreground focus:border-sky-400 focus:outline-none"
            >
              <option value={UNFILED_VALUE}>Unfiled (no project)</option>
              {request.projects.length > 0 ? (
                <optgroup label="Projects">
                  {request.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>

          <p className="text-meta text-foreground-muted">
            These {seqNoun} will link to the chosen project collection. Pick
            Unfiled to keep them out of any project for now.
          </p>

          {skipNote ? <p className="text-meta text-foreground-muted">{skipNote}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border bg-surface-sunken px-4 py-3">
          <button
            type="button"
            onClick={request.onCancel}
            className="rounded-lg px-4 py-2 text-body text-foreground-muted transition-colors hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            className="ros-btn-raise rounded-lg bg-brand-action px-4 py-2 text-body font-medium text-white transition-colors hover:bg-brand-action/90"
          >
            Import
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}
