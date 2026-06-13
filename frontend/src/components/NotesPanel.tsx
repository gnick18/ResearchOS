"use client";

import { useState, useEffect, useCallback, type ReactNode, type CSSProperties } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notesApi, labApi, notebooksApi } from "@/lib/local-api";
import type { Note, NoteCreate, LabNote, SharedNotebook, Notebook } from "@/lib/types";
import NoteListRow from "./NoteListRow";
import NoteDetailPopup from "./NoteDetailPopup";
import ContextMenu from "./ContextMenu";
import { Icon } from "@/components/icons";
import { emitNoteDeleted } from "@/lib/notes/delete-toast-bus";
import SharedNotebookView from "./notebooks/SharedNotebookView";
import StartSharedNotebookDialog from "./notebooks/StartSharedNotebookDialog";
import NotebookRail, { type RailSelection } from "./notebooks/NotebookRail";
import NotebookFormDialog from "./notebooks/NotebookFormDialog";
import AddNotebookMemberDialog from "./notebooks/AddNotebookMemberDialog";
import NotebookAppearanceDialog from "./notebooks/NotebookAppearanceDialog";
import MoveToNotebookMenu from "./notebooks/MoveToNotebookMenu";
import LivingPopup from "@/components/ui/LivingPopup";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePiRecordMenu } from "@/hooks/usePiRecordMenu";
import { useIsLabMode } from "@/hooks/useIsLabMode";
import type {
  WorkbenchInitialOpen,
  WorkbenchRecentRef,
} from "@/app/workbench/workbench-beaker-source";

// Notes scale controls (notes-scale bot, 2026-06-02). The Notes tab is a
// pleasant card grid at 7 notes but becomes an unnavigable sea of cards at
// 700 over years. These small controls — a grid/list view toggle, a sort
// order, a month group-by, a "Shared with lab" filter, and an incremental
// "Show more" window — keep the surface navigable at scale without touching
// search, the data model, or the notebook switcher.
type SortKey = "updated" | "created" | "title";

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

// Inline style for a notebook-color band: the notebook's color as the text +
// left accent, plus a faint tint of it as the background. Returns undefined for
// a missing color (the Unfiled band uses neutral Tailwind classes instead).
function bandTint(color: string | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!m) return { color, borderLeftColor: color };
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return { color, borderLeftColor: color, backgroundColor: `rgba(${r},${g},${b},0.10)` };
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
  // BeakerSearch cross-tab jump (spec 4.2). A pending {kind:"note"|"notebook"}
  // intent opens the matching note popup / selects the notebook rail entry once
  // on mount, then clears via onInitialOpenConsumed. The "__create__" /
  // "__create-log__" / "__all__" / "__unfiled__" sentinels run the matching
  // action instead (create a note, jump the rail). This is the same deep-link-
  // on-mount seam as initialNotebookId, generalized for cross-tab opens.
  initialOpen?: WorkbenchInitialOpen;
  onInitialOpenConsumed?: () => void;
  // BeakerSearch v2 chunk 3, the live-selection lift. Reports the open note up
  // to the page so the BeakerSearch context card + Suggested describe the note
  // the user actually clicked, not the last palette-opened proxy. Fires with the
  // open note, null when the popup closes (the notebook-rail selection alone is
  // not a note selection, so it reports null).
  onSelectionChange?: (sel: WorkbenchRecentRef | null) => void;
}

