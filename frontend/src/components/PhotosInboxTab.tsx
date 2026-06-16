"use client";

// Photos segment of the unified inbox (cross-boundary sharing Phase 2b-iii).
//
// This is the EXISTING photo-triage flow, moved verbatim out of InboxPanel so
// the unified inbox shell can mount it under the "Photos" tab with zero
// behavior change. Everything here, the album grouping, multi-select
// (shift / cmd-ctrl), the right-click context menu, send-to-task,
// send-to-note, the ImageMetadataPopup, duplicate resolution, and move-to-active,
// is identical to the pre-rework InboxPanel. The only structural change is that
// the full-screen backdrop + card chrome now lives in InboxPanel (the shell),
// and this component renders just the list body plus its own floating UI
// (context menu, pickers, toast, metadata popup).

import { useCallback, useEffect, useMemo, useState } from "react";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import { listImagesInFolder, type FolderImageEntry } from "@/lib/attachments/image-folder";
import {
  deleteImageFromBase,
  moveImageBetweenBases,
  renameImageInPlace,
} from "@/lib/attachments/move-image";
import { checkForDuplicates } from "@/lib/attachments/duplicate-check";
import { fileService } from "@/lib/file-system/file-service";
import { sidecarPath, type ImageSidecar } from "@/lib/attachments/image-folder";
import { imageEvents } from "@/lib/attachments/image-events";
import { resolveTaskResultsBase } from "@/lib/tasks/results-paths";
import { useAppStore, type ActiveTask, type ActiveNote } from "@/lib/store";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { attachImageToNote } from "@/lib/attachments/attach-image";
import ImageMetadataPopup from "./ImageMetadataPopup";
import SendToTaskPicker from "./SendToTaskPicker";
import SendToNotePicker from "./SendToNotePicker";
import { useDuplicateResolver } from "./DuplicateUploadDialog";

interface InboxEntry extends FolderImageEntry {
  blobUrl?: string;
}

function inboxBase(username: string): string {
  return `users/${username}/inbox`;
}

// "Lab Notes" attachments live in the per-tab `notes/` scope; "Results"
// attachments live in `results/`. The image router on the receive side and
// the universal-drop handler on the popup also target these scopes, so
// dragging into the popup vs filing from here land in the same folder.
function taskSubTabBase(
  taskResultsBase: string,
  subTab: "notes" | "results",
): string {
  return `${taskResultsBase}/${subTab}`;
}

