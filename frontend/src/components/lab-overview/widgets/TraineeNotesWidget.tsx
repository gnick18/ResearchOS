"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi } from "@/lib/local-api";
import NoteDetailPopup from "@/components/NoteDetailPopup";
import UserAvatar from "@/components/UserAvatar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { canRead } from "@/lib/sharing/unified";
import type { Note } from "@/lib/types";

/**
 * Trainee notes widget (PI beta feedback, pi-notes-widget, 2026-05-29).
 *
 * A roster-style list of lab members. Clicking a member surfaces the
 * notes that member has SHARED with the viewing user, so a PI can read a
 * trainee's 1:1 / running-log notes at a glance without hunting through
 * the cross-lab notes gallery. Click a note row to open it read-only.
 *
 * PRIVACY CONTRACT (the whole point of this widget):
 *   The list NEVER exposes a member's private / unshared notes. Two
 *   gates, both reading the EXISTING shared-data aggregation; we never
 *   read raw `users/<member>/notes/` in a way that bypasses sharing:
 *
 *     1. `labApi.getNotes({ shared_only: true })` is the coarse gate.
 *        It returns only notes whose `is_shared` flag is set, so a
 *        member's owner-only notes never enter the dataset at all.
 *     2. `canRead(shareable, viewer)` is the precise per-viewer gate
 *        (same primitive `LabNotesWidget` uses). A note reaches the PI
 *        only if it is shared with them specifically OR whole-lab via
 *        the "*" sentinel OR the viewer is a lab_head (implicit
 *        view-all). The lab_head branch is deliberately layered on TOP
 *        of gate 1, so even view-all only ever sees genuinely-shared
 *        notes, never a private draft.
 *
 *   The member's OWN notes (where `note.username === currentUser`) are
 *   not interesting here (the PI sees their own notes elsewhere) and the
 *   roster lists OTHER members, so self-owned notes drop out naturally.
 *
 * Mirrors `LabRoster` (lab-head/LabRoster.tsx) for the member-row look
 * and reuses the same `labApi.getNotes({ shared_only: true })` query key
 * as `LabNotesWidget` so the underlying read is shared (warm cache).
 */

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

