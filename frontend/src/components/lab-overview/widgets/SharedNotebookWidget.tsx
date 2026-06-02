"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { labApi } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { mondayOf } from "@/lib/weekly-goals/week";
import UserAvatar from "@/components/UserAvatar";
import Tooltip from "@/components/Tooltip";
import type { Note, SharedNotebook, WeeklyGoal } from "@/lib/types";
import type {
  ExpandedViewProps,
  SnapshotTileProps,
  SidebarTileProps,
} from "./types";
import StatTile from "./snapshot/StatTile";
import SidebarStatTile from "./snapshot/SidebarStatTile";

/**
 * Shared Notebook widget (Shared 1:1 Notebooks Phase 4, notebooks-phase4-widget
 * sub-bot, 2026-06-02). See docs/proposals/SHARED_NOTEBOOKS_PROPOSAL.md
 * ("OPTIONAL HOME WIDGET: a widget that surfaces a chosen shared notebook
 * (glanceable notes + tasks)").
 *
 * A GLANCEABLE surface for ONE shared 1:1 notebook the viewer is in: its most
 * recent notes + its open weekly tasks, under the "shared with <other member>"
 * context. Member-visible (both a PI and a student can add it). Nothing is
 * stored beyond the existing widget config; everything is computed at load from
 * the SAME notebook reads the Notes-tab view uses (`labApi.getSharedNotebooks`
 * / `getNotebookNotes` / `getNotebookWeeklyTasks`), so React Query dedupes the
 * fetches and there is no new data-shape.
 *
 * WHICH NOTEBOOK (per-instance config): a 1:1 notebook is uniquely identified
 * for a viewer by the OTHER member (the partner). We reuse the existing
 * `config.pinnedMember` field (the partner's username) to select which
 * notebook to surface, exactly like TraineeNotesWidget pins one trainee. No new
 * persisted-layout field. UNSET (or a stale partner the viewer no longer shares
 * a notebook with) falls back to the FIRST notebook the viewer is in, so a
 * freshly added widget shows the single notebook a typical student has with
 * zero configuration. A viewer in multiple notebooks picks one via the config
 * bar in the popup.
 *
 * EXPANDED VIEW: a richer glance (banner + open tasks + recent notes) plus an
 * "Open in Notes" CTA that deep-links to the Notes tab with the notebook
 * pre-selected (`/workbench?tab=notes&notebook=<id>`), where the full Phase 2
 * SharedNotebookView (add / edit / check-off) lives. The widget itself is
 * read-only and never opens the editor inline.
 */

// ── Inline SVGs (no emojis, no lucide-react) ─────────────────────────────────

