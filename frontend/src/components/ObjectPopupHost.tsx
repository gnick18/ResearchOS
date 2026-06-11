"use client";

// Root popup host (ai popup-host bot, 2026-06-11).
//
// Mounts ONCE at the root (in app/layout.tsx, inside Providers, above the
// BeakerBot dock). Subscribes to the object-popup-bridge bus so any caller --
// ObjectChip, a BeakerBot tool result, or any future surface -- can open an
// item's popup in place without knowing which page is currently rendered.
//
// Scope: notes open as real popups. All other ObjectRefType values
// (method, sequence, datahub, molecule, project, file, collection) fall back to
// navigation via objectDeepLink + requestNavigation, so every type does
// something sensible even before their popups are built.
//
// Tasks and experiments use a separate deep-link mechanism (?openTask= on /)
// and are NOT part of ObjectRefType, so they are not handled here. They
// continue to open via the existing ?openTask= path on the home page.
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
import { PopupActionsProvider } from "@/lib/lab-overview/popup-actions";
import { notesApi } from "@/lib/local-api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import { objectDeepLink } from "@/lib/references";
import {
  useObjectPopupBridge,
  type ObjectRef,
} from "@/components/ai/object-popup-bridge";

// -----------------------------------------------------------------------
// Types that are popup-capable in this pass. Other types navigate.
// -----------------------------------------------------------------------

/** The object types that open as a real popup in this host. All others fall
 *  back to navigation so every type does something sensible. "note" is the
 *  only type wired in this pass. */
const POPUP_CAPABLE_TYPES = new Set(["note"]);

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

  // Note ids are numeric; guard against a malformed ref.
  const numericId = parseInt(openRef.id, 10);
  if (Number.isNaN(numericId)) {
    requestNavigation(objectDeepLink(openRef.type, openRef.id));
    setOpenRef(null);
    return null;
  }

  if (openRef.type === "note") {
    return <NotePopup noteId={numericId} onClose={close} />;
  }

  // Fallback (should not reach here given POPUP_CAPABLE_TYPES gate above).
  requestNavigation(objectDeepLink(openRef.type, openRef.id));
  setOpenRef(null);
  return null;
}
