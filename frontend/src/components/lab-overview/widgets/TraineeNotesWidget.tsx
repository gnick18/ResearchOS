"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi } from "@/lib/local-api";
import NoteDetailPopup from "@/components/NoteDetailPopup";
import UserAvatar from "@/components/UserAvatar";
import Tooltip from "@/components/Tooltip";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { canRead } from "@/lib/sharing/unified";
import { weekLabel } from "@/lib/weekly-goals/week";
import type { Note, WeeklyGoal } from "@/lib/types";
import type {
  ExpandedViewProps,
  SnapshotTileProps,
  SidebarTileProps,
} from "./types";

/**
 * Trainee notes + weekly goals widget (PI beta feedback, weekly-goals
 * widget, 2026-05-29). EXTENDS the original Trainee notes widget
 * (pi-notes-widget, 2026-05-29).
 *
 * A roster-style PI surface. Clicking a member surfaces the notes AND the
 * weekly goals that member has SHARED with the viewing user, so a PI can
 * read a trainee's 1:1 / running-log notes plus the weekly goals set in
 * those meetings at a glance. Click a note row to open it read-only.
 *
 * TWO MODES (driven by the per-instance `config.pinnedMember`):
 *   - Everyone mode (default, no config): roster -> click a member ->
 *     that member's shared notes + shared weekly goals.
 *   - Single-member mode (config.pinnedMember set): shows that one
 *     member's notes + weekly goals directly and concisely, no roster
 *     step. The PI can place one widget per trainee.
 *
 * PRIVACY CONTRACT (the whole point of this widget):
 *   The list NEVER exposes a member's private / unshared notes OR goals.
 *   BOTH datasets flow through the SAME two-gate sharing pipeline, reading
 *   the EXISTING sharing-respecting aggregations; we never read raw
 *   `users/<member>/...` in a way that bypasses sharing:
 *
 *     1. `labApi.getNotes({ shared_only: true })` /
 *        `labApi.getWeeklyGoals({ shared_only: true })` are the coarse
 *        gates. They return only records whose `is_shared` flag is set, so
 *        a member's owner-only records never enter the dataset at all.
 *     2. `canRead(shareable, viewer)` is the precise per-viewer gate (same
 *        primitive `LabNotesWidget` uses). A record reaches the PI only if
 *        it is shared with them specifically OR whole-lab via the "*"
 *        sentinel OR the viewer is a lab_head (implicit view-all). The
 *        lab_head branch is layered ON TOP of gate 1, so even view-all
 *        only ever sees genuinely-shared records, never a private draft.
 *
 *   A member's OWN records (where the record's owner === currentUser) drop
 *   out naturally because the roster lists OTHER members.
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

// Target / bullseye motif for weekly goals. Distinct from the document
// motif used for notes so the two sections read apart at a glance. NOT the
// Gantt high-level-goal icon — weekly goals are a separate concept.
const TARGET_SVG = (
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
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </svg>
);

const CHECK_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
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

const PIN_SVG = (
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
    <line x1="12" y1="17" x2="12" y2="22" />
    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z" />
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

/** The unified-sharing Viewer the gate compares against. Collapses the
 *  user-settings AccountType ("member" | "lab_head") into the sharing
 *  Viewer account_type the same way LabNotesWidget does. */
function useViewer(): { username: string; account_type: "lab" | "lab_head" } | null {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  return useMemo(() => {
    if (!currentUser || !accountType) return null;
    return {
      username: currentUser,
      account_type:
        accountType === "lab_head" ? ("lab_head" as const) : ("lab" as const),
    };
  }, [currentUser, accountType]);
}

/**
 * The viewer-scoped, shared-only notes the widget operates on. GATE 1
 * (shared_only) + GATE 2 (canRead). Exported shape so the SnapshotTile /
 * SidebarTile / ExpandedView all compute the same set.
 */