export default function PhotosInboxTab() {
  const { currentUser } = useCurrentUser();
  const activeTask = useAppStore((s) => s.activeTask);
  // Inbox note-routing R2 (2026-05-26): Inbox now files to NOTES alongside
  // experiments. `activeNote` mirrors `activeTask` — set by NoteDetailPopup
  // when a note is open, cleared on close. The "Move to active" button and
  // the right-click menu both branch on which of the two (or both) is set.
  const activeNote = useAppStore((s) => s.activeNote);
  const { resolve: resolveDuplicates, DialogComponent: DuplicateDialog } =
    useDuplicateResolver();
  const [entries, setEntries] = useState<InboxEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // While the picker-driven batch send is running, lock the whole list so a
  // user can't double-click and accidentally double-file an item. Replaces
  // the per-row `busy` for batch operations.
  const [batchBusy, setBatchBusy] = useState(false);
  const [popupFilename, setPopupFilename] = useState<string | null>(null);

  // Multi-select state. `selectedIds` is the set of inbox-entry names that
  // are highlighted. `anchorId` is the last single-click anchor — used as
  // the range start for shift-click. Plain clicks reset the selection (with
  // the caveat that clicking an already-selected item leaves the set
  // intact so the user can right-click / send the whole group).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);

  // Context menu: opens on right-click of an inbox row, or via the
  // hover-only "…" button on the right side of each row.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    anchorEntry: InboxEntry;
  } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Inbox note-routing R2: second picker, opened by the "Send N items to
  // note" context-menu entry. Mutually exclusive with `pickerOpen` (one
  // modal at a time), but kept as separate flags so each picker owns its
  // own search state without cross-talk.
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  // Inbox note-routing R2: the per-row "Move to active" affordance becomes
  // a dropdown when BOTH activeTask AND activeNote are set. `dropdownOpen`
  // tracks which row's dropdown is currently expanded (by entry name) so
  // outside-click can close it.
  const [dropdownOpen, setDropdownOpen] = useState<string | null>(null);

  // Brief confirmation toast (drop-in, no library — same shape as the
  // emerald drop-toast in TaskDetailPopup).
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const refresh = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const raw = await listImagesInFolder(inboxBase(currentUser));
      const withUrls: InboxEntry[] = [];
      for (const e of raw) {
        const fullPath = `${inboxBase(currentUser)}/Images/${e.name}`;
        const blobUrl = (await blobUrlResolver.getBlobUrl(fullPath)) ?? undefined;
        withUrls.push({ ...e, blobUrl });
      }
      setEntries(withUrls);
      // Drop any selection ids that no longer correspond to an entry — keeps
      // the highlight honest after a delete / move from outside this list.
      setSelectedIds((prev) => {
        if (prev.size === 0) return prev;
        const live = new Set(withUrls.map((e) => e.name));
        const next = new Set<string>();
        for (const id of prev) if (live.has(id)) next.add(id);
        return next.size === prev.size ? prev : next;
      });
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Close the context menu on any outside click or Esc. Note we attach to
  // the document so clicks on either the underlying list rows OR the
  // backdrop dismiss it consistently.
  useEffect(() => {
    if (!contextMenu) return;
    const onAny = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", onAny);
    window.addEventListener("contextmenu", onAny);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onAny);
      window.removeEventListener("contextmenu", onAny);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  // Inbox note-routing R2: same dismissal contract for the per-row "Move
  // to active…" dropdown when both an experiment AND a note are open.
  // Reuses the contextMenu's outside-click + Esc plumbing but as its own
  // effect so the two pieces of UI can be open independently.
  useEffect(() => {
    if (!dropdownOpen) return;
    const onAny = () => setDropdownOpen(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(null);
    };
    window.addEventListener("click", onAny);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onAny);
      window.removeEventListener("keydown", onKey);
    };
  }, [dropdownOpen]);

  const moveToActive = useCallback(
    async (entry: InboxEntry, task: ActiveTask) => {
      if (!currentUser) return;
      setBusy(entry.name);
      try {
        const taskBase = await resolveTaskResultsBase(
          { id: task.id, owner: task.owner },
          currentUser
        );
        await moveImageBetweenBases(inboxBase(currentUser), taskBase, entry.name);
        await refresh();
      } catch (err) {
        console.error("[inbox] move failed", err);
        alert("Failed to move image to experiment.");
      } finally {
        setBusy(null);
      }
    },
    [currentUser, refresh]
  );

  // Inbox note-routing R2: single-row attach to the active NOTE. Reads the
  // inbox image as a Blob, calls attachImageToNote (which handles its own
  // dedupe + appends a markdown link to the note's latest entry), and then
  // deletes the source row from the inbox folder so the row disappears from
  // the panel after refresh. We intentionally do not reuse
  // moveImageBetweenBases here: note attachments need the markdown-append
  // side effect, which only attachImageToNote knows about.
  const moveToActiveNote = useCallback(
    async (entry: InboxEntry, note: ActiveNote) => {
      if (!currentUser) return;
      setBusy(entry.name);
      try {
        const srcImage = `${inboxBase(currentUser)}/Images/${entry.name}`;
        const srcSidecar = sidecarPath(inboxBase(currentUser), entry.name);
        const blob = await fileService.readFileAsBlob(srcImage);
        if (!blob) throw new Error(`Source image not found: ${srcImage}`);
        const caption = entry.sidecar?.caption;
        await attachImageToNote({
          ownerUsername: note.owner,
          noteId: note.id,
          blob,
          suggestedFilename: entry.name,
          altText: caption ?? entry.name,
        });
        await fileService.deleteFile(srcImage);
        await fileService.deleteFile(srcSidecar);
        blobUrlResolver.revokePath(srcImage);
        imageEvents.emitDeleted({
          basePath: inboxBase(currentUser),
          filename: entry.name,
        });
        await refresh();
      } catch (err) {
        console.error("[inbox] move-to-note failed", err);
        alert("Failed to attach image to note.");
      } finally {
        setBusy(null);
      }
    },
    [currentUser, refresh]
  );

  const deleteInbox = useCallback(
    async (entry: InboxEntry) => {
      if (!currentUser) return;
      const ok = window.confirm(`Delete "${entry.name}" from your inbox?`);
      if (!ok) return;
      setBusy(entry.name);
      try {
        await deleteImageFromBase(inboxBase(currentUser), entry.name);
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [currentUser, refresh]
  );

  // ---- Selection handlers --------------------------------------------------

  const handleRowClick = useCallback(
    (e: React.MouseEvent, entry: InboxEntry) => {
      // Clicks on the action buttons themselves are stopPropagation'd
      // upstream, so anything we see here is a row click. Open the
      // metadata popup when the click is a plain single-select (i.e. not a
      // modified click and the row is the only one in the active
      // selection or no selection at all).
      const isShift = e.shiftKey;
      const isModifier = e.metaKey || e.ctrlKey;

      if (isShift && anchorId) {
        // Range select from anchor → this row.
        const startIdx = entries.findIndex((x) => x.name === anchorId);
        const endIdx = entries.findIndex((x) => x.name === entry.name);
        if (startIdx >= 0 && endIdx >= 0) {
          const [lo, hi] =
            startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          const next = new Set<string>();
          for (let i = lo; i <= hi; i += 1) next.add(entries[i].name);
          setSelectedIds(next);
        }
        return;
      }

      if (isModifier) {
        // Add / remove this row from the selection without touching the rest.
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(entry.name)) next.delete(entry.name);
          else next.add(entry.name);
          return next;
        });
        setAnchorId(entry.name);
        return;
      }

      // Plain click: if the click landed on an already-selected row AND the
      // selection is multi-item, leave the selection alone (the user is
      // about to right-click / drag the group). Otherwise this becomes a
      // single-select and opens the metadata popup as the legacy click
      // affordance.
      const alreadyInGroup = selectedIds.has(entry.name) && selectedIds.size > 1;
      if (alreadyInGroup) {
        setAnchorId(entry.name);
        return;
      }
      setSelectedIds(new Set([entry.name]));
      setAnchorId(entry.name);
      setPopupFilename(entry.name);
    },
    [entries, anchorId, selectedIds]
  );

  // Right-click on a row. If the row is not part of the current selection,
  // the right-click resets the selection to just this row (so the menu's
  // "Send to task…" affects the expected target).
  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, entry: InboxEntry) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selectedIds.has(entry.name)) {
        setSelectedIds(new Set([entry.name]));
        setAnchorId(entry.name);
      }
      setContextMenu({ x: e.clientX, y: e.clientY, anchorEntry: entry });
    },
    [selectedIds]
  );

  // Click outside a row clears the selection. We hook this off the panel
  // body — but NOT the list itself, since clicks on rows have their own
  // handlers above.
  const handleBodyClick = useCallback((e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    setSelectedIds(new Set());
    setAnchorId(null);
  }, []);

  // ---- Batch action: Send selected items to a task -------------------------

  const sendSelectedToTask = useCallback(
    async (
      task: Pick<ActiveTask, "id" | "owner" | "name">,
      subTab: "notes" | "results" = "notes",
    ) => {
      if (!currentUser) return;
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;

      setBatchBusy(true);
      try {
        const taskBase = await resolveTaskResultsBase(
          { id: task.id, owner: task.owner },
          currentUser
        );
        const destBase = taskSubTabBase(taskBase, subTab);
        const fromBase = inboxBase(currentUser);

        // List the destination's existing Images/ filenames so we can
        // surface collisions to the user instead of silently auto-suffixing.
        // Previously this batch used `moveImageBetweenBasesUnique`, which
        // appended `-1`, `-2` to the filename without any UI signal.
        const existingDest = new Set(
          await fileService.listFiles(`${destBase}/Images`)
        );

        // Build synthetic File objects so the duplicate-check helper has
        // size + last-modified for the dialog. The bytes are already on
        // disk — we just need a File handle for the partition logic.
        // This batch only touches inbox images, all of which were
        // previously written via image-folder helpers, so reading them
        // back as Blobs is safe.
        const idsAsFiles: File[] = [];
        for (const id of ids) {
          const blob = await fileService.readFileAsBlob(
            `${fromBase}/Images/${id}`
          );
          if (!blob) {
            // Source vanished between selection and send — log and skip.
            console.warn("[inbox] source image missing:", id);
            continue;
          }
          const file = new File([blob], id, {
            type: blob.type,
            lastModified: Date.now(),
          });
          idsAsFiles.push(file);
        }

        const { uniqueFiles, collisions } = checkForDuplicates(
          idsAsFiles,
          existingDest
        );

        let succeeded = 0;
        const failures: string[] = [];

        // Safe-to-write: move bytes as-is. Reuses the legacy
        // moveImageBetweenBases primitive (no suffix logic — the
        // partition already guarantees uniqueness).
        for (const file of uniqueFiles) {
          try {
            await moveImageBetweenBases(fromBase, destBase, file.name);
            succeeded += 1;
          } catch (err) {
            console.error("[inbox] send-to-task failed for", file.name, err);
            failures.push(file.name);
          }
        }

        // Collisions: walk the dialog queue.
        if (collisions.length > 0) {
          const resolutions = await resolveDuplicates(collisions);
          for (const info of collisions) {
            const choice = resolutions.get(info.existingName);
            if (!choice || choice.action === "cancel") continue;
            const finalName =
              choice.action === "rename"
                ? (choice.newName ?? info.suggestedName)
                : info.existingName;
            try {
              if (choice.action === "replace") {
                // Drop the existing destination image + its sidecar.
                await deleteImageFromBase(destBase, info.existingName);
              }
              // Write the source bytes under finalName, then delete from
              // inbox + emit events. Mirrors the body of
              // moveImageBetweenBases but with a renamed destination.
              const srcImage = `${fromBase}/Images/${info.existingName}`;
              const srcSidecar = sidecarPath(fromBase, info.existingName);
              const destImage = `${destBase}/Images/${finalName}`;
              const destSidecar = sidecarPath(destBase, finalName);
              const blob = await fileService.readFileAsBlob(srcImage);
              if (!blob) throw new Error(`Source image not found: ${srcImage}`);
              await fileService.writeFileFromBlob(destImage, blob);
              const sidecar = await fileService.readJson<ImageSidecar>(srcSidecar);
              if (sidecar) {
                await fileService.writeJson(destSidecar, sidecar);
              }
              await fileService.deleteFile(srcImage);
              await fileService.deleteFile(srcSidecar);
              blobUrlResolver.revokePath(srcImage);
              imageEvents.emitAttached({
                basePath: destBase,
                relativePath: `Images/${finalName}`,
              });
              imageEvents.emitDeleted({
                basePath: fromBase,
                filename: info.existingName,
              });
              succeeded += 1;
            } catch (err) {
              console.error("[inbox] send-to-task failed for", finalName, err);
              failures.push(finalName);
            }
          }
        }

        await refresh();
        setSelectedIds(new Set());
        setAnchorId(null);
        setPickerOpen(false);

        if (succeeded > 0) {
          const noun = succeeded === 1 ? "item" : "items";
          const tab = subTab === "notes" ? "Lab Notes" : "Results";
          setToast(`Sent ${succeeded} ${noun} to ${task.name} (${tab}).`);
        }
        if (failures.length > 0) {
          alert(
            `Some items failed to send (${failures.length}). Check the console for details.`
          );
        }
      } finally {
        setBatchBusy(false);
      }
    },
    [currentUser, selectedIds, refresh, resolveDuplicates]
  );

  // ---- Batch action: Send selected items to a note ------------------------
  // Inbox note-routing R2: parallels sendSelectedToTask, but notes don't
  // share the destination-collision dialog flow because attachImageToNote
  // dedupes filenames internally (its own pickUniqueFilename pass). So
  // this is a plain sequential loop with success / failure tallies.
  // Sequential rather than Promise.all because (a) it's clearer to debug
  // and (b) the per-call markdown-append happens on the note's latest
  // entry — concurrent appends on the same entry would race even though
  // the file write is dedupe-safe.
  const sendSelectedToNote = useCallback(
    async (note: { id: number; owner: string; title: string }) => {
      if (!currentUser) return;
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;

      setBatchBusy(true);
      try {
        const fromBase = inboxBase(currentUser);
        let succeeded = 0;
        const failures: string[] = [];

        for (const id of ids) {
          try {
            const srcImage = `${fromBase}/Images/${id}`;
            const srcSidecar = sidecarPath(fromBase, id);
            const blob = await fileService.readFileAsBlob(srcImage);
            if (!blob) {
              console.warn("[inbox] source image missing:", id);
              failures.push(id);
              continue;
            }
            // The picker hands us the note ref; the per-row caption from
            // the sidecar becomes the alt text on the appended markdown
            // link. Falls back to the filename when no caption was set.
            const caption = entries.find((e) => e.name === id)?.sidecar?.caption;
            await attachImageToNote({
              ownerUsername: note.owner,
              noteId: note.id,
              blob,
              suggestedFilename: id,
              altText: caption ?? id,
            });
            // Now delete the inbox copy (image + sidecar) so the row
            // disappears from the panel. attachImageToNote already wrote
            // its own copy under the note's Images/.
            await fileService.deleteFile(srcImage);
            await fileService.deleteFile(srcSidecar);
            blobUrlResolver.revokePath(srcImage);
            imageEvents.emitDeleted({ basePath: fromBase, filename: id });
            succeeded += 1;
          } catch (err) {
            console.error("[inbox] send-to-note failed for", id, err);
            failures.push(id);
          }
        }

        await refresh();
        setSelectedIds(new Set());
        setAnchorId(null);
        setNotePickerOpen(false);

        if (succeeded > 0) {
          const noun = succeeded === 1 ? "item" : "items";
          setToast(
            `Sent ${succeeded} ${noun} to ${note.title || "note"}.`
          );
        }
        if (failures.length > 0) {
          alert(
            `Some items failed to send (${failures.length}). Check the console for details.`
          );
        }
      } finally {
        setBatchBusy(false);
      }
    },
    [currentUser, selectedIds, refresh, entries]
  );

  // The context-menu / button label includes the count when >1 selected.
  const selectedCount = selectedIds.size;
  const sendMenuLabel = useMemo(() => {
    if (selectedCount <= 1) return "Send to task…";
    return `Send ${selectedCount} items to task…`;
  }, [selectedCount]);
  // Inbox note-routing R2: companion label for the new "Send … to note"
  // entry. Same shape so the two menu rows read as sibling actions.
  const sendNoteMenuLabel = useMemo(() => {
    if (selectedCount <= 1) return "Send to note…";
    return `Send ${selectedCount} items to note…`;
  }, [selectedCount]);

  // ---- Batch grouping -------------------------------------------------------
  // Legacy: photos that arrived as one album share a `telegramMediaGroupId` in
  // their sidecar (written by the now-removed Telegram integration). Group
  // consecutive entries that share that id into a single visual cluster so a
  // user can file the whole album in one action. Entries without the field
  // (everything sent via the mobile relay, single sends) render as standalone
  // rows, which is now the common case.
  //
  // `rows` is an ordered list of either a single entry or a batch group; the
  // original `entries` order is preserved (arrivals are already sorted) so
  // grouping never reshuffles the list.
  type InboxRow =
    | { kind: "single"; entry: InboxEntry }
    | { kind: "batch"; groupId: string; entries: InboxEntry[] };
  const rows = useMemo<InboxRow[]>(() => {
    const out: InboxRow[] = [];
    let i = 0;
    while (i < entries.length) {
      const gid = entries[i].sidecar?.telegramMediaGroupId;
      if (!gid) {
        out.push({ kind: "single", entry: entries[i] });
        i += 1;
        continue;
      }
      const group: InboxEntry[] = [];
      while (i < entries.length && entries[i].sidecar?.telegramMediaGroupId === gid) {
        group.push(entries[i]);
        i += 1;
      }
      // A "group" of one is just a single row — don't draw the batch chrome.
      if (group.length === 1) out.push({ kind: "single", entry: group[0] });
      else out.push({ kind: "batch", groupId: gid, entries: group });
    }
    return out;
  }, [entries]);

  // Select every photo in a batch group (replaces the current selection).
  const selectBatch = useCallback((groupEntries: InboxEntry[]) => {
    setSelectedIds(new Set(groupEntries.map((e) => e.name)));
    setAnchorId(groupEntries[groupEntries.length - 1]?.name ?? null);
  }, []);

  // Single inbox row. Shared between standalone rows and the members of a
  // batch group so the row chrome (thumbnail, caption, per-row controls)
  // stays identical in both layouts.
  const renderRow = (entry: InboxEntry) => {
    const caption = entry.sidecar?.caption;
    const isSelected = selectedIds.has(entry.name);
    return (
      <li
        key={entry.name}
        className={`group flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${
          isSelected
            ? "border-blue-400 bg-blue-50 dark:bg-blue-500/10 ring-2 ring-blue-200"
            : "border-border bg-surface-raised hover:border-blue-200 dark:border-blue-500/30 hover:bg-blue-50 dark:hover:bg-brand-action/10"
        }`}
        onClick={(e) => handleRowClick(e, entry)}
        onContextMenu={(e) => handleRowContextMenu(e, entry)}
      >
        {entry.blobUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.blobUrl}
            alt={entry.name}
            className="w-16 h-16 rounded object-cover bg-surface-sunken flex-shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded bg-surface-sunken flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-body font-medium text-foreground truncate" title={entry.name}>
            {caption ?? <span className="italic text-foreground-muted">No caption</span>}
          </p>
          <p className="text-meta text-foreground-muted truncate">{entry.name}</p>
          {entry.sidecar?.receivedAt && (
            <p className="text-meta text-foreground-muted">
              {new Date(entry.sidecar.receivedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <MoveToActiveControl
            entry={entry}
            activeTask={activeTask}
            activeNote={activeNote}
            busy={busy === entry.name || batchBusy}
            dropdownOpen={dropdownOpen === entry.name}
            onOpenDropdown={() => setDropdownOpen(entry.name)}
            onCloseDropdown={() => setDropdownOpen(null)}
            onMoveToTask={(task) => {
              setDropdownOpen(null);
              void moveToActive(entry, task);
            }}
            onMoveToNote={(note) => {
              setDropdownOpen(null);
              void moveToActiveNote(entry, note);
            }}
          />
          <button
            type="button"
            aria-label="More actions"
            disabled={batchBusy}
            onClick={(e) => {
              e.preventDefault();
              // Treat the "…" button like a right-click on this row:
              // select-if-not-selected, then open the menu at the button's
              // anchor point.
              if (!selectedIds.has(entry.name)) {
                setSelectedIds(new Set([entry.name]));
                setAnchorId(entry.name);
              }
              const rect = (
                e.currentTarget as HTMLButtonElement
              ).getBoundingClientRect();
              setContextMenu({
                x: rect.left,
                y: rect.bottom + 4,
                anchorEntry: entry,
              });
            }}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 px-2 py-1.5 text-meta text-foreground-muted hover:text-foreground hover:bg-surface-sunken rounded-md transition-all"
            data-force-hover-controls-target
          >
            ⋯
          </button>
          <button
            type="button"
            disabled={busy === entry.name || batchBusy}
            onClick={() => deleteInbox(entry)}
            className="px-2 py-1.5 text-meta text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      </li>
    );
  };

  return (
    <>
      {/* DuplicateDialog uses higher z-index (200) than the inbox backdrop
          (105), so clicks land on it correctly even though it's a sibling.
          Mounted outside the backdrop so the backdrop's onClick={onClose}
          doesn't fire when the user interacts with the dialog. */}
      <DuplicateDialog />

      <div className="flex-1 overflow-y-auto p-4" onClick={handleBodyClick}>
        {loading ? (
          <p className="text-body text-foreground-muted text-center py-8">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-body text-foreground-muted italic text-center py-8">
            Inbox is empty. Photos sent with no experiment open land here.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) =>
              row.kind === "single" ? (
                renderRow(row.entry)
              ) : (
                <li key={`batch-${row.groupId}`} className="list-none">
                  {/* Album: a single batch the user sent at once. Grouped
                      visually so it reads as one unit, with a one-tap
                      "select all" so the whole album can be filed together
                      via the right-click menu. */}
                  <div className="rounded-lg border border-blue-100 bg-blue-50 dark:bg-blue-500/10 p-2">
                    <div className="flex items-center justify-between px-1 pb-1.5">
                      <span className="inline-flex items-center gap-1.5 text-meta font-medium uppercase tracking-wide text-blue-500">
                        <BatchIcon />
                        Album · {row.entries.length} photos
                      </span>
                      <button
                        type="button"
                        disabled={batchBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectBatch(row.entries);
                        }}
                        className="text-meta font-medium text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 disabled:opacity-40"
                      >
                        Select all
                      </button>
                    </div>
                    <ul className="space-y-2">
                      {row.entries.map((entry) => renderRow(entry))}
                    </ul>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      {contextMenu && (
        <div
          className="fixed z-[115] min-w-[180px] rounded-md border border-border bg-surface-raised shadow-lg py-1"
          style={{
            left: Math.min(
              contextMenu.x,
              (typeof window !== "undefined" ? window.innerWidth : 1024) - 200,
            ),
            top: Math.min(
              contextMenu.y,
              (typeof window !== "undefined" ? window.innerHeight : 768) - 120,
            ),
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              setPickerOpen(true);
            }}
            className="w-full text-left px-3 py-1.5 text-body text-foreground hover:bg-blue-50 dark:hover:bg-brand-action/10"
          >
            {sendMenuLabel}
          </button>
          {/* Inbox note-routing R2: parallel "Send … to note" entry, opens
              the SendToNotePicker. Sits directly under "Send … to task"
              so the two read as sibling actions. */}
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              setNotePickerOpen(true);
            }}
            className="w-full text-left px-3 py-1.5 text-body text-foreground hover:bg-blue-50 dark:hover:bg-brand-action/10"
          >
            {sendNoteMenuLabel}
          </button>
          <button
            type="button"
            disabled={!activeTask}
            onClick={() => {
              if (!activeTask) return;
              setContextMenu(null);
              void moveToActive(contextMenu.anchorEntry, activeTask);
            }}
            className="w-full text-left px-3 py-1.5 text-body text-foreground hover:bg-blue-50 dark:hover:bg-brand-action/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {activeTask ? `Move to active (${activeTask.name})` : "Move to active"}
          </button>
          {/* Inbox note-routing R2: when a note popup is open, surface a
              dedicated "Move to active note" entry here too, mirroring
              the per-row dropdown shape. Hidden entirely when no note is
              open so the menu doesn't grow a disabled row. */}
          {activeNote && (
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                void moveToActiveNote(contextMenu.anchorEntry, activeNote);
              }}
              className="w-full text-left px-3 py-1.5 text-body text-foreground hover:bg-blue-50 dark:hover:bg-brand-action/10"
            >
              {`Move to active note (${activeNote.title})`}
            </button>
          )}
          <div className="h-px bg-surface-sunken my-1" />
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              void deleteInbox(contextMenu.anchorEntry);
            }}
            className="w-full text-left px-3 py-1.5 text-body text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10"
          >
            Delete
          </button>
        </div>
      )}

      {pickerOpen && (
        <SendToTaskPicker
          isOpen={pickerOpen}
          selectedCount={Math.max(1, selectedIds.size)}
          onClose={() => setPickerOpen(false)}
          onPick={(task, subTab) => {
            void sendSelectedToTask(task, subTab);
          }}
        />
      )}

      {/* Inbox note-routing R2: companion note picker. Mounted alongside
          SendToTaskPicker so the right-click menu's "Send … to note"
          entry has a target. Only one picker is open at a time (menu
          rows set just one of the two open-flags). */}
      {notePickerOpen && (
        <SendToNotePicker
          isOpen={notePickerOpen}
          selectedCount={Math.max(1, selectedIds.size)}
          onClose={() => setNotePickerOpen(false)}
          onPick={(note) => {
            void sendSelectedToNote(note);
          }}
        />
      )}

      {toast && (
        <div
          className="fixed z-[120] right-6 bottom-6 max-w-sm rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 text-body text-emerald-900 shadow-lg pointer-events-none"
          role="status"
        >
          {toast}
        </div>
      )}

      {popupFilename && currentUser && (
        <ImageMetadataPopup
          basePath={inboxBase(currentUser)}
          filename={popupFilename}
          inDocument={false}
          onRename={async (newFilename) => {
            await renameImageInPlace(inboxBase(currentUser), popupFilename, newFilename);
            await refresh();
          }}
          onDelete={async () => {
            await deleteImageFromBase(inboxBase(currentUser), popupFilename);
            await refresh();
          }}
          onMoveToActive={async (task) => {
            const taskBase = await resolveTaskResultsBase(
              { id: task.id, owner: task.owner },
              currentUser
            );
            await moveImageBetweenBases(inboxBase(currentUser), taskBase, popupFilename);
            await refresh();
          }}
          onClose={() => setPopupFilename(null)}
        />
      )}
    </>
  );
}

