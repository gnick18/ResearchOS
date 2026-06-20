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
  CrossFolderCopyError,
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
