"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sharedNotebooksApi, weeklyGoalsApi, labApi } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { mondayOf, weekLabel } from "@/lib/weekly-goals/week";
import Tooltip from "@/components/Tooltip";
import UserAvatar from "@/components/UserAvatar";
import NoteCard from "@/components/NoteCard";
import NoteDetailPopup from "@/components/NoteDetailPopup";
import type { Note, SharedNotebook, WeeklyGoal } from "@/lib/types";

// Shared Notebooks Phase 2 (notebooks-phase2 sub-bot, 2026-06-02). See
// docs/proposals/SHARED_NOTEBOOKS_PROPOSAL.md.
//
// The SHARED-NOTEBOOK VIEW shown inside the Notes tab when a notebook is
// selected. It renders the notebook's NOTES (`labApi.getNotebookNotes`, across
// both members' folders) and WEEKLY TASKS (`labApi.getNotebookWeeklyTasks`)
// under an "Always shared with <the other member>" banner. Both members can
// add a note + a weekly task, and either member can check off / rename / delete
// any task (the owner-routed `sharedNotebooksApi.updateWeeklyTask` makes the
// PI-assign / student-complete workflow bidirectional).
//
// NOTE EDITING (notebook-note-edit sub-bot of HR, 2026-06-02): BOTH members can
// add AND edit any note in the notebook (Grant locked "both can add and edit").
// A member's OWN notebook notes open fully editable (writes route to their own
// folder). The OTHER member's notebook notes ALSO open editable: NoteDetailPopup
// carves notebook notes out of the lab-head edit-session read-only gate via
// `canEditNotebookNote` (the pair-shared-at-edit grant IS the authorization),
// and routes the save to the OWNER's folder (`ownerScopedNotesApi`'s
// notebookPeerOwner). We still pass `readOnly={!noteIsMine}` here as the
// lab-mode posture for the NON-notebook case; the popup relaxes it for notebook
// notes the viewer can write. Ordinary (non-notebook) shared notes are
// untouched and keep the PI-unlock posture.

const notebookKeys = {
  notes: (id: string) => ["notebook", id, "notes"] as const,
  tasks: (id: string) => ["notebook", id, "tasks"] as const,
};

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

