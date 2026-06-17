"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DuplicateInfo } from "@/lib/attachments/duplicate-check";
import Tooltip from "./Tooltip";
import { ImageIcon, PaperclipIcon } from "@/lib/utils/icons";
import LivingPopup from "@/components/ui/LivingPopup";

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
  // Retain the last collision so the body stays rendered through
  // LivingPopup's close animation after `current` clears. Synced during
  // render (no ref read in render) the way ExportFormatDialog syncs state.
  const [shown, setShown] = useState<DuplicateInfo | null>(current);
  if (current && current !== shown) setShown(current);

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

  const handleClick = useCallback(
    (action: DuplicateAction) => {
      onChoose(action, applyToAll);
    },
    [applyToAll, onChoose],
  );

  const isImage = shown ? shown.file.type.startsWith("image/") : false;
  const size = shown ? formatFileSize(shown.file.size) : "";
  const modified = shown ? formatModified(shown.file.lastModified) : "";

  return (
    <LivingPopup
      // Escape / scrim click = cancel this collision (no apply-to-all).
      open={isOpen && current !== null}
      onClose={() => onChoose("cancel", false)}
      label="A file with this name already exists"
      widthClassName="max-w-md"
      card={false}
    >
      {/* This dialog brings its own white card chrome (card=false above). */}
      <div
        aria-labelledby="dup-upload-title"
        className="relative w-full rounded-2xl bg-surface-raised ros-popup-card-shadow overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-surface-sunken">
          <h2
            id="dup-upload-title"
            className="text-title font-semibold text-foreground"
          >
            A file with this name already exists
          </h2>
          <p className="text-meta text-foreground-muted mt-1">
            Choose what to do with the file you just added.
          </p>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {/* Existing file at the destination */}
          <div className="bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg p-3">
            <p className="text-meta uppercase tracking-wide text-amber-700 dark:text-amber-300 font-medium mb-1">
              Already in this folder
            </p>
            <div className="flex items-center gap-2">
              <Tooltip label={isImage ? "Image" : "File"} placement="top">
                {isImage ? <ImageIcon className="w-4 h-4 text-foreground-muted" /> : <PaperclipIcon className="w-4 h-4 text-foreground-muted" />}
              </Tooltip>
              <span
                className="text-body font-mono text-foreground truncate"
                title={shown?.existingName}
              >
                {shown?.existingName}
              </span>
            </div>
          </div>

          {/* The dropped file */}
          <div className="bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/30 rounded-lg p-3">
            <p className="text-meta uppercase tracking-wide text-blue-700 dark:text-blue-300 font-medium mb-1">
              File you just added
            </p>
            <div className="flex items-center gap-2">
              <Tooltip label={isImage ? "Image" : "File"} placement="top">
                {isImage ? <ImageIcon className="w-4 h-4 text-foreground-muted" /> : <PaperclipIcon className="w-4 h-4 text-foreground-muted" />}
              </Tooltip>
              <span
                className="text-body font-mono text-foreground truncate"
                title={shown?.file.name}
              >
                {shown?.file.name}
              </span>
            </div>
            <p className="text-meta text-foreground-muted mt-1">
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
            className="ros-btn-raise w-full py-2.5 px-4 bg-brand-action hover:bg-brand-action/90 text-white text-body font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
          >
            Save as{" "}
            <span className="font-mono text-meta bg-blue-700 px-1.5 py-0.5 rounded">
              {shown?.suggestedName}
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleClick("replace")}
            className="w-full py-2 px-4 bg-surface-sunken hover:bg-surface-sunken text-foreground text-body font-medium rounded-lg transition-colors"
          >
            Replace existing
          </button>
          <button
            type="button"
            onClick={() => handleClick("cancel")}
            className="w-full py-2 px-4 text-meta text-foreground-muted hover:text-foreground hover:bg-surface-sunken rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>

        {/* Apply-to-all batch shortcut */}
        {remainingCount > 0 && (
          <div className="px-5 pb-4 border-t border-border pt-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={(e) => setApplyToAll(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-blue-600 dark:text-blue-300 focus:ring-blue-500"
              />
              <span className="text-meta text-foreground-muted">
                Apply this choice to the other {remainingCount} file
                {remainingCount === 1 ? "" : "s"} with name collisions
              </span>
            </label>
          </div>
        )}
      </div>
    </LivingPopup>
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