const NOTEBOOK_ICON = (
  // Open book — the shared-notebook motif.
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
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

const SHARED_SVG = (
  // Two people — mirrors the SharedNotebookView banner motif.
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
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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

const OPEN_SVG = (
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
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const CHECK_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="11"
    height="11"
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

// ── Shared data hooks ────────────────────────────────────────────────────────

const notebookKeys = {
  notes: (id: string) => ["notebook", id, "notes"] as const,
  tasks: (id: string) => ["notebook", id, "tasks"] as const,
};

/** The notebooks the viewer is in. SAME query key as the Notes tab + the
 *  StartSharedNotebookDialog so React Query delivers one fetch. */
function useMyNotebooks(): { isLoading: boolean; notebooks: SharedNotebook[] } {
  const { data = [], isLoading } = useQuery<SharedNotebook[]>({
    queryKey: ["shared-notebooks", "mine"],
    queryFn: () => labApi.getSharedNotebooks(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return { isLoading, notebooks: data };
}

/**
 * Resolve which notebook this widget instance surfaces. A 1:1 notebook is
 * uniquely keyed by the PARTNER (the other member). We match the configured
 * `pinnedMember` against each notebook's "other member"; if none matches (unset
 * config, or a stale partner the viewer no longer shares with), we fall back to
 * the first notebook so a zero-config widget still shows the single notebook a
 * typical student has.
 */
function resolveActiveNotebook(
  notebooks: SharedNotebook[],
  me: string,
  pinnedMember: string | undefined,
): SharedNotebook | undefined {
  if (notebooks.length === 0) return undefined;
  if (pinnedMember) {
    const match = notebooks.find(
      (nb) => otherMemberOf(nb, me) === pinnedMember,
    );
    if (match) return match;
  }
  return notebooks[0];
}

/** The member of the pair who is NOT the viewer. Falls back to members[1] when
 *  the viewer is somehow not in the pair, so the partner is never blank. */
function otherMemberOf(nb: SharedNotebook, me: string): string {
  return nb.members.find((m) => m !== me) ?? nb.members[1];
}

/** A 1:1 deep-link into the Notes tab with the notebook pre-selected. The
 *  workbench page reads `tab` + `notebook` from the query string (Phase 4). */
function notebookHref(nb: SharedNotebook): string {
  return `/workbench?tab=notes&notebook=${encodeURIComponent(nb.id)}`;
}

/** Open weekly tasks (not complete), newest week first then newest id. */
function openTasks(tasks: WeeklyGoal[]): WeeklyGoal[] {
  return tasks
    .filter((t) => !t.is_complete)
    .sort((a, b) => {
      if (a.week_of !== b.week_of) return b.week_of.localeCompare(a.week_of);
      return b.id - a.id;
    });
}

/** Notes, newest update first. */
function recentNotes(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
}

// ── Config bar (popup only) ──────────────────────────────────────────────────

/**
 * Notebook picker. Rendered in the ExpandedView popup only when the canvas
 * supplies `onConfigChange`. Lets the viewer pick WHICH notebook this instance
 * surfaces (by partner). Hidden when the viewer is in a single notebook (no
 * choice to make).
 */
function NotebookConfigBar({
  notebooks,
  me,
  profileLabel,
  pinnedMember,
  onConfigChange,
  config,
}: {
  notebooks: SharedNotebook[];
  me: string;
  profileLabel: (username: string) => string;
  pinnedMember: string | undefined;
  onConfigChange: ExpandedViewProps["onConfigChange"];
  config: ExpandedViewProps["config"];
}) {
  if (!onConfigChange || notebooks.length < 2) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
      <span aria-hidden="true" className="text-gray-400 flex-shrink-0">
        {PIN_SVG}
      </span>
      <label
        htmlFor="shared-notebook-pin"
        className="text-xs font-medium text-gray-600 flex-shrink-0"
      >
        Show notebook
      </label>
      <select
        id="shared-notebook-pin"
        data-testid="shared-notebook-pin-select"
        value={pinnedMember ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onConfigChange(
            v ? { ...(config ?? {}), pinnedMember: v } : null,
          );
        }}
        className="flex-1 min-w-0 text-xs rounded border border-gray-200 bg-white px-2 py-1 text-gray-800"
      >
        <option value="">First notebook</option>
        {notebooks.map((nb) => {
          const partner = otherMemberOf(nb, me);
          const label = nb.title?.trim()
            ? nb.title
            : `1:1 with ${profileLabel(partner)}`;
          return (
            <option key={nb.id} value={partner}>
              {label}
            </option>
          );
        })}
      </select>
    </div>
  );
}

// ── ExpandedView (popup body) ────────────────────────────────────────────────

const MAX_TASKS = 5;
const MAX_NOTES = 4;

export default function SharedNotebookWidget(props?: ExpandedViewProps) {
  const config = props?.config;
  const onConfigChange = props?.onConfigChange;
  const pinnedMember = config?.pinnedMember;

  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const me = currentUser ?? "";
  const profileMap = useLabUserProfileMap();
  const profileLabel = (username: string) =>
    profileMap[username]?.displayName?.trim() || username;

  const { isLoading: notebooksLoading, notebooks } = useMyNotebooks();
  const active = useMemo(
    () => resolveActiveNotebook(notebooks, me, pinnedMember),
    [notebooks, me, pinnedMember],
  );

  const { data: notes = [], isLoading: notesLoading } = useQuery<Note[]>({
    queryKey: active ? notebookKeys.notes(active.id) : ["notebook", "none", "notes"],
    queryFn: () => labApi.getNotebookNotes(active!.id),
    enabled: !!active,
  });
  const { data: tasks = [], isLoading: tasksLoading } = useQuery<WeeklyGoal[]>({
    queryKey: active ? notebookKeys.tasks(active.id) : ["notebook", "none", "tasks"],
    queryFn: () => labApi.getNotebookWeeklyTasks(active!.id),
    enabled: !!active,
  });

  const thisWeek = mondayOf();
  const open = useMemo(() => openTasks(tasks), [tasks]);
  const notesSorted = useMemo(() => recentNotes(notes), [notes]);

  if (notebooksLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-sky-600" />
        Loading notebook…
      </div>
    );
  }

  // No notebook at all: prompt to start one on the Notes tab.
  if (!active) {
    return (
      <div className="h-full flex flex-col gap-3 min-h-0">
        <div
          className="rounded-lg border border-dashed border-gray-200 bg-gray-50/40 px-4 py-6 text-center m-auto"
          data-testid="shared-notebook-empty"
        >
          <span aria-hidden="true" className="inline-flex text-sky-400">
            {NOTEBOOK_ICON}
          </span>
          <p className="mt-2 text-sm font-medium text-gray-700">
            No shared notebook yet
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Start a shared 1:1 notebook from the Notes tab to surface it here.
          </p>
          <button
            type="button"
            data-testid="shared-notebook-start"
            onClick={() => router.push("/workbench?tab=notes")}
            className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <span aria-hidden="true">{OPEN_SVG}</span>
            Open Notes
          </button>
        </div>
      </div>
    );
  }

  const partner = otherMemberOf(active, me);
  const partnerLabel = profileLabel(partner);
  const loadingBody = notesLoading || tasksLoading;

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <NotebookConfigBar
        notebooks={notebooks}
        me={me}
        profileLabel={profileLabel}
        pinnedMember={pinnedMember}
        onConfigChange={onConfigChange}
        config={config}
      />

      {/* Shared-with banner */}
      <div
        className="flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2"
        data-testid="shared-notebook-banner"
      >
        <span aria-hidden="true" className="text-sky-500 flex-shrink-0">
          {SHARED_SVG}
        </span>
        <UserAvatar username={partner} size="sm" />
        <p className="min-w-0 flex-1 text-sm text-sky-900 truncate">
          Shared with <span className="font-semibold">{partnerLabel}</span>
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-4">
        {/* Open weekly tasks */}
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Open tasks
          </h3>
          {loadingBody ? (
            <p className="text-sm italic text-gray-400">Loading…</p>
          ) : open.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No open tasks.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {open.slice(0, MAX_TASKS).map((task) => (
                <li
                  key={`${task.owner}:${task.id}`}
                  className="flex items-center gap-2"
                  data-testid={`shared-notebook-task-${task.id}`}
                >
                  <span
                    aria-hidden="true"
                    className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-gray-300 text-transparent"
                  >
                    {CHECK_SVG}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                    {task.text}
                  </span>
                  {task.week_of === thisWeek && (
                    <span className="flex-shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-600">
                      This week
                    </span>
                  )}
                  <Tooltip label={`Added by ${profileLabel(task.owner)}`} placement="top">
                    <span className="flex-shrink-0">
                      <UserAvatar username={task.owner} size="xs" />
                    </span>
                  </Tooltip>
                </li>
              ))}
              {open.length > MAX_TASKS && (
                <li className="text-[11px] text-gray-400 pl-6">
                  +{open.length - MAX_TASKS} more
                </li>
              )}
            </ul>
          )}
        </section>

        {/* Recent notes */}
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Recent notes
          </h3>
          {loadingBody ? (
            <p className="text-sm italic text-gray-400">Loading…</p>
          ) : notesSorted.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No notes yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {notesSorted.slice(0, MAX_NOTES).map((note) => (
                <li
                  key={`${note.username}:${note.id}`}
                  className="flex items-center gap-2"
                  data-testid={`shared-notebook-note-${note.id}`}
                >
                  <span aria-hidden="true" className="text-gray-300 flex-shrink-0">
                    {NOTEBOOK_ICON}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
                    {note.title || "Untitled note"}
                  </span>
                  <Tooltip label={`By ${profileLabel(note.username ?? "")}`} placement="top">
                    <span className="flex-shrink-0">
                      <UserAvatar username={note.username ?? ""} size="xs" />
                    </span>
                  </Tooltip>
                </li>
              ))}
              {notesSorted.length > MAX_NOTES && (
                <li className="text-[11px] text-gray-400 pl-6">
                  +{notesSorted.length - MAX_NOTES} more
                </li>
              )}
            </ul>
          )}
        </section>
      </div>

      <button
        type="button"
        data-testid="shared-notebook-open"
        onClick={() => router.push(notebookHref(active))}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span aria-hidden="true">{OPEN_SVG}</span>
        Open in Notes
      </button>
    </div>
  );
}

