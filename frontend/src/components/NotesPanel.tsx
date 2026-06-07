"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notesApi, labApi, notebooksApi } from "@/lib/local-api";
import type { Note, NoteCreate, LabNote, SharedNotebook, Notebook } from "@/lib/types";
import NoteCard from "./NoteCard";
import NoteListRow from "./NoteListRow";
import NoteDetailPopup from "./NoteDetailPopup";
import ContextMenu from "./ContextMenu";
import { emitNoteDeleted } from "@/lib/notes/delete-toast-bus";
import SharedNotebookView from "./notebooks/SharedNotebookView";
import StartSharedNotebookDialog from "./notebooks/StartSharedNotebookDialog";
import NotebookRail, { type RailSelection } from "./notebooks/NotebookRail";
import NotebookFormDialog from "./notebooks/NotebookFormDialog";
import AddNotebookMemberDialog from "./notebooks/AddNotebookMemberDialog";
import MoveToNotebookMenu from "./notebooks/MoveToNotebookMenu";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import Tooltip from "./Tooltip";

// Notes scale controls (notes-scale bot, 2026-06-02). The Notes tab is a
// pleasant card grid at 7 notes but becomes an unnavigable sea of cards at
// 700 over years. These small controls — a grid/list view toggle, a sort
// order, a month group-by, a "Shared with lab" filter, and an incremental
// "Show more" window — keep the surface navigable at scale without touching
// search, the data model, or the notebook switcher.
type ViewMode = "grid" | "list";
type SortKey = "updated" | "created" | "title";
type GroupBy = "none" | "month";

// Initial render cap + page size for the incremental "Show more" window. We
// never mount 700 cards/rows at once: the first ~60 notes (in sort order,
// across groups) render eagerly and each "Show more" reveals the next ~60.
// See the FLAG FOR MASTER note in the report re: real virtualization.
const PAGE_SIZE = 60;