function useSharedNotesByMember(): {
  isLoading: boolean;
  /** member username -> their shared-with-the-viewer notes, newest first */
  byMember: Map<string, Note[]>;
} {
  const { currentUser } = useCurrentUser();
  const viewer = useViewer();

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
    if (!currentUser || !viewer) return map;
    for (const note of notes) {
      // Skip the viewer's own notes — the roster lists OTHER members.
      if (note.username === currentUser) continue;
      // GATE 2: precise per-viewer read check.
      const shareable = {
        owner: note.username,
        shared_with: note.shared_with ?? [],
      };
      if (!canRead(shareable, viewer)) continue;
      const list = map.get(note.username) ?? [];
      list.push(note);
      map.set(note.username, list);
    }
    for (const [, list] of map) {
      list.sort(
        (a, b) =>
          new Date(b.updated_at ?? "").getTime() -
          new Date(a.updated_at ?? "").getTime(),
      );
    }
    return map;
  }, [notes, currentUser, viewer]);

  return { isLoading, byMember };
}

/**
 * The viewer-scoped, shared-only WEEKLY GOALS the widget operates on.
 * MIRRORS `useSharedNotesByMember` EXACTLY — same two gates, same
 * structure — only the aggregation source differs
 * (`labApi.getWeeklyGoals` instead of `labApi.getNotes`). This is how the
 * privacy contract is identical for notes and goals.
 */
