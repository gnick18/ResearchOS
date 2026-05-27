"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DuplicateInfo } from "@/lib/attachments/duplicate-check";
import Tooltip from "./Tooltip";
import { ImageIcon, PaperclipIcon } from "@/lib/utils/icons";

/**
 * User-facing dialog shown when a dropped/picked file collides with an
 * existing filename at the destination. Replaces the silent auto-suffix
 * behavior that lived in 5+ separate upload surfaces.
 *
 * UX (locked design from Grant):
 *  - Title: "A file with this name already exists"
 *  - Body: existing name + dropped file (size + last-modified) + preview
 *    of the suggested rename in monospace.
 *  - Three buttons stacked vertically:
 *      1. Primary (blue): "Save as <suggestedName>"  — default action
 *      2. Secondary (slate): "Replace existing"      — destructive, no
 *         secondary confirmation (the user just clicked it after seeing
 *         the existing name displayed)
 *      3. Tertiary (ghost): "Cancel"
 *  - When the queue has multiple collisions, a checkbox below the buttons:
 *    "Apply this choice to the other N file(s) with name collisions"
 *
 * Trade-offs / open questions:
 *  - Replace has no secondary confirmation. The user has already seen the
 *    existing filename rendered in the body, so a second "Are you sure?"
 *    modal felt like overconfirmation. If users start replacing things
 *    by accident we'll add a `confirm()` step here.
 *  - The dialog does NOT show a thumbnail of the existing file. We don't
 *    have a fast path to read it without a disk roundtrip + URL.create
 *    for an arbitrary mime type; the filename + extension carries the
 *    signal users typically need.
 */

export type DuplicateAction = "rename" | "replace" | "cancel";

interface Props {
  isOpen: boolean;
  /** First collision in the queue. The dialog shows this one. */
  current: DuplicateInfo | null;
  /** Total collisions waiting AFTER this one. If > 0, the "apply to all"
   *  checkbox is shown. */
  remainingCount: number;
  /** Caller is notified once with the user's choice. `applyToAll`
   *  indicates the choice should be replayed for the remaining queue
   *  without re-prompting. */
  onChoose: (action: DuplicateAction, applyToAll: boolean) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModified(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export default function DuplicateUploadDialog({
  isOpen,
  current,
  remainingCount,
  onChoose,
}: Props) {
  const [applyToAll, setApplyToAll] = useState(false);
  const renameButtonRef = useRef<HTMLButtonElement>(null);

  // Reset "apply to all" each time the dialog re-opens for a new
  // collision queue. Without this, a previous batch's checkbox state
  // leaks into the next batch and surprises the user.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset checkbox when dialog re-opens (sync state to prop transition)
    if (isOpen) setApplyToAll(false);
  }, [isOpen]);