// Sort dates safely. `updated_at` is always present; `created_at` is
// optional/nullable on older on-disk notes (see Note type docs) and MUST
// sort LAST regardless of direction, so we map a missing value to a
// sentinel that always loses the "newest first" comparison.
function noteTime(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

// Month bucket key + human label from an ISO-ish date string. Notes whose
// grouping date is missing/invalid fall into a single "Undated" bucket that
// always sorts last.
function monthBucket(value: string | null | undefined): { key: string; label: string } {
  const t = noteTime(value);
  if (t === Number.NEGATIVE_INFINITY) return { key: "0000-00", label: "Undated" };
  const d = new Date(t);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return { key, label };
}

function isSharedNote(note: Note | LabNote): boolean {
  // `shared_with` lives on `Note` (the unified-sharing surface) but not on
  // `LabNote`; narrow with an `in` check so the union access is type-safe.
  const sharedWith =
    "shared_with" in note ? (note as Note).shared_with : undefined;
  return Boolean(note.is_shared || (sharedWith && sharedWith.length > 0));
}

interface NotesPanelProps {
  // If true, this is in Lab Mode and should show all users' shared notes
  isLabMode?: boolean;
  // For Lab Mode: filter by specific usernames
  selectedUsernames?: Set<string>;
  // For Lab Mode: user colors for display
  userColors?: Record<string, string>;
  // Shared Notebooks Phase 4 (notebooks-phase4-widget sub-bot, 2026-06-02):
  // a notebook id to pre-select on mount, used when the Shared Notebook home/
  // dashboard widget deep-links here (`/workbench?tab=notes&notebook=<id>`).
  // Absent / null = the default Personal section. The id only seeds the INITIAL
  // selection; the user can switch away freely afterward.
  initialNotebookId?: string | null;
}

export default function NotesPanel({
  isLabMode = false,
  selectedUsernames,
  initialNotebookId = null,
}: NotesPanelProps) {
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();
  const [selectedNote, setSelectedNote] = useState<Note | LabNote | null>(null);
  // Right-click "Add a comment": opens the note popup with the comments rail open.
  const [noteCommentIntent, setNoteCommentIntent] = useState(false);
  const [noteMenu, setNoteMenu] = useState<{ x: number; y: number; note: Note | LabNote } | null>(null);
  const openNoteComments = (note: Note | LabNote) => {
    setSelectedNote(note);
    setNoteCommentIntent(true);
  };
  const [showNewNoteDropdown, setShowNewNoteDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "single" | "running">("all");

  // Notes scale state (notes-scale bot, 2026-06-02). View mode defaults to
  // the existing card grid; sort defaults to recently-updated (the current
  // behavior); grouping + shared-filter default off so the surface is
  // byte-for-byte unchanged until the user reaches for a control.
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [sharedOnly, setSharedOnly] = useState(false);
  // Folded group keys (month grouping). We DON'T seed this set; instead the
  // effective collapsed state is derived (see `isGroupCollapsed`): every month
  // group EXCEPT the newest defaults to collapsed so a multi-year library opens
  // as a tidy list of month headers rather than a long scroll. Once the user
  // explicitly toggles a group its key lands in `userToggledGroups` and the
  // derived default no longer applies to it: their manual state (tracked in
  // `collapsedGroups`) wins from then on.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Keys the user has explicitly expanded/collapsed. Manual toggles always win
  // over the newest-month-only default below.
  const [userToggledGroups, setUserToggledGroups] = useState<Set<string>>(new Set());
  // Incremental render window: how many notes are currently mounted.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Notebooks Generalization Phase 2 (notebooks-gen Phase 2 bot, 2026-06-06).
  // The Notes tab is now a LEFT RAIL of notebook containers (All / Unfiled /
  // My notebooks / Shared) instead of the old flat "Personal + shared 1:1
  // switcher". Selecting a rail entry filters the main note pane; the existing
  // scale controls (view/sort/group/show-more) apply WITHIN the selection.
  // The rail is PERSONAL-mode only; Lab Mode keeps its separate shared-notes
  // browser untouched.
  // The initial selection seeds from `initialNotebookId` (deep-link from the
  // Shared Notebook home widget); otherwise it defaults to All notes. A stale /
  // no-longer-visible id harmlessly falls back to All (resolved below).
  const [selection, setSelection] = useState<RailSelection>(
    initialNotebookId
      ? { kind: "notebook", id: initialNotebookId }
      : { kind: "all" },
  );
  const [showStartDialog, setShowStartDialog] = useState(false);
  // Notebook create / rename / add-member dialogs + delete confirm.
  const [notebookForm, setNotebookForm] = useState<
    { mode: "create" } | { mode: "rename"; notebook: Notebook } | null
  >(null);
  const [addMemberFor, setAddMemberFor] = useState<Notebook | null>(null);
  const [deleteConfirmFor, setDeleteConfirmFor] = useState<Notebook | null>(null);
  // The "Move to notebook" cursor-anchored menu for a single note.
  const [moveMenu, setMoveMenu] = useState<{
    x: number;
    y: number;
    note: Note;
  } | null>(null);

  // Every notebook the viewer participates in (personal + shared), one query.
  // `getSharedNotebooks` returns all notebooks where the viewer is a member,
  // including personal (single-member) ones, so we split by member count.
  const { data: allNotebooks = [] } = useQuery<SharedNotebook[]>({
    queryKey: ["shared-notebooks", "mine"],
    queryFn: () => labApi.getSharedNotebooks(),
    enabled: !isLabMode,
  });

  const myNotebooks = allNotebooks.filter((n) => n.members.length === 1);
  const sharedNotebooks = allNotebooks.filter((n) => n.members.length >= 2);

  // Resolve the selected notebook from the LIVE list. A stale / no-longer-
  // visible id (the other member deleted it, list not loaded yet) resolves to
  // null, so the pane falls back to All without setState-in-effect churn.
  const activeNotebook =
    selection.kind === "notebook"
      ? (allNotebooks.find((n) => n.id === selection.id) ?? null)
      : null;
  // A shared (2+ member) active notebook uses the dedicated cross-member view
  // (banner + weekly tasks); a personal one filters the local grid below.
  const activeSharedNotebook =
    activeNotebook && activeNotebook.members.length >= 2 ? activeNotebook : null;

  // Fetch notes based on mode
  const { data: notes = [], isLoading, error } = useQuery({
    queryKey: isLabMode ? ["lab-notes", selectedUsernames] : ["notes"],
    queryFn: isLabMode
      ? () => labApi.getNotes({
          usernames: selectedUsernames ? Array.from(selectedUsernames).join(",") : undefined,
          shared_only: true
        })
      : () => notesApi.list(),
  });

  // Create note mutation. When a notebook rail entry is active, the note is
  // created INSIDE that notebook (via notebooksApi.createNote, which stamps the
  // notebook_id + share list); otherwise it is a normal floating note.
  const createNoteMutation = useMutation({
    mutationFn: (data: NoteCreate) => {
      if (selection.kind === "notebook" && activeNotebook) {
        return notebooksApi.createNote({
          notebookId: activeNotebook.id,
          title: data.title,
          description: data.description ?? "",
          is_running_log: data.is_running_log ?? false,
          entries: data.entries,
        });
      }
      return notesApi.create(data);
    },
    onSuccess: (newNote) => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["notebook"] });
      setSelectedNote(newNote);
      setShowNewNoteDropdown(false);
    },
    onError: (error) => {
      console.error("Failed to create note:", error);
      alert("Failed to create note. Please try again.");
    },
  });

  // Move a note into / out of a notebook (single-notebook-per-note; replaces).
  const moveNoteMutation = useMutation({
    mutationFn: ({
      noteId,
      notebookId,
      owner,
    }: {
      noteId: number;
      notebookId: string | null;
      owner?: string;
    }) => notebooksApi.moveNoteToNotebook(noteId, notebookId, owner),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["notebook"] });
      if (selectedNote?.id === updated.id) setSelectedNote(updated);
    },
    onError: (error) => {
      console.error("Failed to move note:", error);
      alert("Could not move the note. Please try again.");
    },
  });

  // Delete a notebook (container only; its notes become floating-readable per
  // the API). Invalidates the notebook list + notes.
  const deleteNotebookMutation = useMutation({
    mutationFn: (id: string) => notebooksApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shared-notebooks", "mine"] });
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      setSelection({ kind: "all" });
    },
    onError: (error) => {
      console.error("Failed to delete notebook:", error);
      alert("Could not delete the notebook. Please try again.");
    },
  });

  // Update note mutation. Sharing toggles affect lab-mode caches too, so
  // bust those (activity feed, per-user dashboard) in addition to the
  // regular notes lists.
  const updateNoteMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<NoteCreate> }) =>
      notesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["lab-notes"] });
      queryClient.invalidateQueries({ queryKey: ["lab", "notes-shared"] });
      queryClient.invalidateQueries({ queryKey: ["lab", "notes"] });
    },
  });

  // Delete note mutation
  const deleteNoteMutation = useMutation({
    mutationFn: (id: number) => notesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["lab-notes"] });
      queryClient.invalidateQueries({ queryKey: ["lab", "notes-shared"] });
      queryClient.invalidateQueries({ queryKey: ["lab", "notes"] });
    },
  });

  // Handle creating a new note
  const handleCreateNote = useCallback((isRunningLog: boolean) => {
    const today = new Date().toISOString().split("T")[0];
    const defaultTitle = isRunningLog ? "New Running Log" : "New Note";
    
    createNoteMutation.mutate({
      title: defaultTitle,
      description: "",
      is_running_log: isRunningLog,
      is_shared: false,
      // Running-log notes start with NO entries, so the user names the first
      // entry through "Add Entry" exactly like every later entry (no special-
      // cased auto-named first entry). Single notes keep their one implicit entry.
      entries: isRunningLog
        ? []
        : [
            {
              title: "Note",
              date: today,
              content: "",
            },
          ],
    });
  }, [createNoteMutation]);

  // Handle note update
  const handleNoteUpdate = useCallback((updatedNote: Note) => {
    updateNoteMutation.mutate({ id: updatedNote.id, data: updatedNote });
    setSelectedNote(updatedNote);
  }, [updateNoteMutation]);

  // Handle note delete. Bug 3 (lab head UX polish manager, 2026-05-24):
  // `notesApi.delete` is now a soft-delete (file moves to
  // `users/<owner>/notes_trash/`). We pop a 10s "Undo" toast so the
  // user can restore the note from the trash directory without
  // touching disk by hand.
  const handleNoteDelete = useCallback((noteId: number) => {
    const note = notes.find((n) => n.id === noteId);
    const title = note?.title ?? "";
    // The user field on the lab-notes wrapper is `username`; fall back
    // to undefined so notesApi.delete uses the current viewer.
    const owner =
      (note && "username" in note ? (note as { username?: string }).username : undefined) ||
      undefined;
    deleteNoteMutation.mutate(noteId, {
      onSuccess: () => {
        emitNoteDeleted({
          noteId,
          noteTitle: title,
          owner,
          onRestored: () => {
            queryClient.invalidateQueries({ queryKey: ["notes"] });
            queryClient.invalidateQueries({ queryKey: ["lab-notes"] });
            queryClient.invalidateQueries({ queryKey: ["lab", "notes-shared"] });
            queryClient.invalidateQueries({ queryKey: ["lab", "notes"] });
          },
        });
      },
    });
    if (selectedNote?.id === noteId) {
      setSelectedNote(null);
    }
  }, [deleteNoteMutation, selectedNote, notes, queryClient]);

  // Rail bucket counts (over the full visible list, independent of the active
  // selection so the rail always shows totals). `notebook_id` lives on `Note`;
  // narrow with an `in` check for the union with `LabNote`.
  const notebookIdOf = (note: Note | LabNote): string | undefined =>
    "notebook_id" in note ? (note as Note).notebook_id : undefined;
  const allCount = notes.length;
  const unfiledCount = notes.filter((n) => !notebookIdOf(n)).length;

  // Filter notes based on the active rail selection, search, and type. A shared
  // (2+ member) notebook is rendered by SharedNotebookView instead (it reads
  // cross-member notes), so the grid filter only ever narrows the LOCAL list to
  // All / Unfiled / a PERSONAL notebook.
  const filteredNotes = notes.filter((note) => {
    // Rail selection filter
    if (selection.kind === "unfiled" && notebookIdOf(note)) return false;
    if (selection.kind === "notebook" && notebookIdOf(note) !== selection.id)
      return false;

    // Type filter
    if (filterType === "single" && note.is_running_log) return false;
    if (filterType === "running" && !note.is_running_log) return false;

    // Shared-with-lab filter (notes-scale bot). Composes with the type
    // filter above (AND). A note counts as shared when `is_shared` is set
    // OR it has any `shared_with` entries.
    if (sharedOnly && !isSharedNote(note)) return false;

    // Search filter (UNCHANGED — searches title + description + entries)
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const titleMatch = note.title.toLowerCase().includes(query);
      const descMatch = note.description?.toLowerCase().includes(query);
      const entryMatch = note.entries.some(
        (e) =>
          e.title.toLowerCase().includes(query) ||
          e.content.toLowerCase().includes(query)
      );
      if (!titleMatch && !descMatch && !entryMatch) return false;
    }

    return true;
  });

  // Sort notes by the active sort key. "updated" (default) preserves the
  // original updated_at-desc behavior. "created" sorts created_at desc with
  // missing/undefined values LAST. "title" is A-Z, case-insensitive.
  const sortedNotes = [...filteredNotes].sort((a, b) => {
    if (sortKey === "title") {
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    }
    if (sortKey === "created") {
      return noteTime(b.created_at) - noteTime(a.created_at);
    }
    return noteTime(b.updated_at) - noteTime(a.updated_at);
  });

  // The date field a note is grouped by. The two recency sorts group by
  // their own field; Title sort groups by updated_at (per the brief).
  const groupDateOf = (note: Note | LabNote): string | null | undefined =>
    sortKey === "created" ? note.created_at : note.updated_at;

  // Build month groups (newest month first; the "Undated" bucket sorts
  // last via its 0000-00 key). Each group's notes stay in the active sort.
  const monthGroups =
    groupBy === "month"
      ? (() => {
          const buckets = new Map<
            string,
            { key: string; label: string; notes: (Note | LabNote)[] }
          >();
          for (const note of sortedNotes) {
            const { key, label } = monthBucket(groupDateOf(note));
            const bucket = buckets.get(key) ?? { key, label, notes: [] };
            bucket.notes.push(note);
            buckets.set(key, bucket);
          }
          return Array.from(buckets.values()).sort((a, b) =>
            b.key.localeCompare(a.key),
          );
        })()
      : null;

  // Incremental render. We walk the sorted list (flat, or group-by-group in
  // group order) and only mount the first `visibleCount` notes, so a 700-note
  // library never mounts 700 cards/rows at once. "Show more" reveals the
  // next PAGE_SIZE. The slicing is order-stable, so groups fill top-to-bottom.
  const totalNotes = sortedNotes.length;
  const hasMore = visibleCount < totalNotes;

  // The newest month group (descending sort puts it first). Used by the
  // default-collapse rule: only this group is expanded until the user says
  // otherwise.
  const newestGroupKey = monthGroups?.[0]?.key ?? null;

  // Effective collapsed state for a month group. If the user has explicitly
  // toggled the group, their choice (recorded in `collapsedGroups`) wins.
  // Otherwise the default is: the newest month is expanded, every older month
  // (and the "Undated" bucket, whose key sorts last) is collapsed.
  const isGroupCollapsed = (key: string): boolean =>
    userToggledGroups.has(key)
      ? collapsedGroups.has(key)
      : key !== newestGroupKey;

  const toggleGroup = (key: string) => {
    // Capture the CURRENT effective state so the first manual toggle flips what
    // the user actually sees (the derived default), not an empty baseline.
    const currentlyCollapsed = isGroupCollapsed(key);
    setUserToggledGroups((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (currentlyCollapsed) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Reset the incremental window whenever the effective result set changes
  // (search / type filter / shared filter / sort), so "Show more" always
  // starts from the top of the new list instead of stranding the user mid-
  // window. Grouping + view-mode don't change membership, so they're excluded.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, filterType, sharedOnly, sortKey, selection]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showNewNoteDropdown) {
        const target = event.target as HTMLElement;
        if (!target.closest(".new-note-dropdown")) {
          setShowNewNoteDropdown(false);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showNewNoteDropdown]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 mb-4">Failed to load notes</p>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ["notes"] })}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
        >
          Retry
        </button>
      </div>
    );
  }

  // The notebook left rail (personal-mode only). Lab Mode renders no rail.
  const rail = !isLabMode ? (
    <NotebookRail
      selection={selection}
      onSelect={setSelection}
      myNotebooks={myNotebooks}
      sharedNotebooks={sharedNotebooks}
      currentUser={currentUser}
      allCount={allCount}
      unfiledCount={unfiledCount}
      onNewNotebook={() => setNotebookForm({ mode: "create" })}
      onStartShared={() => setShowStartDialog(true)}
      onRenameNotebook={(nb) => setNotebookForm({ mode: "rename", notebook: nb })}
      onDeleteNotebook={(nb) => setDeleteConfirmFor(nb)}
      onAddMember={(nb) => setAddMemberFor(nb)}
    />
  ) : null;

  // Notebook dialogs (create / rename / add-member / delete confirm), shared by
  // every render path below.
  const notebookDialogs =
    !isLabMode ? (
      <>
        {showStartDialog && (
          <StartSharedNotebookDialog
            existingPartners={
              new Set(
                sharedNotebooks
                  .map((nb) => nb.members.find((m) => m !== currentUser))
                  .filter((m): m is string => Boolean(m)),
              )
            }
            onClose={() => setShowStartDialog(false)}
            onCreated={(nb) => {
              setShowStartDialog(false);
              queryClient.invalidateQueries({
                queryKey: ["shared-notebooks", "mine"],
              });
              setSelection({ kind: "notebook", id: nb.id });
            }}
          />
        )}
        {notebookForm && (
          <NotebookFormDialog
            mode={notebookForm.mode}
            notebook={
              notebookForm.mode === "rename" ? notebookForm.notebook : undefined
            }
            onClose={() => setNotebookForm(null)}
            onSaved={(nb) => {
              const wasCreate = notebookForm.mode === "create";
              setNotebookForm(null);
              queryClient.invalidateQueries({
                queryKey: ["shared-notebooks", "mine"],
              });
              if (wasCreate) setSelection({ kind: "notebook", id: nb.id });
            }}
          />
        )}
        {addMemberFor && (
          <AddNotebookMemberDialog
            notebook={addMemberFor}
            noteCount={
              notes.filter((n) => notebookIdOf(n) === addMemberFor.id).length
            }
            onClose={() => setAddMemberFor(null)}
            onAdded={() => {
              setAddMemberFor(null);
              queryClient.invalidateQueries({
                queryKey: ["shared-notebooks", "mine"],
              });
              queryClient.invalidateQueries({ queryKey: ["notes"] });
              queryClient.invalidateQueries({ queryKey: ["notebook"] });
            }}
          />
        )}
        {deleteConfirmFor && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Delete notebook"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setDeleteConfirmFor(null);
            }}
          >
            <div className="w-full max-w-md rounded-xl bg-surface-raised shadow-xl">
              <div className="border-b border-border px-5 py-4">
                <h2 className="text-title font-semibold text-foreground">
                  Delete notebook
                </h2>
              </div>
              <div className="px-5 py-4 text-body text-foreground-muted">
                Delete{" "}
                <span className="font-medium text-foreground">
                  {deleteConfirmFor.title?.trim() || "this notebook"}
                </span>
                ? The notes inside it are not deleted, they become unfiled.
                {deleteConfirmFor.members.length >= 2 && (
                  <span>
                    {" "}
                    This removes the notebook for every member.
                  </span>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmFor(null)}
                  className="rounded-lg px-4 py-2 text-body font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="notebook-delete-confirm"
                  onClick={() => {
                    deleteNotebookMutation.mutate(deleteConfirmFor.id);
                    setDeleteConfirmFor(null);
                  }}
                  className="rounded-lg bg-red-600 px-4 py-2 text-body font-medium text-white transition-colors hover:bg-red-700"
                >
                  Delete notebook
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    ) : null;

  // When a SHARED (2+ member) notebook is selected, render the rail + its
  // dedicated cross-member view (banner + weekly tasks) in place of the local
  // grid. Personal notebooks and All / Unfiled stay in the grid below.
  if (!isLabMode && activeSharedNotebook) {
    return (
      <div className="h-full flex gap-4">
        {rail}
        <div className="flex-1 min-h-0">
          <SharedNotebookView notebook={activeSharedNotebook} />
        </div>
        {notebookDialogs}
      </div>
    );
  }

  // Render one note as either a grid card or a dense list row. `globalIndex`
  // is the note's position in the full sorted list, used BOTH for the
  // incremental window AND for the lab-mode first-card tour target (which
  // must land on the very first note regardless of grouping).
  const renderNote = (note: Note | LabNote, globalIndex: number) => {
    const tourTarget =
      // Lab Mode fix manager R1 (2026-05-22): the lab-mode-notes cursor demo
      // clicks the first card. Only stamp in lab mode + grid view so the
      // tour target doesn't leak into the per-user /notes page or the row
      // view (the lab-mode tour drives the grid).
      isLabMode && viewMode === "grid" && globalIndex === 0
        ? "lab-mode-notes-first-card"
        : undefined;
    const onTileContextMenu = (e: React.MouseEvent) => {
      e.preventDefault();
      setNoteMenu({ x: e.clientX, y: e.clientY, note });
    };
    if (viewMode === "list") {
      return (
        <div key={`${note.username}:${note.id}`} onContextMenu={onTileContextMenu}>
          <NoteListRow
            note={note}
            onClick={() => setSelectedNote(note)}
            isLabMode={isLabMode}
          />
        </div>
      );
    }
    return (
      <div key={`${note.username}:${note.id}`} onContextMenu={onTileContextMenu}>
        <NoteCard
          note={note}
          onClick={() => setSelectedNote(note)}
          isLabMode={isLabMode}
          tourTarget={tourTarget}
        />
      </div>
    );
  };

  // Container for a run of notes in the active view (grid = the original
  // 1/2/3/4-col card grid; list = a hairline-divided stack of dense rows).
  const NotesContainer = ({ children }: { children: ReactNode }) =>
    viewMode === "list" ? (
      <div className="divide-y divide-border border border-border rounded-lg overflow-hidden bg-surface-raised">
        {children}
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {children}
      </div>
    );

  // Body: flat (sorted) OR month-grouped, both windowed by `visibleCount`.
  // We track a running global index so the incremental cap spans groups.
  const indexOf = new Map<Note | LabNote, number>();
  sortedNotes.forEach((n, i) => indexOf.set(n, i));

  let notesBody: ReactNode;
  if (groupBy === "month" && monthGroups) {
    notesBody = (
      <div className="space-y-5">
        {monthGroups.map((group) => {
          // Only mount this group's notes that fall inside the window.
          const visibleInGroup = group.notes.filter(
            (n) => (indexOf.get(n) ?? 0) < visibleCount,
          );
          if (visibleInGroup.length === 0) return null;
          const collapsed = isGroupCollapsed(group.key);
          return (
            <div key={group.key} data-testid={`notes-group-${group.key}`}>
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                aria-expanded={!collapsed}
                className="flex items-center gap-2 w-full text-left mb-2 group/header"
              >
                <svg
                  className={`w-4 h-4 text-foreground-muted transition-transform ${collapsed ? "" : "rotate-90"}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-body font-semibold text-foreground">{group.label}</span>
                <span className="text-meta text-foreground-muted bg-surface-sunken px-2 py-0.5 rounded-full">
                  {group.notes.length}
                </span>
              </button>
              {!collapsed && (
                <NotesContainer>
                  {visibleInGroup.map((note) => renderNote(note, indexOf.get(note) ?? 0))}
                </NotesContainer>
              )}
            </div>
          );
        })}
      </div>
    );
  } else {
    notesBody = (
      <NotesContainer>
        {sortedNotes
          .slice(0, visibleCount)
          .map((note, idx) => renderNote(note, idx))}
      </NotesContainer>
    );
  }

  return (
    <div className={isLabMode ? "h-full flex flex-col" : "h-full flex gap-4"}>
      {rail}
      <div className="h-full flex flex-1 min-w-0 flex-col">
      {/* Header with search and filters. Wraps gracefully on tablet widths:
          the row flex-wraps, and the related controls are kept in coherent
          clusters (type filters; sort + group-by + view toggle) so the wrap
          reads tidy rather than ragged. New Note stays reachable. */}
      <div className="flex items-center justify-between mb-4 gap-x-4 gap-y-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notes..."
            className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:outline-none focus:border-emerald-500 text-body"
          />
        </div>

        {/* Filter + arrange controls. Two coherent clusters that wrap as
            units: the type/shared filters, then sort + group-by + view. */}
        <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
          {/* Cluster 1: type + shared filters */}
          <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterType("all")}
            className={`px-3 py-1.5 text-body rounded-lg transition-colors ${
              filterType === "all"
                ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-surface-sunken text-foreground-muted hover:bg-surface-sunken"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterType("single")}
            className={`px-3 py-1.5 text-body rounded-lg transition-colors ${
              filterType === "single"
                ? "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300"
                : "bg-surface-sunken text-foreground-muted hover:bg-surface-sunken"
            }`}
          >
            Single
          </button>
          <button
            onClick={() => setFilterType("running")}
            className={`px-3 py-1.5 text-body rounded-lg transition-colors ${
              filterType === "running"
                ? "bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300"
                : "bg-surface-sunken text-foreground-muted hover:bg-surface-sunken"
            }`}
          >
            Running Logs
          </button>

          {/* Shared-with-lab filter (notes-scale bot). Composes (AND) with
              the type filter above; does not replace it. */}
          <button
            onClick={() => setSharedOnly((v) => !v)}
            aria-pressed={sharedOnly}
            data-testid="notes-filter-shared"
            className={`flex items-center gap-1 px-3 py-1.5 text-body rounded-lg transition-colors ${
              sharedOnly
                ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-surface-sunken text-foreground-muted hover:bg-surface-sunken"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.83-4" />
            </svg>
            Shared with lab
          </button>
          </div>

          {/* Cluster 2: sort + group-by selects kept together, with the
              grid/list view toggle next to them. */}
          <div className="flex items-center gap-2">
          {/* Sort control (notes-scale bot) */}
          <label className="sr-only" htmlFor="notes-sort">Sort notes</label>
          <select
            id="notes-sort"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            data-testid="notes-sort"
            className="px-2 py-1.5 text-body rounded-lg bg-surface-sunken text-foreground hover:bg-surface-sunken border-none focus:outline-none focus:ring-1 focus:ring-emerald-400 cursor-pointer"
          >
            <option value="updated">Recently updated</option>
            <option value="created">Recently created</option>
            <option value="title">Title A-Z</option>
          </select>

          {/* Group-by control (notes-scale bot) */}
          <label className="sr-only" htmlFor="notes-group">Group notes</label>
          <select
            id="notes-group"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            data-testid="notes-group"
            className="px-2 py-1.5 text-body rounded-lg bg-surface-sunken text-foreground hover:bg-surface-sunken border-none focus:outline-none focus:ring-1 focus:ring-emerald-400 cursor-pointer"
          >
            <option value="none">No grouping</option>
            <option value="month">By month</option>
          </select>

          <span className="w-px h-6 bg-surface-sunken mx-0.5" aria-hidden="true" />

          {/* View-mode toggle (notes-scale bot): grid (current cards) | list
              (dense rows). Each icon-only button wrapped in Tooltip. */}
          <div
            className="flex items-center rounded-lg bg-surface-sunken p-0.5"
            data-testid="notes-view-toggle"
            role="group"
            aria-label="Note view mode"
          >
            <Tooltip label="Card grid">
              <button
                onClick={() => setViewMode("grid")}
                aria-pressed={viewMode === "grid"}
                aria-label="Card grid view"
                data-testid="notes-view-grid"
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === "grid"
                    ? "bg-surface-raised text-emerald-700 dark:text-emerald-300 shadow-sm"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM13 5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1h-5a1 1 0 01-1-1V5zM4 14a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1v-5zM13 14a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1h-5a1 1 0 01-1-1v-5z" />
                </svg>
              </button>
            </Tooltip>
            <Tooltip label="Dense list">
              <button
                onClick={() => setViewMode("list")}
                aria-pressed={viewMode === "list"}
                aria-label="Dense list view"
                data-testid="notes-view-list"
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === "list"
                    ? "bg-surface-raised text-emerald-700 dark:text-emerald-300 shadow-sm"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </Tooltip>
          </div>
          </div>
        </div>

        {/* New note button (not in Lab Mode) */}
        {!isLabMode && (
          <div className="relative new-note-dropdown">
            <button
              onClick={() => setShowNewNoteDropdown(!showNewNoteDropdown)}
              data-tour-target="workbench-new-note-button"
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-2 text-body"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Note
            </button>

            {showNewNoteDropdown && (
              <div className="absolute right-0 top-full mt-1 bg-surface-raised border border-border rounded-lg shadow-lg py-1 z-50 min-w-[180px]">
                <button
                  onClick={() => handleCreateNote(false)}
                  className="w-full px-4 py-2 text-left text-body text-foreground hover:bg-surface-sunken flex items-center gap-2"
                >
                  <div className="w-6 h-6 rounded bg-blue-100 dark:bg-blue-500/15 flex items-center justify-center">
                    <svg className="w-3 h-3 text-blue-600 dark:text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium">Single Note</p>
                    <p className="text-meta text-foreground-muted">One-time meeting notes</p>
                  </div>
                </button>
                <button
                  onClick={() => handleCreateNote(true)}
                  className="w-full px-4 py-2 text-left text-body text-foreground hover:bg-surface-sunken flex items-center gap-2"
                >
                  <div className="w-6 h-6 rounded bg-purple-100 dark:bg-purple-500/15 flex items-center justify-center">
                    <svg className="w-3 h-3 text-purple-600 dark:text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium">Running Log</p>
                    <p className="text-meta text-foreground-muted">Multiple timestamped entries</p>
                  </div>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Notes grid */}
      {sortedNotes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-surface-sunken flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-foreground-muted mb-2">
              {sharedOnly
                ? "No notes shared with the lab match your filters"
                : searchQuery || filterType !== "all"
                ? "No notes match your filters"
                : isLabMode
                ? "No shared notes found"
                : "No notes yet"}
            </p>
            {!isLabMode && !searchQuery && filterType === "all" && !sharedOnly && (
              <p className="text-body text-foreground-muted mb-4">
                Add a note to see it here
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {notesBody}
          {/* Incremental render (notes-scale bot): never mount the whole
              library at once. The first PAGE_SIZE notes (in sort order,
              across groups) render eagerly; "Show more" reveals the next
              PAGE_SIZE. */}
          {hasMore && (
            <div className="flex justify-center mt-5">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                data-testid="notes-show-more"
                className="px-4 py-2 text-body rounded-lg bg-surface-sunken text-foreground hover:bg-surface-sunken transition-colors"
              >
                Show more ({totalNotes - visibleCount} more)
              </button>
            </div>
          )}
        </div>
      )}

      {/* Note tile context menu */}
      {noteMenu && (
        <ContextMenu
          x={noteMenu.x}
          y={noteMenu.y}
          onClose={() => setNoteMenu(null)}
          items={[
            {
              label: (noteMenu.note.comments?.length ?? 0) > 0 ? "View / add comment" : "Add a comment",
              icon: (
                <svg className="h-4 w-4 text-foreground-muted" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 8h10M7 12h6m-7 9l4-4h10a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h1v4z" />
                </svg>
              ),
              onClick: () => openNoteComments(noteMenu.note),
            },
            // Move-to-notebook: personal mode only (Lab Mode is read-only).
            ...(!isLabMode
              ? [
                  {
                    label: "Move to notebook",
                    icon: (
                      <svg className="h-4 w-4 text-foreground-muted" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                      </svg>
                    ),
                    onClick: () => {
                      const { x, y, note } = noteMenu;
                      setMoveMenu({ x, y, note: note as Note });
                    },
                  },
                ]
              : []),
          ]}
        />
      )}

      {/* Move-to-notebook picker (single note). */}
      {moveMenu && (
        <MoveToNotebookMenu
          x={moveMenu.x}
          y={moveMenu.y}
          currentNotebookId={moveMenu.note.notebook_id}
          myNotebooks={myNotebooks}
          sharedNotebooks={sharedNotebooks}
          currentUser={currentUser}
          onMove={(notebookId) =>
            moveNoteMutation.mutate({
              noteId: moveMenu.note.id,
              notebookId,
              owner: moveMenu.note.username || undefined,
            })
          }
          onClose={() => setMoveMenu(null)}
        />
      )}

      {selectedNote && (
        <NoteDetailPopup
          note={selectedNote as Note}
          onClose={() => {
            setSelectedNote(null);
            setNoteCommentIntent(false);
          }}
          onUpdate={handleNoteUpdate}
          onDelete={handleNoteDelete}
          readOnly={isLabMode}
          initialCommentsOpen={noteCommentIntent}
          {...(!isLabMode
            ? {
                onMoveToNotebook: (notebookId: string | null) =>
                  moveNoteMutation.mutate({
                    noteId: (selectedNote as Note).id,
                    notebookId,
                    owner: (selectedNote as Note).username || undefined,
                  }),
                myNotebooks,
                sharedNotebooks,
                currentUser,
              }
            : {})}
        />
      )}
      </div>

      {notebookDialogs}
    </div>
  );
}