export const ExpandedView = SharedNotebookWidget;

export const HELP_TEXT =
  "A glanceable view of one shared 1:1 notebook: its open weekly tasks and most recent notes, with the partner it is shared with. Click the tile to open the full notebook on the Notes tab, where you and your partner add notes and check off tasks. If you are in more than one notebook, the popup picker chooses which one this tile shows; otherwise it surfaces your only notebook automatically.";

// ── SnapshotTile: open-task count headline ───────────────────────────────────

export function SnapshotTile(props: SnapshotTileProps) {
  const pinnedMember = props.config?.pinnedMember;
  const { currentUser } = useCurrentUser();
  const me = currentUser ?? "";
  const profileMap = useLabUserProfileMap();
  const profileLabel = (username: string) =>
    profileMap[username]?.displayName?.trim() || username;

  const { isLoading: notebooksLoading, notebooks } = useMyNotebooks();
  const active = useMemo(
    () => resolveActiveNotebook(notebooks, me, pinnedMember),
    [notebooks, me, pinnedMember],
  );

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<WeeklyGoal[]>({
    queryKey: active ? notebookKeys.tasks(active.id) : ["notebook", "none", "tasks"],
    queryFn: () => labApi.getNotebookWeeklyTasks(active!.id),
    enabled: !!active,
  });

  const openCount = useMemo(
    () => tasks.filter((t) => !t.is_complete).length,
    [tasks],
  );

  const label = active
    ? `1:1 with ${profileLabel(otherMemberOf(active, me))}`
    : "Shared notebook";
  const stat = !active ? "—" : tasksLoading ? "…" : String(openCount);
  const sub = !active
    ? notebooksLoading
      ? "Loading…"
      : "No notebook yet"
    : `${openCount === 1 ? "open task" : "open tasks"}`;

  return (
    <StatTile
      icon={NOTEBOOK_ICON}
      iconClassName="text-sky-500"
      label={label}
      stat={stat}
      sub={sub}
    />
  );
}

// ── SidebarTile: slim row ────────────────────────────────────────────────────

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { currentUser } = useCurrentUser();
  const me = currentUser ?? "";
  const profileMap = useLabUserProfileMap();
  const profileLabel = (username: string) =>
    profileMap[username]?.displayName?.trim() || username;

  const { notebooks } = useMyNotebooks();
  // Sidebar carries no per-instance config; show the first notebook.
  const active = resolveActiveNotebook(notebooks, me, undefined);

  const { data: tasks = [] } = useQuery<WeeklyGoal[]>({
    queryKey: active ? notebookKeys.tasks(active.id) : ["notebook", "none", "tasks"],
    queryFn: () => labApi.getNotebookWeeklyTasks(active!.id),
    enabled: !!active,
  });
  const openCount = tasks.filter((t) => !t.is_complete).length;

  return (
    <SidebarStatTile
      icon={NOTEBOOK_ICON}
      iconClassName="text-sky-500"
      label={
        active ? `1:1 with ${profileLabel(otherMemberOf(active, me))}` : "Shared notebook"
      }
      stat={active ? String(openCount) : "—"}
      sub={active ? "open tasks" : "Open to start one"}
      onClick={onClick}
    />
  );
}
