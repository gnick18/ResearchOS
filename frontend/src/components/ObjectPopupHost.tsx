"use client";

// Root popup host (ai popup-host bot, 2026-06-11).
//
// Mounts ONCE at the root (in app/layout.tsx, inside Providers, above the
// BeakerBot dock). Subscribes to the object-popup-bridge bus so any caller --
// ObjectChip, a BeakerBot tool result, or any future surface -- can open an
// item's popup in place without knowing which page is currently rendered.
//
// Scope: notes, tasks, and experiments open as real popups. All other
// ObjectRefType values (method, sequence, datahub, molecule, project, file,
// collection) fall back to navigation via objectDeepLink + requestNavigation,
// so every type does something sensible even before their popups are built.
//
// Why task and experiment share the same popup component: experiments are Task
// records with task_type = "experiment". There is no separate data model or
// component. The chip type distinction ("task" vs "experiment") tells the user
// what kind of entry it is, but the popup is identical.
//
// Task id encoding: the ObjectRef.id is the composite taskKey ("self:<numericId>"
// for own tasks, "<owner>:<numericId>" for shared tasks). The host parses this
// back to a numeric id and optional owner string for tasksApi.get. Older bare
// numeric string ids (from pre-taskKey callers) still work -- parseTaskRef
// treats a string that does not contain ":" as a bare numeric id.
//
// Why no-op onUpdate / onDelete on NoteDetailPopup: the popup writes all
// mutations directly through notesApi (no lifted state, no React Query cache).
// onUpdate and onDelete exist so a PARENT LIST can stay in sync. From the root
// host there is no parent list; onUpdate is a no-op and onDelete closes the
// popup. The note the user is reading is always fresh because it was loaded by
// id right before mount.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import NoteDetailPopup from "@/components/NoteDetailPopup";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import { PopupActionsProvider } from "@/lib/lab-overview/popup-actions";
import { notesApi, tasksApi } from "@/lib/local-api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import { objectDeepLink } from "@/lib/references";
import {
  useObjectPopupBridge,
  POPUP_CAPABLE_TYPES,
  type ObjectRef,
} from "@/components/ai/object-popup-bridge";

// -----------------------------------------------------------------------
// Task id parsing
// -----------------------------------------------------------------------

/** Parse the composite taskKey back to a numeric id and optional owner.
 *  The key format is "self:<numericId>" (own task) or "<owner>:<numericId>"
 *  (shared task). A bare numeric string (legacy callers) maps to own task. */
function parseTaskRef(compositeId: string): { numericId: number; owner?: string } | null {
  const colon = compositeId.indexOf(":");
  if (colon === -1) {
    // Legacy bare numeric id.
    const n = parseInt(compositeId, 10);
    return Number.isFinite(n) ? { numericId: n } : null;
  }
  const ns = compositeId.slice(0, colon);
  const rest = compositeId.slice(colon + 1);
  const n = parseInt(rest, 10);
  if (!Number.isFinite(n)) return null;
  // "self" namespace = own task, no owner override needed.
  return ns === "self" ? { numericId: n } : { numericId: n, owner: ns };
}

// -----------------------------------------------------------------------
// Note loader (uses React Query so the result is cached)
// -----------------------------------------------------------------------