export default function NotesPanel({
  isLabMode = false,
  selectedUsernames,
  initialNotebookId = null,
  initialOpen = null,
  onInitialOpenConsumed,
  onSelectionChange,
}: NotesPanelProps) {
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();
  // The "Shared with lab" filter only makes sense in a lab folder. Gate it on
  // the canonical folder-level signal, falling back to the view-level isLabMode
  // prop so the lab notes view never flickers while the hook settles. A solo
  // folder (1 member, no lab head) hides the chip entirely.
  const folderLabMode = useIsLabMode();
  const showSharedWithLab = isLabMode || folderLabMode === true;
  // PI capability revamp Phase 2: right-click PI actions on member-owned note
  // rows. The builder gates internally (no items for a non-PI viewer or a PI
  // on their own note), so we append its items to the existing tile menu.
  const piMenu = usePiRecordMenu();
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

  // Notes explorer (2026-06-11 redesign). The dense list is the only layout
  // now; sort defaults to recently-updated; the shared-filter defaults off.
  // Rows group under notebook-color bands in the All view (see notesBody).
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sharedOnly, setSharedOnly] = useState(false);
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
  const [appearanceFor, setAppearanceFor] = useState<Notebook | null>(null);
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

  // BeakerSearch cross-tab jump (spec 4.2). A pending note / notebook intent
  // opens the matching note popup or selects the rail entry once on mount; the
  // sentinels run their action (create a note / running log, jump the rail to
  // All / Unfiled). Then the intent clears. Personal-mode only (Lab Mode keeps
  // its own browser); a no-op when nothing pending.
  useEffect(() => {
    if (!initialOpen || isLabMode) return;
    if (initialOpen.kind === "notebook") {
      if (initialOpen.key === "__all__") setSelection({ kind: "all" });
      else if (initialOpen.key === "__unfiled__")
        setSelection({ kind: "unfiled" });
      else {
        const id = initialOpen.key.replace(/^notebook-/, "");
        setSelection({ kind: "notebook", id });
      }
      onInitialOpenConsumed?.();
      return;
    }
    if (initialOpen.kind === "note") {
      if (initialOpen.key === "__create__") {
        handleCreateNote(false);
        onInitialOpenConsumed?.();
        return;
      }
      if (initialOpen.key === "__create-log__") {
        handleCreateNote(true);
        onInitialOpenConsumed?.();
        return;
      }
      if (notes.length === 0) return; // wait for the list, then resolve.
      const target = notes.find(
        (n) => `note-${n.username || currentUser}:${n.id}` === initialOpen.key,
      );
      if (target) setSelectedNote(target);
      onInitialOpenConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpen, notes, isLabMode]);

  // BeakerSearch v2 chunk 3, the live-selection lift. Report the open note up to
  // the page so the BeakerSearch source names the note the user actually clicked.
  // The key matches the hook's note resolution (note-<owner>:<id>). Watching
  // selectedNote covers every open path (click, comment intent, create, the
  // cross-tab jump) and the close-to-null path with one thin effect.
  useEffect(() => {
    onSelectionChange?.(
      selectedNote
        ? {
            kind: "note",
            key: `note-${selectedNote.username || currentUser}:${selectedNote.id}`,
          }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNote]);

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
  // Exclude 1:1-scoped notes — those live exclusively in WorkbenchOneOnOnePanel
  // (the Mentoring / Check-ins tab) and must not appear in the Notes grid.
  const notesForPanel = notes.filter(
    (n) => !("one_on_one_id" in n && (n as Note).one_on_one_id)
  );
  const allCount = notesForPanel.length;
  const unfiledCount = notesForPanel.filter((n) => !notebookIdOf(n)).length;

  // Filter notes based on the active rail selection, search, and type. A shared
  // (2+ member) notebook is rendered by SharedNotebookView instead (it reads
  // cross-member notes), so the grid filter only ever narrows the LOCAL list to
  // All / Unfiled / a PERSONAL notebook.
  const filteredNotes = notesForPanel.filter((note) => {
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

  // Incremental render. We walk the sorted list and only mount the first
  // `visibleCount` notes, so a 700-note library never mounts 700 rows at once.
  // "Show more" reveals the next PAGE_SIZE. The slicing is order-stable, so
  // notebook bands fill top-to-bottom.
  const totalNotes = sortedNotes.length;
  const hasMore = visibleCount < totalNotes;

  // Notebook-band grouping for the All view: rows sit under colored notebook
  // bands (each notebook's own color), Unfiled last. A single-notebook (or
  // Unfiled) selection renders a flat list. Lab Mode is flat (no notebooks).
  // Bands honor the active sort (notebooks ordered by their freshest note) and
  // the incremental window via the shared sortedNotes order.
  const notebookColorOf = (id: string): string | undefined =>
    allNotebooks.find((n) => n.id === id)?.color;
  const notebookTitleOf = (id: string): string =>
    allNotebooks.find((n) => n.id === id)?.title?.trim() || "Notebook";
  const showNotebookBands = !isLabMode && selection.kind === "all";
  const notebookBands = showNotebookBands
    ? (() => {
        const buckets = new Map<string, (Note | LabNote)[]>();
        for (const note of sortedNotes) {
          const key = notebookIdOf(note) ?? "__unfiled__";
          const arr = buckets.get(key) ?? [];
          arr.push(note);
          buckets.set(key, arr);
        }
        // Order: notebooks (by first-appearance in the sorted list, i.e. the
        // freshest note wins), Unfiled always last.
        const keys = Array.from(buckets.keys()).filter((k) => k !== "__unfiled__");
        if (buckets.has("__unfiled__")) keys.push("__unfiled__");
        return keys.map((key) => ({
          key,
          label: key === "__unfiled__" ? "Unfiled" : notebookTitleOf(key),
          color: key === "__unfiled__" ? undefined : notebookColorOf(key),
          notes: buckets.get(key)!,
        }));
      })()
    : null;

  // Reset the incremental window whenever the effective result set changes
  // (search / type filter / shared filter / sort / rail selection), so
  // "Show more" always starts from the top of the new list.
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-action"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 mb-4">Failed to load notes</p>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ["notes"] })}
          className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-lg px-4 py-2"
        >
          Retry
        </button>
      </div>
    );
  }

  // Type + owner filter chips, pinned to the bottom of the rail (Notes
  // explorer redesign). Replaces the old toolbar filter cluster.
  const chipClass = (on: boolean) =>
    `px-2.5 py-1 text-meta font-medium rounded-full border transition-colors ${
      on
        ? "bg-brand-action border-brand-action text-white"
        : "border-border text-foreground-muted hover:bg-surface-raised"
    }`;
  const railFilters = (
    <div className="space-y-2 border-t border-border pt-3">
      <div>
        <p className="px-1 mb-1.5 text-meta font-bold uppercase tracking-wider text-foreground-muted">
          Type
        </p>
        <div className="flex flex-wrap gap-1.5 px-1">
          <button
            type="button"
            onClick={() => setFilterType(filterType === "single" ? "all" : "single")}
            className={chipClass(filterType === "single")}
          >
            Notes
          </button>
          <button
            type="button"
            onClick={() => setFilterType(filterType === "running" ? "all" : "running")}
            className={chipClass(filterType === "running")}
          >
            Running logs
          </button>
        </div>
      </div>
      {showSharedWithLab && (
        <div>
          <p className="px-1 mb-1.5 text-meta font-bold uppercase tracking-wider text-foreground-muted">
            Owner
          </p>
          <div className="flex flex-wrap gap-1.5 px-1">
            <button
              type="button"
              data-testid="notes-filter-shared"
              onClick={() => setSharedOnly((v) => !v)}
              className={chipClass(sharedOnly)}
            >
              Shared with lab
            </button>
          </div>
        </div>
      )}
    </div>
  );

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
      onCustomizeAppearance={(nb) => setAppearanceFor(nb)}
      footer={railFilters}
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
        {appearanceFor && (
          <NotebookAppearanceDialog
            notebook={appearanceFor}
            onClose={() => setAppearanceFor(null)}
            onSaved={(updated) => {
              setAppearanceFor(null);
              queryClient.setQueryData(
                ["shared-notebooks", "mine"],
                (old: Notebook[] | undefined) =>
                  old?.map((n) => (n.id === updated.id ? updated : n)),
              );
              queryClient.invalidateQueries({
                queryKey: ["shared-notebooks", "mine"],
              });
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
          <LivingPopup
            open
            onClose={() => setDeleteConfirmFor(null)}
            label="Delete notebook"
            widthClassName="max-w-md"
            card={false}
          >
            <div className="w-full rounded-xl bg-surface-raised shadow-xl">
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
          </LivingPopup>
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

  // Render one note as a dense list row. `globalIndex` is the note's position
  // in the full sorted list (the incremental window + the lab-mode first-row
  // tour target both key off it).
  const renderNote = (note: Note | LabNote, globalIndex: number) => {
    const tourTarget =
      isLabMode && globalIndex === 0 ? "lab-mode-notes-first-card" : undefined;
    return (
      <div
        key={`${note.username}:${note.id}`}
        data-tour-target={tourTarget}
        onContextMenu={(e) => {
          e.preventDefault();
          setNoteMenu({ x: e.clientX, y: e.clientY, note });
        }}
      >
        <NoteListRow
          note={note}
          onClick={() => setSelectedNote(note)}
          isLabMode={isLabMode}
        />
      </div>
    );
  };

  // A hairline-divided stack of dense rows (the only layout now).
  const NotesContainer = ({ children }: { children: ReactNode }) => (
    <div className="divide-y divide-border border border-border rounded-lg overflow-hidden bg-surface-raised">
      {children}
    </div>
  );

  // Body: notebook-banded (All view) or flat, both windowed by `visibleCount`.
  // A running global index keeps the incremental cap spanning bands.
  const indexOf = new Map<Note | LabNote, number>();
  sortedNotes.forEach((n, i) => indexOf.set(n, i));

  let notesBody: ReactNode;
  if (notebookBands) {
    notesBody = (
      <div className="space-y-5">
        {notebookBands.map((band) => {
          const visibleInBand = band.notes.filter(
            (n) => (indexOf.get(n) ?? 0) < visibleCount,
          );
          if (visibleInBand.length === 0) return null;
          return (
            <div key={band.key} data-testid={`notes-band-${band.key}`}>
              <div
                className={`flex items-center gap-2 px-3 py-1.5 mb-2 rounded-md border-l-[3px] text-meta font-bold uppercase tracking-wider ${
                  band.color
                    ? ""
                    : "bg-surface-sunken text-foreground-muted border-l-gray-300 dark:border-l-gray-600"
                }`}
                style={bandTint(band.color)}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full flex-none ${band.color ? "" : "bg-gray-400"}`}
                  style={band.color ? { backgroundColor: band.color } : undefined}
                />
                <span className="flex-1">{band.label}</span>
                <span className="opacity-70">{band.notes.length}</span>
              </div>
              <NotesContainer>
                {visibleInBand.map((note) => renderNote(note, indexOf.get(note) ?? 0))}
              </NotesContainer>
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

        {/* Sort control. The type / owner filters now live in the rail. */}
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="notes-sort">Sort notes</label>
          <select
            id="notes-sort"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            data-testid="notes-sort"
            className="px-2 py-1.5 text-body rounded-lg bg-surface-sunken text-foreground border-none focus:outline-none focus:ring-1 focus:ring-emerald-400 cursor-pointer"
          >
            <option value="updated">Recently updated</option>
            <option value="created">Recently created</option>
            <option value="title">Title A-Z</option>
          </select>
        </div>

        {/* New note button (not in Lab Mode) */}
        {!isLabMode && (
          <div className="relative new-note-dropdown">
            <button
              onClick={() => setShowNewNoteDropdown(!showNewNoteDropdown)}
              data-tour-target="workbench-new-note-button"
              aria-haspopup="menu"
              aria-expanded={showNewNoteDropdown}
              aria-label="New Note"
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-lg px-4 py-2 flex items-center gap-2 text-body"
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
              label: "Open",
              icon: <Icon name="eye" className="h-4 w-4 text-foreground-muted" />,
              onClick: () => setSelectedNote(noteMenu.note),
            },
            {
              label: (noteMenu.note.comments?.length ?? 0) > 0 ? "View / add comment" : "Add a comment",
              icon: (
                <svg className="h-4 w-4 text-foreground-muted" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 8h10M7 12h6m-7 9l4-4h10a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h1v4z" />
                </svg>
              ),
              onClick: () => openNoteComments(noteMenu.note),
            },
            // Move-to-notebook + Delete: personal mode only (Lab Mode is read-only).
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
                  {
                    label: "Delete",
                    icon: <Icon name="trash" className="h-4 w-4 text-red-500" />,
                    onClick: () => handleNoteDelete(noteMenu.note.id),
                  },
                ]
              : []),
            // PI capability revamp Phase 2: append the lab-head actions for a
            // member's note. buildItems returns [] for a non-PI viewer or a PI
            // on their own note, so this stays empty for everyone else. The
            // EditMenuItem.onRun maps to the local menu's onClick.
            ...piMenu
              .buildItems({
                recordType: "note",
                record: {
                  owner: noteMenu.note.username,
                  id: noteMenu.note.id,
                  flagged: !!(noteMenu.note as Note).flagged,
                },
                onEditAsPi: () => setSelectedNote(noteMenu.note),
              })
              .map((it) => ({ label: it.label, onClick: it.onRun })),
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

      {/* PI capability revamp Phase 2: assign-modal home for the PI record menu
          (notes have no assign action, so this stays inert here; rendered for
          hook symmetry). */}
      {piMenu.modals}
    </div>
  );
}
