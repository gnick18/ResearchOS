"use client";

// Cross-folder COPY picker + entry point (Strategy A, NOTES ONLY in v1).
//
// FolderDestinationPicker lists the remembered folders this account may copy
// INTO right now. The active folder and every member (joined-lab) folder are
// excluded by listEligibleDestinations (the latter for the addendum C7 safety
// reason: a joined lab is a folder the account does not own).
//
// CopyNoteToFolderButton is the smallest entry point: a button that opens the
// picker in a LivingPopup and, on selection, copies one note into the chosen
// folder via copyObjectToFolder. It is gated behind CROSS_FOLDER_ENABLED and
// renders NOTHING when the flag is off or there is fewer than one eligible
// destination. Any note row / action menu can mount it. This avoids touching
// the shared UnifiedShareDialog (used by every entity type), keeping that
// dialog byte-identical while still surfacing the feature for notes.

import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/icons";
import LivingPopup from "@/components/ui/LivingPopup";
import Tooltip from "@/components/Tooltip";
import type { OpenOrigin } from "@/lib/ui/create-popup-store";
import { CROSS_FOLDER_ENABLED } from "@/lib/file-system/cross-folder-config";
import {
  listEligibleDestinations,
  copyObjectToFolder,
  moveObjectToFolder,
  bulkTransfer,
  describeTarget,
  CrossFolderCopyError,
  SourceNotRemovedError,
  type TransferTarget,
} from "@/lib/transfer/local-folder-transfer";
import type { RememberedFolder } from "@/lib/file-system/indexeddb-store";
import type { Note } from "@/lib/types";

/** A one-line human label for a remembered folder's lab role. Solo / legacy
 *  rows carry no role and render with just the name. */
function roleLabel(folder: RememberedFolder): string | null {
  if (folder.labRole === "head") {
    return folder.labName ? `${folder.labName} (you lead)` : "Lab you lead";
  }
  // member folders are excluded upstream, so we only ever see solo / head here.
  return null;
}

export interface FolderDestinationPickerProps {
  /** The eligible destinations to choose from. */
  folders: RememberedFolder[];
  /** Fired with the chosen folder id. */
  onPick: (folderId: string) => void;
  /** True while a copy is in flight (disables the rows). */
  busy?: boolean;
}