const CHEVRON_RIGHT_SVG = (
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
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const BACK_ARROW_SVG = (
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
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

function formatWhen(iso: string | undefined | null): string {
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
 * The viewer-scoped, shared-only notes the widget operates on. Exported
 * helper so the SnapshotTile / SidebarTile / ExpandedView all compute
 * the same set, and so the privacy gate has a single home.
 */
function useSharedNotesByMember(): {
  isLoading: boolean;
  /** member username -> their shared-with-the-viewer notes, newest first */
  byMember: Map<string, Note[]>;
} {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);

  // Same query key as LabNotesWidget so React Query dedupes the read.
  // GATE 1: shared_only -> only notes with is_shared set come back.
  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const byMember = useMemo(() => {
    const map = new Map<string, Note[]>();
    if (!currentUser || !accountType) return map;
    // The unified-sharing Viewer uses "solo" | "lab" | "lab_head"; the
    // user-settings AccountType is "member" | "lab_head". Only the
    // lab_head branch shifts canRead behavior, so collapse "member" ->
    // "lab" (same mapping LabNotesWidget uses).
    const viewer = {
      username: currentUser,
      account_type:
        accountType === "lab_head" ? ("lab_head" as const) : ("lab" as const),
    };
    for (const note of notes) {
      // Skip the viewer's own notes — the roster lists OTHER members and
      // the PI reads their own notes elsewhere.
      if (note.username === currentUser) continue;
      // GATE 2: precise per-viewer read check. Drops any note not shared
      // with this viewer (or whole-lab via "*"); lab_head view-all still
      // only ever sees notes that passed GATE 1 (genuinely shared).
      const shareable = {
        owner: note.username,
        shared_with: note.shared_with ?? [],
      };
      if (!canRead(shareable, viewer)) continue;
      const list = map.get(note.username) ?? [];
      list.push(note);
      map.set(note.username, list);
    }
    // Newest-first within each member.
    for (const [, list] of map) {
      list.sort(
        (a, b) =>
          new Date(b.updated_at ?? "").getTime() -
          new Date(a.updated_at ?? "").getTime(),
      );
    }
    return map;
  }, [notes, currentUser, accountType]);

  return { isLoading, byMember };
}

/**
 * ExpandedView: the roster -> member -> shared notes drill-down. This is
 * the popup body opened from the snapshot / sidebar tiles.
 */
export default function TraineeNotesWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const { currentUser } = useCurrentUser();
  const profileMap = useLabUserProfileMap();
  const { isLoading, byMember } = useSharedNotesByMember();
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);

  // Roster = every other lab member, lab_head first then alphabetical.
  // Drawn from the profile map (the canonical cross-user roster source)
  // so a member with zero shared notes still appears with an empty
  // state, matching the brief.
  const roster = useMemo(() => {
    return Object.values(profileMap)
      .filter((p) => p.username !== currentUser)
      .sort((a, b) => {
        if (a.account_type !== b.account_type) {
          return a.account_type === "lab_head" ? -1 : 1;
        }
        const aLabel = a.displayName?.trim() || a.username;
        const bLabel = b.displayName?.trim() || b.username;
        return aLabel.localeCompare(bLabel);
      });
  }, [profileMap, currentUser]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-sky-600" />
        Loading lab roster…
      </div>
    );
  }

  // Drill-down view: a member's shared notes.
  if (selectedMember) {
    const profile = profileMap[selectedMember];
    const label = profile?.displayName?.trim() || selectedMember;
    const memberNotes = byMember.get(selectedMember) ?? [];
    return (
      <div className="h-full flex flex-col gap-3 min-h-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedMember(null)}
            className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
            data-testid="trainee-notes-back"
          >
            <span aria-hidden="true">{BACK_ARROW_SVG}</span>
            Roster
          </button>
          <span className="text-gray-300" aria-hidden="true">
            /
          </span>
          <div className="flex items-center gap-2 min-w-0">
            <UserAvatar username={selectedMember} size="sm" />
            <span className="text-sm font-semibold text-gray-900 truncate">
              {label}
            </span>
          </div>
        </div>

        {memberNotes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/40 px-4 py-6 text-center">
            <p className="text-sm font-medium text-gray-700">
              {label} has not shared any notes with you yet
            </p>
            <p className="mt-1 text-xs text-gray-500">
              When {label} shares a note with you (or with the whole lab),
              it shows up here. Private notes never appear.
            </p>
          </div>
        ) : (
          <ul className="flex-1 min-h-0 overflow-auto divide-y divide-gray-100 border border-gray-200 rounded-lg">
            {memberNotes.map((note) => (
              <li key={`${note.username}:${note.id}`}>
                <button
                  type="button"
                  onClick={() => setSelectedNote(note)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  data-testid={`trainee-notes-note-${note.id}`}
                >
                  <span
                    aria-hidden="true"
                    className="text-sky-500 flex-shrink-0"
                  >
                    {DOC_SVG}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {note.title || "Untitled note"}
                      {note.is_running_log && (
                        <span className="ml-2 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-purple-100 text-purple-700 align-middle">
                          Running log
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-gray-500 truncate">
                      Updated {formatWhen(note.updated_at)}
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="text-gray-300 flex-shrink-0"
                  >
                    {CHEVRON_RIGHT_SVG}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selectedNote && (
          <NoteDetailPopup
            note={selectedNote}
            onClose={() => setSelectedNote(null)}
            onUpdate={(updated) => setSelectedNote(updated)}
            onDelete={() => setSelectedNote(null)}
            // A trainee's shared note is always read-only here unless the
            // viewer happens to own it (they don't — self is filtered
            // out), so the popup opens read-only.
            readOnly={selectedNote.username !== currentUser}
          />
        )}
      </div>
    );
  }

  // Roster view.
  return (
    <div className="h-full flex flex-col gap-2 min-h-0">
      <p className="text-xs text-gray-500">
        Click a member to read the notes they have shared with you.
      </p>
      {roster.length === 0 ? (
        <p className="text-sm text-gray-400 italic">
          No other lab members found yet.
        </p>
      ) : (
        <ul className="flex-1 min-h-0 overflow-auto divide-y divide-gray-100 border border-gray-200 rounded-lg">
          {roster.map((p) => {
            const label = p.displayName?.trim() || p.username;
            const count = byMember.get(p.username)?.length ?? 0;
            return (
              <li key={p.username}>
                <button
                  type="button"
                  onClick={() => setSelectedMember(p.username)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  data-testid={`trainee-notes-member-${p.username}`}
                >
                  <UserAvatar username={p.username} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {label}
                      </span>
                      {p.account_type === "lab_head" && (
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-800">
                          PI
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      @{p.username}
                    </div>
                  </div>
                  <span
                    className={`flex-shrink-0 inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full text-[11px] font-semibold tabular-nums ${
                      count > 0
                        ? "bg-sky-100 text-sky-700"
                        : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {count}
                  </span>
                  <span aria-hidden="true" className="text-gray-300 flex-shrink-0">
                    {CHEVRON_RIGHT_SVG}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const ExpandedView = TraineeNotesWidget;

/**
 * Lab overview PI tooltips help-badge copy.
 */
export const HELP_TEXT =
  "A roster of your lab members. Click a member to read the notes they have shared with you (1:1 or running-log notes). Only shared notes appear; private notes are never shown.";

// ─────────────────────────────────────────────────────────────────────────────
// Tiles
// ─────────────────────────────────────────────────────────────────────────────

import SidebarStatTile from "./snapshot/SidebarStatTile";
import type { SnapshotTileProps, SidebarTileProps } from "./types";

const PEOPLE_SVG = (
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
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

/**
 * SnapshotTile: top members by shared-note count, so the PI sees at a
 * glance who has shared what. The outer tile click opens the full roster
 * popup (the canvas owns that wiring); per-row clicks aren't needed.
 */
export function SnapshotTile(_props: SnapshotTileProps) {
  const { currentUser } = useCurrentUser();
  const profileMap = useLabUserProfileMap();
  const { isLoading, byMember } = useSharedNotesByMember();

  const rows = useMemo(() => {
    return Object.values(profileMap)
      .filter((p) => p.username !== currentUser)
      .map((p) => ({
        username: p.username,
        label: p.displayName?.trim() || p.username,
        count: byMember.get(p.username)?.length ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 4);
  }, [profileMap, byMember, currentUser]);

  const totalShared = useMemo(() => {
    let n = 0;
    for (const list of byMember.values()) n += list.length;
    return n;
  }, [byMember]);

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 text-gray-500">
        <span aria-hidden="true" className="text-sky-500 flex-shrink-0">
          {PEOPLE_SVG}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-medium">
          Trainee notes
        </span>
      </div>
      {totalShared > 0 && (
        <span className="absolute top-0 right-0 text-[10px] text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-full font-medium">
          {totalShared} shared
        </span>
      )}
      <div className="mt-2 flex-1 min-h-0 flex flex-col gap-1.5">
        {isLoading ? (
          <p className="text-xs text-gray-400 italic m-auto">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-gray-400 italic m-auto">
            No lab members yet
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={row.username}
              className="flex items-center gap-2 min-w-0 px-1 py-0.5 rounded hover:bg-gray-50 transition-colors"
            >
              <UserAvatar username={row.username} size="sm" />
              <span className="flex-1 min-w-0 text-xs font-medium text-gray-800 truncate">
                {row.label}
              </span>
              <span
                className={`flex-shrink-0 text-[10px] font-semibold tabular-nums ${
                  row.count > 0 ? "text-sky-700" : "text-gray-400"
                }`}
              >
                {row.count}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { currentUser } = useCurrentUser();
  const profileMap = useLabUserProfileMap();
  const { isLoading, byMember } = useSharedNotesByMember();

  const memberCount = useMemo(
    () =>
      Object.values(profileMap).filter((p) => p.username !== currentUser)
        .length,
    [profileMap, currentUser],
  );
  const totalShared = useMemo(() => {
    let n = 0;
    for (const list of byMember.values()) n += list.length;
    return n;
  }, [byMember]);

  return (
    <SidebarStatTile
      icon={PEOPLE_SVG}
      iconClassName="text-sky-500"
      label="Trainee notes"
      stat={
        isLoading ? (
          "—"
        ) : (
          <span
            className={`inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full text-[11px] font-semibold tabular-nums ${
              totalShared > 0
                ? "bg-sky-100 text-sky-700"
                : "bg-gray-100 text-gray-400"
            }`}
          >
            {totalShared}
          </span>
        )
      }
      sub={isLoading ? undefined : `${memberCount} members`}
      onClick={onClick}
    />
  );
}