  // Focus the default "Save as <suggestedName>" button on open so Enter
  // commits the safe choice. Mirrors the keyboard-friendly behavior of
  // FileRenamePopup's input.
  useEffect(() => {
    if (!isOpen) return;
    // setTimeout 0 so the button is mounted before focus().
    const id = window.setTimeout(() => {
      renameButtonRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [isOpen, current?.existingName]);

  // Esc closes the dialog as a "cancel this one" (not cancel-all).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onChoose("cancel", false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onChoose]);

  const handleClick = useCallback(
    (action: DuplicateAction) => {
      onChoose(action, applyToAll);
    },
    [applyToAll, onChoose],
  );

  if (!isOpen || !current) return null;

  const isImage = current.file.type.startsWith("image/");
  const size = formatFileSize(current.file.size);
  const modified = formatModified(current.file.lastModified);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this popup
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="duplicate-upload"
      // Click on backdrop = cancel this collision (does not propagate
      // to "apply to all" — the user didn't make an explicit choice).
      onClick={() => onChoose("cancel", false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dup-upload-title"
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
          <h2
            id="dup-upload-title"
            className="text-base font-semibold text-gray-900"
          >
            A file with this name already exists
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Choose what to do with the file you just added.
          </p>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {/* Existing file at the destination */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-[11px] uppercase tracking-wide text-amber-700 font-medium mb-1">
              Already in this folder
            </p>
            <div className="flex items-center gap-2">
              <Tooltip label={isImage ? "Image" : "File"} placement="top">
                {isImage ? <ImageIcon className="w-4 h-4 text-gray-400" /> : <PaperclipIcon className="w-4 h-4 text-gray-400" />}
              </Tooltip>
              <span
                className="text-sm font-mono text-gray-800 truncate"
                title={current.existingName}
              >
                {current.existingName}
              </span>
            </div>
          </div>

          {/* The dropped file */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-[11px] uppercase tracking-wide text-blue-700 font-medium mb-1">
              File you just added
            </p>
            <div className="flex items-center gap-2">
              <Tooltip label={isImage ? "Image" : "File"} placement="top">
                {isImage ? <ImageIcon className="w-4 h-4 text-gray-400" /> : <PaperclipIcon className="w-4 h-4 text-gray-400" />}
              </Tooltip>
              <span
                className="text-sm font-mono text-gray-800 truncate"
                title={current.file.name}
              >
                {current.file.name}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {size}
              {modified ? ` • Modified ${modified}` : ""}
            </p>
          </div>
        </div>

        {/* Actions — stacked vertically per the locked design */}
        <div className="px-5 pb-4 flex flex-col gap-2">
          <button
            ref={renameButtonRef}
            type="button"
            onClick={() => handleClick("rename")}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
          >
            Save as{" "}
            <span className="font-mono text-xs bg-blue-700 px-1.5 py-0.5 rounded">
              {current.suggestedName}
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleClick("replace")}
            className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-medium rounded-lg transition-colors"
          >
            Replace existing
          </button>
          <button
            type="button"
            onClick={() => handleClick("cancel")}
            className="w-full py-2 px-4 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>

        {/* Apply-to-all batch shortcut */}
        {remainingCount > 0 && (
          <div className="px-5 pb-4 border-t border-gray-100 pt-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={(e) => setApplyToAll(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-600">
                Apply this choice to the other {remainingCount} file
                {remainingCount === 1 ? "" : "s"} with name collisions
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Hook: useDuplicateResolver ───────────────────────────────────────────────

export interface DuplicateResolution {
  action: DuplicateAction;
  /** Only meaningful when `action === "rename"`. The non-colliding name
   *  the caller should write the file as. */
  newName?: string;
}

interface PendingResolver {
  collisions: DuplicateInfo[];
  resolve: (resolutions: Map<string, DuplicateResolution>) => void;
  // Index into `collisions` of the dialog currently being shown.
  cursor: number;
  // Choices the user has made so far for this batch, keyed by the
  // dropped file's name (== existingName).
  resolutions: Map<string, DuplicateResolution>;
  // Set when "apply to all" was checked on the last decision. The hook
  // replays that choice across the remaining cursor positions without
  // re-prompting.
  bulkChoice?: DuplicateAction;
}

/**
 * Promise-based hook that walks a `DuplicateInfo[]` queue, showing the
 * dialog for each collision, and returns a `Map<filename, Resolution>`.
 * Mirrors the shape of `useFileRenamePopup` — caller renders
 * `<DialogComponent />` once in its JSX tree and calls `resolve(...)` to
 * trigger the walk.
 *
 * Cancel semantics:
 *  - "Cancel" on a single collision marks just that file as cancelled
 *    and advances to the next collision. The caller gets a Map entry
 *    with `action: "cancel"` for that file.
 *  - "Apply to all" + "Cancel" cancels the remaining queue too.
 *  - Esc / backdrop click acts as "Cancel this one" (no apply-to-all).
 *
 * The resolver's Map is keyed by `existingName` (== `file.name`). If a
 * batch contains the same filename twice (which `checkForDuplicates`
 * already partitions — only the second instance becomes a collision), no
 * key clash occurs because only one DuplicateInfo exists per name.
 */
export function useDuplicateResolver() {
  const [pending, setPending] = useState<PendingResolver | null>(null);

  const resolve = useCallback(
    (collisions: DuplicateInfo[]): Promise<Map<string, DuplicateResolution>> => {
      return new Promise((res) => {
        if (collisions.length === 0) {
          res(new Map());
          return;
        }
        setPending({
          collisions,
          resolve: res,
          cursor: 0,
          resolutions: new Map(),
        });
      });
    },
    [],
  );

  const handleChoose = useCallback(
    (action: DuplicateAction, applyToAll: boolean) => {
      setPending((prev) => {
        if (!prev) return null;
        const current = prev.collisions[prev.cursor];
        if (!current) return prev;

        const nextResolutions = new Map(prev.resolutions);
        const recordChoice = (info: DuplicateInfo, act: DuplicateAction) => {
          if (act === "rename") {
            nextResolutions.set(info.existingName, {
              action: "rename",
              newName: info.suggestedName,
            });
          } else {
            nextResolutions.set(info.existingName, { action: act });
          }
        };

        recordChoice(current, action);

        // If "apply to all" was checked, replay this choice across the
        // remaining queue without re-prompting and resolve immediately.
        if (applyToAll) {
          for (let i = prev.cursor + 1; i < prev.collisions.length; i++) {
            recordChoice(prev.collisions[i], action);
          }
          prev.resolve(nextResolutions);
          return null;
        }

        // Advance the cursor; if we're at the end, resolve.
        const nextCursor = prev.cursor + 1;
        if (nextCursor >= prev.collisions.length) {
          prev.resolve(nextResolutions);
          return null;
        }
        return {
          ...prev,
          cursor: nextCursor,
          resolutions: nextResolutions,
        };
      });
    },
    [],
  );

  // Memoized renderable element. Callers mount this once in their JSX.
  const DialogComponent = useCallback(() => {
    const current = pending ? pending.collisions[pending.cursor] ?? null : null;
    const remaining = pending
      ? Math.max(0, pending.collisions.length - pending.cursor - 1)
      : 0;
    return (
      <DuplicateUploadDialog
        isOpen={Boolean(pending && current)}
        current={current}
        remainingCount={remaining}
        onChoose={handleChoose}
      />
    );
  }, [pending, handleChoose]);

  return { resolve, DialogComponent };
}
