"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Note, NoteEntry, NoteRestorePayload } from "@/lib/types";
import { ownerScopedNotesApi } from "@/lib/notes/owner-scoped-api";
import { emitNoteDeleted } from "@/lib/notes/delete-toast-bus";
import { canDeleteNoteFromPopup } from "@/lib/notes/delete-permission";
import { canRestoreNoteVersion } from "@/lib/notes/restore-permission";
import { canEditNotebookNote } from "@/lib/notes/notebook-edit-permission";
import { RESTORE_ENABLED, canonicalize } from "@/lib/history";
import {
  useVersionRestore,
  type VersionRestoreApi,
} from "@/lib/history/useVersionRestore";
import { useAppStore } from "@/lib/store";
import { LORO_PILOT_ENABLED } from "@/lib/loro/config";
import { openNote, type NoteHandle } from "@/lib/loro/store";
import { persistEntryContent } from "@/lib/notes/persist-entry-content";
import LiveMarkdownEditor from "./LiveMarkdownEditor";
import NoteCommentsThread from "./NoteCommentsThread";
import ReceivedFromBadge from "./ReceivedFromBadge";
import Tooltip from "./Tooltip";
import { useFileRenamePopup } from "./FileRenamePopup";
import { useDuplicateResolver } from "./DuplicateUploadDialog";
import { fileService } from "@/lib/file-system/file-service";
import { attachImageToTask } from "@/lib/attachments/attach-image";
import { fileEvents } from "@/lib/attachments/file-events";
import { checkForDuplicates } from "@/lib/attachments/duplicate-check";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useLabHeadEditGate } from "@/hooks/useLabHeadEditGate";
import RequestEditButton from "./RequestEditButton";
import EditSessionBanner from "./EditSessionBanner";
import AuditTrailNotice from "./AuditTrailNotice";
import FlagForReviewButton from "./lab-head/FlagForReviewButton";
import FlagBanner from "./lab-head/FlagBanner";
import SharingChips from "@/components/sharing/SharingChips";
import UnifiedShareDialog from "@/components/sharing/UnifiedShareDialog";
import { StampsRow } from "@/components/AttributionChip";
import NoteVersionHistorySidebar, {
  type VersionPreview,
} from "@/components/history/NoteVersionHistorySidebar";
import VersionDiffView from "@/components/history/VersionDiffView";

