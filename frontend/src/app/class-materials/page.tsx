"use client";

// Class Mode (CT-1): the SHARED CLASS MATERIALS surface. An instructor-only,
// class-only page that lists the instructor's OWN notes that are shared to the
// whole class (the WHOLE_LAB_SENTINEL "*" in shared_with, relabeled "whole
// class" in the share dialog, same underlying grant). Each row carries a
// "Shared with class / Private" toggle that flips the "*" entry on or off
// through the EXISTING whole-lab grant write (sharingApi.shareNote). This is a
// filtered VIEW over existing data, not a new store; there is no new "is class
// material" flag.
//
// v1 scope: NOTES (and, by extension, any record the instructor authored that
// carries shared_with and materializes to students via the C1 pull). Raw files
// have no ACL of their own, so a file travels inside its parent note. Sequences
// are excluded from the in-lab share tab today (UnifiedShareDialog), so
// whole-class sequence sharing is a documented FOLLOW-UP, not built here.
//
// Mounting: AppShell adds the "Class Materials" nav entry ONLY when
// useIsClassMode is true (CLASS_MATERIALS_HREF in class-chrome.ts). With
// NEXT_PUBLIC_CLASS_MODE off no folder is a class, so the entry never mounts and
// this page is unreachable from the nav, keeping flag-off parity. The page
// itself also gates on useIsClassMode so a direct URL hit by a non-instructor
// shows the not-a-class state instead of the panel.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/AppShell";
import Tooltip from "@/components/Tooltip";
import { notesApi, sharingApi } from "@/lib/local-api";
import type { Note } from "@/lib/types";
import {
  WHOLE_LAB_SENTINEL,
  normalizeSharedWith,
  upsertSharedEntry,
  removeSharedEntry,
  isWholeLabShared,
} from "@/lib/sharing/unified";
import { filterOwnClassMaterials } from "@/lib/lab/class-materials";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useIsClassMode } from "@/hooks/useIsClassMode";

// A note's owner stamp lives on `username` (creator-attribution), which the
// store also uses to route the owner folder. The class-materials filter keys on
// a generic `owner`, so we map it here.
function noteOwner(note: Note): string {
  return (note as { owner?: string }).owner ?? note.username ?? "";
}

