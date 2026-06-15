"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import CalmPopupShell from "@/components/ui/CalmPopupShell";
import HeaderOverflowMenu, { HeaderOverflowLabel } from "@/components/ui/HeaderOverflowMenu";
import type { Note, NoteEntry, NoteRestorePayload, Notebook } from "@/lib/types";
import MoveToNotebookMenu from "./notebooks/MoveToNotebookMenu";
import { Icon } from "@/components/icons";
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
import { LORO_PILOT_ENABLED, EXTERNAL_COLLAB_ENABLED } from "@/lib/loro/config";
import {
  isBlocked as isSenderBlocked,
  blockSender,
  unblockSender,
  onBlockListChange,
} from "@/lib/collab/client/block-list";
import { openNote, type NoteHandle } from "@/lib/loro/store";
import { restoreLoroVersion, undoLoroRestore } from "@/lib/loro/restore";
import { makeLoroHistoryEngine } from "@/lib/loro/history-engine";
import { persistEntryContent } from "@/lib/notes/persist-entry-content";
import LiveMarkdownEditor from "./LiveMarkdownEditor";
import NoteCommentsThread from "./NoteCommentsThread";
import CommentsSidebar from "./CommentsSidebar";
import ReceivedFromBadge from "./ReceivedFromBadge";
import Tooltip from "./Tooltip";
import { focusWithoutTooltip } from "./tooltip-focus";
import { usePhonePaired } from "@/hooks/usePhonePaired";
import { useFileRenamePopup } from "./FileRenamePopup";
import { useDuplicateResolver } from "./DuplicateUploadDialog";
import { fileService } from "@/lib/file-system/file-service";
import { attachImageToTask } from "@/lib/attachments/attach-image";
import { fileEvents } from "@/lib/attachments/file-events";
import { checkForDuplicates } from "@/lib/attachments/duplicate-check";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useAccountType } from "@/hooks/useAccountType";
import FlagForReviewButton from "./lab-head/FlagForReviewButton";
import FlagBanner from "./lab-head/FlagBanner";
import PiEditButton from "./lab-head/PiEditButton";
import PiEditConfirmDialog from "./lab-head/PiEditConfirmDialog";
import PiEditAuditNote from "./lab-head/PiEditAuditNote";
import PiActionsHeaderButton from "./lab-head/PiActionsHeaderButton";
import { usePiEditGate } from "@/hooks/usePiEditGate";
import UnifiedShareDialog from "@/components/sharing/UnifiedShareDialog";
import NoteVersionHistorySidebar, {
  type VersionPreview,
} from "@/components/history/NoteVersionHistorySidebar";
import VersionDiffView from "@/components/history/VersionDiffView";
import { useCollabSession } from "@/lib/loro/collab/use-collab-session";
import { peerColorClass } from "@/lib/loro/collab/safe-ephemeral-plugin";
import { grantCollabOnShare } from "@/lib/collab/client/grant-on-share";
import { setCollabSignerEmail } from "@/lib/collab/client/current-email";
import { getCollabDocId } from "@/lib/collab/client/doc-id";
import { isRevoked, onRevoked } from "@/lib/collab/client/revocation";

interface NoteDetailPopupProps {
  note: Note;
  onClose: () => void;
  onUpdate: (note: Note) => void;
  onDelete: (noteId: number) => void;
  readOnly?: boolean;
  // Open with the comments rail already expanded + composer focused (used by the
  // right-click "Add a comment" action).
  initialCommentsOpen?: boolean;
  // Notebooks Generalization Phase 2 (notebooks-gen Phase 2 bot, 2026-06-06):
  // a "Move to notebook" header control. When `onMoveToNotebook` is provided
  // (personal mode, not lab mode), the header shows a notebook icon that opens
  // a picker of the viewer's notebooks + "Remove from notebook". Omitted in Lab
  // Mode / read-only contexts so the control never appears there.
  onMoveToNotebook?: (notebookId: string | null) => void;
  myNotebooks?: Notebook[];
  sharedNotebooks?: Notebook[];
  currentUser?: string | null;
}