function useSharedWeeklyGoalsByMember(): {
  isLoading: boolean;
  /** member username -> their shared-with-the-viewer goals, newest week first */
  byMember: Map<string, WeeklyGoal[]>;
} {
  const { currentUser } = useCurrentUser();
  const viewer = useViewer();

  // GATE 1: shared_only -> only goals with is_shared set come back.
  const { data: goals = [], isLoading } = useQuery<WeeklyGoal[]>({
    queryKey: ["lab", "weekly-goals-shared"],
    queryFn: () => labApi.getWeeklyGoals({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const byMember = useMemo(() => {
    const map = new Map<string, WeeklyGoal[]>();
    if (!currentUser || !viewer) return map;
    for (const goal of goals) {
      // Skip the viewer's own goals — the roster lists OTHER members.
      if (goal.owner === currentUser) continue;
      // GATE 2: precise per-viewer read check. `WeeklyGoal` carries the
      // same `{ owner, shared_with }` shape as a Note, so the identical
      // `canRead` primitive applies with no special-casing.
      const shareable = {
        owner: goal.owner,
        shared_with: goal.shared_with ?? [],
      };
      if (!canRead(shareable, viewer)) continue;
      const list = map.get(goal.owner) ?? [];
      list.push(goal);
      map.set(goal.owner, list);
    }
    // Newest week first, then incomplete before complete within a week.
    for (const [, list] of map) {
      list.sort((a, b) => {
        const byWeek = b.week_of.localeCompare(a.week_of);
        if (byWeek !== 0) return byWeek;
        if (a.is_complete !== b.is_complete) return a.is_complete ? 1 : -1;
        return b.id - a.id;
      });
    }
    return map;
  }, [goals, currentUser, viewer]);

  return { isLoading, byMember };
}

// ─────────────────────────────────────────────────────────────────────────────
// Member detail panel (shared by everyone-mode drill-down + single-member mode)
// ─────────────────────────────────────────────────────────────────────────────

function MemberDetail({
  member,
  label,
  notes,
  goals,
  onOpenNote,
}: {
  member: string;
  label: string;
  notes: Note[];
  goals: WeeklyGoal[];
  onOpenNote: (note: Note) => void;
}) {
  void member;
  void label;
  return (
    <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-4">
      {/* Weekly goals section. Conceptually + visually SEPARATE from the
          notes section (and from the Gantt). */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <span aria-hidden="true" className="text-emerald-500 flex-shrink-0">
            {TARGET_SVG}
          </span>
          <span className="text-meta uppercase tracking-wide font-semibold text-foreground-muted">
            Weekly goals
          </span>
        </div>
        {goals.length === 0 ? (
          <p className="text-meta text-foreground-muted italic">
            No weekly goals shared with you yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {goals.map((goal) => (
              <li
                key={`g-${goal.owner}-${goal.id}`}
                className="flex items-start gap-2 text-body"
                data-testid={`trainee-goal-${goal.id}`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full flex-shrink-0 ${
                    goal.is_complete
                      ? "bg-emerald-500 text-white"
                      : "border border-border text-transparent"
                  }`}
                >
                  {CHECK_SVG}
                </span>
                <span className="flex-1 min-w-0">
                  <span
                    className={
                      goal.is_complete
                        ? "text-foreground-muted line-through"
                        : "text-foreground"
                    }
                  >
                    {goal.text}
                  </span>
                  <span className="ml-2 text-meta text-foreground-muted">
                    {weekLabel(goal.week_of)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Notes section. */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span aria-hidden="true" className="text-sky-500 flex-shrink-0">
            {DOC_SVG}
          </span>
          <span className="text-meta uppercase tracking-wide font-semibold text-foreground-muted">
            Shared notes
          </span>
        </div>
        {notes.length === 0 ? (
          <p className="text-meta text-foreground-muted italic">
            No notes shared with you yet. Private notes never appear.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-border rounded-lg">
            {notes.map((note) => (
              <li key={`${note.username}:${note.id}`}>
                <button
                  type="button"
                  onClick={() => onOpenNote(note)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-sunken transition-colors"
                  data-testid={`trainee-notes-note-${note.id}`}
                >
                  <span aria-hidden="true" className="text-sky-500 flex-shrink-0">
                    {DOC_SVG}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-body font-medium text-foreground truncate">
                      {note.title || "Untitled note"}
                      {note.is_running_log && (
                        <span className="ml-2 px-1.5 py-0.5 text-meta font-semibold rounded bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 align-middle">
                          Running log
                        </span>
                      )}
                    </p>
                    <p className="text-meta text-foreground-muted truncate">
                      Updated {formatWhen(note.updated_at)}
                    </p>
                  </div>
                  <span aria-hidden="true" className="text-foreground-muted flex-shrink-0">
                    {CHEVRON_RIGHT_SVG}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Config control (single-member pin). Rendered in the ExpandedView popup
 * only when the canvas supplies `onConfigChange` (the /lab-overview canvas
 * surface). Lets the PI pin this widget instance to one trainee, or clear
 * the pin to return to roster (everyone) mode.
 */
function PinConfigBar({
  roster,
  pinnedMember,
  onConfigChange,
}: {
  roster: { username: string; label: string }[];
  pinnedMember: string | undefined;
  onConfigChange: ExpandedViewProps["onConfigChange"];
}) {
  if (!onConfigChange) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-sunken border border-border px-3 py-2">
      <span aria-hidden="true" className="text-foreground-muted flex-shrink-0">
        {PIN_SVG}
      </span>
      <label
        htmlFor="trainee-widget-pin"
        className="text-meta font-medium text-foreground-muted flex-shrink-0"
      >
        Pin to trainee
      </label>
      <select
        id="trainee-widget-pin"
        data-testid="trainee-widget-pin-select"
        value={pinnedMember ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onConfigChange(v ? { pinnedMember: v } : null);
        }}
        className="flex-1 min-w-0 text-meta rounded border border-border bg-surface-raised px-2 py-1 text-foreground"
      >
        <option value="">Everyone (roster)</option>
        {roster.map((r) => (
          <option key={r.username} value={r.username}>
            {r.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * ExpandedView: the popup body. Renders either the roster drill-down
 * (everyone mode) or a single member's detail (single-member mode), driven
 * by `config.pinnedMember`.
 */
export default function TraineeNotesWidget(props?: ExpandedViewProps) {
  const config = props?.config;
  const onConfigChange = props?.onConfigChange;
  const pinnedMember = config?.pinnedMember;

  const { currentUser } = useCurrentUser();
  const profileMap = useLabUserProfileMap();
  const { isLoading: notesLoading, byMember: notesByMember } =
    useSharedNotesByMember();
  const { isLoading: goalsLoading, byMember: goalsByMember } =
    useSharedWeeklyGoalsByMember();
  const isLoading = notesLoading || goalsLoading;

  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);

  // Roster = every other lab member, lab_head first then alphabetical.
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
      })
      .map((p) => ({
        username: p.username,
        label: p.displayName?.trim() || p.username,
        account_type: p.account_type,
      }));
  }, [profileMap, currentUser]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-body text-foreground-muted">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-sky-600" />
        Loading shared notes and goals…
      </div>
    );
  }

  const renderNotePopup = () =>
    selectedNote && (
      <NoteDetailPopup
        note={selectedNote}
        onClose={() => setSelectedNote(null)}
        onUpdate={(updated) => setSelectedNote(updated)}
        onDelete={() => setSelectedNote(null)}
        readOnly={selectedNote.username !== currentUser}
      />
    );

  // ── Single-member mode: show that one member directly, no roster step ──
  if (pinnedMember) {
    const profile = profileMap[pinnedMember];
    const label = profile?.displayName?.trim() || pinnedMember;
    return (
      <div className="h-full flex flex-col gap-3 min-h-0">
        <PinConfigBar
          roster={roster}
          pinnedMember={pinnedMember}
          onConfigChange={onConfigChange}
        />
        <div className="flex items-center gap-2 min-w-0">
          <UserAvatar username={pinnedMember} size="sm" />
          <span className="text-body font-semibold text-foreground truncate">
            {label}
          </span>
          <span className="px-1.5 py-0.5 text-meta font-semibold rounded bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300">
            Pinned
          </span>
        </div>
        <MemberDetail
          member={pinnedMember}
          label={label}
          notes={notesByMember.get(pinnedMember) ?? []}
          goals={goalsByMember.get(pinnedMember) ?? []}
          onOpenNote={(n) => setSelectedNote(n)}
        />
        {renderNotePopup()}
      </div>
    );
  }

  // ── Everyone mode: roster -> drill-down ──
  if (selectedMember) {
    const profile = profileMap[selectedMember];
    const label = profile?.displayName?.trim() || selectedMember;
    return (
      <div className="h-full flex flex-col gap-3 min-h-0">
        <PinConfigBar
          roster={roster}
          pinnedMember={undefined}
          onConfigChange={onConfigChange}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedMember(null)}
            className="flex items-center gap-1 text-meta font-medium text-foreground-muted hover:text-foreground"
            data-testid="trainee-notes-back"
          >
            <span aria-hidden="true">{BACK_ARROW_SVG}</span>
            Roster
          </button>
          <span className="text-foreground-muted" aria-hidden="true">
            /
          </span>
          <div className="flex items-center gap-2 min-w-0">
            <UserAvatar username={selectedMember} size="sm" />
            <span className="text-body font-semibold text-foreground truncate">
              {label}
            </span>
          </div>
        </div>
        <MemberDetail
          member={selectedMember}
          label={label}
          notes={notesByMember.get(selectedMember) ?? []}
          goals={goalsByMember.get(selectedMember) ?? []}
          onOpenNote={(n) => setSelectedNote(n)}
        />
        {renderNotePopup()}
      </div>
    );
  }

  // Roster view.
  return (
    <div className="h-full flex flex-col gap-2 min-h-0">
      <PinConfigBar
        roster={roster}
        pinnedMember={undefined}
        onConfigChange={onConfigChange}
      />
      <p className="text-meta text-foreground-muted">
        Click a member to read the notes and weekly goals they have shared
        with you.
      </p>
      {roster.length === 0 ? (
        <p className="text-body text-foreground-muted italic">
          No other lab members found yet.
        </p>
      ) : (
        <ul className="flex-1 min-h-0 overflow-auto divide-y divide-gray-100 border border-border rounded-lg">
          {roster.map((p) => {
            const noteCount = notesByMember.get(p.username)?.length ?? 0;
            const goalCount = goalsByMember.get(p.username)?.length ?? 0;
            return (
              <li key={p.username}>
                <button
                  type="button"
                  onClick={() => setSelectedMember(p.username)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-sunken transition-colors"
                  data-testid={`trainee-notes-member-${p.username}`}
                >
                  <UserAvatar username={p.username} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-body font-medium text-foreground truncate">
                        {p.label}
                      </span>
                      {p.account_type === "lab_head" && (
                        <span className="px-1.5 py-0.5 text-meta font-semibold rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200">
                          PI
                        </span>
                      )}
                    </div>
                    <div className="text-meta text-foreground-muted truncate">
                      @{p.username}
                    </div>
                  </div>
                  {/* Goal count pill (emerald, target motif). */}
                  <Tooltip label="Weekly goals shared with you" placement="top">
                    <span
                      className={`flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-meta font-semibold tabular-nums ${
                        goalCount > 0
                          ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                          : "bg-surface-sunken text-foreground-muted"
                      }`}
                    >
                      <span aria-hidden="true">{TARGET_SVG}</span>
                      {goalCount}
                    </span>
                  </Tooltip>
                  {/* Note count pill (sky, document motif). */}
                  <Tooltip label="Notes shared with you" placement="top">
                    <span
                      className={`flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-meta font-semibold tabular-nums ${
                        noteCount > 0
                          ? "bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300"
                          : "bg-surface-sunken text-foreground-muted"
                      }`}
                    >
                      <span aria-hidden="true">{DOC_SVG}</span>
                      {noteCount}
                    </span>
                  </Tooltip>
                  <span aria-hidden="true" className="text-foreground-muted flex-shrink-0">
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
  "A roster of your lab members. Click a member to read the notes and weekly goals they have shared with you. Only shared records appear; private notes and goals are never shown. Pin the widget to a single trainee to skip the roster.";

// ─────────────────────────────────────────────────────────────────────────────
// Tiles
// ─────────────────────────────────────────────────────────────────────────────

import SidebarStatTile from "./snapshot/SidebarStatTile";

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
 * SnapshotTile. In everyone mode, shows top members by shared-record count.
 * In single-member mode (`config.pinnedMember`), shows that one member's
 * note + goal counts directly.
 */
export function SnapshotTile(props: SnapshotTileProps) {
  const pinnedMember = props.config?.pinnedMember;
  const { currentUser } = useCurrentUser();
  const profileMap = useLabUserProfileMap();
  const { isLoading: notesLoading, byMember: notesByMember } =
    useSharedNotesByMember();
  const { isLoading: goalsLoading, byMember: goalsByMember } =
    useSharedWeeklyGoalsByMember();
  const isLoading = notesLoading || goalsLoading;

  // Everyone-mode aggregates. Computed unconditionally (before the
  // single-member early return) so the hook order stays stable across
  // both modes (rules of hooks).
  const rows = useMemo(() => {
    return Object.values(profileMap)
      .filter((p) => p.username !== currentUser)
      .map((p) => ({
        username: p.username,
        label: p.displayName?.trim() || p.username,
        notes: notesByMember.get(p.username)?.length ?? 0,
        goals: goalsByMember.get(p.username)?.length ?? 0,
      }))
      .sort(
        (a, b) =>
          b.notes + b.goals - (a.notes + a.goals) ||
          a.label.localeCompare(b.label),
      )
      .slice(0, 4);
  }, [profileMap, notesByMember, goalsByMember, currentUser]);

  const totalShared = useMemo(() => {
    let n = 0;
    for (const list of notesByMember.values()) n += list.length;
    for (const list of goalsByMember.values()) n += list.length;
    return n;
  }, [notesByMember, goalsByMember]);

  // Single-member tile.
  if (pinnedMember) {
    const profile = profileMap[pinnedMember];
    const label = profile?.displayName?.trim() || pinnedMember;
    const noteCount = notesByMember.get(pinnedMember)?.length ?? 0;
    const goalCount = goalsByMember.get(pinnedMember)?.length ?? 0;
    return (
      <div className="relative h-full overflow-hidden flex flex-col">
        <div className="flex items-center gap-1.5 text-foreground-muted">
          <span aria-hidden="true" className="text-sky-500 flex-shrink-0">
            {PEOPLE_SVG}
          </span>
          <span className="text-meta uppercase tracking-wide font-medium truncate">
            {label}
          </span>
        </div>
        <div className="mt-2 flex-1 min-h-0 flex flex-col justify-center gap-2">
          {isLoading ? (
            <p className="text-meta text-foreground-muted italic">Loading…</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="text-emerald-500">
                  {TARGET_SVG}
                </span>
                <span className="text-body font-semibold tabular-nums text-foreground">
                  {goalCount}
                </span>
                <span className="text-meta text-foreground-muted">weekly goals</span>
              </div>
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="text-sky-500">
                  {DOC_SVG}
                </span>
                <span className="text-body font-semibold tabular-nums text-foreground">
                  {noteCount}
                </span>
                <span className="text-meta text-foreground-muted">shared notes</span>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 text-foreground-muted">
        <span aria-hidden="true" className="text-sky-500 flex-shrink-0">
          {PEOPLE_SVG}
        </span>
        <span className="text-meta uppercase tracking-wide font-medium">
          Trainee notes &amp; goals
        </span>
      </div>
      {totalShared > 0 && (
        <span className="absolute top-0 right-0 text-meta text-foreground-muted bg-surface-sunken px-1.5 py-0.5 rounded-full font-medium">
          {totalShared} shared
        </span>
      )}
      <div className="mt-2 flex-1 min-h-0 flex flex-col gap-1.5">
        {isLoading ? (
          <p className="text-meta text-foreground-muted italic m-auto">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-meta text-foreground-muted italic m-auto">
            No lab members yet
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={row.username}
              className="flex items-center gap-2 min-w-0 px-1 py-0.5 rounded hover:bg-surface-sunken transition-colors"
            >
              <UserAvatar username={row.username} size="sm" />
              <span className="flex-1 min-w-0 text-meta font-medium text-foreground truncate">
                {row.label}
              </span>
              <span
                className={`flex-shrink-0 text-meta font-semibold tabular-nums ${
                  row.goals > 0 ? "text-emerald-600 dark:text-emerald-300" : "text-foreground-muted"
                }`}
              >
                {row.goals}g
              </span>
              <span
                className={`flex-shrink-0 text-meta font-semibold tabular-nums ${
                  row.notes > 0 ? "text-sky-700 dark:text-sky-300" : "text-foreground-muted"
                }`}
              >
                {row.notes}n
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
  const { isLoading: notesLoading, byMember: notesByMember } =
    useSharedNotesByMember();
  const { isLoading: goalsLoading, byMember: goalsByMember } =
    useSharedWeeklyGoalsByMember();
  const isLoading = notesLoading || goalsLoading;

  const memberCount = useMemo(
    () =>
      Object.values(profileMap).filter((p) => p.username !== currentUser)
        .length,
    [profileMap, currentUser],
  );
  const totalShared = useMemo(() => {
    let n = 0;
    for (const list of notesByMember.values()) n += list.length;
    for (const list of goalsByMember.values()) n += list.length;
    return n;
  }, [notesByMember, goalsByMember]);

  return (
    <SidebarStatTile
      icon={PEOPLE_SVG}
      iconClassName="text-sky-500"
      label="Trainee notes & goals"
      stat={
        isLoading ? (
          "—"
        ) : (
          <span
            className={`inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full text-meta font-semibold tabular-nums ${
              totalShared > 0
                ? "bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300"
                : "bg-surface-sunken text-foreground-muted"
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