// Small stacked-photos glyph for the album group header. Inline
// SVG (project rule: no emoji / no icon-font deps in UI).
function BatchIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="4" width="9" height="9" rx="1.5" />
      <path d="M2.5 11V3.5A1.5 1.5 0 0 1 4 2h6.5" />
    </svg>
  );
}

// ─── MoveToActiveControl ────────────────────────────────────────────────────
//
// Inbox note-routing R2 (2026-05-26): the per-row primary CTA branches on
// which active surface (task / note / both / neither) the user has open in
// ResearchOS. Pulling the four-way logic out of the main list keeps the
// row JSX flat and lets the dropdown anchor at the button without needing
// extra refs on the parent.
//
// Cases:
//   - activeTask only           → "Move to active" button → moveToActive(task)
//   - activeNote only           → "Move to active note" → moveToActiveNote(note)
//   - BOTH active               → "Move to active…" + caret → dropdown with
//                                 two labeled rows (experiment + note)
//   - NEITHER active            → disabled button with the legacy tooltip
//                                 ("Open an experiment first")
//
// The dropdown's outside-click + Esc-to-close lifecycle is owned by the
// parent (see `dropdownOpen` state + effect). This component just renders
// the trigger and the floating menu when its `dropdownOpen` prop is true.

interface MoveToActiveControlProps {
  entry: InboxEntry;
  activeTask: ActiveTask | null;
  activeNote: ActiveNote | null;
  busy: boolean;
  dropdownOpen: boolean;
  onOpenDropdown: () => void;
  onCloseDropdown: () => void;
  onMoveToTask: (task: ActiveTask) => void;
  onMoveToNote: (note: ActiveNote) => void;
}

