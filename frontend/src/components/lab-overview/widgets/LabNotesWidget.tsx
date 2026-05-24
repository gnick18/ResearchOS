"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi } from "@/lib/local-api";
import NoteCard from "@/components/NoteCard";
import NoteDetailPopup from "@/components/NoteDetailPopup";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
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
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search lab notes…"
            className="w-full pl-8 pr-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div className="flex items-center gap-1">
          <FilterPill
            label="All"
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
            label="Running"
            active={filterType === "running"}
            onClick={() => setFilterType("running")}
            tone="purple"
          />
        </div>
      </div>

      {/* Grid of NoteCards. Internal scroll so the Widget body owns
          the overflow boundary. */}
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400 italic">
          {searchQuery || filterType !== "all"
            ? "No notes match your filters."
            : "No shared notes across the lab yet."}
        </p>
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
// Phase A snapshot + expanded contract (Phase A redispatch manager, 2026-05-23)
// ─────────────────────────────────────────────────────────────────────────────
import StatTile from "./snapshot/StatTile";
import type { SnapshotTileProps } from "./types";

export function SnapshotTile(_props: SnapshotTileProps) {
  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return (
    <StatTile
      icon={
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
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
      }
      iconClassName="text-sky-500"
      label="Lab notes"
      stat={isLoading ? "—" : notes.length}
      sub={notes.length === 0 ? "No shared notes" : "shared lab-wide"}
    />
  );
}

export const ExpandedView = LabNotesWidget;

// ─────────────────────────────────────────────────────────────────────────────
// SidebarTile (customizable PI sidebar manager #146, 2026-05-23)
// ─────────────────────────────────────────────────────────────────────────────
import SidebarStatTile from "./snapshot/SidebarStatTile";
import type { SidebarTileProps } from "./types";

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return (
    <SidebarStatTile
      icon={
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
      }
      iconClassName="text-sky-500"
      label="Lab notes"
      stat={isLoading ? "—" : notes.length}
      onClick={onClick}
    />
  );
}
