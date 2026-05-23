"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Note, NoteEntry } from "@/lib/types";
import { ownerScopedNotesApi } from "@/lib/notes/owner-scoped-api";
import LiveMarkdownEditor from "./LiveMarkdownEditor";
import NoteCommentsThread from "./NoteCommentsThread";
import Tooltip from "./Tooltip";
import { useFileRenamePopup } from "./FileRenamePopup";
import { useDuplicateResolver } from "./DuplicateUploadDialog";
import { fileService } from "@/lib/file-system/file-service";
import { attachImageToTask } from "@/lib/attachments/attach-image";
import { fileEvents } from "@/lib/attachments/file-events";
import { checkForDuplicates } from "@/lib/attachments/duplicate-check";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useLabHeadEditGate } from "@/hooks/useLabHeadEditGate";
import RequestEditButton from "./RequestEditButton";
import EditSessionBanner from "./EditSessionBanner";
import AuditTrailNotice from "./AuditTrailNotice";
import FlagForReviewButton from "./lab-head/FlagForReviewButton";
import FlagBanner from "./lab-head/FlagBanner";

interface NoteDetailPopupProps {
  note: Note;
  onClose: () => void;
  onUpdate: (note: Note) => void;
  onDelete: (noteId: number) => void;
  readOnly?: boolean;
}

// Debounce helper with cancel capability
function useDebouncedCallback<T extends (...args: string[]) => void>(
  callback: T,
  delay: number
): { debounced: T; cancel: () => void; flush: () => void } {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const argsRef = useRef<Parameters<T> | null>(null);
  
  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      argsRef.current = null;
    }
  }, []);
  
  const flush = useCallback(() => {
    if (timeoutRef.current && argsRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      callback(...argsRef.current);
      argsRef.current = null;
    }
  }, [callback]);
  
  const debounced = useCallback(
    (...args: Parameters<T>) => {
      argsRef.current = args;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
        argsRef.current = null;
      }, delay);
    },
    [callback, delay]
  ) as T;
  
  return { debounced, cancel, flush };
}

