"use client";

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
import { useAppStore, type ActiveTask } from "@/lib/store";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import ImageMetadataPopup from "./ImageMetadataPopup";
import SendToTaskPicker from "./SendToTaskPicker";
import { useDuplicateResolver } from "./DuplicateUploadDialog";

interface InboxPanelProps {
  onClose: () => void;
}

interface InboxEntry extends FolderImageEntry {
  blobUrl?: string;
}

function inboxBase(username: string): string {
  return `users/${username}/inbox`;
}

// "Lab Notes" attachments live in the per-tab `notes/` scope. The image
// router on the receive side and the universal-drop handler on the popup
// also target this scope, so dragging into the popup vs filing from here
// land in the same folder.
function taskNotesBase(taskResultsBase: string): string {
  return `${taskResultsBase}/notes`;
}

export default function InboxPanel({ onClose }: InboxPanelProps) {
  const { currentUser } = useCurrentUser();
  const activeTask = useAppStore((s) => s.activeTask);
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
    async (task: Pick<ActiveTask, "id" | "owner" | "name">) => {
      if (!currentUser) return;
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;

      setBatchBusy(true);
      try {
        const taskBase = await resolveTaskResultsBase(
          { id: task.id, owner: task.owner },
          currentUser
        );
        const destBase = taskNotesBase(taskBase);
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
          setToast(`Sent ${succeeded} ${noun} to ${task.name}.`);
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

  // The context-menu / button label includes the count when >1 selected.
  const selectedCount = selectedIds.size;
  const sendMenuLabel = useMemo(() => {
    if (selectedCount <= 1) return "Send to task…";
    return `Send ${selectedCount} items to task…`;
  }, [selectedCount]);

  return (
    <>
    {/* DuplicateDialog uses higher z-index (200) than the inbox backdrop
        (105), so clicks land on it correctly even though it's a sibling.
        Mounted outside the backdrop so the backdrop's onClick={onClose}
        doesn't fire when the user interacts with the dialog. */}
    <DuplicateDialog />
    <div
      className="fixed inset-0 z-[105] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Inbox</h3>
            <p className="text-xs text-gray-500">
              Photos sent via Telegram while no experiment was open. Shift-click
              or Cmd/Ctrl-click to select multiple, then right-click to file as
              a batch.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4" onClick={handleBodyClick}>
          {loading ? (
            <p className="text-sm text-gray-500 text-center py-8">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-400 italic text-center py-8">
              Inbox is empty. Photos sent via Telegram while no experiment is open will
              appear here.
            </p>
          ) : (
            <ul className="space-y-2">
              {entries.map((entry) => {
                const caption = entry.sidecar?.caption;
                const isSelected = selectedIds.has(entry.name);
                return (
                  <li
                    key={entry.name}
                    className={`group flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${
                      isSelected
                        ? "border-blue-400 bg-blue-50 ring-2 ring-blue-200"
                        : "border-gray-100 hover:border-blue-200 hover:bg-blue-50/30"
                    }`}
                    onClick={(e) => handleRowClick(e, entry)}
                    onContextMenu={(e) => handleRowContextMenu(e, entry)}
                  >
                    {entry.blobUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={entry.blobUrl}
                        alt={entry.name}
                        className="w-16 h-16 rounded object-cover bg-gray-100 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded bg-gray-100 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate" title={entry.name}>
                        {caption ?? <span className="italic text-gray-400">No caption</span>}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{entry.name}</p>
                      {entry.sidecar?.receivedAt && (
                        <p className="text-xs text-gray-400">
                          {new Date(entry.sidecar.receivedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={!activeTask || busy === entry.name || batchBusy}
                        onClick={() => activeTask && moveToActive(entry, activeTask)}
                        title={
                          activeTask
                            ? `Move to Experiment ${activeTask.id} (${activeTask.name})`
                            : "Open an experiment first"
                        }
                        className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Move to active
                      </button>
                      <button
                        type="button"
                        aria-label="More actions"
                        disabled={batchBusy}
                        onClick={(e) => {
                          e.preventDefault();
                          // Treat the "…" button like a right-click on this
                          // row: select-if-not-selected, then open the menu
                          // at the button's anchor point.
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
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-all"
                        data-force-hover-controls-target
                      >
                        ⋯
                      </button>
                      <button
                        type="button"
                        disabled={busy === entry.name || batchBusy}
                        onClick={() => deleteInbox(entry)}
                        className="px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {contextMenu && (
        <div
          className="fixed z-[115] min-w-[180px] rounded-md border border-gray-200 bg-white shadow-lg py-1"
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
            className="w-full text-left px-3 py-1.5 text-sm text-gray-800 hover:bg-blue-50"
          >
            {sendMenuLabel}
          </button>
          <button
            type="button"
            disabled={!activeTask}
            onClick={() => {
              if (!activeTask) return;
              setContextMenu(null);
              void moveToActive(contextMenu.anchorEntry, activeTask);
            }}
            className="w-full text-left px-3 py-1.5 text-sm text-gray-800 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {activeTask ? `Move to active (${activeTask.name})` : "Move to active"}
          </button>
          <div className="h-px bg-gray-100 my-1" />
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              void deleteInbox(contextMenu.anchorEntry);
            }}
            className="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
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
          onPick={(task) => {
            void sendSelectedToTask(task);
          }}
        />
      )}

      {toast && (
        <div
          className="fixed z-[120] right-6 bottom-6 max-w-sm rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-lg pointer-events-none"
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
    </div>
    </>
  );
}