/** The list body. Stateless: the parent owns loading + the copy action. */
export function FolderDestinationPicker({
  folders,
  onPick,
  busy = false,
}: FolderDestinationPickerProps) {
  return (
    <ul className="flex flex-col gap-1.5" role="listbox" aria-label="Destination folders">
      {folders.map((folder) => {
        const sub = roleLabel(folder);
        return (
          <li key={folder.id}>
            <button
              type="button"
              role="option"
              aria-selected={false}
              disabled={busy}
              onClick={() => onPick(folder.id)}
              className="ros-btn-raise w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left disabled:opacity-50"
            >
              <Icon name="folder" className="h-4 w-4 shrink-0 text-foreground-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-foreground">
                  {folder.name}
                </span>
                {sub ? (
                  <span className="block truncate text-meta text-foreground-muted">
                    {sub}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export interface CopyNoteToFolderButtonProps {
  /** The note to copy. */
  note: Note;
  /** The note's owner in the SOURCE (active) folder. */
  sourceUsername: string;
  /** Optional click origin for the popup zoom animation. */
  origin?: OpenOrigin | null;
  /** Optional: notified with the new note id after a successful copy. */
  onCopied?: (result: { folderId: string; noteId: number }) => void;
  /** Optional extra classes on the trigger button. */
  className?: string;
}

type Status =
  | { phase: "idle" }
  | { phase: "copying" }
  | { phase: "done"; folderName: string }
  | { phase: "error"; message: string };

/**
 * Self-contained "Copy to another folder" entry point for a NOTE. Renders
 * nothing unless the flag is on AND at least one eligible destination exists.
 */
export default function CopyNoteToFolderButton({
  note,
  sourceUsername,
  origin = null,
  onCopied,
  className = "",
}: CopyNoteToFolderButtonProps) {
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<RememberedFolder[] | null>(null);
  const [status, setStatus] = useState<Status>({ phase: "idle" });

  // Probe for eligible destinations once. We keep the result so the trigger can
  // hide itself when there are none. Skipped entirely when the flag is off.
  useEffect(() => {
    if (!CROSS_FOLDER_ENABLED) return;
    let alive = true;
    void listEligibleDestinations().then((list) => {
      if (alive) setFolders(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const list = await listEligibleDestinations();
    setFolders(list);
    return list;
  }, []);

  const handlePick = useCallback(
    async (folderId: string) => {
      setStatus({ phase: "copying" });
      try {
        const { noteId } = await copyObjectToFolder(note, sourceUsername, folderId);
        const name =
          (folders ?? []).find((f) => f.id === folderId)?.name ?? "the folder";
        setStatus({ phase: "done", folderName: name });
        onCopied?.({ folderId, noteId });
      } catch (err) {
        const message =
          err instanceof CrossFolderCopyError
            ? err.message
            : "Could not copy the note to that folder";
        setStatus({ phase: "error", message });
      }
    },
    [note, sourceUsername, folders, onCopied],
  );

  // Flag off, or no eligible destination -> render nothing. The brief asks for
  // the entry point only when more than one eligible remembered folder exists;
  // since listEligibleDestinations already drops the active folder, "at least
  // one OTHER folder" is the right gate.
  if (!CROSS_FOLDER_ENABLED) return null;
  if (!folders || folders.length === 0) return null;

  const busy = status.phase === "copying";

  return (
    <>
      <Tooltip label="Copy this note into another of your folders" placement="bottom">
        <button
          type="button"
          onClick={() => {
            setStatus({ phase: "idle" });
            void refresh();
            setOpen(true);
          }}
          className={`ros-btn-raise inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-body font-medium text-foreground ${className}`}
        >
          <Icon name="copy" className="h-4 w-4" />
          Copy to another folder
        </button>
      </Tooltip>

      <LivingPopup
        open={open}
        onClose={() => setOpen(false)}
        origin={origin}
        label="Copy to another folder"
        widthClassName="max-w-sm"
        card={false}
      >
        <div className="flex w-full flex-col gap-3 rounded-xl border border-border bg-surface-overlay p-5 ros-popup-card-shadow">
          <div className="flex items-center justify-between">
            <h2 className="text-heading font-semibold text-foreground">
              Copy to another folder
            </h2>
            <Tooltip label="Close" placement="bottom">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-foreground-muted hover:text-foreground transition-colors"
              >
                <Icon name="close" className="h-5 w-5" />
              </button>
            </Tooltip>
          </div>

          <p className="text-meta text-foreground-muted leading-relaxed">
            Make a copy of this note in one of your other folders. The original
            stays here, untouched. You may be asked to grant access to the
            destination folder.
          </p>

          {status.phase === "done" ? (
            <div className="flex items-center gap-2 rounded-lg bg-surface-sunken px-3 py-2.5 text-body text-foreground">
              <Icon name="check" className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>Copied to {status.folderName}.</span>
            </div>
          ) : (
            <>
              <FolderDestinationPicker
                folders={folders}
                onPick={handlePick}
                busy={busy}
              />
              {status.phase === "error" ? (
                <p className="text-meta text-rose-600 leading-relaxed">
                  {status.message}
                </p>
              ) : null}
              {busy ? (
                <p className="text-meta text-foreground-muted">Copying...</p>
              ) : null}
            </>
          )}
        </div>
      </LivingPopup>
    </>
  );
}

// ── Generic single-object Copy / Move entry (Stage 2) ─────────────────────────

export interface CopyMoveToFolderButtonProps {
  /** The object to transfer, tagged by kind. */
  target: TransferTarget;
  /** Which operations to offer. Defaults to both. Move is destructive (it trashes
   *  the source after a verified copy), so a caller may offer copy-only. */
  modes?: Array<"copy" | "move">;
  /** Optional click origin for the popup zoom animation. */
  origin?: OpenOrigin | null;
  /** Optional: notified after a successful transfer. */
  onDone?: (result: {
    mode: "copy" | "move";
    folderId: string;
    destId: number;
  }) => void;
  /** Optional extra classes on the trigger button. */
  className?: string;
  /** Optional trigger label override. */
  label?: string;
}

type GenericStatus =
  | { phase: "idle"; mode: "copy" | "move" }
  | { phase: "working"; mode: "copy" | "move" }
  | { phase: "done"; mode: "copy" | "move"; folderName: string }
  | { phase: "error"; mode: "copy" | "move"; message: string };

/**
 * Generic "Copy / Move to another folder" entry point for ANY supported
 * TransferTarget kind. Renders nothing unless the flag is on AND at least one
 * eligible destination exists. Mirrors CopyNoteToFolderButton but dispatches by
 * kind and offers a Move toggle. The heavy zip-closure kinds
 * (method/experiment/project) surface the transfer layer's refusal message
 * inline rather than rendering a doomed action.
 */
export function CopyMoveToFolderButton({
  target,
  modes = ["copy", "move"],
  origin = null,
  onDone,
  className = "",
  label,
}: CopyMoveToFolderButtonProps) {
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<RememberedFolder[] | null>(null);
  const [mode, setMode] = useState<"copy" | "move">(modes[0] ?? "copy");
  const [status, setStatus] = useState<GenericStatus>({
    phase: "idle",
    mode: modes[0] ?? "copy",
  });

  useEffect(() => {
    if (!CROSS_FOLDER_ENABLED) return;
    let alive = true;
    void listEligibleDestinations().then((list) => {
      if (alive) setFolders(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const list = await listEligibleDestinations();
    setFolders(list);
    return list;
  }, []);

  const handlePick = useCallback(
    async (folderId: string) => {
      setStatus({ phase: "working", mode });
      try {
        const outcome =
          mode === "move"
            ? await moveObjectToFolder(target, folderId)
            : await copyObjectToFolder(target, folderId);
        const name =
          (folders ?? []).find((f) => f.id === folderId)?.name ?? "the folder";
        setStatus({ phase: "done", mode, folderName: name });
        onDone?.({ mode, folderId, destId: outcome.destId });
      } catch (err) {
        // A move that copied but could not remove the source is still a SUCCESS
        // for the copy; surface it as a soft warning, not a hard failure.
        if (err instanceof SourceNotRemovedError) {
          setStatus({ phase: "error", mode, message: err.message });
          onDone?.({ mode, folderId, destId: err.outcome.destId });
          return;
        }
        const message =
          err instanceof CrossFolderCopyError
            ? err.message
            : `Could not ${mode} this item to that folder`;
        setStatus({ phase: "error", mode, message });
      }
    },
    [target, mode, folders, onDone],
  );

  if (!CROSS_FOLDER_ENABLED) return null;
  if (!folders || folders.length === 0) return null;

  const busy = status.phase === "working";
  const triggerLabel = label ?? "Copy or move to another folder";

  return (
    <>
      <Tooltip label="Copy or move this into another of your folders" placement="bottom">
        <button
          type="button"
          onClick={() => {
            setStatus({ phase: "idle", mode });
            void refresh();
            setOpen(true);
          }}
          className={`ros-btn-raise inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-body font-medium text-foreground ${className}`}
        >
          <Icon name="copy" className="h-4 w-4" />
          {triggerLabel}
        </button>
      </Tooltip>

      <LivingPopup
        open={open}
        onClose={() => setOpen(false)}
        origin={origin}
        label="Copy or move to another folder"
        widthClassName="max-w-sm"
        card={false}
      >
        <div className="flex w-full flex-col gap-3 rounded-xl border border-border bg-surface-overlay p-5 ros-popup-card-shadow">
          <div className="flex items-center justify-between">
            <h2 className="text-heading font-semibold text-foreground">
              {mode === "move" ? "Move" : "Copy"} to another folder
            </h2>
            <Tooltip label="Close" placement="bottom">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-foreground-muted hover:text-foreground transition-colors"
              >
                <Icon name="close" className="h-5 w-5" />
              </button>
            </Tooltip>
          </div>

          {modes.length > 1 ? (
            <div
              className="flex gap-1 rounded-lg bg-surface-sunken p-1"
              role="tablist"
              aria-label="Copy or move"
            >
              {modes.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  disabled={busy}
                  onClick={() => {
                    setMode(m);
                    setStatus({ phase: "idle", mode: m });
                  }}
                  className={`flex-1 rounded-md px-3 py-1.5 text-body font-medium transition-colors disabled:opacity-50 ${
                    mode === m
                      ? "bg-surface-overlay text-foreground ros-popup-card-shadow"
                      : "text-foreground-muted hover:text-foreground"
                  }`}
                >
                  {m === "move" ? "Move" : "Copy"}
                </button>
              ))}
            </div>
          ) : null}

          <p className="text-meta text-foreground-muted leading-relaxed">
            {mode === "move"
              ? `Move "${describeTarget(target)}" into one of your other folders. It moves out of this folder; the original is sent to Trash here after the copy is confirmed in the destination.`
              : `Make a copy of "${describeTarget(target)}" in one of your other folders. The original stays here, untouched.`}{" "}
            You may be asked to grant access to the destination folder.
          </p>

          {status.phase === "done" ? (
            <div className="flex items-center gap-2 rounded-lg bg-surface-sunken px-3 py-2.5 text-body text-foreground">
              <Icon name="check" className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                {status.mode === "move" ? "Moved" : "Copied"} to {status.folderName}.
              </span>
            </div>
          ) : (
            <>
              <FolderDestinationPicker
                folders={folders}
                onPick={handlePick}
                busy={busy}
              />
              {status.phase === "error" ? (
                <p className="text-meta text-rose-600 leading-relaxed">
                  {status.message}
                </p>
              ) : null}
              {busy ? (
                <p className="text-meta text-foreground-muted">
                  {mode === "move" ? "Moving..." : "Copying..."}
                </p>
              ) : null}
            </>
          )}
        </div>
      </LivingPopup>
    </>
  );
}

// ── Bulk Copy / Move entry (Stage 2) ──────────────────────────────────────────

export interface BulkTransferDialogProps {
  /** The selected objects to transfer. Heterogeneous kinds are allowed; an
   *  unsupported kind is reported per-item without aborting the batch. */
  items: TransferTarget[];
  /** Which operations to offer. Defaults to both. */
  modes?: Array<"copy" | "move">;
  /** Dismiss the dialog. */
  onClose: () => void;
  /** Called after the batch settles so the caller can clear its selection. */
  onSettled?: (okCount: number, failCount: number) => void;
  /** Optional click origin for the popup zoom animation. */
  origin?: OpenOrigin | null;
}

type BulkPhase =
  | { phase: "idle" }
  | { phase: "working" }
  | { phase: "done"; okCount: number; failCount: number; lines: string[] }
  | { phase: "error"; message: string };

/**
 * Minimal BULK destination picker modeled on BulkSequenceSendDialog: a Copy/Move
 * toggle, a destination picker, and a per-item result summary. Resolves the
 * destination handle ONCE via bulkTransfer (single permission prompt). Renders
 * nothing when the flag is off, when there are no items, or when there is no
 * eligible destination.
 */
export function BulkTransferDialog({
  items,
  modes = ["copy", "move"],
  onClose,
  onSettled,
  origin = null,
}: BulkTransferDialogProps) {
  const [folders, setFolders] = useState<RememberedFolder[] | null>(null);
  const [mode, setMode] = useState<"copy" | "move">(modes[0] ?? "copy");
  const [state, setState] = useState<BulkPhase>({ phase: "idle" });

  useEffect(() => {
    if (!CROSS_FOLDER_ENABLED) return;
    let alive = true;
    void listEligibleDestinations().then((list) => {
      if (alive) setFolders(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const handlePick = useCallback(
    async (folderId: string) => {
      setState({ phase: "working" });
      try {
        const result = await bulkTransfer(items, folderId, mode);
        const lines = result.items.map((r) =>
          r.ok
            ? `${describeTarget(r.target)} — done`
            : `${describeTarget(r.target)} — ${r.reason}`,
        );
        setState({
          phase: "done",
          okCount: result.okCount,
          failCount: result.failCount,
          lines,
        });
        onSettled?.(result.okCount, result.failCount);
      } catch (err) {
        const message =
          err instanceof CrossFolderCopyError
            ? err.message
            : "Could not transfer the selected items";
        setState({ phase: "error", message });
      }
    },
    [items, mode, onSettled],
  );

  if (!CROSS_FOLDER_ENABLED) return null;
  if (items.length === 0) return null;
  if (!folders || folders.length === 0) return null;

  const busy = state.phase === "working";

  return (
    <LivingPopup
      open
      onClose={onClose}
      origin={origin}
      label="Copy or move selected items"
      widthClassName="max-w-md"
      card={false}
    >
      <div className="flex w-full flex-col gap-3 rounded-xl border border-border bg-surface-overlay p-5 ros-popup-card-shadow">
        <div className="flex items-center justify-between">
          <h2 className="text-heading font-semibold text-foreground">
            {mode === "move" ? "Move" : "Copy"} {items.length}{" "}
            {items.length === 1 ? "item" : "items"} to another folder
          </h2>
          <Tooltip label="Close" placement="bottom">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-foreground-muted hover:text-foreground transition-colors"
            >
              <Icon name="close" className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>

        {modes.length > 1 && state.phase !== "done" ? (
          <div
            className="flex gap-1 rounded-lg bg-surface-sunken p-1"
            role="tablist"
            aria-label="Copy or move"
          >
            {modes.map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                disabled={busy}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-md px-3 py-1.5 text-body font-medium transition-colors disabled:opacity-50 ${
                  mode === m
                    ? "bg-surface-overlay text-foreground ros-popup-card-shadow"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {m === "move" ? "Move" : "Copy"}
              </button>
            ))}
          </div>
        ) : null}

        {state.phase === "done" ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded-lg bg-surface-sunken px-3 py-2.5 text-body text-foreground">
              <Icon name="check" className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                {mode === "move" ? "Moved" : "Copied"} {state.okCount} of{" "}
                {state.okCount + state.failCount}.
              </span>
            </div>
            {state.failCount > 0 ? (
              <ul className="flex flex-col gap-1 text-meta text-foreground-muted">
                {state.lines.map((line, i) => (
                  <li key={i} className="leading-relaxed">
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <>
            <p className="text-meta text-foreground-muted leading-relaxed">
              {mode === "move"
                ? "The selected items move out of this folder; each original is sent to Trash here after its copy is confirmed in the destination."
                : "The selected items are copied; the originals stay here, untouched."}{" "}
              You may be asked to grant access to the destination folder once.
            </p>
            <FolderDestinationPicker folders={folders} onPick={handlePick} busy={busy} />
            {state.phase === "error" ? (
              <p className="text-meta text-rose-600 leading-relaxed">{state.message}</p>
            ) : null}
            {busy ? (
              <p className="text-meta text-foreground-muted">
                {mode === "move" ? "Moving..." : "Copying..."} this may take a moment.
              </p>
            ) : null}
          </>
        )}
      </div>
    </LivingPopup>
  );
}