export default function ClassMaterialsPage() {
  const { currentUser } = useFileSystem();
  const classMode = useIsClassMode(currentUser ?? null);
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["class-materials", "notes"],
    queryFn: () => notesApi.list(),
    // Only fetch once we know this is a class the viewer instructs.
    enabled: classMode === true,
  });

  // The instructor's own notes shared to the whole class. A filtered view over
  // the note list; the "*" grant is the source of truth.
  const materials = useMemo(() => {
    if (!currentUser) return [];
    const candidates = notes.map((n) => ({
      ...n,
      owner: noteOwner(n),
    }));
    return filterOwnClassMaterials(candidates, currentUser);
  }, [notes, currentUser]);

  // Toggle the "*" entry on a note's shared_with through the existing whole-lab
  // grant write. Adding "*" defaults to read-only (the same default the share
  // dialog's whole-lab toggle uses). Removing "*" leaves any explicit per-person
  // entries intact. Persisted via sharingApi.shareNote, which dual-writes the
  // legacy is_shared boolean.
  const toggleShared = async (note: Note, share: boolean) => {
    setBusyId(note.id);
    setError(null);
    try {
      const current = normalizeSharedWith(note.shared_with ?? []);
      // normalizeSharedWith / upsert / remove all return NormalizedSharedUser
      // (definite `level`), so the recipients shareNote wants are exact.
      const next = share
        ? upsertSharedEntry(current, WHOLE_LAB_SENTINEL, "read")
        : removeSharedEntry(current, WHOLE_LAB_SENTINEL);
      await sharingApi.shareNote(
        note.id,
        next.map((s) => ({ username: s.username, level: s.level })),
      );
      await queryClient.invalidateQueries({
        queryKey: ["class-materials", "notes"],
      });
    } catch (err) {
      console.error("[class-materials] toggle failed", err);
      setError(
        (err as { message?: string })?.message ??
          "Could not update sharing. Try again.",
      );
    } finally {
      setBusyId(null);
    }
  };

  // The full own-note list (shared + private) so the instructor can promote a
  // private note INTO class materials, not just demote one. Materials above is
  // the shared subset; this is every own note for the "add a material" picker.
  const ownNotes = useMemo(() => {
    if (!currentUser) return [];
    return notes.filter((n) => noteOwner(n) === currentUser);
  }, [notes, currentUser]);

  const privateOwnNotes = useMemo(
    () => ownNotes.filter((n) => !isWholeLabShared(n.shared_with ?? [])),
    [ownNotes],
  );

  // Loading the class-mode answer: suppress the surface until it settles so we
  // never flash the not-a-class state for an instructor.
  if (classMode === undefined) {
    return (
      <AppShell>
        <div className="p-6 text-foreground-muted">Loading…</div>
      </AppShell>
    );
  }

  if (classMode === false) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto p-6">
          <h1 className="text-heading font-semibold text-foreground mb-2">
            Class Materials
          </h1>
          <p className="text-body text-foreground-muted">
            This page is for an instructor of a class folder. The active folder
            is not a class you instruct.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto p-6" data-testid="class-materials-page">
        <header className="mb-6">
          <h1 className="text-heading font-semibold text-foreground">
            Class Materials
          </h1>
          <p className="text-body text-foreground-muted mt-1">
            Notes you share to the whole class. Every student in this class sees
            a shared note. Files and images travel inside the note you attach
            them to.
          </p>
        </header>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
            <p className="text-body text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Shared materials */}
        <section className="mb-8">
          <h2 className="text-body font-medium text-foreground mb-2">
            Shared with the class ({materials.length})
          </h2>
          {isLoading ? (
            <p className="text-meta text-foreground-muted">Loading…</p>
          ) : materials.length === 0 ? (
            <p className="text-meta text-foreground-muted italic">
              You have not shared any notes with the class yet. Share a note
              below to make it visible to every student.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="class-materials-shared-list">
              {materials.map((note) => (
                <li
                  key={note.id}
                  className="bg-surface-sunken rounded-lg px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-body font-medium text-foreground">
                      {note.title || "Untitled note"}
                    </p>
                    <p className="text-meta text-emerald-700 dark:text-emerald-300">
                      Shared with class
                    </p>
                  </div>
                  <Tooltip label="Make this note private again" placement="left">
                    <button
                      type="button"
                      disabled={busyId === note.id}
                      onClick={() => toggleShared(note, false)}
                      className="ros-btn-raise shrink-0 px-3 py-1.5 rounded-lg border border-border text-body font-medium text-foreground hover:bg-surface-raised disabled:opacity-50"
                      data-testid={`class-material-unshare-${note.id}`}
                    >
                      {busyId === note.id ? "Saving…" : "Make private"}
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Promote a private note into class materials */}
        <section>
          <h2 className="text-body font-medium text-foreground mb-2">
            Share another note
          </h2>
          {isLoading ? (
            <p className="text-meta text-foreground-muted">Loading…</p>
          ) : privateOwnNotes.length === 0 ? (
            <p className="text-meta text-foreground-muted italic">
              Every note you own is already shared with the class.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="class-materials-private-list">
              {privateOwnNotes.map((note) => (
                <li
                  key={note.id}
                  className="bg-surface-sunken rounded-lg px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-body font-medium text-foreground">
                      {note.title || "Untitled note"}
                    </p>
                    <p className="text-meta text-foreground-muted">Private</p>
                  </div>
                  <Tooltip label="Share with every student" placement="left">
                    <button
                      type="button"
                      disabled={busyId === note.id}
                      onClick={() => toggleShared(note, true)}
                      className="ros-btn-raise shrink-0 px-3 py-1.5 rounded-lg bg-brand-action text-white text-body font-medium hover:bg-brand-action/90 disabled:opacity-50"
                      data-testid={`class-material-share-${note.id}`}
                    >
                      {busyId === note.id ? "Saving…" : "Share with class"}
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