export default function NoteDetailPopup({
  note,
  onClose,
  onUpdate,
  onDelete,
  readOnly: propReadOnly = false,
}: NoteDetailPopupProps) {
  // Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): wrap the
  // prop-passed readOnly flag with the PI edit-mode gate. When the active
  // user is a lab head and has unlocked a session for this note, the
  // effective readOnly flips false so inputs become editable + saves
  // emit audit entries.
  //
  // Lab Head Phase 5 R1 (lab head Phase 5 R1 manager, 2026-05-23): writes
  // now route to the NOTE-OWNER's folder via `ownerScopedNotesApi`, not
  // the PI's. Closes the silent-data-corruption gap Phase 5 deferred.
  // When the session is NOT unlocked (or any session arg is missing) the
  // wrapper falls through to the raw notesApi — current-user behavior is
  // unchanged for members and PIs editing their own data.
  const labHeadGate = useLabHeadEditGate({
    readOnly: propReadOnly,
    recordOwner: note.username ?? null,
  });
  const readOnly = labHeadGate.effectiveReadOnly;
  const notesApi = useMemo(
    () =>
      ownerScopedNotesApi({
        targetOwner: labHeadGate.unlocked ? note.username : undefined,
        actor: labHeadGate.unlocked ? labHeadGate.activeUser : undefined,
        sessionId: labHeadGate.unlocked ? labHeadGate.sessionId : undefined,
      }),
    [
      labHeadGate.unlocked,
      labHeadGate.activeUser,
      labHeadGate.sessionId,
      note.username,
    ],
  );
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [description, setDescription] = useState(note.description);
  const [entries, setEntries] = useState<NoteEntry[]>(note.entries);
  const [isShared, setIsShared] = useState(note.is_shared);
  const [saving, setSaving] = useState(false);
  const [showNewEntryForm, setShowNewEntryForm] = useState(false);
  const [newEntryTitle, setNewEntryTitle] = useState("");
  const [newEntryDate, setNewEntryDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingEntryTitle, setEditingEntryTitle] = useState(false);
  const [editingEntryDate, setEditingEntryDate] = useState(false);
  const [entryTitle, setEntryTitle] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { requestRename, PopupComponent: FileRenamePopup } = useFileRenamePopup();
  const { resolve: resolveDuplicates, DialogComponent: DuplicateDialog } =
    useDuplicateResolver();
  const { currentUser } = useCurrentUser();

  // Per-note attachment folder. Mirrors how tasks use
  // `users/{owner}/results/task-{id}/`. Falls back to the note's own
  // `username` when there's no signed-in user (read-only / lab-mode views),
  // so the path is still defined even if no upload can happen.
  const basePath = `users/${currentUser ?? note.username}/notes/${note.id}`;

  // Track unsaved content for auto-save
  const unsavedContentRef = useRef<Map<string, string>>(new Map());
  const isSavingRef = useRef(false);
  const isClosingRef = useRef(false);

  // Warn before navigating away when there is a pending debounced save.
  // We read the ref directly inside the handler so we always get the latest
  // value without needing a separate piece of state that would require
  // re-renders to stay current. flushRef is wired to the debounced flush
  // function after it is declared below.
  const flushRef = useRef<() => void>(() => {});

  // Set initial active tab
  useEffect(() => {
    if (note.entries.length > 0 && !activeTab) {
      if (note.is_running_log) {
        // Sort entries by date descending and select the most recent
        const sorted = [...note.entries].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        setActiveTab(sorted[0].id);
      } else {
        // Single note - set the first (and only) entry as active
        setActiveTab(note.entries[0].id);
      }
    }
  }, [note.is_running_log, note.entries, activeTab]);

  // Get the current entry being edited
  const currentEntry = entries.find((e) => e.id === activeTab);

  // Debounced save function
  const saveEntryContent = useCallback(
    async (entryId: string, content: string) => {
      if (isSavingRef.current) return;

      isSavingRef.current = true;
      setSaving(true);

      try {
        const updated = await notesApi.updateEntry(note.id, entryId, { content });
        if (!updated) return;
        // Only update state if we're not closing
        if (!isClosingRef.current) {
          setEntries(updated.entries);
        }
        unsavedContentRef.current.delete(entryId);
        if (updated) onUpdate(updated);
      } catch (error) {
        console.error("Failed to save entry content:", error);
      } finally {
        setSaving(false);
        isSavingRef.current = false;
      }
    },
    [note.id, onUpdate, notesApi]
  );

  // Debounced save (1.5 seconds after user stops typing)
  const { debounced: debouncedSave, cancel: cancelDebouncedSave, flush: flushDebouncedSave } = useDebouncedCallback(
    (entryId: string, content: string) => {
      saveEntryContent(entryId, content);
    },
    1500
  );
  // Keep the beforeunload flush ref pointing at the latest flush function.
  flushRef.current = flushDebouncedSave;

  // Warn before navigating away when there is a pending debounced save.
  // Reads the ref directly inside the handler so we always see the latest
  // state without needing a re-render to propagate the boolean.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (unsavedContentRef.current.size === 0) return;
      flushRef.current();
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Handle close with save - saves any pending changes before closing
  const handleClose = useCallback(async () => {
    // Mark that we're closing to prevent state updates after save
    isClosingRef.current = true;

    // Cancel any pending debounced saves
    cancelDebouncedSave();

    // Save any unsaved content immediately
    if (unsavedContentRef.current.size > 0) {
      setSaving(true);
      try {
        // Save all unsaved entries in parallel
        const savePromises = Array.from(unsavedContentRef.current.entries()).map(
          ([entryId, content]) => notesApi.updateEntry(note.id, entryId, { content })
        );
        await Promise.all(savePromises);
        unsavedContentRef.current.clear();
      } catch (error) {
        console.error("Failed to save pending changes:", error);
      } finally {
        setSaving(false);
      }
    }

    onClose();
  }, [note.id, onClose, cancelDebouncedSave, notesApi]);

  // Handle escape key to close or exit fullscreen
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isExpanded) {
          setIsExpanded(false);
        } else {
          handleClose();
        }
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isExpanded, handleClose]);

  // Save title
  const saveTitle = async () => {
    if (title === note.title) {
      setEditingTitle(false);
      return;
    }
    setSaving(true);
    try {
      // Phase 5 R1: notesApi is owner-scoped — write goes to the note
      // owner's folder + audit entries emitted automatically when a PI
      // edit session is unlocked.
      const updated = await notesApi.update(note.id, { title });
      if (updated) onUpdate(updated);
      setEditingTitle(false);
    } catch (error) {
      console.error("Failed to save title:", error);
      setTitle(note.title);
    } finally {
      setSaving(false);
    }
  };

  // Save description
  const saveDescription = async () => {
    if (description === note.description) {
      setEditingDescription(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await notesApi.update(note.id, { description });
      if (updated) onUpdate(updated);
      setEditingDescription(false);
    } catch (error) {
      console.error("Failed to save description:", error);
      setDescription(note.description);
    } finally {
      setSaving(false);
    }
  };

  // Toggle sharing
  const toggleSharing = async () => {
    setSaving(true);
    try {
      const updated = await notesApi.update(note.id, { is_shared: !isShared });
      if (updated) {
        setIsShared(updated.is_shared);
        onUpdate(updated);
      }
    } catch (error) {
      console.error("Failed to toggle sharing:", error);
    } finally {
      setSaving(false);
    }
  };

  // Update entry content - immediate local update, debounced API save
  const updateEntryContent = useCallback(
    (content: string) => {
      if (!activeTab) return;

      // Immediate local update for responsive UI
      setEntries((prev) =>
        prev.map((e) =>
          e.id === activeTab ? { ...e, content, updated_at: new Date().toISOString() } : e
        )
      );

      // Track unsaved content
      unsavedContentRef.current.set(activeTab, content);

      // Trigger debounced save
      debouncedSave(activeTab, content);
    },
    [activeTab, debouncedSave]
  );

  const handleImageUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);

      // Per-file rename popup first (existing UX). The renamed file is what
      // we then duplicate-check against the destination — checking pre-rename
      // would let the user rename INTO a colliding name without warning.
      const renamedFiles: File[] = [];
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const renamedFile = await requestRename(file);
        if (!renamedFile) continue;
        renamedFiles.push(renamedFile);
      }

      // Partition into "safe to write" and "needs user decision".
      const imagesDir = `${basePath}/Images`;
      const existing = new Set(await fileService.listFiles(imagesDir));
      const { uniqueFiles, collisions } = checkForDuplicates(
        renamedFiles,
        existing,
      );

      // Drop writes the file to Images/ and emits the attached event so
      // the bottom ImageStrip refreshes; placing the markdown ref inline
      // is the user's explicit drag from the strip into the editor body.
      // Because we do NOT call updateEntryContent here, the debounced
      // autosave does not fire from a drop alone — so the GC sweep won't
      // touch the new file until the user types or drags it in.
      for (const file of uniqueFiles) {
        try {
          await attachImageToTask({
            ownerUsername: currentUser ?? note.username,
            taskId: note.id,
            basePath,
            blob: file,
            suggestedFilename: file.name,
          });
        } catch {
          alert(`Failed to upload ${file.name}`);
        }
      }

      // Walk the collision queue.
      if (collisions.length > 0) {
        const resolutions = await resolveDuplicates(collisions);
        for (const info of collisions) {
          const choice = resolutions.get(info.existingName);
          if (!choice || choice.action === "cancel") continue;
          const finalName =
            choice.action === "rename"
              ? (choice.newName ?? info.suggestedName)
              : info.existingName; // replace = overwrite existing
          try {
            // For "replace" we delete the existing image first so the
            // sidecar / blob-url cache for the old bytes is cleared.
            if (choice.action === "replace") {
              await fileService.deleteFile(`${imagesDir}/${info.existingName}`);
            }
            const renamed = new File([info.file], finalName, {
              type: info.file.type,
            });
            await attachImageToTask({
              ownerUsername: currentUser ?? note.username,
              taskId: note.id,
              basePath,
              blob: renamed,
              suggestedFilename: finalName,
            });
          } catch {
            alert(`Failed to upload ${finalName}`);
          }
        }
      }

      setUploading(false);
    },
    [basePath, requestRename, resolveDuplicates, currentUser, note.id, note.username]
  );

  const handleFileUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      const filesDir = `${basePath}/Files`;

      // Per-file rename popup first, then batch duplicate-check.
      const renamedFiles: File[] = [];
      for (const file of files) {
        const renamedFile = await requestRename(file);
        if (!renamedFile) continue;
        renamedFiles.push(renamedFile);
      }

      const existing = new Set(await fileService.listFiles(filesDir));
      const { uniqueFiles, collisions } = checkForDuplicates(
        renamedFiles,
        existing,
      );

      // Drop writes to Files/ and emits the attached event so the bottom
      // FileStrip refreshes. We do NOT splice a markdown link into the
      // body here — placing the link inline is the user's explicit drag
      // from the strip.
      const writeOne = async (file: File, finalName: string) => {
        const destPath = `${filesDir}/${finalName}`;
        await fileService.writeFileFromBlob(destPath, file);
        fileEvents.emitAttached({ basePath, relativePath: `Files/${finalName}` });
      };

      for (const file of uniqueFiles) {
        try {
          await writeOne(file, file.name);
        } catch {
          alert(`Failed to upload ${file.name}`);
        }
      }

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
            await writeOne(info.file, finalName);
          } catch {
            alert(`Failed to upload ${finalName}`);
          }
        }
      }

      setUploading(false);
    },
    [basePath, requestRename, resolveDuplicates]
  );

  // Add new entry
  const addNewEntry = async () => {
    if (!newEntryTitle.trim()) return;

    setSaving(true);
    try {
      const updated = await notesApi.addEntry(note.id, {
        title: newEntryTitle,
        date: newEntryDate,
        content: "",
      });
      if (!updated) return;
      setEntries(updated.entries);
      setActiveTab(updated.entries[updated.entries.length - 1].id);
      setShowNewEntryForm(false);
      setNewEntryTitle("");
      setNewEntryDate(new Date().toISOString().split("T")[0]);
      onUpdate(updated);
    } catch (error) {
      console.error("Failed to add entry:", error);
    } finally {
      setSaving(false);
    }
  };

  // Delete entry
  const deleteEntry = async (entryId: string) => {
    if (!confirm("Are you sure you want to delete this entry?")) return;

    setSaving(true);
    try {
      const updated = await notesApi.deleteEntry(note.id, entryId);
      if (!updated) return;
      setEntries(updated.entries);
      // Select another tab if the deleted one was active
      if (activeTab === entryId && updated.entries.length > 0) {
        setActiveTab(updated.entries[0].id);
      }
      onUpdate(updated);
    } catch (error) {
      console.error("Failed to delete entry:", error);
    } finally {
      setSaving(false);
    }
  };

  // Save entry title
  const saveEntryTitle = async () => {
    if (!currentEntry || entryTitle.trim() === currentEntry.title) {
      setEditingEntryTitle(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await notesApi.updateEntry(note.id, currentEntry.id, { title: entryTitle.trim() });
      if (updated) {
        setEntries(updated.entries);
        onUpdate(updated);
      }
      setEditingEntryTitle(false);
    } catch (error) {
      console.error("Failed to save entry title:", error);
      setEntryTitle(currentEntry.title);
    } finally {
      setSaving(false);
    }
  };

  // Save entry date
  const saveEntryDate = async () => {
    if (!currentEntry || entryDate === currentEntry.date) {
      setEditingEntryDate(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await notesApi.updateEntry(note.id, currentEntry.id, { date: entryDate });
      if (updated) {
        setEntries(updated.entries);
        onUpdate(updated);
      }
      setEditingEntryDate(false);
    } catch (error) {
      console.error("Failed to save entry date:", error);
      setEntryDate(currentEntry.date);
    } finally {
      setSaving(false);
    }
  };

  // Start editing entry title
  const startEditingEntryTitle = () => {
    if (currentEntry && !readOnly) {
      setEntryTitle(currentEntry.title);
      setEditingEntryTitle(true);
    }
  };

  // Start editing entry date
  const startEditingEntryDate = () => {
    if (currentEntry && !readOnly) {
      setEntryDate(currentEntry.date);
      setEditingEntryDate(true);
    }
  };

  // Delete note
  const handleDeleteNote = async () => {
    if (!confirm("Are you sure you want to delete this entire note?")) return;

    try {
      await notesApi.delete(note.id);
      onDelete(note.id);
      onClose();
    } catch (error) {
      console.error("Failed to delete note:", error);
    }
  };

  // Format date for display
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <>
    <FileRenamePopup />
    <DuplicateDialog />
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full flex flex-col overflow-hidden transition-all duration-300 ${
          isExpanded
            ? "inset-4 max-w-none max-h-none h-[calc(100vh-2rem)]"
            : "max-w-4xl max-h-[90vh]"
        }`}
        // LiveMarkdownEditor draws its file-drag ring on this card so the
        // ring isn't clipped by the editor's overflow parents.
        data-drag-ring-target=""
        onClick={(e) => e.stopPropagation()}
      >
        {/* Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23):
            unlocked-session timer banner. Renders only while the PI's
            session is unlocked AND it's THIS user's session. */}
        {labHeadGate.unlocked && labHeadGate.activeUser && (
          <EditSessionBanner
            contextLabel={`${note.username ?? "lab member"}'s note: ${title}`}
            scopedToUsername={labHeadGate.activeUser}
          />
        )}
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 mr-4">
              {/* Title */}
              {editingTitle ? (
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => e.key === "Enter" && saveTitle()}
                  className="text-xl font-bold text-gray-900 w-full border-b-2 border-emerald-500 focus:outline-none bg-transparent"
                  autoFocus
                  disabled={readOnly}
                />
              ) : (
                <h2
                  onClick={() => !readOnly && setEditingTitle(true)}
                  className={`text-xl font-bold text-gray-900 ${
                    !readOnly ? "cursor-pointer hover:text-emerald-600" : ""
                  }`}
                >
                  {title}
                </h2>
              )}

              {/* Description */}
              {editingDescription ? (
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={saveDescription}
                  onKeyDown={(e) => e.key === "Enter" && saveDescription()}
                  placeholder="Add a description..."
                  className="text-sm text-gray-500 w-full border-b-2 border-emerald-500 focus:outline-none bg-transparent mt-1"
                  autoFocus
                  disabled={readOnly}
                />
              ) : (
                <p
                  onClick={() => !readOnly && setEditingDescription(true)}
                  className={`text-sm text-gray-500 mt-1 ${
                    !readOnly ? "cursor-pointer hover:text-emerald-600" : ""
                  }`}
                >
                  {description || (!readOnly ? "Add a description..." : "")}
                </p>
              )}
              {/* Lab Head Phase 5 — record-level "Edited by PI" notice. */}
              {propReadOnly && note.username && (
                <AuditTrailNotice
                  targetUser={note.username}
                  recordType="note"
                  recordId={note.id}
                />
              )}
            </div>

            {/* Fullscreen and Close buttons */}
            <div className="flex items-center gap-1">
              {/* Lab Head Phase 5 — Request edit button. Visible only when
                  PI is viewing another member's note + no session active. */}
              {labHeadGate.canRequestEdit && !labHeadGate.unlocked && labHeadGate.activeUser && (
                <RequestEditButton
                  username={labHeadGate.activeUser}
                  targetLabel={`${note.username ?? "member"}'s note: ${title}`}
                />
              )}
              {/* Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23):
                  Flag-for-review button. Shows while the PI session is
                  unlocked for this note. Notes have no "assign" surface
                  in v1 — that's a Task-only concept. */}
              {labHeadGate.canRequestEdit && labHeadGate.unlocked && labHeadGate.activeUser && labHeadGate.sessionId && note.username && (
                <FlagForReviewButton
                  recordType="note"
                  recordId={note.id}
                  recordName={title}
                  targetOwner={note.username}
                  actor={labHeadGate.activeUser}
                  sessionId={labHeadGate.sessionId}
                  currentFlag={note.flagged ?? null}
                />
              )}
              <Tooltip label={isExpanded ? "Exit fullscreen" : "Fullscreen"} placement="bottom">
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  {isExpanded ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                  )}
                </button>
              </Tooltip>
              <Tooltip label="Close" placement="bottom">
                <button
                  onClick={handleClose}
                  data-tour-target="lab-mode-note-popup-close"
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23):
              flag banner. Shown to everyone who can view this note;
              owner sees a Clear-flag affordance. */}
          {note.flagged && note.username && (
            <div className="mt-3">
              <FlagBanner
                flag={note.flagged}
                recordType="note"
                recordId={note.id}
                owner={note.username}
                activeUser={currentUser}
              />
            </div>
          )}

          {/* Sharing toggle */}
          {!readOnly && (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={toggleSharing}
                disabled={saving}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isShared
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {isShared ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  )}
                </svg>
                {isShared ? "Shared with lab" : "Private"}
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                {uploading ? "Uploading..." : "Add File"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFileUpload(Array.from(e.target.files));
                  e.target.value = "";
                }}
              />

              {/* Auto-save indicator */}
              {saving && (
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Saving...
                </span>
              )}
            </div>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Tabs for running logs */}
          {note.is_running_log && (
            <div className="border-b border-gray-200 px-4 py-2 flex-shrink-0">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {entries
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => setActiveTab(entry.id)}
                      className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                        activeTab === entry.id
                          ? "bg-emerald-100 text-emerald-700 font-medium"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {entry.title}
                    </button>
                  ))}

                {/* Add entry button */}
                {!readOnly && (
                  <button
                    onClick={() => setShowNewEntryForm(true)}
                    className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Entry
                  </button>
                )}
              </div>
            </div>
          )}

          {/* New entry form */}
          {showNewEntryForm && (
            <div className="border-b border-gray-200 px-4 py-3 bg-gray-50 flex-shrink-0">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={newEntryTitle}
                  onChange={(e) => setNewEntryTitle(e.target.value)}
                  placeholder="Entry title..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-emerald-500"
                  autoFocus
                />
                <input
                  type="date"
                  value={newEntryDate}
                  onChange={(e) => setNewEntryDate(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={addNewEntry}
                  disabled={!newEntryTitle.trim() || saving}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Add
                </button>
                <button
                  onClick={() => setShowNewEntryForm(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Entry info bar */}
          {note.is_running_log && currentEntry && (
            <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 flex-shrink-0">
              <div className="flex items-center gap-3">
                {/* Entry title - editable */}
                {editingEntryTitle ? (
                  <input
                    type="text"
                    value={entryTitle}
                    onChange={(e) => setEntryTitle(e.target.value)}
                    onBlur={saveEntryTitle}
                    onKeyDown={(e) => e.key === "Enter" && saveEntryTitle()}
                    className="text-sm font-medium text-gray-700 border-b-2 border-emerald-500 focus:outline-none bg-transparent"
                    autoFocus
                    disabled={readOnly}
                  />
                ) : (
                  <span
                    onClick={startEditingEntryTitle}
                    className={`text-sm font-medium text-gray-700 ${
                      !readOnly ? "cursor-pointer hover:text-emerald-600" : ""
                    }`}
                    title={!readOnly ? "Click to edit title" : ""}
                  >
                    {currentEntry.title}
                  </span>
                )}
                <span className="text-gray-300">|</span>
                {/* Entry date - editable */}
                {editingEntryDate ? (
                  <input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    onBlur={saveEntryDate}
                    onKeyDown={(e) => e.key === "Enter" && saveEntryDate()}
                    className="text-sm text-gray-500 border-b-2 border-emerald-500 focus:outline-none bg-transparent"
                    autoFocus
                    disabled={readOnly}
                  />
                ) : (
                  <span
                    onClick={startEditingEntryDate}
                    className={`text-sm text-gray-500 ${
                      !readOnly ? "cursor-pointer hover:text-emerald-600" : ""
                    }`}
                    title={!readOnly ? "Click to edit date" : ""}
                  >
                    {formatDate(currentEntry.date)}
                  </span>
                )}
                <span className="text-xs text-gray-400">
                  Updated: {formatDate(currentEntry.updated_at)}
                </span>
              </div>
              {!readOnly && entries.length > 1 && (
                <button
                  onClick={() => deleteEntry(currentEntry.id)}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors"
                >
                  Delete Entry
                </button>
              )}
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 overflow-y-auto">
            {note.is_running_log ? (
              currentEntry ? (
                <LiveMarkdownEditor
                  value={currentEntry.content}
                  onChange={updateEntryContent}
                  placeholder="Write your meeting notes in Markdown..."
                  disabled={readOnly}
                  allowAnyFileType={true}
                  onImageDrop={handleImageUpload}
                  onFileDrop={handleFileUpload}
                  imageBasePath={basePath}
                  recordType="note"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <p>No entries yet. Click &quot;Add Entry&quot; to get started.</p>
                </div>
              )
            ) : (
              // Single note - use the first (and only) entry
              entries[0] && (
                <LiveMarkdownEditor
                  value={entries[0].content}
                  onChange={(content) => {
                    if (entries[0]) {
                      updateEntryContent(content);
                    }
                  }}
                  placeholder="Write your meeting notes in Markdown..."
                  disabled={readOnly}
                  allowAnyFileType={true}
                  onImageDrop={handleImageUpload}
                  onFileDrop={handleFileUpload}
                  imageBasePath={basePath}
                  recordType="note"
                />
              )
            )}
          </div>
        </div>

        {/* Comments thread (#13): visible in both lab mode (readOnly=true)
            and regular mode so the note's owner can see PI feedback. The
            thread itself is the gate for whether commenting is enabled. */}
        <NoteCommentsThread note={note} />

        {/* Footer */}
        {!readOnly && (
          <div className="p-4 border-t border-gray-200 flex items-center justify-between flex-shrink-0">
            <div className="text-xs text-gray-400">
              Created: {formatDate(note.created_at)} • Updated: {formatDate(note.updated_at)}
            </div>
            <button
              onClick={handleDeleteNote}
              className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              Delete Note
            </button>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