function MoveToActiveControl({
  entry: _entry,
  activeTask,
  activeNote,
  busy,
  dropdownOpen,
  onOpenDropdown,
  onCloseDropdown,
  onMoveToTask,
  onMoveToNote,
}: MoveToActiveControlProps) {
  // Case 1: neither active. Disabled with the legacy tooltip copy.
  if (!activeTask && !activeNote) {
    return (
      <button
        type="button"
        disabled
        title="Open an experiment or a note first"
        className="ros-btn-raise px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Move to active
      </button>
    );
  }

  // Case 2: task only.
  if (activeTask && !activeNote) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => onMoveToTask(activeTask)}
        title={`Move to Experiment ${activeTask.id} (${activeTask.name})`}
        className="ros-btn-raise px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Move to active
      </button>
    );
  }

  // Case 3: note only.
  if (!activeTask && activeNote) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => onMoveToNote(activeNote)}
        title={`Move to note "${activeNote.title}"`}
        className="ros-btn-raise px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Move to active note
      </button>
    );
  }

  // Case 4: both active → dropdown with two labeled options. The caret
  // button toggles the dropdown; the dropdown itself sits absolutely
  // positioned just below the trigger. Outside-click dismissal is
  // handled by the parent (see effect on `dropdownOpen` in PhotosInboxTab).
  return (
    <div className="relative">
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          if (dropdownOpen) onCloseDropdown();
          else onOpenDropdown();
        }}
        aria-haspopup="menu"
        aria-expanded={dropdownOpen}
        title="Move to active…"
        className="ros-btn-raise px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
      >
        <span>Move to active</span>
        <span aria-hidden className="text-meta leading-none">▾</span>
      </button>
      {dropdownOpen && activeTask && activeNote && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-[116] min-w-[220px] rounded-md border border-border bg-surface-raised shadow-lg py-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => onMoveToTask(activeTask)}
            className="w-full text-left px-3 py-1.5 text-meta text-foreground hover:bg-blue-50 dark:hover:bg-brand-action/10"
          >
            <span className="block text-meta uppercase tracking-wide text-foreground-muted">
              Experiment
            </span>
            <span className="block truncate">{activeTask.name}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onMoveToNote(activeNote)}
            className="w-full text-left px-3 py-1.5 text-meta text-foreground hover:bg-blue-50 dark:hover:bg-brand-action/10"
          >
            <span className="block text-meta uppercase tracking-wide text-foreground-muted">
              Note
            </span>
            <span className="block truncate">{activeNote.title}</span>
          </button>
        </div>
      )}
    </div>
  );
}