interface NoteDetailPopupProps {
  note: Note;
  onClose: () => void;
  onUpdate: (note: Note) => void;
  onDelete: (noteId: number) => void;
  readOnly?: boolean;
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
  // Version-history viewer (VCP Phase 1, version-history viewer bot for HR,
  // 2026-05-29). Opening the right-sidebar version list puts the document
  // column into a READ-ONLY preview: `historyOpen` forces the editor read-only
  // alongside the existing lab-head gate, and `versionPreview` carries the
  // selected version's {before, after} diff into the document column. Closing
  // the sidebar ("Exit history") clears both and returns to the live record.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versionPreview, setVersionPreview] = useState<VersionPreview | null>(
    null,
  );
  // The history entry button, so closing the sidebar (Esc / Exit history)
  // returns focus to the trigger per the accessibility contract.
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    setVersionPreview(null);
    historyTriggerRef.current?.focus();
  }, []);
  // Shared 1:1 notebooks (notebook-note-edit sub-bot of HR, 2026-06-02):
  // carve a NOTEBOOK note out of the lab-head edit-session read-only gate.
  // A note carrying a `notebook_id` is always shared with BOTH members at
  // level "edit" (via `pairingSharedWith`), so either member edits any note
  // in the notebook freely. The explicit pair-shared-at-edit grant IS the
  // authorization; it does NOT ride the PI passcode unlock. The predicate
  // returns false for any non-notebook note, so ordinary shared notes keep
  // the existing PI-unlock posture (the carve-out cannot leak). We use
  // `labHeadGate.activeUser` as the viewer here (it equals `currentUser`)
  // because `useCurrentUser` is destructured further down; reading it via the
  // gate avoids reordering hooks.
  const notebookEditAllowed = canEditNotebookNote({
    notebookId: note.notebook_id,
    noteOwner: note.username,
    currentUser: labHeadGate.activeUser,
    sharedWith: note.shared_with,
  });
  // The other member's notebook note is owned by them; route the peer write
  // to the owner's folder so it lands where they read it. An OWN notebook note
  // (owner === viewer) needs no routing: leave it on the current-user path.
  const notebookPeerOwner =
    notebookEditAllowed &&
    !!note.username &&
    note.username !== labHeadGate.activeUser
      ? note.username
      : undefined;
  const readOnly =
    (labHeadGate.effectiveReadOnly && !notebookEditAllowed) || historyOpen;
  const notesApi = useMemo(
    () =>
      ownerScopedNotesApi({
        targetOwner: labHeadGate.unlocked ? note.username : undefined,
        actor: labHeadGate.unlocked ? labHeadGate.activeUser : undefined,
        sessionId: labHeadGate.unlocked ? labHeadGate.sessionId : undefined,
        notebookPeerOwner,
      }),
    [
      labHeadGate.unlocked,
      labHeadGate.activeUser,
      labHeadGate.sessionId,
      note.username,
      notebookPeerOwner,
    ],
  );
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [description, setDescription] = useState(note.description);
  const [entries, setEntries] = useState<NoteEntry[]>(note.entries);
  const [saving, setSaving] = useState(false);
  // Unified Share entry point (2026-06-04): one Share button opens the two-tab
  // UnifiedShareDialog. The "In your lab" tab is the full per-person ACL
  // (shareNote, read / edit, whole-lab), which REPLACES the old coarse
  // is_shared Private / Shared toggle for notes. The "Outside your lab" tab is
  // the cross-boundary encrypted-copy send that used to be a separate button.
  const [showShare, setShowShare] = useState(false);
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

  // Loro pilot: one handle per note (keyed on note.id + owner). Opened once;
  // closed on note identity change or unmount. Null when flag is off or while
  // the async open is in flight.
  const [loroHandle, setLoroHandle] = useState<NoteHandle | null>(null);
  // True when the async Loro open failed for this note. Lets the editor fall
  // back to the normal (non-Loro) surface instead of blocking on a loader.
  const [loroOpenFailed, setLoroOpenFailed] = useState(false);

  // Per-note attachment folder. Mirrors how tasks use
  // `users/{owner}/results/task-{id}/`. Falls back to the note's own
  // `username` when there's no signed-in user (read-only / lab-mode views),
  // so the path is still defined even if no upload can happen.
  const basePath = `users/${currentUser ?? note.username}/notes/${note.id}`;

  // Expose this note as the "active note" while the popup is open, so the
  // Telegram batch-routing flow can offer "attach to this open note" as a
  // first-class option alongside the active experiment. Mirrors the
  // `setActiveTask` wiring in TaskDetailPopup. Both can be set at once when
  // a note popup is layered over an experiment popup; the bot's prompt
  // builder disambiguates with an A/B picker in that case.
  const setActiveNote = useAppStore((s) => s.setActiveNote);
  useEffect(() => {
    // Owner for the attachment write path. Mirror `basePath` above:
    // `currentUser ?? note.username`. Legacy notes (and demo seeds) can carry
    // an empty `username` string; using that directly produced
    // `users//notes/<id>/Images/...` writes that `atomicWrite` silently
    // collapsed to `users/notes/<id>/Images/...` (top-level garbage folder),
    // leaving the popup's image-strip pointing at a non-existent file. The
    // currentUser fallback keeps the write inside the signed-in user's
    // folder, which is what the popup's reader resolves against. See
    // attach-image-to-note.test.ts for the explicit empty-owner guard.
    const owner = note.username || currentUser || "";
    setActiveNote({ id: note.id, owner, title: note.title });
    return () => setActiveNote(null);
  }, [setActiveNote, note.id, note.username, note.title, currentUser]);

  // Loro pilot: open / close the handle when note identity changes.
  // When the flag is off this effect is a no-op (all branches return early).
  useEffect(() => {
    if (!LORO_PILOT_ENABLED) return;

    let active = true;
    const ownerValue = note.username || currentUser || "";
    setLoroOpenFailed(false);

    openNote(note, ownerValue)
      .then((handle) => {
        if (!active) return;
        setLoroHandle(handle);
      })
      .catch((err) => {
        console.error("[NoteDetailPopup] Loro openNote failed:", err);
        if (active) setLoroOpenFailed(true);
      });

    return () => {
      active = false;
      setLoroHandle((prev) => {
        if (prev) void prev.close();
        return null;
      });
    };
    // Keyed on note identity + owner only (the handle is one-per-note).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, note.username, currentUser]);

  // Loro pilot: while the handle is still opening (flag on, not yet ready, not
  // failed) render a brief loading placeholder INSTEAD of the editor, so the
  // CM6 editor only ever mounts once its final mode (Loro vs normal) is known.
  // Mounting the editor before the handle arrives would build it in non-Loro
  // mode and never switch (its mount effect runs once). On open failure we fall
  // through to the normal editor (loroHandle stays null, so no Loro props).
  const loroOpening =
    LORO_PILOT_ENABLED && loroHandle === null && !loroOpenFailed;

  // Track unsaved content (pending writes that haven't been manually saved
  // yet). Still drives the close + SPA-nav safety nets even though we no
  // longer auto-save: a user can navigate away mid-edit and we flush these.
  const unsavedContentRef = useRef<Map<string, string>>(new Map());
  const isSavingRef = useRef(false);
  const isClosingRef = useRef(false);

  // note-save (note-save manager): manual-save model mirroring the experiment
  // Lab Notes tab. `savedContentRef` holds the last-saved (disk) baseline per
  // entry so we can compute, for the ACTIVE entry, whether there is anything
  // new to save. The parent "Save note" button lights up while that differs.
  const savedContentRef = useRef<Map<string, string>>(new Map());
  // Mirrors the editor's in-flight buffer-dirty flag. The editor buffers
  // keystrokes and only flushes to the entry content on block commit, so the
  // content (and thus hasUnsavedChanges) lags while the user is mid-block. We
  // OR this into the Save button's enabled state so it lights up the instant
  // typing starts, not only after a block switch.
  const [editorDirty, setEditorDirty] = useState(false);
  // Imperative flush handle published by the embedded editor. Calling it
  // commits the editor's in-flight block buffer, fires onChange, and returns
  // the freshest full-document string so the "Save note" button persists the
  // very latest edit even if the user never left the active block.
  const editorSaveRef = useRef<(() => string) | null>(null);

  // Seed / refresh the saved baseline whenever entries load (mount, add,
  // delete, or a successful save replaces the entries array). We only set a
  // baseline for entries we don't already track so an unsaved in-flight edit
  // isn't clobbered back to "clean" by an unrelated entries refresh.
  useEffect(() => {
    for (const entry of entries) {
      if (!savedContentRef.current.has(entry.id)) {
        savedContentRef.current.set(entry.id, entry.content ?? "");
      }
    }
  }, [entries]);

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

  // Manual-save function (note-save manager). This is the explicit
  // version-control save: every write is a git commit. Called from the
  // parent "Save note" button, the editor's Cmd+S (onExplicitSave), the
  // tab-switch flush, and the close / SPA-nav safety nets.
  const saveEntryContent = useCallback(
    async (entryId: string, content: string) => {
      if (isSavingRef.current) return;

      isSavingRef.current = true;
      setSaving(true);

      try {
        // Loro pilot: when the CRDT owns content (flag on + handle ready) flush
        // the handle instead of writing content through the legacy API, so
        // notes/<id>.json is written ONCE (by the Loro mirror), not twice. The
        // legacy metadata paths (saveTitle/description, entry title+date) are
        // untouched and still feed syncNoteMetadataToDoc. Flag-off / handle-not-
        // ready falls through to the unchanged legacy content write.
        const { legacyResult: updated, wroteLegacy } = await persistEntryContent({
          loroOwnsContent: LORO_PILOT_ENABLED && !!loroHandle,
          flushLoro: () => loroHandle!.flush(),
          writeLegacyContent: () =>
            notesApi.updateEntry(note.id, entryId, { content }),
        });
        // Legacy write failed -> leave the entry dirty so the user can retry.
        // (In Loro mode wroteLegacy is false and updated is null by design; we
        // proceed to the shared dirty-bookkeeping below.)
        if (wroteLegacy && !updated) return;
        // Only update state if we're not closing. In Loro mode there is no
        // fresh Note from the API (updated is null); local entries already hold
        // the typed content via updateEntryContent, so nothing to re-sync here.
        if (updated && !isClosingRef.current) {
          setEntries(updated.entries);
        }
        unsavedContentRef.current.delete(entryId);
        // Move this entry's saved baseline to what we just wrote so the
        // "Save note" button greys out (nothing new to save). Clearing the
        // editor's dirty flag is belt-and-suspenders: the editor also clears
        // its own dirty state when its buffer flushes.
        savedContentRef.current.set(entryId, content);
        setEditorDirty(false);
        // Drop the SPA-nav draft for this entry — disk now matches what
        // the user typed, so a later remount should pick up the disk
        // baseline cleanly rather than re-hydrating a stale slug.
        try {
          sessionStorage.removeItem(
            `researchos:draft:note-entry:${currentUser ?? ""}:${note.username ?? ""}:${note.id}:${entryId}`,
          );
        } catch {
          // sessionStorage unavailable -- silently ignore.
        }
        if (updated) onUpdate(updated);
      } catch (error) {
        console.error("Failed to save entry content:", error);
      } finally {
        setSaving(false);
        isSavingRef.current = false;
      }
    },
    [note.id, onUpdate, notesApi, currentUser, note.username, loroHandle]
  );

  // note-save (note-save manager): notes no longer auto-save. Versions push
  // only on an explicit save. This helper flushes EVERY pending entry to disk
  // synchronously (best-effort, in parallel) and is the manual replacement for
  // the old debounced flush — used by the close path, the SPA-nav guard, and
  // the unsaved-changes beforeunload guard so in-flight edits are never lost.
  const flushAllUnsaved = useCallback(() => {
    if (unsavedContentRef.current.size === 0) return;
    const pending = Array.from(unsavedContentRef.current.entries());
    for (const [entryId, content] of pending) {
      // Fire-and-forget; saveEntryContent self-guards against re-entry. We
      // don't await here because the guard callbacks are synchronous.
      void saveEntryContent(entryId, content);
    }
  }, [saveEntryContent]);

  // hasUnsavedChanges for the ACTIVE entry only: the parent "Save note" button
  // saves the active entry, so it should reflect whether the active entry
  // differs from its last-saved baseline. (Outgoing-entry edits are flushed on
  // tab switch, see the activeTab effect below.)
  const hasUnsavedChanges = currentEntry
    ? currentEntry.content !== (savedContentRef.current.get(currentEntry.id) ?? "")
    : false;

  // Track dirty state across every editable surface, not just the entry
  // body. The inline title + description editors and the new-entry form all
  // live in local React state, so a refresh / tab-close mid-edit would
  // silently drop them without this gate.
  //
  // `unsavedContentRef` is intentionally not part of React state (the ref is
  // updated synchronously by `updateEntryContent` as the user types); we
  // mirror it into a re-render boundary by passing the ref's `.size > 0`
  // value through here, which re-evaluates on every render that follows a
  // typed character (the editor body change calls setEntries above, which
  // triggers a render).
  const hasUnsavedEdits =
    unsavedContentRef.current.size > 0 ||
    (editingTitle && title !== note.title) ||
    (editingDescription && description !== note.description) ||
    (showNewEntryForm && newEntryTitle.trim().length > 0);

  // beforeunload guard. `onFlush` saves every pending entry synchronously via
  // the manual path, giving the in-flight write a fighting chance before the
  // browser tears down. The guard itself only triggers when `hasUnsavedEdits`
  // is true, so it does not prompt for clean closes.
  useUnsavedChangesGuard(hasUnsavedEdits && !saving, {
    onFlush: flushAllUnsaved,
  });

  // SPA-nav-safe persistence for the currently-active entry's body. Notes
  // now save manually (note-save manager), and `handleClose` flushes pending
  // writes on the user-initiated close path. But a SPA nav-link click unmounts
  // the popup WITHOUT going through `handleClose`, so the in-flight content
  // sitting in `unsavedContentRef` would otherwise be silently dropped.
  //
  // Persisting the active entry's body to sessionStorage closes that gap:
  // on remount (user returns to this note via inbox / search / direct nav)
  // the onRestore hydrates `unsavedContentRef` + the entry's local content so
  // the "Save note" button lights up again and the user can persist it (or
  // `handleClose` flushes it on close).
  //
  // Per-user + per-note + per-entry key so an open in another tab does not
  // collide; entries are independent because each entry has its own id.
  const activeEntryDraftKey = `researchos:draft:note-entry:${currentUser ?? ""}:${note.username ?? ""}:${note.id}:${activeTab ?? "none"}`;
  const activeEntryContent = useMemo(() => {
    if (!activeTab) return "";
    const e = entries.find((e) => e.id === activeTab);
    return e?.content ?? "";
  }, [entries, activeTab]);
  const activeEntryDirty =
    !!activeTab && unsavedContentRef.current.has(activeTab);
  // We deliberately don't capture `clearDraft` here — the per-entry slugs
  // are cleared inside `saveEntryContent` via a direct `sessionStorage`
  // call so the cleanup keys off the specific entry that just persisted,
  // not whatever entry happens to be active when the API resolves.
  useDraftPersistence(activeEntryDraftKey, activeEntryContent, activeEntryDirty, {
    onRestore: (saved) => {
      if (typeof saved !== "string" || !activeTab) return;
      // Only restore if the entry is still at its disk baseline (no
      // unsaved typing yet). Mirror the AnnouncementsWidget composer
      // restore-once-then-yield pattern: the user's in-progress typing
      // always wins.
      if (unsavedContentRef.current.has(activeTab)) return;
      setEntries((prev) =>
        prev.map((e) =>
          e.id === activeTab
            ? { ...e, content: saved, updated_at: new Date().toISOString() }
            : e,
        ),
      );
      unsavedContentRef.current.set(activeTab, saved);
      // note-save (note-save manager): notes no longer auto-save, so we do
      // NOT push the recovered content to disk here. It's restored into the
      // editor + tracked as unsaved so the "Save note" button lights up and
      // the close / guard flush will persist it when the user is ready.
    },
  });

  // Handle close with save - saves any pending changes before closing.
  // note-save (note-save manager): notes no longer auto-save, but closing the
  // popup still flushes any pending (unsaved) entries so an explicit "X" /
  // Escape doesn't silently drop in-flight edits.
  const handleClose = useCallback(async () => {
    // Mark that we're closing to prevent state updates after save
    isClosingRef.current = true;

    // Save any unsaved content immediately
    if (unsavedContentRef.current.size > 0) {
      setSaving(true);
      try {
        // Snapshot the entry ids whose content is about to be flushed so
        // we can drop their SPA-nav drafts after the write resolves.
        const flushedEntryIds = Array.from(unsavedContentRef.current.keys());
        // Loro pilot: when the CRDT owns content, flush the handle ONCE (its
        // doc already holds every entry's edits) instead of per-entry legacy
        // content writes. Flag-off / handle-not-ready keeps the parallel
        // legacy save. Metadata paths are unaffected either way.
        await persistEntryContent({
          loroOwnsContent: LORO_PILOT_ENABLED && !!loroHandle,
          flushLoro: () => loroHandle!.flush(),
          writeLegacyContent: () =>
            Promise.all(
              Array.from(unsavedContentRef.current.entries()).map(
                ([entryId, content]) =>
                  notesApi.updateEntry(note.id, entryId, { content }),
              ),
            ),
        });
        unsavedContentRef.current.clear();
        // Drop persisted drafts now that the content is on disk.
        for (const entryId of flushedEntryIds) {
          try {
            sessionStorage.removeItem(
              `researchos:draft:note-entry:${currentUser ?? ""}:${note.username ?? ""}:${note.id}:${entryId}`,
            );
          } catch {
            // sessionStorage unavailable -- silently ignore.
          }
        }
      } catch (error) {
        console.error("Failed to save pending changes:", error);
      } finally {
        setSaving(false);
      }
    }

    onClose();
  }, [note.id, note.username, onClose, notesApi, currentUser, loroHandle]);

  // The explicit "X" is a ONE-CLICK FULL DISMISS, even when the history sidebar
  // is open (vc-persona-fixes sub-bot of HR, 2026-05-30: the old X dismissed only
  // the sidebar, a surprising two-stage close). It resets the history view state
  // first so no stale sidebar / diff preview lingers if the parent keeps the
  // popup mounted, then runs the normal close (which flushes pending edits). Esc
  // keeps its history-first precedence (the keydown handler below); only the
  // explicit X is a full dismiss.
  const handleCloseAll = useCallback(() => {
    setHistoryOpen(false);
    setVersionPreview(null);
    void handleClose();
  }, [handleClose]);

  // Handle escape key to close or exit fullscreen. Precedence (VCP Phase 1):
  // when the version-history sidebar is open, Esc exits HISTORY first and
  // returns to the live record, rather than closing the whole popup, so the
  // sidebar's focus-trap Esc and this window handler agree on one action.
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (historyOpen) {
        setHistoryOpen(false);
        setVersionPreview(null);
        historyTriggerRef.current?.focus();
      } else if (isExpanded) {
        setIsExpanded(false);
      } else {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isExpanded, handleClose, historyOpen]);

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

  // Update entry content - immediate local update only (note-save manager).
  // Notes no longer auto-save: this keeps the editor responsive and tracks
  // the unsaved content for the close / SPA-nav / tab-switch safety nets, but
  // it does NOT write to disk. The user persists via the "Save note" button
  // (or Cmd+S, which routes through onExplicitSave -> saveEntryContent).
  const updateEntryContent = useCallback(
    (content: string) => {
      if (!activeTab) return;

      // Immediate local update for responsive UI
      setEntries((prev) =>
        prev.map((e) =>
          e.id === activeTab ? { ...e, content, updated_at: new Date().toISOString() } : e
        )
      );

      // Track unsaved content so close / nav-away flushes can recover it.
      unsavedContentRef.current.set(activeTab, content);
    },
    [activeTab]
  );

  // Running-log tab switch (note-save manager). Auto-save used to cover the
  // case where the user typed in one entry then clicked another tab. With
  // manual save we'd lose those edits, so flush-save the OUTGOING entry first.
  // We pull the freshest text from the editor buffer (editorSaveRef) and fall
  // back to whatever is tracked in unsavedContentRef. Saving is fire-and-
  // forget; saveEntryContent updates state and the saved baseline so the
  // outgoing tab is clean when the user returns.
  const switchToTab = useCallback(
    (nextId: string) => {
      if (nextId === activeTab) return;
      const outgoing = activeTab;
      if (outgoing) {
        const buffered = editorSaveRef.current?.();
        const pending =
          typeof buffered === "string"
            ? buffered
            : unsavedContentRef.current.get(outgoing);
        if (
          typeof pending === "string" &&
          pending !== (savedContentRef.current.get(outgoing) ?? "")
        ) {
          void saveEntryContent(outgoing, pending);
        }
      }
      // Clear the dirty mirror so the incoming entry starts clean; the editor
      // re-publishes dirty on the next keystroke.
      setEditorDirty(false);
      setActiveTab(nextId);
    },
    [activeTab, saveEntryContent]
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
      // We do NOT call updateEntryContent here, so a drop alone never marks
      // the entry dirty — the GC sweep won't touch the new file until the
      // user references it and explicitly saves.
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

  // Delete note. Bug 3 (lab head UX polish manager, 2026-05-25):
  // notesApi.delete is now a soft-delete (the note's JSON moves to
  // `users/<owner>/_trash/notes/<id>-<slug>.json`). After the call lands
  // we fire an Undo toast via the delete-toast-bus so the user can
  // recover from a misclick within 10 seconds.
  //
  // Owner-only delete (VCP R1 OQ9, 2026-05-26): edit-access shared users
  // never see this button (see the footer below); a PI in an active
  // Phase 5 unlock can delete cross-owner via `labHeadGate.sessionId`.
  const handleDeleteNote = async () => {
    if (!confirm("Are you sure you want to delete this entire note?")) return;

    try {
      await notesApi.delete(note.id, note.username || undefined, {
        actor: labHeadGate.activeUser ?? undefined,
        sessionId: labHeadGate.sessionId ?? null,
      });
      emitNoteDeleted({
        noteId: note.id,
        noteTitle: note.title ?? "",
        owner: note.username || undefined,
      });
      onDelete(note.id);
      onClose();
    } catch (error) {
      console.error("Failed to delete note:", error);
    }
  };

  // Shared gate for BOTH the header trash icon and the footer "Delete Note"
  // text button (delete-affordances bot, 2026-05-29). Centralized in
  // `canDeleteNoteFromPopup` so the two affordances can never drift.
  const canDeleteNote = canDeleteNoteFromPopup({
    readOnly,
    currentUser,
    noteOwner: note.username,
    labHeadUnlocked: labHeadGate.unlocked,
  });

  // ── VC Phase 2: restore-a-version + 24h undo-restore ─────────────────────
  // The history file lives under the OWNER's folder; mirror the sidebar mount's
  // owner resolution exactly so reads/writes hit the same path.
  const historyOwner = note.username || currentUser || "";

  // Three-way PI gate (canRestoreNoteVersion). Computed once here, passed to
  // BOTH the sidebar footer (Restore) and the header (Undo). `effectiveReadOnly`
  // is the lab-head gate's own read-only (NOT `readOnly`, which also flips true
  // while the history sidebar is open). Restoring is the whole point of having
  // the sidebar open, so we must not let `historyOpen` suppress the affordance.
  const canRestore = canRestoreNoteVersion({
    readOnly: labHeadGate.effectiveReadOnly,
    currentUser,
    noteOwner: note.username,
    labHeadUnlocked: labHeadGate.unlocked,
  });

  // A PI who is VIEWING another member's note but has NOT unlocked an edit
  // session: the affordance renders DISABLED with an unlock tooltip (vs hidden
  // for a plain read-only shared viewer). `canRequestEdit` is true exactly for
  // that PI-could-unlock case.
  const restoreNeedsUnlock =
    !canRestore && labHeadGate.canRequestEdit && !labHeadGate.unlocked;

  // VC Phase 3 (shared-generalization): the restore controller now lives in the
  // entity-agnostic useVersionRestore hook. Notes binds it with the notes api +
  // the Notes immutable keys; behavior is byte-for-byte the Phase 2 controller.
  // The hook hands the freshly-written record to onUpdate; the popup's onUpdate
  // is where the local-editor reflection (setTitle/etc.) STAYS (per the design).
  const restoreApi = useMemo<VersionRestoreApi<Note>>(
    () => ({
      get: (id, owner) => notesApi.get(id, owner),
      update: (id, payload, historyMeta) =>
        notesApi.update(id, payload as NoteRestorePayload, historyMeta),
    }),
    [notesApi],
  );

  // Reflect the restored record into the popup's local editor fields AND bubble
  // it up via the prop onUpdate. This is the only restore step that stays in the
  // popup (the hook is editor-state agnostic).
  const reflectRestoredNote = useCallback(
    (updated: Note) => {
      onUpdate(updated);
      setTitle(updated.title);
      setDescription(updated.description);
      setEntries(updated.entries);
    },
    [onUpdate],
  );

  // Canonical tracked state of the LIVE note (HEAD). Threaded into the history
  // sidebar so the engine can resolve a BARE-GENESIS anchor: a note created and
  // then saved (the common pilot flow) anchors genesis at a non-empty pre-image,
  // so reconstructState needs HEAD to reverse-walk and lazily backfill
  // genesis_state (R4-prep 2c). This is the same HEAD source useVersionRestore
  // uses (canonicalize of the live record) so the viewer + the restore path
  // agree byte-for-byte.
  const liveNoteCanonical = useMemo(() => canonicalize(note), [note]);

  const {
    handleRestore,
    handleUndoRestore,
    undoConfirmPending,
    confirmUndoRestore,
    dismissUndoConfirm,
    undoWindow,
    undoWindowActive,
    isBusy: restoreBusy,
    restoreError,
    setRestoreError,
  } = useVersionRestore<Note>({
    entityType: "notes",
    record: note,
    id: note.id,
    owner: historyOwner,
    api: restoreApi,
    currentUser,
    onUpdate: reflectRestoredNote,
    // Notes immutable keys: never overwritten by a restore payload.
    immutableKeys: ["id", "created_at", "username"],
    onAfterRestore: closeHistory,
  });

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
    {showShare && currentUser && (
      <UnifiedShareDialog
        isOpen
        target={{ kind: "note", note, owner: currentUser }}
        onClose={() => setShowShare(false)}
        onShared={() => {
          // Refetch the note so the chips + provenance reflect the new ACL.
          notesApi.get(note.id).then((updated) => {
            if (updated) onUpdate(updated);
          });
        }}
      />
    )}
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this popup
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="note-detail"
      onClick={handleClose}
    >
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
        {/* PI Phase 5 (PI Phase 5 manager, 2026-05-23):
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
                  className="text-heading font-bold text-gray-900 w-full border-b-2 border-emerald-500 focus:outline-none bg-transparent"
                  autoFocus
                  disabled={readOnly}
                />
              ) : (
                <h2
                  onClick={() => !readOnly && setEditingTitle(true)}
                  className={`text-heading font-bold text-gray-900 ${
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
                  className="text-body text-gray-500 w-full border-b-2 border-emerald-500 focus:outline-none bg-transparent mt-1"
                  autoFocus
                  disabled={readOnly}
                />
              ) : (
                <p
                  onClick={() => !readOnly && setEditingDescription(true)}
                  className={`text-body text-gray-500 mt-1 ${
                    !readOnly ? "cursor-pointer hover:text-emerald-600" : ""
                  }`}
                >
                  {description || (!readOnly ? "Add a description..." : "")}
                </p>
              )}
              {/* Cross-boundary sharing provenance. Renders only on an imported
                  note (received_from is stamped at import time), so a native note
                  shows nothing. Marks WHO sent it, distinct from a native note. */}
              {note.received_from && (
                <div className="mt-2">
                  <ReceivedFromBadge
                    receivedFrom={note.received_from}
                    fingerprint={note.received_from_fingerprint}
                    receivedAt={note.received_at}
                  />
                </div>
              )}
              {/* PI Phase 5 — record-level "Edited by PI" notice. */}
              {propReadOnly && note.username && (
                <AuditTrailNotice
                  targetUser={note.username}
                  recordType="note"
                  recordId={note.id}
                />
              )}
              {/* VC Phase 2: restore / undo-restore error + Case-C fallback
                  message. Inline, non-blocking; clears on the next attempt. */}
              {restoreError && (
                <p
                  data-testid="note-restore-error"
                  className="mt-2 text-meta text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-snug"
                >
                  {restoreError}
                </p>
              )}
              {/* IN-APP undo confirm (vc-persona-fixes sub-bot of HR,
                  2026-05-30). The undo USED to call native confirm(), which can
                  FREEZE the Electron renderer (house rule: no native dialogs).
                  When real content edits landed since the restore, the hook
                  raises `undoConfirmPending` and we render this inline confirm /
                  cancel pair instead, mirroring the sidebar restore-confirm
                  pattern. */}
              {undoConfirmPending && (
                <div
                  data-testid="note-undo-confirm"
                  className="mt-2 text-meta text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-snug"
                >
                  <p>
                    You have edited this note since the restore. Undoing will
                    discard those edits and return the note to its pre-restore
                    state.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void confirmUndoRestore()}
                      disabled={restoreBusy}
                      data-testid="note-undo-confirm-button"
                      className="px-2.5 py-1 text-meta font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 rounded-md transition-colors"
                    >
                      {restoreBusy ? "Undoing..." : "Discard edits and undo"}
                    </button>
                    <button
                      type="button"
                      onClick={dismissUndoConfirm}
                      disabled={restoreBusy}
                      data-testid="note-undo-cancel-button"
                      className="px-2.5 py-1 text-meta font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 disabled:opacity-60 rounded-md transition-colors"
                    >
                      Keep editing
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Fullscreen and Close buttons */}
            <div className="flex items-center gap-1">
              {/* PI Phase 5 — Request edit button. Visible only when
                  PI is viewing another member's note + no session active. */}
              {labHeadGate.canRequestEdit && !labHeadGate.unlocked && labHeadGate.activeUser && (
                <RequestEditButton
                  username={labHeadGate.activeUser}
                  targetLabel={`${note.username ?? "member"}'s note: ${title}`}
                />
              )}
              {/* PI Phase 3 (PI Phase 3 manager, 2026-05-23):
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
              {/* Header Delete affordance (delete-affordances bot,
                  2026-05-29): the soft-delete used to live only as a small
                  text link in the footer, which Grant could not find. This
                  mirrors the experiment popup's header trash icon. Gated with
                  the SAME condition as the footer Delete button: not
                  read-only AND (owner OR an active PI Phase 5 unlock). Calls
                  the existing handleDeleteNote, so the soft-delete (move to
                  `users/<owner>/_trash/notes/`) + Undo toast are preserved. */}
              {canDeleteNote && (
                <Tooltip label="Delete note" placement="bottom">
                  <button
                    onClick={handleDeleteNote}
                    data-testid="note-header-delete"
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </Tooltip>
              )}
              {/* VC Phase 2 (restore-a-version sub-bot of HR, 2026-05-30):
                  "Undo restore" header button. Visible (flag ON) while a
                  24h undo window is live for this note. The button is the
                  prominent surface that appears after a restore exits the
                  sidebar. Enabled for the owner / PI-with-unlock; DISABLED with
                  an unlock Tooltip for a PI who could unlock but has not; HIDDEN
                  for a read-only shared viewer (both canRestore and
                  restoreNeedsUnlock are false). Render-gated on expiry: once
                  `expires_at` passes, undoWindowActive is false and the button
                  drops with no background timer. */}
              {RESTORE_ENABLED &&
                undoWindowActive &&
                (canRestore || restoreNeedsUnlock) && (
                  <Tooltip
                    label={
                      restoreNeedsUnlock
                        ? "Unlock edit mode (PI passcode) to undo the restore"
                        : restoreBusy
                          ? "Undoing the restore..."
                          : "Undo the restore (returns the note to its pre-restore version)"
                    }
                    placement="bottom"
                  >
                    <button
                      onClick={
                        canRestore && !restoreBusy ? handleUndoRestore : undefined
                      }
                      // Disable while a restore / undo is in flight so a
                      // distracted double click cannot fire two concurrent
                      // undo-revert writes. The hook also early-returns when
                      // busy; this is the UX layer over that guard.
                      disabled={!canRestore || restoreBusy}
                      data-testid="note-undo-restore-button"
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-meta font-medium rounded-lg transition-colors ${
                        canRestore && !restoreBusy
                          ? "text-amber-700 bg-amber-50 hover:bg-amber-100"
                          : "text-gray-400 bg-gray-50 cursor-not-allowed"
                      }`}
                    >
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M9 14L4 9l5-5" />
                        <path d="M4 9h11a4 4 0 0 1 0 8h-1" />
                      </svg>
                      {restoreBusy ? "Undoing..." : "Undo restore"}
                    </button>
                  </Tooltip>
                )}
              {/* VCP Phase 1 (version-history viewer bot for HR,
                  2026-05-29): version-history entry button. Shown to anyone
                  with read access (the popup only opens on notes the viewer
                  can read). Icon-only history glyph (clock + counter-arrow),
                  inline SVG, wrapped in Tooltip per house rule. Toggles the
                  right-sidebar version viewer; opening flips the document
                  column to read-only preview. No data-tour-target here so it
                  never collides with the v4 tour anchors. */}
              <Tooltip label="Version history" placement="bottom">
                <button
                  ref={historyTriggerRef}
                  onClick={() => {
                    if (historyOpen) {
                      closeHistory();
                    } else {
                      setHistoryOpen(true);
                    }
                  }}
                  data-testid="note-history-button"
                  aria-pressed={historyOpen}
                  className={`p-2 rounded-lg transition-colors ${
                    historyOpen
                      ? "text-emerald-600 bg-emerald-50"
                      : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <svg
                    className="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 3v5h5" />
                    <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </button>
              </Tooltip>
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
                  onClick={handleCloseAll}
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

          {/* PI Phase 3 (PI Phase 3 manager, 2026-05-23):
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

          {/* R1b: sharing chips — read-only visibility hint row
              showing who currently has access. */}
          {note.username && (
            <div className="mt-3">
              <SharingChips
                sharedWith={note.shared_with || []}
                ownerUsername={note.username}
                viewerUsername={currentUser ?? undefined}
              />
            </div>
          )}

          {/* VCP R3 attribution stamps (VCP R3 attribution stamps,
              2026-05-26): popup stamps row. Renders "Created by X on D"
              + "Last edited by Y on D" with PI badge resolution. Self-
              hides on pre-R3 notes that lack `last_edited_by` /
              `last_edited_at`. The note's creator stamp is `username`
              (per OQ5), not `created_by`. */}
          <div className="mt-3">
            <StampsRow
              createdBy={note.username}
              createdAt={note.created_at}
              lastEditedBy={note.last_edited_by}
              lastEditedAt={note.last_edited_at}
            />
          </div>

          {/* Unified Share + Add File actions */}
          {!readOnly && (
            <div className="mt-3 flex items-center gap-2">
              {/* One Share button opens the two-tab UnifiedShareDialog (lab ACL
                  + cross-boundary send), replacing the old Private / Shared
                  toggle AND the separate "Share outside this folder" button. */}
              <Tooltip label="Share" placement="top">
                <button
                  onClick={() => setShowShare(true)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-body bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                  aria-label="Share"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                  Share
                </button>
              </Tooltip>

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-body bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50"
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

              {/* Save-in-progress indicator (note-save manager): shown while
                  an explicit save (or title / sharing write) is in flight. */}
              {saving && (
                <span className="text-meta text-gray-400 flex items-center gap-1">
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

        {/* Content + version-history split. When the history sidebar is open
            the document column (left) renders read-only and the version list
            docks on the right (VCP Phase 1, version-history viewer bot for HR,
            2026-05-29). */}
        <div className="flex-1 overflow-hidden flex flex-row min-h-0">
        {/* Content area (document column) */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {/* Tabs for running logs */}
          {note.is_running_log && (
            <div className="border-b border-gray-200 px-4 py-2 flex-shrink-0">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {entries
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => switchToTab(entry.id)}
                      className={`px-3 py-1.5 rounded-lg text-body whitespace-nowrap transition-colors ${
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
                    className="px-3 py-1.5 rounded-lg text-body bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors flex items-center gap-1"
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
                    className="text-body font-medium text-gray-700 border-b-2 border-emerald-500 focus:outline-none bg-transparent"
                    autoFocus
                    disabled={readOnly}
                  />
                ) : (
                  <span
                    onClick={startEditingEntryTitle}
                    className={`text-body font-medium text-gray-700 ${
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
                    className="text-body text-gray-500 border-b-2 border-emerald-500 focus:outline-none bg-transparent"
                    autoFocus
                    disabled={readOnly}
                  />
                ) : (
                  <span
                    onClick={startEditingEntryDate}
                    className={`text-body text-gray-500 ${
                      !readOnly ? "cursor-pointer hover:text-emerald-600" : ""
                    }`}
                    title={!readOnly ? "Click to edit date" : ""}
                  >
                    {formatDate(currentEntry.date)}
                  </span>
                )}
                <span className="text-meta text-gray-400">
                  Updated: {formatDate(currentEntry.updated_at)}
                </span>
              </div>
              {!readOnly && entries.length > 1 && (
                <button
                  onClick={() => deleteEntry(currentEntry.id)}
                  className="text-meta text-red-500 hover:text-red-700 transition-colors"
                >
                  Delete Entry
                </button>
              )}
            </div>
          )}

          {/* Save toolbar (note-save manager). Notes now use the manual
              version-control save model from the experiment Lab Notes tab:
              this parent-owned "Save note" button lights up the moment there
              are unsaved edits (including while typing) and greys when there
              is nothing new to save. Each save is a git commit; notes no
              longer auto-save. Hidden entirely in readOnly mode. */}
          {!readOnly && currentEntry && (
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 flex-shrink-0">
              <div className="flex-1" />
              {(hasUnsavedChanges || editorDirty) && (
                <span className="inline-flex items-center gap-1 text-meta text-amber-700 font-medium">
                  <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Unsaved changes
                </span>
              )}
              <button
                data-testid="note-save"
                data-tour-target="note-save"
                onClick={() => {
                  // Flush the editor's in-flight block buffer first so the
                  // last in-progress edit lands on disk, then persist.
                  const latest = editorSaveRef.current?.() ?? (currentEntry?.content ?? "");
                  if (activeTab) void saveEntryContent(activeTab, latest);
                }}
                disabled={saving || readOnly || (!hasUnsavedChanges && !editorDirty)}
                className={`px-3 py-1.5 text-meta font-medium rounded-lg transition-colors ${
                  (hasUnsavedChanges || editorDirty) && !saving
                    ? "text-white bg-blue-600 hover:bg-blue-700"
                    : "text-gray-400 bg-gray-100 cursor-not-allowed"
                }`}
              >
                {saving ? "Saving..." : "Save note"}
              </button>
            </div>
          )}

          {/* Editor (or, when the history sidebar is open with a selected
              version, the in-place read-only diff for that version). */}
          <div className="flex-1 overflow-y-auto">
            {historyOpen && versionPreview ? (
              <div className="p-6" data-testid="note-version-diff-column">
                <VersionDiffView
                  before={versionPreview.before}
                  after={versionPreview.after}
                  editor={versionPreview.editor}
                  editorLabel={versionPreview.editorLabel}
                />
              </div>
            ) : historyOpen ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-body p-6">
                <p>Select a version to preview it here.</p>
              </div>
            ) : note.is_running_log ? (
              currentEntry ? (
                // Loro pilot: when the flag is on AND the handle is ready, pass
                // loroHandle/entryIndex/baseNote into LiveMarkdownEditor so
                // InlineMarkdownEditor runs in Loro mode. While the handle is
                // still opening we show a loader (loroOpening) so the editor
                // mounts in its final mode. When the flag is off OR the open
                // failed, the extra props are absent and the editor behaves
                // exactly as before.
                loroOpening ? (
                  <div className="flex items-center justify-center h-full text-gray-400 text-body p-6">
                    <p>Loading editor...</p>
                  </div>
                ) : (
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
                  // note-save (note-save manager): the popup owns its own
                  // version-controlled "Save note" button above, so hide the
                  // editor's internal buffer-commit button. saveRef lets that
                  // button flush the live buffer; onExplicitSave routes Cmd+S
                  // to disk; onDirtyChange keeps the button lit while mid-edit.
                  hideSaveButton
                  saveRef={editorSaveRef}
                  onExplicitSave={(v) => { if (activeTab) void saveEntryContent(activeTab, v); }}
                  onDirtyChange={setEditorDirty}
                  // Loro pilot props (forwarded to InlineMarkdownEditor; absent = no-op).
                  loroHandle={LORO_PILOT_ENABLED ? (loroHandle ?? undefined) : undefined}
                  loroEntryIndex={LORO_PILOT_ENABLED ? entries.findIndex((e) => e.id === activeTab) : undefined}
                  loroBaseNote={LORO_PILOT_ENABLED ? note : undefined}
                />
                )
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <p>No entries yet. Click &quot;Add Entry&quot; to get started.</p>
                </div>
              )
            ) : (
              // Single note - use the first (and only) entry
              entries[0] && (
                loroOpening ? (
                  <div className="flex items-center justify-center h-full text-gray-400 text-body p-6">
                    <p>Loading editor...</p>
                  </div>
                ) : (
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
                  // note-save (note-save manager): see running-log branch.
                  hideSaveButton
                  saveRef={editorSaveRef}
                  onExplicitSave={(v) => { if (activeTab) void saveEntryContent(activeTab, v); }}
                  onDirtyChange={setEditorDirty}
                  // Loro pilot props (forwarded to InlineMarkdownEditor; absent = no-op).
                  loroHandle={LORO_PILOT_ENABLED ? (loroHandle ?? undefined) : undefined}
                  loroEntryIndex={LORO_PILOT_ENABLED ? 0 : undefined}
                  loroBaseNote={LORO_PILOT_ENABLED ? note : undefined}
                />
                )
              )
            )}
          </div>
        </div>

        {/* Version-history sidebar (docked right). Mounts only while open so
            the history file read happens on demand. The owner folder is the
            note's `username` (the history file lives under
            users/<owner>/_history/notes/<id>.jsonl); fall back to the signed-in
            user when a legacy note carries an empty username. */}
        {historyOpen && (
          <NoteVersionHistorySidebar
            noteId={note.id}
            owner={note.username || currentUser || ""}
            onClose={closeHistory}
            onPreviewChange={setVersionPreview}
            // Live HEAD canonical: lets the engine resolve a bare-genesis anchor
            // (create-note-then-edit) so every version reconstructs + the diffs
            // are non-empty. Without it reconstructState throws and diffs are "".
            headCanonical={liveNoteCanonical}
            // VC Phase 2: the Restore footer only appears when the feature flag
            // is ON, the three-way PI gate grants restore rights, AND a non-HEAD
            // version is selected (the sidebar enforces the last condition).
            canRestore={RESTORE_ENABLED && canRestore}
            onRestore={handleRestore}
          />
        )}
        </div>

        {/* Comments thread (#13): visible in both lab mode (readOnly=true)
            and regular mode so the note's owner can see PI feedback. The
            thread itself is the gate for whether commenting is enabled. */}
        <NoteCommentsThread note={note} />

        {/* Footer */}
        {!readOnly && (
          <div className="p-4 border-t border-gray-200 flex items-center justify-between flex-shrink-0">
            <div className="text-meta text-gray-400">
              Created: {note.created_at ? formatDate(note.created_at) : "—"} • Updated: {formatDate(note.updated_at)}
            </div>
            {/* VCP R1 OQ9 (2026-05-26): owner-only Delete. Shared-edit
                users see no Delete button; their writes still go through
                the unwrapped notesApi.update. A PI in an active Phase 5
                unlock (`labHeadGate.unlocked`) gets the button so they
                can delete cross-owner under audit. */}
            {canDeleteNote && (
              <button
                onClick={handleDeleteNote}
                className="px-4 py-2 text-body text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                Delete Note
              </button>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