const TRASH_SVG = (
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
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const PLUS_SVG = (
  <svg
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

const SHARED_SVG = (
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

interface SharedNotebookViewProps {
  notebook: SharedNotebook;
}

/** Group weekly tasks by `week_of` (newest week first), completed sinking. */
function groupTasksByWeek(
  tasks: WeeklyGoal[],
): { week: string; tasks: WeeklyGoal[] }[] {
  const map = new Map<string, WeeklyGoal[]>();
  for (const t of tasks) {
    const list = map.get(t.week_of) ?? [];
    list.push(t);
    map.set(t.week_of, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([week, list]) => ({
      week,
      tasks: list.sort((a, b) => {
        if (a.is_complete !== b.is_complete) return a.is_complete ? 1 : -1;
        return b.id - a.id;
      }),
    }));
}

export default function SharedNotebookView({ notebook }: SharedNotebookViewProps) {
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();
  const me = currentUser ?? "";

  // The other member is whichever of the two `members` is not the current user.
  // Falls back to members[1] when the viewer is somehow not in the pair (e.g. a
  // lab_head reading a notebook they are not a member of) so the banner is never
  // blank.
  const otherMember = useMemo(
    () => notebook.members.find((m) => m !== me) ?? notebook.members[1],
    [notebook.members, me],
  );

  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [taskDraft, setTaskDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const thisWeek = mondayOf();

  const { data: notes = [], isLoading: notesLoading } = useQuery<Note[]>({
    queryKey: notebookKeys.notes(notebook.id),
    queryFn: () => labApi.getNotebookNotes(notebook.id),
  });

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<WeeklyGoal[]>({
    queryKey: notebookKeys.tasks(notebook.id),
    queryFn: () => labApi.getNotebookWeeklyTasks(notebook.id),
  });

  const sortedNotes = useMemo(
    () =>
      [...notes].sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      ),
    [notes],
  );

  const groupedTasks = useMemo(() => groupTasksByWeek(tasks), [tasks]);

  const refreshNotes = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: notebookKeys.notes(notebook.id),
      }),
    [queryClient, notebook.id],
  );
  const refreshTasks = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: notebookKeys.tasks(notebook.id),
      }),
    [queryClient, notebook.id],
  );

  const handleAddNote = useCallback(
    async (isRunningLog: boolean) => {
      if (busy) return;
      setBusy(true);
      const today = new Date().toISOString().split("T")[0];
      try {
        const created = await sharedNotebooksApi.createNote({
          notebookId: notebook.id,
          title: isRunningLog ? "New Running Log" : "New Note",
          is_running_log: isRunningLog,
          entries: [
            {
              title: isRunningLog ? `Entry - ${today}` : "Note",
              date: today,
            },
          ],
        });
        await refreshNotes();
        setSelectedNote(created);
      } catch (err) {
        console.error("Failed to add notebook note:", err);
      } finally {
        setBusy(false);
      }
    },
    [busy, notebook.id, refreshNotes],
  );

  const handleAddTask = useCallback(async () => {
    const text = taskDraft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await sharedNotebooksApi.createWeeklyTask({
        notebookId: notebook.id,
        text,
        week_of: thisWeek,
      });
      setTaskDraft("");
      await refreshTasks();
    } catch (err) {
      console.error("Failed to add notebook task:", err);
    } finally {
      setBusy(false);
    }
  }, [taskDraft, busy, notebook.id, thisWeek, refreshTasks]);

  const handleToggleTask = useCallback(
    async (task: WeeklyGoal) => {
      // OWNER-ROUTED: either member can flip any task, even the OTHER member's.
      // We MUST pass `task.owner` so the write lands on the intended task. Ids
      // are per-user counters, so both members own a task with id 1, 2, 3, ...;
      // routing by id alone could flip the OTHER member's same-id task.
      await sharedNotebooksApi.updateWeeklyTask({
        notebookId: notebook.id,
        taskId: task.id,
        owner: task.owner,
        data: { is_complete: !task.is_complete },
      });
      await refreshTasks();
    },
    [notebook.id, refreshTasks],
  );

  const handleDeleteTask = useCallback(
    async (task: WeeklyGoal) => {
      // Delete is current-user-scoped: a task lives in its owner's folder, so
      // only the member who ADDED it removes it (the delete button is hidden on
      // the other member's tasks below). No new data-layer path is needed for
      // this; the owner-routed change is the bidirectional UPDATE only.
      await weeklyGoalsApi.delete(task.id);
      await refreshTasks();
    },
    [refreshTasks],
  );

  // A note opens editable only when the viewer owns it; the other member's
  // notes open read-only (cross-owner body edits are out of scope this phase).
  const noteIsMine = selectedNote
    ? (selectedNote.username ?? "") === me
    : false;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Always-shared banner */}
      <div
        className="flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50 px-4 py-2.5"
        data-testid="notebook-shared-banner"
      >
        <span aria-hidden="true" className="text-sky-500">
          {SHARED_SVG}
        </span>
        <UserAvatar username={otherMember} size="sm" />
        <p className="text-sm text-sky-900">
          Always shared with{" "}
          <span className="font-semibold">{otherMember}</span>. Everything here,
          notes and weekly tasks, is visible to both of you.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto pb-2">
        {/* Weekly tasks */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-800">Weekly tasks</h3>
          </div>
          <p className="mb-2 text-xs text-gray-500">
            Add tasks for the week. Either of you can add a task and check off
            any task, so a PI can assign and the student can complete (and vice
            versa).
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleAddTask();
            }}
            className="mb-3 flex items-center gap-2"
          >
            <input
              type="text"
              value={taskDraft}
              onChange={(e) => setTaskDraft(e.target.value)}
              placeholder={`Add a task for ${weekLabel(thisWeek)}…`}
              data-testid="notebook-task-input"
              className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
            <button
              type="submit"
              disabled={!taskDraft.trim() || busy}
              data-testid="notebook-task-add"
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-40"
            >
              Add task
            </button>
          </form>

          {tasksLoading ? (
            <p className="text-sm italic text-gray-400">Loading tasks…</p>
          ) : groupedTasks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/40 px-4 py-5 text-center">
              <p className="text-sm font-medium text-gray-700">
                No weekly tasks yet
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Add the first task for this 1:1.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {groupedTasks.map((group) => (
                <div key={group.week}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    {weekLabel(group.week)}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {group.tasks.map((task) => (
                      <li
                        key={`${task.owner}:${task.id}`}
                        className="group flex items-center gap-2"
                        data-testid={`notebook-task-row-${task.id}`}
                      >
                        <Tooltip
                          label={task.is_complete ? "Mark not done" : "Mark done"}
                          placement="top"
                        >
                          <button
                            type="button"
                            onClick={() => void handleToggleTask(task)}
                            data-testid={`notebook-task-toggle-${task.id}`}
                            aria-pressed={task.is_complete}
                            className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
                              task.is_complete
                                ? "bg-sky-500 text-white"
                                : "border border-gray-300 text-transparent hover:border-sky-400"
                            }`}
                          >
                            {CHECK_SVG}
                          </button>
                        </Tooltip>
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${
                            task.is_complete
                              ? "text-gray-400 line-through"
                              : "text-gray-800"
                          }`}
                        >
                          {task.text}
                        </span>
                        <Tooltip
                          label={`Added by ${task.owner}`}
                          placement="top"
                        >
                          <span className="flex-shrink-0">
                            <UserAvatar username={task.owner} size="xs" />
                          </span>
                        </Tooltip>
                        {task.owner === me ? (
                          <Tooltip label="Delete task" placement="top">
                            <button
                              type="button"
                              onClick={() => void handleDeleteTask(task)}
                              data-testid={`notebook-task-delete-${task.id}`}
                              className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-300 opacity-0 transition-colors hover:bg-red-50 hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                            >
                              {TRASH_SVG}
                            </button>
                          </Tooltip>
                        ) : (
                          // Placeholder keeps row widths aligned for tasks the
                          // viewer cannot delete (the other member's tasks).
                          <span className="inline-flex h-6 w-6 flex-shrink-0" />
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Notes */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-800">Notes</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleAddNote(false)}
                disabled={busy}
                data-testid="notebook-add-note"
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-40"
              >
                {PLUS_SVG}
                Note
              </button>
              <button
                type="button"
                onClick={() => void handleAddNote(true)}
                disabled={busy}
                data-testid="notebook-add-running-log"
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40"
              >
                {PLUS_SVG}
                Running log
              </button>
            </div>
          </div>

          {notesLoading ? (
            <p className="text-sm italic text-gray-400">Loading notes…</p>
          ) : sortedNotes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/40 px-4 py-6 text-center">
              <p className="text-sm font-medium text-gray-700">No notes yet</p>
              <p className="mt-1 text-xs text-gray-500">
                Add a note to start this shared notebook.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sortedNotes.map((note) => (
                <NoteCard
                  key={`${note.username}:${note.id}`}
                  note={note}
                  onClick={() => setSelectedNote(note)}
                  // Surface authorship + lock cross-owner cards like lab mode.
                  isLabMode={(note.username ?? "") !== me}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {selectedNote && (
        <NoteDetailPopup
          note={selectedNote}
          onClose={() => setSelectedNote(null)}
          onUpdate={(updated) => {
            setSelectedNote(updated);
            void refreshNotes();
          }}
          onDelete={() => {
            setSelectedNote(null);
            void refreshNotes();
          }}
          // The other member's notes open read-only; your own are editable.
          readOnly={!noteIsMine}
        />
      )}
    </div>
  );
}