function useNote(id: number | null) {
  return useQuery({
    queryKey: ["object-popup-note", id],
    queryFn: async () => {
      if (id === null) return null;
      return notesApi.get(id);
    },
    enabled: id !== null,
    // Do not refetch aggressively. The popup loads once and the user may be
    // editing inside it; a background refetch would clobber the local state
    // in NoteDetailPopup which manages its own editing state from the initial
    // note prop.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

// -----------------------------------------------------------------------
// Task loader (uses React Query so the result is cached)
// -----------------------------------------------------------------------

function useTask(numericId: number | null, owner?: string) {
  return useQuery({
    queryKey: ["object-popup-task", numericId, owner ?? "self"],
    queryFn: async () => {
      if (numericId === null) return null;
      return tasksApi.get(numericId, owner);
    },
    enabled: numericId !== null,
    // Mirror the note loader: do not refetch aggressively while the popup is
    // open. TaskDetailPopup manages its own editing state from the initial prop.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

// -----------------------------------------------------------------------
// Note popup renderer
// -----------------------------------------------------------------------

function NotePopup({
  noteId,
  onClose,
}: {
  noteId: number;
  onClose: () => void;
}) {
  const { data: note, isLoading } = useNote(noteId);

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }

  if (!note) {
    // The note was deleted or not found. Close quietly rather than showing
    // an error popup the user would need to dismiss.
    onClose();
    return null;
  }

  return (
    <PopupActionsProvider closePopup={onClose}>
      <NoteDetailPopup
        note={note}
        onClose={onClose}
        // onUpdate from the root host is a no-op: the popup writes through
        // notesApi directly; this callback only matters for a parent list
        // that wants to stay in sync. No list is open here.
        onUpdate={() => {}}
        // onDelete closes the popup. The popup already called notesApi.delete
        // before it fires this callback, so the record is already gone.
        onDelete={() => onClose()}
      />
    </PopupActionsProvider>
  );
}

// -----------------------------------------------------------------------
// Task popup renderer (also used for experiments, same component)
// -----------------------------------------------------------------------

function TaskPopup({
  compositeId,
  onClose,
}: {
  compositeId: string;
  onClose: () => void;
}) {
  const parsed = parseTaskRef(compositeId);
  const { data: task, isLoading } = useTask(
    parsed?.numericId ?? null,
    parsed?.owner,
  );

  if (!parsed) {
    // Malformed id -- close quietly and fall back to navigation.
    onClose();
    return null;
  }

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }

  if (!task) {
    // The task was deleted or not found. Close quietly.
    onClose();
    return null;
  }

  return (
    <TaskDetailPopup
      task={task}
      // project is optional on TaskDetailPopup. The host does not load projects
      // (it would need a second async fetch). The popup gracefully shows "—"
      // for the project name when no project object is passed.
      onClose={onClose}
    />
  );
}

// -----------------------------------------------------------------------
// The host
// -----------------------------------------------------------------------

export default function ObjectPopupHost() {
  const [openRef, setOpenRef] = useState<ObjectRef | null>(null);

  const close = useCallback(() => setOpenRef(null), []);

  // Register on the bus once. Any call to openObjectPopup() from anywhere in
  // the app (ObjectChip, a tool result, etc.) arrives here. Non-popup types
  // are redirected to navigation so the host never fails silently.
  useObjectPopupBridge(
    useCallback(
      (ref: ObjectRef) => {
        if (POPUP_CAPABLE_TYPES.has(ref.type)) {
          setOpenRef(ref);
        } else {
          // Navigate as the universal fallback for types without a popup.
          requestNavigation(objectDeepLink(ref.type, ref.id));
        }
      },
      [],
    ),
  );

  if (!openRef) return null;

  if (openRef.type === "note") {
    // Note ids are plain numeric strings.
    const numericId = parseInt(openRef.id, 10);
    if (Number.isNaN(numericId)) {
      requestNavigation(objectDeepLink(openRef.type, openRef.id));
      setOpenRef(null);
      return null;
    }
    return <NotePopup noteId={numericId} onClose={close} />;
  }

  if (openRef.type === "task" || openRef.type === "experiment") {
    // Task/experiment ids are composite taskKey strings ("self:<n>" or
    // "<owner>:<n>"). TaskPopup handles the parsing.
    return <TaskPopup compositeId={openRef.id} onClose={close} />;
  }

  // Fallback (should not reach here given POPUP_CAPABLE_TYPES gate above).
  requestNavigation(objectDeepLink(openRef.type, openRef.id));
  setOpenRef(null);
  return null;
}
