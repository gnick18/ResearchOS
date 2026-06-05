"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notesApi, labApi } from "@/lib/local-api";
import type { Note, NoteCreate, LabNote, SharedNotebook } from "@/lib/types";
import NoteCard from "./NoteCard";
import NoteListRow from "./NoteListRow";
import NoteDetailPopup from "./NoteDetailPopup";
import { emitNoteDeleted } from "@/lib/notes/delete-toast-bus";
import SharedNotebookView from "./notebooks/SharedNotebookView";
import StartSharedNotebookDialog from "./notebooks/StartSharedNotebookDialog";
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

  // Shared Notebooks Phase 2 (notebooks-phase2 sub-bot, 2026-06-02). The Notes
  // tab becomes NOTEBOOK-AWARE: a switcher section lists "Personal" (today's
  // notes, unchanged) plus every shared 1:1 notebook the viewer is in. The
  // switcher + the shared-notebook view are PERSONAL-mode only; Lab Mode keeps
  // the existing shared-notes browser untouched.
  // `null` = the Personal section (default); a notebook id = that notebook's
  // shared view. Phase 4: seed from `initialNotebookId` so a deep-link from the
  // Shared Notebook widget lands on the chosen notebook. The id is resolved
  // against the LIVE list below, so a stale / no-longer-shared id harmlessly
  // falls back to Personal.
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(
    initialNotebookId,
  );
  const [showStartDialog, setShowStartDialog] = useState(false);

  const { data: sharedNotebooks = [] } = useQuery<SharedNotebook[]>({
    queryKey: ["shared-notebooks", "mine"],
    queryFn: () => labApi.getSharedNotebooks(),
    enabled: !isLabMode,
  });

  // Resolve the selected notebook from the LIVE list. If the stored id no
  // longer matches a notebook the viewer is in (e.g. the other member deleted
  // it, or the list has not loaded yet), this is simply `null`, so the view
  // falls back to Personal without any setState-in-effect churn. The stale id
  // stays in state harmlessly and re-resolves if the notebook reappears.
  const activeNotebook =
    activeNotebookId !== null
      ? (sharedNotebooks.find((n) => n.id === activeNotebookId) ?? null)
      : null;

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

  // Create note mutation
  const createNoteMutation = useMutation({
    mutationFn: (data: NoteCreate) => notesApi.create(data),
    onSuccess: (newNote) => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      setSelectedNote(newNote);
      setShowNewNoteDropdown(false);
    },
    onError: (error) => {
      console.error("Failed to create note:", error);
      alert("Failed to create note. Please try again.");
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

  // Filter notes based on search and type
  const filteredNotes = notes.filter((note) => {
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
  }, [searchQuery, filterType, sharedOnly, sortKey]);

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

  // The notebook switcher: "Personal" + one chip per shared notebook + a
  // "Start a shared notebook" action. Personal-mode only (Lab Mode renders the
  // existing shared-notes browser, no switcher).
  const notebookSwitcher = !isLabMode ? (
    <div
      className="flex flex-wrap items-center gap-2 mb-4"
      data-testid="notebook-switcher"
    >
      <button
        type="button"
        onClick={() => setActiveNotebookId(null)}
        aria-pressed={activeNotebook === null}
        data-testid="notebook-switch-personal"
        className={`px-3 py-1.5 text-body rounded-lg transition-colors ${
          activeNotebook === null
            ? "bg-emerald-100 text-emerald-700"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
        }`}
      >
        Personal
      </button>
      {sharedNotebooks.map((nb) => {
        const partner =
          nb.members.find((m) => m !== currentUser) ?? nb.members[1];
        const label = nb.title?.trim() ? nb.title : `1:1 with ${partner}`;
        const isActive = activeNotebook?.id === nb.id;
        return (
          <button
            key={nb.id}
            type="button"
            onClick={() => setActiveNotebookId(nb.id)}
            aria-pressed={isActive}
            data-testid={`notebook-switch-${nb.id}`}
            className={`px-3 py-1.5 text-body rounded-lg transition-colors max-w-[220px] truncate ${
              isActive
                ? "bg-sky-100 text-sky-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setShowStartDialog(true)}
        data-testid="notebook-start-button"
        className="flex items-center gap-1.5 px-3 py-1.5 text-body rounded-lg border border-dashed border-gray-300 text-gray-600 hover:border-sky-400 hover:text-sky-600 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Start a shared notebook
      </button>
    </div>
  ) : null;

  const startDialog =
    !isLabMode && showStartDialog ? (
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
          setActiveNotebookId(nb.id);
        }}
      />
    ) : null;

  // When a shared notebook is selected, render the switcher + its dedicated
  // view in place of the personal notes list. Personal stays byte-for-byte
  // unchanged.
  if (!isLabMode && activeNotebook) {
    return (
      <div className="h-full flex flex-col">
        {notebookSwitcher}
        <div className="flex-1 min-h-0">
          <SharedNotebookView notebook={activeNotebook} />
        </div>
        {startDialog}
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
    if (viewMode === "list") {
      return (
        <NoteListRow
          key={`${note.username}:${note.id}`}
          note={note}
          onClick={() => setSelectedNote(note)}
          isLabMode={isLabMode}
        />
      );
    }
    return (
      <NoteCard
        key={`${note.username}:${note.id}`}
        note={note}
        onClick={() => setSelectedNote(note)}
        isLabMode={isLabMode}
        tourTarget={tourTarget}
      />
    );
  };

  // Container for a run of notes in the active view (grid = the original
  // 1/2/3/4-col card grid; list = a hairline-divided stack of dense rows).
  const NotesContainer = ({ children }: { children: ReactNode }) =>
    viewMode === "list" ? (
      <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden bg-white">
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
                  className={`w-4 h-4 text-gray-400 transition-transform ${collapsed ? "" : "rotate-90"}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-body font-semibold text-gray-700">{group.label}</span>
                <span className="text-meta text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
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
    <div className="h-full flex flex-col">
      {notebookSwitcher}
      {/* Header with search and filters. Wraps gracefully on tablet widths:
          the row flex-wraps, and the related controls are kept in coherent
          clusters (type filters; sort + group-by + view toggle) so the wrap
          reads tidy rather than ragged. New Note stays reachable. */}
      <div className="flex items-center justify-between mb-4 gap-x-4 gap-y-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
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
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-emerald-500 text-body"
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
                ? "bg-emerald-100 text-emerald-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterType("single")}
            className={`px-3 py-1.5 text-body rounded-lg transition-colors ${
              filterType === "single"
                ? "bg-blue-100 text-blue-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Single
          </button>
          <button
            onClick={() => setFilterType("running")}
            className={`px-3 py-1.5 text-body rounded-lg transition-colors ${
              filterType === "running"
                ? "bg-purple-100 text-purple-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
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
                ? "bg-emerald-100 text-emerald-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
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
            className="px-2 py-1.5 text-body rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 border-none focus:outline-none focus:ring-1 focus:ring-emerald-400 cursor-pointer"
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
            className="px-2 py-1.5 text-body rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 border-none focus:outline-none focus:ring-1 focus:ring-emerald-400 cursor-pointer"
          >
            <option value="none">No grouping</option>
            <option value="month">By month</option>
          </select>

          <span className="w-px h-6 bg-gray-200 mx-0.5" aria-hidden="true" />

          {/* View-mode toggle (notes-scale bot): grid (current cards) | list
              (dense rows). Each icon-only button wrapped in Tooltip. */}
          <div
            className="flex items-center rounded-lg bg-gray-100 p-0.5"
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
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
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
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
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
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[180px]">
                <button
                  onClick={() => handleCreateNote(false)}
                  className="w-full px-4 py-2 text-left text-body text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <div className="w-6 h-6 rounded bg-blue-100 flex items-center justify-center">
                    <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium">Single Note</p>
                    <p className="text-meta text-gray-400">One-time meeting notes</p>
                  </div>
                </button>
                <button
                  onClick={() => handleCreateNote(true)}
                  className="w-full px-4 py-2 text-left text-body text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <div className="w-6 h-6 rounded bg-purple-100 flex items-center justify-center">
                    <svg className="w-3 h-3 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium">Running Log</p>
                    <p className="text-meta text-gray-400">Multiple timestamped entries</p>
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
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-gray-500 mb-2">
              {sharedOnly
                ? "No notes shared with the lab match your filters"
                : searchQuery || filterType !== "all"
                ? "No notes match your filters"
                : isLabMode
                ? "No shared notes found"
                : "No notes yet"}
            </p>
            {!isLabMode && !searchQuery && filterType === "all" && !sharedOnly && (
              <p className="text-body text-gray-400 mb-4">
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
                className="px-4 py-2 text-body rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
              >
                Show more ({totalNotes - visibleCount} more)
              </button>
            </div>
          )}
        </div>
      )}

      {/* Note Detail Popup */}
      {selectedNote && (
        <NoteDetailPopup
          note={selectedNote as Note}
          onClose={() => setSelectedNote(null)}
          onUpdate={handleNoteUpdate}
          onDelete={handleNoteDelete}
          readOnly={isLabMode}
        />
      )}

      {startDialog}
    </div>
  );
}