export default function NoteDetailPopup({
  note,
  onClose,
  onUpdate,
  onDelete,
  readOnly: propReadOnly = false,
  initialCommentsOpen = false,
  onMoveToNotebook,
  myNotebooks = [],
  sharedNotebooks = [],
  currentUser: moveCurrentUser,
}: NoteDetailPopupProps) {
  // Move-to-notebook menu anchor (notebooks-gen Phase 2). Cursor-anchored from
  // the header notebook button when `onMoveToNotebook` is wired.
  const [moveMenuAnchor, setMoveMenuAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  // PI edit-mode removal (remove-edit-mode bot, 2026-06-07): the PI
  // edit-session soft-write was removed. The prop-passed readOnly is now the
  // effective readOnly (writes follow standard share permissions). A lab head
  // viewing a member's note can still flag it (a role privilege, not a record
  // write) via canActAsLabHead below.
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  // The PI-role boolean for the header button, derived from accountType so the
  // loading `undefined` is preserved (matching useIsLabHead). accountType is
  // still read directly below for the canActAsLabHead gate, so it stays.
  const isLabHead =
    accountType === "lab_head"
      ? true
      : accountType === undefined
        ? undefined
        : false;
  const canActAsLabHead =
    propReadOnly &&
    accountType === "lab_head" &&
    !!note.username &&
    !!currentUser &&
    note.username !== currentUser;
  // PI capability revamp (2026-06-07): role-based PI edit of a member's note.
  // The gate decides whether this is a lab head editing someone else's note on
  // the role alone, and holds the once-per-session confirm. When active +
  // confirmed, writes route to the owner's folder + emit audit (notesApi memo
  // below); until confirmed the note stays read-only behind the "Edit as lab
  // head" affordance.
  const piGate = usePiEditGate({
    owner: note.username,
    sharedWith: note.shared_with,
    recordType: "note",
    recordId: note.id,
    propReadOnly,
  });
  // Version-history viewer (VCP Phase 1, version-history viewer bot for HR,
  // 2026-05-29). Opening the right-sidebar version list puts the document
  // column into a READ-ONLY preview: `historyOpen` forces the editor read-only
  // alongside the existing lab-head gate, and `versionPreview` carries the
  // selected version's {before, after} diff into the document column. Closing
  // the sidebar ("Exit history") clears both and returns to the live record.
  const [historyOpen, setHistoryOpen] = useState(false);
  // Lab comments live in a docked right rail (like the history sidebar). The two
  // rails are mutually exclusive: opening one closes the other.
  const [commentsOpen, setCommentsOpen] = useState(initialCommentsOpen);
  const commentCount = note.comments?.length ?? 0;
  const [versionPreview, setVersionPreview] = useState<VersionPreview | null>(
    null,
  );
  // The history entry button, so closing the sidebar (Esc / Exit history)
  // returns focus to the trigger per the accessibility contract.
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    setVersionPreview(null);
    focusWithoutTooltip(historyTriggerRef.current);
  }, []);
  // Shared 1:1 notebooks (notebook-note-edit sub-bot of HR, 2026-06-02):
  // a NOTEBOOK note carrying a `notebook_id` is always shared with BOTH members
  // at level "edit" (via `pairingSharedWith`), so either member edits any note
  // in the notebook freely. The explicit pair-shared-at-edit grant IS the
  // authorization. The predicate returns false for any non-notebook note.
  const notebookEditAllowed = canEditNotebookNote({
    notebookId: note.notebook_id,
    noteOwner: note.username,
    currentUser,
    sharedWith: note.shared_with,
  });
  // The other member's notebook note is owned by them; route the peer write
  // to the owner's folder so it lands where they read it. An OWN notebook note
  // (owner === viewer) needs no routing: leave it on the current-user path.
  const notebookPeerOwner =
    notebookEditAllowed && !!note.username && note.username !== currentUser
      ? note.username
      : undefined;
  // External-collab chunk 5: true when the owner has revoked this recipient's
  // live access (detected as a 401 on the enforced session for a materialized
  // external note). The recipient keeps their last snapshot as a read-only local
  // copy. We render a banner and force the editor read-only, and the auto-connect
  // effect skips reconnecting. Seeded from the registry (the store open path may
  // already have marked it during buildCollabBaseDoc) and kept live via onRevoked.
  const [collabRevoked, setCollabRevoked] = useState(false);
  useEffect(() => {
    const docId = note.collab_doc_id;
    if (!docId) return;
    if (isRevoked(docId)) setCollabRevoked(true);
    return onRevoked((revokedId) => {
      if (revokedId === docId) setCollabRevoked(true);
    });
  }, [note.collab_doc_id]);

  // External-collab chunk 5: block-the-sender state for a materialized external
  // note. received_from carries the verified sender email. Reflects the local
  // block list and updates live when it changes elsewhere (e.g. the Shared-with-me
  // tab). Only meaningful when EXTERNAL_COLLAB_ENABLED and this is a received note.
  const [senderBlocked, setSenderBlocked] = useState(false);
  useEffect(() => {
    const sender = note.received_from;
    if (!EXTERNAL_COLLAB_ENABLED || !sender) return;
    setSenderBlocked(isSenderBlocked(sender));
    return onBlockListChange(() => setSenderBlocked(isSenderBlocked(sender)));
  }, [note.received_from]);

  // A PI editing a member's note on the role stays read-only until they cross
  // the once-per-session confirm; everyone else keeps the share-permission flag.
  const piActive = piGate.isPiEdit && piGate.confirmed;
  const readOnly =
    (piGate.isPiEdit
      ? !piGate.confirmed
      : propReadOnly && !notebookEditAllowed) ||
    historyOpen ||
    // External-collab chunk 5: a revoked recipient's copy is read-only.
    collabRevoked;
  const notesApi = useMemo(
    () =>
      ownerScopedNotesApi({
        notebookPeerOwner,
        // When the PI has confirmed, route writes to the member's folder + audit.
        targetOwner: piActive ? (note.username ?? undefined) : undefined,
        actor: piActive ? (currentUser ?? undefined) : undefined,
      }),
    [notebookPeerOwner, piActive, note.username, currentUser],
  );
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [title, setTitle] = useState(note.title);
  // True when a phone is companion-paired, so the header can show the link.
  const phonePaired = usePhonePaired();
  const [description, setDescription] = useState(note.description);
  const [entries, setEntries] = useState<NoteEntry[]>(note.entries);
  const [saving, setSaving] = useState(false);
  // Unified Share entry point (2026-06-04): one Share button opens the two-tab
  // UnifiedShareDialog. The "In your lab" tab is the full per-person ACL
  // (shareNote, read / edit, whole-lab), which REPLACES the old coarse
  // is_shared Private / Shared toggle for notes. The "Outside your lab" tab is
  // the cross-boundary encrypted-copy send that used to be a separate button.
  const [showShare, setShowShare] = useState(false);
  // Phase 3c chunk 2: snapshot the shared_with list at dialog-open time so the
  // grant-on-share callback can diff previous vs new members.
  const sharedWithBeforeShareRef = useRef<import("@/lib/types").SharedUser[]>([]);
  const [showNewEntryForm, setShowNewEntryForm] = useState(false);
  const [newEntryTitle, setNewEntryTitle] = useState("");
  const [newEntryDate, setNewEntryDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  // Unified Popup Chrome (UNIFIED_POPUP_CHROME_SPEC.md §4): CalmPopupShell now
  // OWNS the canonical expand state, the Focus toggle, the calm-surface class,
  // and the Escape state machine. This stays only as a local MIRROR the shell
  // pushes via `onExpandedChange`, so the many existing body conditionals that
  // read `isExpanded` (editor `expanded` prop, the docked save bar gate, the
  // running-log seam softening) keep working unchanged.
  const [isExpanded, setIsExpanded] = useState(false);
  const shellToggleExpandRef = useRef<() => void>(() => {});
  const [editingEntryTitle, setEditingEntryTitle] = useState(false);
  const [editingEntryDate, setEditingEntryDate] = useState(false);
  const [entryTitle, setEntryTitle] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { requestRename, PopupComponent: FileRenamePopup } = useFileRenamePopup();
  const { resolve: resolveDuplicates, DialogComponent: DuplicateDialog } =
    useDuplicateResolver();
  // The device's own directory email (canonical), used to SIGN collab Neon
  // requests. This is the registered identity email, NOT a username or the note
  // owner; the server rejects anything that is not a bound directory email.
  // Null when this device has no sharing identity (collab then stays live-only).
  const { email: myDirectoryEmail } = useSharingIdentity();
  // Account-capability gate (capabilities bot, 2026-06-13). Share is a deep
  // in-flow control, so it HIDES for solo/locked users rather than walling them
  // inside the share dialog with an account prompt.
  const { canShare } = useAccountCapabilities();

  // Publish the device's directory email to the lazy collab signer (store.ts and
  // the sync hooks read it when they sign Neon requests). Reactive so the email
  // becomes available as soon as the sharing identity sidecar loads.
  useEffect(() => {
    setCollabSignerEmail(myDirectoryEmail);
  }, [myDirectoryEmail]);

  // Loro pilot: one handle per note (keyed on note.id + owner). Opened once;
  // closed on note identity change or unmount. Null when flag is off or while
  // the async open is in flight.
  const [loroHandle, setLoroHandle] = useState<NoteHandle | null>(null);
  // True when the async Loro open failed for this note. Lets the editor fall
  // back to the normal (non-Loro) surface instead of blocking on a loader.
  const [loroOpenFailed, setLoroOpenFailed] = useState(false);

  // Loro Phase 3, chunk 4: live-collab session (flag-gated).
  // useCollabSession is unconditionally called (Rules of Hooks) but is
  // permanently idle when LORO_PILOT_ENABLED is false or the handle is null.
  // Phase 3 chunk 5b: pass owner + collaboratorUsername so the hook records
  // the remote collaborator in the actors map when their first commit arrives.
  // For the same-user two-tab MVP the collaborator is the same user (currentUser).
  const collabOwner = (note.username || currentUser) ?? undefined;
  const collab = useCollabSession({
    doc: loroHandle?.doc ?? null,
    enabled: LORO_PILOT_ENABLED,
    owner: collabOwner,
    collaboratorUsername: currentUser ?? undefined,
  });

  // Phase 3 chunk 5a: derive the local peer's cursor identity.
  // The EphemeralStore is stable (never re-created by useCollabSession) and is
  // passed to both InlineMarkdownEditor instances below so their CM6 bindings
  // share one store with the relay provider. collabUser is derived from the
  // signed-in user name + a deterministic color derived from the doc's peer id
  // string. Both are stable after the handle opens and change only when the
  // user identity changes (which means the popup would unmount anyway).
  //
  // The LoroEphemeralPlugin is only installed when the session is LIVE -- see
  // the `collabActive` gate passed to the editors.
  const collabActive = LORO_PILOT_ENABLED && collab.state.status === "live";
  // Build a collabUser lazily: only when the flag is on and the handle is open.
  // peerColorClass is a pure deterministic hash of the peer id string so each
  // device/tab gets a stable, distinct color. Both fields are stable after
  // the handle opens.
  const collabUser = useMemo(() => {
    if (!LORO_PILOT_ENABLED || !loroHandle) return undefined;
    return {
      name: currentUser ?? "collaborator",
      colorClassName: peerColorClass(loroHandle.doc.peerIdStr),
    };
  // peerColorClass is stable; only recompute on user/handle identity change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loroHandle?.doc.peerIdStr, currentUser]);

  // Per-note attachment folder. Mirrors how tasks use
  // `users/{owner}/results/task-{id}/`. Falls back to the note's own
  // `username` when there's no signed-in user (read-only / lab-mode views),
  // so the path is still defined even if no upload can happen.
  const basePath = `users/${currentUser ?? note.username}/notes/${note.id}`;

  // Markdown embed hybrid P7-1a: the per-note embed-pins sidecar. Pinning freezes a
  // block embed into this file (one per note), so the editor can render the frozen
  // snapshot and offer a Pin / Unpin control. Sits beside the note's attachments
  // under its directory. Only wired when the note is editable, a read-only viewer
  // gets no pin control (a missing context renders embeds live, unchanged).
  const embedPinContext = useMemo(
    () =>
      readOnly
        ? undefined
        : { sidecarPath: `${basePath}/notes.ros-embeds.json` },
    [basePath, readOnly],
  );

  // Expose this note as the "active note" while the popup is open, so the
  // Telegram batch-routing flow can offer "attach to this open note" as a
  // first-class option alongside the active experiment. Mirrors the
  // `setActiveTask` wiring in TaskDetailPopup. Both can be set at once when
  // a note popup is layered over an experiment popup; the bot's prompt
  // builder disambiguates with an A/B picker in that case.
  //
  // Phase 1.5 extends this with running-log metadata (isRunningLog, entries,
  // openEntryId, lastEditedEntryId) so the phone's focus-context picker can
  // show the right set of entries and pre-select the recommended one.
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
    const entryList = entries.map((e) => ({ id: e.id, title: e.title, date: e.date }));
    const lastEditedEntry = entries.reduce<typeof entries[0] | null>((best, e) => {
      if (!best) return e;
      return new Date(e.updated_at).getTime() > new Date(best.updated_at).getTime() ? e : best;
    }, null);
    setActiveNote({
      id: note.id,
      owner,
      title: note.title,
      isRunningLog: note.is_running_log,
      entries: entryList,
      openEntryId: activeTab,
      lastEditedEntryId: lastEditedEntry?.id ?? null,
    });
    return () => setActiveNote(null);
  }, [setActiveNote, note.id, note.username, note.title, note.is_running_log, currentUser, entries, activeTab]);

  // Phase 1.5: when the laptop receives a note:routed event (the phone placed a
  // photo into a specific entry), switch to that entry so the user sees where
  // the image landed. Mirrors the capture:routed listener in TaskDetailPopup.
  useEffect(() => {
    function onNoteRouted(ev: Event) {
      const detail = (ev as CustomEvent<{ noteId: number; owner: string; entryId: string | null }>).detail;
      if (detail.noteId !== note.id) return;
      const owner = note.username || currentUser || "";
      if (detail.owner !== owner) return;
      if (detail.entryId && detail.entryId !== activeTab) {
        setActiveTab(detail.entryId);
      }
    }
    window.addEventListener("note:routed", onNoteRouted);
    return () => window.removeEventListener("note:routed", onNoteRouted);
    // activeTab intentionally NOT in deps: the listener reads the latest value
    // via closure and we want only one registration per popup lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, note.username, currentUser]);

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

  // Auto-save status (auto-save bot, 2026-06-05). Tracks whether a debounced
  // commit is queued or in flight so the Saving/Saved indicator stays accurate.
  // Only meaningful when LORO_PILOT_ENABLED and the handle is open; false
  // (settled) otherwise. The subscription fires on every flip; we mirror it
  // into React state for a re-render.
  const [loroCommitPending, setLoroCommitPending] = useState(false);
  useEffect(() => {
    if (!LORO_PILOT_ENABLED || !loroHandle) {
      setLoroCommitPending(false);
      return;
    }
    // subscribeCommitPending fires immediately with the current value so the
    // indicator initialises correctly without a one-frame flash.
    return loroHandle.subscribeCommitPending(setLoroCommitPending);
  }, [loroHandle]);

  // Phase 3c chunk 3a: auto-connect to the live session when a shared note
  // opens. A shared note has a collab_doc_id in its Loro meta map (written by
  // getOrMintCollabDocId on the sender's side and carried by the bundle on
  // import). When detected, connectFromDocId derives the (sessionId, sessionKey)
  // and connects the relay provider without any manual link.
  //
  // Bootstrap path for newly-imported notes: the bundle import writes the
  // collab_doc_id into the Note JSON record (note.collab_doc_id) but the Loro
  // sidecar does not yet exist, so getCollabDocId on the fresh Loro doc returns
  // undefined. In that case we check note.collab_doc_id from the prop and use
  // getOrMintCollabDocId to write it into the Loro meta, ensuring the CRDT doc
  // and the relay room use the SAME id that the sender minted.
  //
  // Guard conditions:
  //   - LORO_PILOT_ENABLED (flag off = no side effects)
  //   - loroHandle is open (doc must be readable)
  //   - collab session is idle (never re-connect while already connecting/live)
  //   - the note has a collab_doc_id (only shared notes have one)
  //
  // Unshared notes: no collab_doc_id in meta or JSON, effect is a no-op.
  // Dependency on collab.state.status prevents double-fire: once the session
  // moves to "connecting" the guard fails and the effect body skips.
  useEffect(() => {
    if (!LORO_PILOT_ENABLED) return;
    if (!loroHandle) return;
    if (collab.state.status !== "idle") return;
    // External-collab chunk 5: never reconnect a revoked recipient's note. The
    // read-only local copy stays; live access is gone.
    if (collabRevoked) return;

    // First try the Loro meta (authoritative for notes that were already open).
    let docId = getCollabDocId(loroHandle.doc);

    // Bootstrap: for a freshly-imported note the sidecar does not exist yet.
    // The bundle import wrote collab_doc_id into the Note JSON. If it's present
    // and the Loro doc doesn't have one yet, seed the meta map with that exact id
    // so the sidecar derives the same room as the sender.
    if (!docId && note.collab_doc_id) {
      // Write the received id into the meta map (and commit) so the sidecar
      // carries it from this point forward. We use the internal doc.getMap API
      // directly (like doc-id.ts does) to set the exact id from the bundle.
      loroHandle.doc.getMap("meta").set("collab_doc_id", note.collab_doc_id);
      loroHandle.doc.commit({ message: "seed-collab-doc-id-from-import" });
      docId = note.collab_doc_id;
    }

    if (!docId) return; // unshared note, nothing to do

    // Shared note detected: auto-connect using the derived session credentials.
    collab.connectFromDocId(docId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loroHandle, collab.state.status, note.collab_doc_id, collabRevoked]);
  // Intentional: collab.connectFromDocId is stable (useCallback, no deps that
  // change after mount), and we only want this to fire when the handle opens
  // (loroHandle identity change) or the session returns to idle after a stop.

  // Phase 3c shared-collab: lazy collab bootstrap for shared-NOTEBOOK notes.
  //
  // Shared-notebook notes are created with `shared_with = pairingSharedWith(...)`
  // (both members at "edit") but they never go through the Share dialog's
  // onShared callback, so grantCollabOnShare is never called for them and they
  // never get a collab_doc_id or a server-side grant. Without those two things
  // the auto-connect effect above is a no-op (no docId -> no connect).
  //
  // This effect fills that gap: the FIRST time either member opens a shared-
  // notebook note with LORO_PILOT_ENABLED, it mints the collab_doc_id into the
  // shared Loro sidecar (in the creator's folder, readable+writable by both via
  // the FSA data folder) and grants both members on the server. The auto-connect
  // then fires via collab.connectFromDocId below (since the auto-connect effect
  // already ran and the session is still idle, we connect here directly).
  //
  // Guard conditions:
  //   - LORO_PILOT_ENABLED (flag off = no side effects)
  //   - loroHandle is open
  //   - note.notebook_id is set (shared-notebook note, not a personal note)
  //   - currentUser is known (for ownerEmail signing)
  //   - no collab_doc_id already in the Loro meta (first open only; subsequent
  //     opens will have it and fall through to the existing auto-connect effect)
  //   - collab session is idle (avoid racing a connecting/live session)
  //
  // Idempotent: grantCollabOnShare calls getOrMintCollabDocId (which only
  // mints when absent) and grantCollabMember (the server accepts duplicate
  // grants silently). If both members open simultaneously the second opener
  // sees the id already in the sidecar and skips the mint.
  //
  // FLAG (data-shape): writes collab_doc_id into the Loro meta map (the shared
  // sidecar at users/<creator>/.researchos/notes/<id>.loro). This is the same
  // data-shape as Phase 3c chunk 2 (same key, same semantics).
  useEffect(() => {
    if (!LORO_PILOT_ENABLED) return;
    if (!loroHandle) return;
    if (!note.notebook_id) return;
    if (!currentUser) return;
    if (collab.state.status !== "idle") return;
    // If there is already a collab_doc_id the auto-connect effect above handles
    // the connect; skip here to avoid a redundant grant/push on every open.
    if (getCollabDocId(loroHandle.doc)) return;

    // No collab_doc_id yet: this is the first open for this notebook note.
    // Mint + grant best-effort, then connect once the docId is available.
    void grantCollabOnShare({
      doc: loroHandle.doc,
      ownerEmail: myDirectoryEmail ?? "",
      // Treat the whole shared_with list as newly-added so both members and the
      // granting user (as "owner") get registered on the server.
      previousSharedWith: [],
      nextSharedWith: note.shared_with ?? [],
    }).then((docId) => {
      if (docId && collab.state.status === "idle") {
        collab.connectFromDocId(docId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loroHandle, note.notebook_id, currentUser]);
  // Intentional deps: fire when the handle opens (loroHandle identity change)
  // or the notebook association changes. collab.state.status and
  // collab.connectFromDocId are read inside the void-async body after the
  // initial guard; not listed as deps to avoid re-firing on every status flip
  // (the guard at the top of the effect short-circuits when collab is not idle).

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
  // Unified editor surface (UNIFIED_EDITOR_SURFACE_DESIGN.md §3B / §9, U2).
  // The note popup MODAL GROWS in place — same DOM, a CSS size transition on
  // the card (transition-all duration-300). Single-doc surface, so there is no
  // tab row to keep navigable. This single toggle is shared by the header
  // fullscreen button and the editor's own Focus button (via onRequestExpand).
  // It flushes the editor's in-flight buffer BEFORE growing (editorSaveRef
  // commits the CM6 block buffer + fires onChange) so no in-flight text is lost
  // across the size transition, and never remounts the editor subtree.
  // The editor's Focus button + Cmd/Ctrl+Shift+F route here via onRequestExpand.
  // The shell owns the actual toggle (and flushes the editor buffer first via
  // onBeforeToggleExpand = flushEditorBuffer below), so this just delegates.
  const toggleExpanded = useCallback(() => {
    shellToggleExpandRef.current();
  }, []);
  // The shell flushes the editor's in-flight buffer BEFORE growing / before
  // Done. Mirrors the old toggleExpanded's editorSaveRef flush.
  const flushEditorBuffer = useCallback(() => {
    try {
      editorSaveRef.current?.();
    } catch {
      // Best-effort flush; the editor keeps its own buffer if this throws.
    }
  }, []);
  // P7-2 transclusion normalize. Wired to InlineMarkdownEditor via LiveMarkdownEditor.
  // Awaited before persistEntryContent so the CM6 doc is rewritten BEFORE Loro flushes
  // or the legacy writer runs, ensuring persisted bytes carry the portable embed links.
  const editorNormalizeRef = useRef<(() => Promise<void>) | null>(null);

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
        // P7-2 transclusion normalize: rewrite any ![[Note#Heading]] in the
        // CM6 doc to the portable embed link BEFORE persisting, in both Loro
        // and legacy modes. The normalize dispatch flows through LoroSyncPlugin
        // so the CRDT doc reflects the rewritten content when flush() runs.
        // Best-effort: a failure (no editor mounted, or list unavailable) is
        // silently swallowed and the save proceeds with the raw text.
        await editorNormalizeRef.current?.();
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

  // True when the Loro pilot owns this note's content (flag on + handle ready).
  // In that mode the note auto-persists via the debounced commit; otherwise the
  // note follows the manual-save model. Hoisted here so the ambient indicator
  // and the unsaved-changes guard below share one definition.
  const loroActive = LORO_PILOT_ENABLED && !!loroHandle;

  // Unified editor surface (L3, continuous-surface shell). An HONEST ambient
  // save indicator derived ENTIRELY from the existing save/dirty state — no new
  // autosave loop, no change to the manual-save semantics underneath.
  //   - Loro pilot active: the note auto-persists via the debounced commit, so
  //     "Saving" while a commit is queued/in-flight, else "Saved".
  //   - Legacy (manual-save) note: tells the truth about the manual flow —
  //     "Saving" while an explicit save is in flight, "Unsaved changes" while
  //     the active entry (or its in-flight buffer) differs from disk, else
  //     "Saved". It NEVER reads "Saved" while there is unsaved content, so the
  //     ambient state can be trusted before the user clicks Done / closes.
  // Only consumed in the expanded shell; the docked popup keeps its existing
  // bars unchanged.
  const ambientSaveState: "saving" | "unsaved" | "saved" = loroActive
    ? loroCommitPending
      ? "saving"
      : "saved"
    : saving
      ? "saving"
      : hasUnsavedChanges || editorDirty
        ? "unsaved"
        : "saved";

  // Plain "Done" for the expanded shell: flush the active entry through the
  // EXISTING manual-save path (legacy note) then collapse back to the docked
  // popup. In Loro mode the debounced commit already persists, so Done just
  // collapses. No close, no new write path — just the existing save + the
  // collapse the user already had via the fullscreen toggle / Esc.
  // The shell's footer Done invokes this (the shell collapses itself after).
  const handleDone = useCallback(() => {
    if (!loroActive && !readOnly && activeTab) {
      const latest = editorSaveRef.current?.();
      const next =
        typeof latest === "string"
          ? latest
          : (entries.find((e) => e.id === activeTab)?.content ?? "");
      if (next !== (savedContentRef.current.get(activeTab) ?? "")) {
        void saveEntryContent(activeTab, next);
      }
    }
  }, [loroActive, readOnly, activeTab, entries, saveEntryContent]);

  // beforeunload guard. `onFlush` saves every pending entry synchronously via
  // the manual path, giving the in-flight write a fighting chance before the
  // browser tears down. The guard itself only triggers when `hasUnsavedEdits`
  // is true, so it does not prompt for clean closes.
  //
  // Auto-save (auto-save bot, 2026-06-05): under the Loro pilot there are no
  // "unsaved changes" to warn about (every edit auto-persists via the debounced
  // commit), so the beforeunload prompt is suppressed. We STILL call flush via
  // onFlush so any pending debounced commit is drained before the page unloads
  // (belt and suspenders alongside the close/unmount paths).
  const flushLoroOnUnload = useCallback(() => {
    if (loroHandle) void loroHandle.flush();
  }, [loroHandle]);
  useUnsavedChangesGuard(!loroActive && hasUnsavedEdits && !saving, {
    onFlush: loroActive ? flushLoroOnUnload : flushAllUnsaved,
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
        // P7-2 transclusion normalize: same contract as the explicit save.
        // Normalize any ![[Note#Heading]] in the active CM6 doc to the portable
        // embed link before flushing to Loro or the legacy writer. The dispatch
        // flows through LoroSyncPlugin so the CRDT content is already normalized
        // when flush() runs. Best-effort: a failure is silently ignored.
        await editorNormalizeRef.current?.();
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

  // Escape precedence (VCP Phase 1) now lives in CalmPopupShell's lifted state
  // machine. These ordered intermediate layers run BEFORE the shell shrinks a
  // fullscreen shell / closes: history first (exit history, return to the live
  // record), then comments. Each returns true if it consumed the press. The
  // shell's terminal close branch calls its `onClose` (= handleClose here), and
  // a focused text field still owns Escape inside the shell.
  const escapeLayers = useMemo<Array<() => boolean>>(
    () => [
      () => {
        if (historyOpen) {
          setHistoryOpen(false);
          setVersionPreview(null);
          focusWithoutTooltip(historyTriggerRef.current);
          return true;
        }
        return false;
      },
      () => {
        if (commentsOpen) {
          setCommentsOpen(false);
          return true;
        }
        return false;
      },
    ],
    [historyOpen, commentsOpen],
  );

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
  // never see this button (see the footer below). The old PI Phase 5
  // cross-owner delete path was removed with the PI edit-mode feature.
  const handleDeleteNote = async () => {
    if (!confirm("Are you sure you want to delete this entire note?")) return;

    try {
      await notesApi.delete(note.id, note.username || undefined);
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
  });

  // ── VC Phase 2: restore-a-version + 24h undo-restore ─────────────────────
  // The history file lives under the OWNER's folder; mirror the sidebar mount's
  // owner resolution exactly so reads/writes hit the same path.
  const historyOwner = note.username || currentUser || "";

  // canRestoreNoteVersion. Computed once here, passed to BOTH the sidebar
  // footer (Restore) and the header (Undo). We pass `propReadOnly` (NOT
  // `readOnly`, which also flips true while the history sidebar is open):
  // restoring is the whole point of having the sidebar open, so we must not
  // let `historyOpen` suppress the affordance.
  const canRestore = canRestoreNoteVersion({
    readOnly: propReadOnly,
    currentUser,
    noteOwner: note.username,
  });

  // The PI-passcode unlock path was removed; the affordance is simply hidden
  // for a read-only viewer who cannot write.
  const restoreNeedsUnlock = false;

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

  // Phase 2 chunk 4: Loro-backed history engine for the version-history sidebar.
  // Keyed on note.id + note.username (not the whole note object) so the memo
  // stays stable across content edits -- the history sidebar opens in read-only
  // preview mode, and a base captured at note-identity time is correct for
  // Loro doc reconstruction. When the flag is off, loroHistoryEngine is undefined
  // and the sidebar falls back to the legacy delta engine, unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loroHistoryEngine = useMemo(
    () => (LORO_PILOT_ENABLED ? makeLoroHistoryEngine(note) : undefined),
    // Intentionally keyed on note.id + note.username, not the full note object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note.id, note.username],
  );

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

  // Phase 2 chunk 5: Loro-path restore + undo, flag-gated.
  // When the flag is on and loroHandle is ready, onRestore and the undo
  // affordance call these instead of the legacy useVersionRestore handlers.
  // The legacy path is completely unchanged when the flag is off.
  const [loroRestoreBusy, setLoroRestoreBusy] = useState(false);

  // A Loro restore/undo rewrites the live doc's content but the bound editor
  // only reflects doc content when it RE-SEEDS (mount / entry-switch). Bumping
  // this key after a restore/undo remounts the editor so it re-seeds from the
  // doc, which (a) shows the restored/undone content and (b) starts clean (a
  // fresh seed is not dirty), so the redundant "Unsaved changes" after a restore
  // is gone too. Only bumped on the Loro path; stays 0 when the flag is off.
  const [loroEditorRemountKey, setLoroEditorRemountKey] = useState(0);

  const handleLoroRestore = useCallback(
    async (targetVersion: number) => {
      if (!loroHandle || loroRestoreBusy) return;
      setLoroRestoreBusy(true);
      try {
        const owner = note.username || currentUser || "";
        const result = await restoreLoroVersion(
          loroHandle,
          owner,
          note,
          targetVersion,
          currentUser ?? "",
        );
        // Clear any in-flight unsaved edits: the Loro doc is now the
        // authoritative source of truth for content after the restore.
        unsavedContentRef.current.clear();
        reflectRestoredNote(result);
        setLoroEditorRemountKey((k) => k + 1);
        closeHistory();
      } catch (err) {
        console.error("[NoteDetailPopup] Loro restore failed:", err);
      } finally {
        setLoroRestoreBusy(false);
      }
    },
    [loroHandle, loroRestoreBusy, note, currentUser, reflectRestoredNote, closeHistory],
  );

  const handleLoroUndoRestore = useCallback(async () => {
    if (!loroHandle || loroRestoreBusy) return;
    if (!note.revert_undo_window) return;
    setLoroRestoreBusy(true);
    try {
      const owner = note.username || currentUser || "";
      const result = await undoLoroRestore(
        loroHandle,
        owner,
        note,
        note.revert_undo_window.from_version,
        currentUser ?? "",
      );
      unsavedContentRef.current.clear();
      reflectRestoredNote(result);
      setLoroEditorRemountKey((k) => k + 1);
    } catch (err) {
      console.error("[NoteDetailPopup] Loro undo restore failed:", err);
    } finally {
      setLoroRestoreBusy(false);
    }
  }, [loroHandle, loroRestoreBusy, note, currentUser, reflectRestoredNote]);

  // Branched restore + undo handlers: Loro when flag+handle are ready,
  // legacy otherwise. The sidebar onRestore and the undo button use these.
  const activeHandleRestore =
    LORO_PILOT_ENABLED && loroHandle ? handleLoroRestore : handleRestore;
  const activeHandleUndoRestore =
    LORO_PILOT_ENABLED && loroHandle ? handleLoroUndoRestore : handleUndoRestore;
  const activeRestoreBusy =
    LORO_PILOT_ENABLED && loroHandle ? loroRestoreBusy : restoreBusy;

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

  // ── Unified Popup Chrome slots (UNIFIED_POPUP_CHROME_SPEC.md §2/§4) ─────────
  // The note's chrome is composed here as CalmPopupShell slots. The shell owns
  // the transparent header band, the Focus/Close glyphs, the footer, the calm
  // surface, the expand state, and the Escape machine; these slots carry the
  // note-specific content the shell places into the canonical anatomy.

  // .s-title: editable title + editable description (the description is content,
  // not metadata, so it rides with the title rather than the meta subline).
  const titleSlot = (
    <div className="min-w-0">
      {editingTitle ? (
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === "Enter" && saveTitle()}
          className={`font-bold text-foreground w-full focus:outline-none bg-transparent ${
            isExpanded
              ? "text-3xl leading-tight border-0 focus:ring-0 placeholder:text-foreground-muted/50"
              : "text-2xl border-b-2 border-sky-500"
          }`}
          autoFocus
          disabled={readOnly}
        />
      ) : (
        // Family hue: note = sky (writing). The accent marker sits on the
        // display title; editing shows the plain input.
        <h2
          onClick={() => !readOnly && setEditingTitle(true)}
          className={`ros-title-accent ros-accent-sky font-bold text-foreground ${
            isExpanded ? "text-3xl leading-tight" : "text-2xl"
          } ${
            !readOnly ? "cursor-pointer hover:brightness-95 dark:hover:brightness-110" : ""
          }`}
        >
          {title}
        </h2>
      )}
      {editingDescription ? (
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveDescription}
          onKeyDown={(e) => e.key === "Enter" && saveDescription()}
          placeholder="Add a description..."
          className="text-body text-foreground-muted w-full border-b-2 border-sky-500 focus:outline-none bg-transparent mt-1"
          autoFocus
          disabled={readOnly}
        />
      ) : (
        <p
          onClick={() => !readOnly && setEditingDescription(true)}
          className={`text-body text-foreground-muted mt-1 ${
            !readOnly ? "cursor-pointer hover:text-sky-600 dark:hover:text-sky-300" : ""
          }`}
        >
          {description || (!readOnly ? "Add a description..." : "")}
        </p>
      )}
    </div>
  );

  // .s-meta: ONE quiet "date · author · sharing" subline (C4), plus the inline
  // live-collab / phone / upload presence the old header subline carried.
  const metaSlot = note.username ? (
    <span data-testid="note-meta-subline" className="flex flex-wrap items-center gap-x-1.5">
      <span>
        {[
          formatDate(note.created_at || note.last_edited_at || ""),
          note.last_edited_by || note.username,
          (note.shared_with?.length ?? 0) > 0
            ? `Shared with ${note.shared_with!.length}`
            : "Private",
        ]
          .filter(Boolean)
          .join("  ·  ")}
      </span>
      {LORO_PILOT_ENABLED && !!loroHandle && collab.state.status === "connecting" && (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1 text-foreground-muted">
            <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Connecting
          </span>
        </span>
      )}
      {LORO_PILOT_ENABLED && !!loroHandle && collab.state.status === "live" && (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-300 font-medium">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="12" r="5" />
            </svg>
            Live
          </span>
        </span>
      )}
      {phonePaired && (
        <Tooltip label="Phone companion is paired" placement="bottom">
          <span className="inline-flex items-center gap-1">
            <span aria-hidden>·</span>
            <Icon name="phone" className="h-3.5 w-3.5" />
          </span>
        </Tooltip>
      )}
      {(uploading || saving) && (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {uploading ? "Uploading" : "Saving"}
          </span>
        </span>
      )}
    </span>
  ) : null;

  // Right-cluster lead: the PI role affordances (kept, not demoted).
  const headerLeadSlot = (
    <>
      {piGate.isPiEdit && !piGate.confirmed && (
        <PiEditButton memberName={note.username} onClick={piGate.beginEdit} />
      )}
      {piActive && <PiEditAuditNote memberName={note.username} className="mr-1" />}
      {note.username && (
        <PiActionsHeaderButton
          recordType="note"
          record={{ owner: note.username, id: note.id, flagged: !!note.flagged }}
          viewerUsername={currentUser}
          isLabHead={isLabHead}
          onEditAsPi={() => {}}
        />
      )}
      {canActAsLabHead && currentUser && note.username && (
        <FlagForReviewButton
          recordType="note"
          recordId={note.id}
          recordName={title}
          targetOwner={note.username}
          actor={currentUser}
          currentFlag={note.flagged ?? null}
        />
      )}
    </>
  );

  // .s-acts overflow: the single "..." menu. C2 demotes Comments + Delete into
  // it (alongside Share / Version history / Undo restore / Move to notebook /
  // Phone linked). Each row keeps its exact handler + data-testid.
  const overflowSlot = (
    <HeaderOverflowMenu
      label="More actions"
      testId="note-header-overflow"
      buttonClassName="iconbtn p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-sunken transition-colors"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setCommentsOpen((open) => {
            const next = !open;
            if (next) setHistoryOpen(false);
            return next;
          });
        }}
        data-testid="note-comments-button"
        aria-pressed={commentsOpen}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body text-foreground hover:bg-surface-sunken transition-colors"
      >
        <svg className="w-4 h-4 text-foreground-muted" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 8h10M7 12h6m-7 9l4-4h10a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h1v4z" />
        </svg>
        <span>
          {commentsOpen ? "Hide comments" : "Comments"}
          {commentCount > 0 ? ` (${commentCount})` : ""}
        </span>
      </button>
      {canShare && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            sharedWithBeforeShareRef.current = note.shared_with ?? [];
            setShowShare(true);
          }}
          data-testid="note-header-share"
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body text-foreground hover:bg-surface-sunken transition-colors"
        >
          <Icon name="share" className="w-4 h-4 text-foreground-muted" />
          <span>Share</span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        ref={historyTriggerRef}
        onClick={() => {
          if (historyOpen) {
            closeHistory();
          } else {
            setCommentsOpen(false);
            setHistoryOpen(true);
          }
        }}
        data-testid="note-history-button"
        aria-pressed={historyOpen}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body text-foreground hover:bg-surface-sunken transition-colors"
      >
        <Icon name="history" className="w-4 h-4 text-foreground-muted" />
        <span>Version history</span>
      </button>
      {RESTORE_ENABLED &&
        undoWindowActive &&
        (canRestore || restoreNeedsUnlock) && (
          <button
            type="button"
            role="menuitem"
            onClick={
              canRestore && !activeRestoreBusy ? activeHandleUndoRestore : undefined
            }
            disabled={!canRestore || activeRestoreBusy}
            data-testid="note-undo-restore-button"
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Icon name="undo" className="w-4 h-4" />
            <span>{activeRestoreBusy ? "Undoing..." : "Undo restore"}</span>
          </button>
        )}
      {onMoveToNotebook && !readOnly && (
        <button
          type="button"
          role="menuitem"
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMoveMenuAnchor({ x: rect.left, y: rect.bottom });
          }}
          data-testid="note-header-move-notebook"
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body text-foreground hover:bg-surface-sunken transition-colors"
        >
          <Icon name="book" className="w-4 h-4 text-foreground-muted" />
          <span>Move to notebook</span>
        </button>
      )}
      {canDeleteNote && (
        <button
          type="button"
          role="menuitem"
          onClick={handleDeleteNote}
          data-testid="note-header-delete"
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
        >
          <Icon name="trash" className="w-4 h-4" />
          <span>Delete note</span>
        </button>
      )}
      {phonePaired && (
        <HeaderOverflowLabel icon={<Icon name="phone" className="h-3.5 w-3.5" />}>
          Phone linked
        </HeaderOverflowLabel>
      )}
    </HeaderOverflowMenu>
  );

  // Always-visible band between header and body (never folded): the
  // revoked-access banner, provenance badge, flag banner, restore error, and
  // the in-app undo confirm. Kept out of the scroll body so they stay visible.
  const beforeBodySlot = (
    <div className="px-6 space-y-2 empty:hidden">
      {collabRevoked && (
        <div className="-mx-6 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-y border-amber-200 dark:border-amber-900/60">
          <p className="text-meta text-amber-800 dark:text-amber-200 leading-relaxed">
            Your live access to this shared note was revoked by the owner. You
            have a read-only copy.
          </p>
        </div>
      )}
      {note.received_from && (
        <div>
          <ReceivedFromBadge
            receivedFrom={note.received_from}
            fingerprint={note.received_from_fingerprint}
            receivedAt={note.received_at}
          />
          {EXTERNAL_COLLAB_ENABLED && note.received_from && (
            <button
              type="button"
              onClick={() =>
                senderBlocked
                  ? unblockSender(note.received_from)
                  : blockSender(note.received_from)
              }
              className="mt-1.5 ml-2 text-meta text-foreground-muted hover:text-foreground underline underline-offset-2"
            >
              {senderBlocked ? "Unblock this sender" : "Block this sender"}
            </button>
          )}
        </div>
      )}
      {note.flagged && note.username && (
        <FlagBanner
          flag={note.flagged}
          recordType="note"
          recordId={note.id}
          owner={note.username}
          activeUser={currentUser}
        />
      )}
      {restoreError && (
        <p
          data-testid="note-restore-error"
          className="text-meta text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2 leading-snug"
        >
          {restoreError}
        </p>
      )}
      {undoConfirmPending && (
        <div
          data-testid="note-undo-confirm"
          className="text-meta text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2 leading-snug"
        >
          <p>
            You have edited this note since the restore. Undoing will discard
            those edits and return the note to its pre-restore state.
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
              className="px-2.5 py-1 text-meta font-medium text-foreground-muted bg-surface-sunken hover:bg-foreground-muted/15 disabled:opacity-60 rounded-md transition-colors"
            >
              Keep editing
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
    <FileRenamePopup />
    <DuplicateDialog />
    {/* PI capability revamp: the once-per-session confirm a lab head crosses
        before editing this member's note. LivingPopup portals itself. */}
    <PiEditConfirmDialog
      open={piGate.confirmDialogOpen}
      memberName={note.username ?? null}
      recordLabel={title ? `note ${title}` : "note"}
      onConfirm={piGate.confirmEdit}
      onCancel={piGate.cancelEdit}
    />
    <CalmPopupShell
      open
      onClose={handleCloseAll}
      label="Note"
      title={titleSlot}
      meta={metaSlot}
      headerLead={headerLeadSlot}
      overflow={overflowSlot}
      beforeBody={beforeBodySlot}
      footer={{
        saveState: ambientSaveState,
        saveTestId: "note-ambient-save",
        onDone: handleDone,
        doneTestId: "note-done",
      }}
      onBeforeToggleExpand={flushEditorBuffer}
      onExpandedChange={setIsExpanded}
      // Bridge the shell's flush-then-toggle to the editor's onRequestExpand
      // (toggleExpanded delegates to shellToggleExpandRef.current).
      expandToggleRef={shellToggleExpandRef}
      closeTourTarget="lab-mode-note-popup-close"
      dockedWidthClassName="max-w-4xl"
      dragRingTarget
      escapeLayers={escapeLayers}
    >
        <div className="flex-1 overflow-hidden flex flex-row min-h-0">
        {/* Hidden file input kept mounted: the editor's quiet "+" Add File menu
            routes uploads to handleFileUpload via onFileDrop. */}
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
        {/* Content area (document column) */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {/* Tabs for running logs. Unified Popup Chrome C1: the seam is gone at
              BOTH sizes so the entry tabs sit on the one continuous calm
              surface, not a banded strip. */}
          {note.is_running_log && (
            <div className="px-4 py-2 flex-shrink-0">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {entries
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => switchToTab(entry.id)}
                      className={`px-3 py-1.5 rounded-lg text-body whitespace-nowrap border transition-colors ${
                        activeTab === entry.id
                          ? "bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 font-medium border-sky-300 dark:border-sky-500/40"
                          : "bg-surface-raised text-foreground border-border hover:bg-surface-sunken hover:border-foreground-muted/40"
                      }`}
                    >
                      {entry.title}
                    </button>
                  ))}

                {/* Add entry button */}
                {!readOnly && (
                  <button
                    onClick={() => setShowNewEntryForm(true)}
                    className="px-3 py-1.5 rounded-lg text-body border border-dashed border-border text-foreground-muted hover:text-foreground hover:bg-surface-sunken hover:border-foreground-muted/40 transition-colors flex items-center gap-1"
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
            <div className="border-b border-border px-4 py-3 bg-surface-sunken flex-shrink-0">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={newEntryTitle}
                  onChange={(e) => setNewEntryTitle(e.target.value)}
                  placeholder="Entry title..."
                  className="flex-1 px-3 py-2 border border-border rounded-lg focus:outline-none focus:border-sky-500"
                  autoFocus
                />
                <input
                  type="date"
                  value={newEntryDate}
                  onChange={(e) => setNewEntryDate(e.target.value)}
                  className="px-3 py-2 border border-border rounded-lg focus:outline-none focus:border-sky-500"
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
                  className="px-4 py-2 bg-foreground-muted/15 text-foreground rounded-lg hover:bg-foreground-muted/25 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Entry info bar. Unified Popup Chrome C1: the seam + tinted strip are
              gone at both sizes so the entry meta sits on the one continuous calm
              surface. A hairline keeps the editor zone visually distinct. */}
          {note.is_running_log && currentEntry && (
            <div className="px-4 py-2 flex items-center justify-between flex-shrink-0 border-b border-border/40">
              <div className="flex items-center gap-3">
                {/* Entry title - editable */}
                {editingEntryTitle ? (
                  <input
                    type="text"
                    value={entryTitle}
                    onChange={(e) => setEntryTitle(e.target.value)}
                    onBlur={saveEntryTitle}
                    onKeyDown={(e) => e.key === "Enter" && saveEntryTitle()}
                    className="text-body font-medium text-foreground border-b-2 border-sky-500 focus:outline-none bg-transparent"
                    autoFocus
                    disabled={readOnly}
                  />
                ) : (
                  <span
                    onClick={startEditingEntryTitle}
                    className={`text-body font-medium text-foreground ${
                      !readOnly ? "cursor-pointer hover:text-sky-600 dark:hover:text-sky-300" : ""
                    }`}
                    title={!readOnly ? "Click to edit title" : ""}
                  >
                    {currentEntry.title}
                  </span>
                )}
                <span className="text-foreground-muted">|</span>
                {/* Entry date - editable */}
                {editingEntryDate ? (
                  <input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    onBlur={saveEntryDate}
                    onKeyDown={(e) => e.key === "Enter" && saveEntryDate()}
                    className="text-body text-foreground-muted border-b-2 border-sky-500 focus:outline-none bg-transparent"
                    autoFocus
                    disabled={readOnly}
                  />
                ) : (
                  <span
                    onClick={startEditingEntryDate}
                    className={`text-body text-foreground-muted ${
                      !readOnly ? "cursor-pointer hover:text-sky-600 dark:hover:text-sky-300" : ""
                    }`}
                    title={!readOnly ? "Click to edit date" : ""}
                  >
                    {formatDate(currentEntry.date)}
                  </span>
                )}
                <span className="text-meta text-foreground-muted">
                  Updated: {formatDate(currentEntry.updated_at)}
                </span>
              </div>
              {!readOnly && entries.length > 1 && (
                <button
                  onClick={() => deleteEntry(currentEntry.id)}
                  className="text-meta text-red-500 dark:text-red-300 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                >
                  Delete Entry
                </button>
              )}
            </div>
          )}

          {/* Unified Popup Chrome C5/D2 (2026-06-14): the persistent docked
              "Save note" toolbar band is RETIRED. The shell's footer now carries
              the honest ambient save state ("Saved" / "Unsaved changes" /
              "Saving") AND the plain Done at BOTH docked and fullscreen, and Done
              flushes the active entry through the EXACT same manual-save path
              this band used (editorSaveRef + saveEntryContent, also reachable via
              Cmd+S onExplicitSave, tab-switch flush, and the close flush). So no
              persistence is lost; only the redundant band goes away, giving the
              editor its full height at every size. The legacy/Loro split no
              longer matters here because the footer indicator is honest for both.
              note-save tour target retired with the v4 walkthrough teardown. */}

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
              <div className="flex items-center justify-center h-full text-foreground-muted text-body p-6">
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
                  <div className="flex items-center justify-center h-full text-foreground-muted text-body p-6">
                    <p>Loading editor...</p>
                  </div>
                ) : (
                <LiveMarkdownEditor
                  // Remount (re-seed from the Loro doc) after a restore/undo.
                  key={`note-editor-${loroEditorRemountKey}`}
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
                  // Unified editor surface (UNIFIED_EDITOR_SURFACE_DESIGN.md §9,
                  // U2): the editor's Focus button grows the POPUP (same DOM,
                  // CSS size transition) instead of teleporting into its own
                  // body-level overlay. The popup flushes the editor buffer
                  // (editorSaveRef) before growing.
                  onRequestExpand={toggleExpanded}
                  expanded={isExpanded}
                  // Loro pilot props (forwarded to InlineMarkdownEditor; absent = no-op).
                  loroHandle={LORO_PILOT_ENABLED ? (loroHandle ?? undefined) : undefined}
                  loroEntryIndex={LORO_PILOT_ENABLED ? entries.findIndex((e) => e.id === activeTab) : undefined}
                  loroBaseNote={LORO_PILOT_ENABLED ? note : undefined}
                  // Phase 3 chunk 5a: live collab cursors. Only active when a
                  // session is live AND the pilot flag is on. Absent = sync-only,
                  // no regression for single-user editing or the undo behavior.
                  collabEphemeral={collabActive ? collab.ephemeral : undefined}
                  collabUser={collabActive ? collabUser : undefined}
                  // Markdown embed hybrid P7-1a: per-note embed-pins sidecar.
                  embedPinContext={embedPinContext}
                  // P7-2 transclusion normalize: awaited before persist.
                  normalizeRef={editorNormalizeRef}
                  // Chemistry Phase 3: reference picker (molecule / sequence / method).
                  enableReferencePicker
                />
                )
              ) : (
                <div className="flex items-center justify-center h-full text-foreground-muted">
                  <p>No entries yet. Click &quot;Add Entry&quot; to get started.</p>
                </div>
              )
            ) : (
              // Single note - use the first (and only) entry
              entries[0] && (
                loroOpening ? (
                  <div className="flex items-center justify-center h-full text-foreground-muted text-body p-6">
                    <p>Loading editor...</p>
                  </div>
                ) : (
                <LiveMarkdownEditor
                  // Remount (re-seed from the Loro doc) after a restore/undo.
                  key={`note-editor-${loroEditorRemountKey}`}
                  value={entries[0].content}
                  // Pass the stable updateEntryContent identity straight through
                  // rather than a fresh inline arrow each render. A new onChange
                  // identity every render is the feed for an infinite-render
                  // loop in the editor's broken-image scan. updateEntryContent
                  // already early-returns when activeTab is empty, so the old
                  // entries[0] guard was redundant. The running-log branch above
                  // already forwards it the same way.
                  onChange={updateEntryContent}
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
                  // Unified editor surface (UNIFIED_EDITOR_SURFACE_DESIGN.md §9,
                  // U2): the editor's Focus button grows the POPUP (same DOM,
                  // CSS size transition) instead of teleporting into its own
                  // body-level overlay. The popup flushes the editor buffer
                  // (editorSaveRef) before growing.
                  onRequestExpand={toggleExpanded}
                  expanded={isExpanded}
                  // Loro pilot props (forwarded to InlineMarkdownEditor; absent = no-op).
                  loroHandle={LORO_PILOT_ENABLED ? (loroHandle ?? undefined) : undefined}
                  loroEntryIndex={LORO_PILOT_ENABLED ? 0 : undefined}
                  loroBaseNote={LORO_PILOT_ENABLED ? note : undefined}
                  // Phase 3 chunk 5a: live collab cursors (see running-log branch).
                  collabEphemeral={collabActive ? collab.ephemeral : undefined}
                  collabUser={collabActive ? collabUser : undefined}
                  // Markdown embed hybrid P7-1a: per-note embed-pins sidecar.
                  embedPinContext={embedPinContext}
                  // P7-2 transclusion normalize: awaited before persist.
                  normalizeRef={editorNormalizeRef}
                  // Chemistry Phase 3: reference picker.
                  enableReferencePicker
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
            onRestore={activeHandleRestore}
            // Phase 2 chunk 4: when the flag is on, drive the sidebar from the
            // Loro native history instead of the legacy delta store. undefined
            // when flag is off (legacy engine used, unchanged).
            engine={loroHistoryEngine}
          />
        )}

        {/* Comments thread (#13): now a docked right rail (like the history
            sidebar) instead of a full-width block below the editor. Visible in
            both lab mode (readOnly=true) and regular mode so the note's owner can
            see PI feedback. The thread itself gates whether commenting is on. */}
        {commentsOpen && (
          <CommentsSidebar count={commentCount} onClose={() => setCommentsOpen(false)}>
            <NoteCommentsThread note={note} variant="sidebar" autoFocusComposer={initialCommentsOpen} />
          </CommentsSidebar>
        )}
        </div>
    </CalmPopupShell>
    {moveMenuAnchor && onMoveToNotebook && (
      <MoveToNotebookMenu
        x={moveMenuAnchor.x}
        y={moveMenuAnchor.y}
        currentNotebookId={note.notebook_id}
        myNotebooks={myNotebooks}
        sharedNotebooks={sharedNotebooks}
        currentUser={moveCurrentUser}
        onMove={(notebookId) => onMoveToNotebook(notebookId)}
        onClose={() => setMoveMenuAnchor(null)}
      />
    )}
    {/* Share dialog. Now on LivingPopup itself, so it joins the shared popup
        stack (single dim, no double-scrim) and, rendered AFTER the host popup,
        paints above it by DOM order. No z-index wrapper needed. */}
    {showShare && currentUser && (
      <UnifiedShareDialog
        isOpen
        target={{ kind: "note", note, owner: currentUser }}
        onClose={() => setShowShare(false)}
        onShared={() => {
          // Refetch the note so the chips + provenance reflect the new ACL.
          notesApi.get(note.id).then((updated) => {
            if (updated) {
              onUpdate(updated);
              // Phase 3c chunk 2: grant newly-added members on the collab server
              // so their openCollabDoc call succeeds. Best-effort, never throws.
              if (LORO_PILOT_ENABLED && loroHandle && currentUser) {
                void grantCollabOnShare({
                  doc: loroHandle.doc,
                  ownerEmail: myDirectoryEmail ?? "",
                  previousSharedWith: sharedWithBeforeShareRef.current,
                  nextSharedWith: updated.shared_with ?? [],
                }).then((docId) => {
                  // Go live right after sharing, not only on reopen. Minting the
                  // doc id does not change the auto-connect effect's deps, so
                  // trigger the connect here when the session is still idle.
                  if (docId && collab.state.status === "idle") {
                    collab.connectFromDocId(docId);
                  }
                });
              }
            }
          });
        }}
      />
    )}
    </>
  );
}
