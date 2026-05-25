"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi } from "@/lib/local-api";
import NoteCard from "@/components/NoteCard";
import NoteDetailPopup from "@/components/NoteDetailPopup";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { canRead } from "@/lib/sharing/unified";
import type { Note } from "@/lib/types";

/**
 * Lab Mode retirement R3 (R3 widget catalog manager, 2026-05-23):
 * canvas-surface port of `LabNotesPanel`/NotesPanel(isLabMode=true).
 *
 * Renders the cross-lab notes list inside the standard Widget frame:
 *   - one card per note the viewer can see (canRead — owner, PI, "*"
 *     wildcard, or explicit shared_with entry)
 *   - in-widget search input + Single / Running / All filter
 *   - click a card → open the existing NoteDetailPopup over the page
 *
 * The card chrome is the existing `NoteCard` component the lab `/lab`
 * page already mounts; this widget just feeds it via the same
 * `labApi.getNotes({shared_only: true})` query the R2 CommentFeedWidget
 * reads, so the cache is warm.
 *
 * R5 deletes the `/lab` route + `LabActivityPanel` / `NotesPanel`
 * lab-mode branch; this widget is the canvas-side replacement.
 */
export default function LabNotesWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "single" | "running">(
    "all",
  );
  // Phase B Batch B2 polish: stable ref on the search input so it
  // doesn't lose focus / caret when the filter-pill click triggers a
  // re-render of the surrounding grid. React keeps the same DOM node
  // because the input is a sibling of (not inside) the grid, but
  // having an explicit ref makes the focus-preservation intent
  // legible and lets us re-focus defensively after filter changes.
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Shared-only across the lab — same key the CommentFeedWidget /
  // RecentActivityWidget use, so the underlying network read is shared.
  const {
    data: notes = [],
    isLoading,
    error,
  } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // canRead filter — unified sharing primitive. The shared_only=true
  // upstream query is already a coarse filter ("the note is shared at
  // all"); canRead refines it to "this specific viewer can read this
  // specific note." Lab heads view-all; members see notes shared with
  // them or to the whole lab via the "*" sentinel.
  //
  // Note on account-type mapping: the unified-sharing Viewer uses
  // "solo" | "lab" | "lab_head" but the user-settings AccountType is
  // "member" | "lab_head". Only the `lab_head` branch actually shifts
  // behavior in canRead (the implicit view-all rule), so we collapse
  // "member" → "lab" here. The dedicated unified-sharing migration
  // (R1) is the long-term home for a single canonical AccountType.
  const visible = useMemo(() => {
    if (!currentUser) return [] as Note[];
    if (!accountType) return [] as Note[];
    const viewer = {
      username: currentUser,
      account_type:
        accountType === "lab_head" ? ("lab_head" as const) : ("lab" as const),
    };
    return notes.filter((n) => {
      const shareable = {
        owner: n.username,
        shared_with: n.shared_with ?? [],
      };
      return canRead(shareable, viewer);
    });
  }, [notes, currentUser, accountType]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return visible.filter((n) => {
      if (filterType === "single" && n.is_running_log) return false;
      if (filterType === "running" && !n.is_running_log) return false;
      if (!q) return true;
      if (n.title?.toLowerCase().includes(q)) return true;
      if (n.description?.toLowerCase().includes(q)) return true;
      return n.entries.some(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q),
      );
    });
  }, [visible, searchQuery, filterType]);

  const sorted = useMemo(() => {
    return [...filtered].sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }, [filtered]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-600" />
        Loading lab notes…
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-600">Failed to load lab notes.</p>
    );
  }

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      {/* Search + filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
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
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search lab notes…"
            className="w-full pl-8 pr-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div
          className="flex items-center gap-1"
          // Phase B Batch B2: keep caret in the search input across
          // filter changes. The pill buttons would steal focus on
          // pointerdown otherwise; preventing default here means the
          // active element stays where the user left it.
          onMouseDown={(e) => {
            if (
              searchInputRef.current &&
              document.activeElement === searchInputRef.current
            ) {
              e.preventDefault();
            }
          }}
        >
          <FilterPill
            label="All notes"
            active={filterType === "all"}
            onClick={() => setFilterType("all")}
            tone="emerald"
          />
          <FilterPill
            label="Single"
            active={filterType === "single"}
            onClick={() => setFilterType("single")}
            tone="blue"
          />
          <FilterPill
            label="In progress"
            active={filterType === "running"}
            onClick={() => setFilterType("running")}
            tone="purple"
          />
        </div>
      </div>

      {/* Grid of NoteCards. Internal scroll so the Widget body owns
          the overflow boundary. */}
      {sorted.length === 0 ? (
        searchQuery || filterType !== "all" ? (
          <p className="text-sm text-gray-400 italic">
            No notes match your filters.
          </p>
        ) : (
          // Phase B Batch B2 polish: friendlier empty state that
          // explains how to share a note instead of a one-liner.
          // The actual share affordance lives inside NoteDetailPopup
          // (per-note share dialog), which we can't open from here
          // without a note in hand — so we explain the path in copy
          // and keep the panel pleasant to land on.
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/40 px-4 py-6 text-center">
            <p className="text-sm font-medium text-gray-700">
              No shared notes across the lab yet
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Open any of your notes and use the Share dialog to share
              it with the lab. Shared notes appear here for everyone.
            </p>
          </div>
        )
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sorted.map((note) => (
              <NoteCard
                key={`${note.username}:${note.id}`}
                note={note}
                onClick={() => setSelectedNote(note)}
                isLabMode={true}
              />
            ))}
          </div>
        </div>
      )}

      {selectedNote && (
        <NoteDetailPopup
          note={selectedNote}
          onClose={() => setSelectedNote(null)}
          onUpdate={(updated) => setSelectedNote(updated)}
          onDelete={() => setSelectedNote(null)}
          readOnly={selectedNote.username !== currentUser}
        />
      )}
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
  tone,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone: "emerald" | "blue" | "purple";
}) {
  const activeCls =
    tone === "emerald"
      ? "bg-emerald-100 text-emerald-700"
      : tone === "blue"
        ? "bg-blue-100 text-blue-700"
        : "bg-purple-100 text-purple-700";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 text-xs rounded transition-colors ${
        active ? activeCls : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      }`}
    >
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase B redesign (Phase B redesign manager, 2026-05-23): content-rich
// SnapshotTile that lists the most-recently-updated shared notes as
// clickable-looking rows (Grant's stated example). Drops the
// HeroNumberTile shape; the actual note titles + authors ARE the
// signal. The SidebarTile stays as the Batch B2 doc+count row.
// ─────────────────────────────────────────────────────────────────────────────
import SidebarStatTile from "./snapshot/SidebarStatTile";
import type { SnapshotTileProps, SidebarTileProps } from "./types";

const DOC_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

function formatRelative(iso: string | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * SnapshotTile: list of the 4 most-recently-updated shared notes. Each
 * row shows a doc icon + note title + author/time so the PI sees what
 * teammates have been working on at a glance. The outer SnapshotTile
 * click already opens the full notes popup; per-row click handlers
 * aren't needed, but the rows render with hover treatment so the
 * affordance is legible. Total shared-notes count lives in a muted
 * pill at the top-right.
 */
export function SnapshotTile(_props: SnapshotTileProps) {
  const profileMap = useLabUserProfileMap();
  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const recent = useMemo(() => {
    return [...notes]
      .filter((n) => Number.isFinite(new Date(n.updated_at ?? "").getTime()))
      .sort(
        (a, b) =>
          new Date(b.updated_at ?? "").getTime() -
          new Date(a.updated_at ?? "").getTime(),
      )
      .slice(0, 4);
  }, [notes]);

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 text-gray-500">
        <span aria-hidden="true" className="text-sky-500 flex-shrink-0">
          {DOC_SVG}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-medium">
          Lab notes
        </span>
      </div>
      {notes.length > 0 && (
        <span className="absolute top-0 right-0 text-[10px] text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-full font-medium">
          {notes.length} shared
        </span>
      )}
      <div className="mt-2 flex-1 min-h-0 flex flex-col gap-1.5">
        {isLoading ? (
          <p className="text-xs text-gray-400 italic m-auto">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="text-xs text-gray-400 italic m-auto">
            No shared notes yet
          </p>
        ) : (
          recent.map((note) => {
            const author =
              profileMap[note.username]?.displayName?.trim() || note.username;
            return (
              <div
                key={`${note.username}:${note.id}`}
                className="flex items-center gap-2 min-w-0 px-1 py-0.5 rounded hover:bg-gray-50 transition-colors"
              >
                <span
                  aria-hidden="true"
                  className="text-sky-500 flex-shrink-0"
                >
                  {DOC_SVG}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">
                    {note.title || "Untitled note"}
                  </p>
                  <p className="text-[10px] text-gray-500 truncate">
                    {author} · {formatRelative(note.updated_at)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export const ExpandedView = LabNotesWidget;

/**
 * Lab overview PI tooltips (Chip B, 2026-05-25): help-badge copy for
 * the Lab notes gallery.
 */
export const HELP_TEXT =
  "Every lab note you have permission to read, searchable. Click a note to open it; PIs can read all shared notes across the lab.";

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const total = notes.length;
  return (
    <SidebarStatTile
      icon={DOC_SVG}
      iconClassName="text-sky-500"
      label="Lab notes"
      stat={
        isLoading ? (
          "—"
        ) : (
          <span
            className={`inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full text-[11px] font-semibold tabular-nums ${
              total > 0
                ? "bg-sky-100 text-sky-700"
                : "bg-gray-100 text-gray-400"
            }`}
          >
            {total}
          </span>
        )
      }
      onClick={onClick}
    />
  );
}
