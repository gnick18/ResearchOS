"use client";

// ClassAssignmentsPanel (CT-2 student-open path): the STUDENT assignment surface.
// It lists the assignments the instructor published to this student (read from the
// folder-local _class_assignments.json the pull materializer caches), and lets the
// student OPEN one. Opening find-or-creates the student's own per-student notebook
// task (openAssignmentNotebook, the C2 student-owned write) and mounts the submit
// control on it. This is the last wiring gap of the student-facing class loop.
//
// FLAG + GATE: rendered only behind CLASS_MODE_ENABLED AND useIsClassStudent (the
// student-only "this folder is a class I am a member of" predicate), so it is
// invisible on a research lab, an instructor's class view, and a flag-off build.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";
import {
  listStudentAssignments,
  type StudentAssignment,
} from "@/lib/lab/class-assignment-read";
import { openAssignmentNotebook } from "@/lib/lab/class-student-open";
import SubmitNotebookButton from "./SubmitNotebookButton";
import type { ClassSubmission } from "@/lib/types";

interface OpenedNotebook {
  taskId: number;
  /** The version pin for "what they submitted" (the notebook's last-edited stamp). */
  rev: string;
  submission: ClassSubmission | null;
}

export default function ClassAssignmentsPanel({
  currentUser,
}: {
  currentUser: string;
}) {
  const [assignments, setAssignments] = useState<StudentAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  // assignmentId -> the opened notebook (so the submit control mounts inline).
  const [opened, setOpened] = useState<Record<string, OpenedNotebook>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await listStudentAssignments();
        if (!cancelled) setAssignments(next);
      } catch {
        if (!cancelled) {
          setAssignments([]);
          setError("Could not load your assignments.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onOpen = useCallback(
    async (assignment: StudentAssignment) => {
      setOpeningId(assignment.assignmentId);
      setError(null);
      try {
        const result = await openAssignmentNotebook({
          assignment,
          student: currentUser,
        });
        if (!result.ok) {
          throw result.error instanceof Error
            ? result.error
            : new Error("Could not open the notebook.");
        }
        const { task } = result;
        setOpened((prev) => ({
          ...prev,
          [assignment.assignmentId]: {
            taskId: task.id,
            rev: task.last_edited_at ?? new Date().toISOString(),
            submission: task.submission ?? null,
          },
        }));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not open the notebook.",
        );
      } finally {
        setOpeningId(null);
      }
    },
    [currentUser],
  );

  if (assignments === null) {
    return <p className="text-meta text-foreground-muted">Loading your assignments...</p>;
  }

  if (assignments.length === 0) {
    return (
      <p className="text-meta text-foreground-muted">
        No assignments yet. When your instructor assigns work it shows up here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-meta text-red-600 dark:text-red-400">{error}</p>
      )}
      <ul className="space-y-3">
        {assignments.map((a) => {
          const open = opened[a.assignmentId];
          return (
            <li
              key={a.assignmentId}
              className="rounded-lg border border-border bg-surface-raised p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-body font-semibold text-foreground">
                    {a.title}
                  </h3>
                  {a.description && (
                    <p className="mt-1 text-meta text-foreground-muted">
                      {a.description}
                    </p>
                  )}
                  <p className="mt-2 text-meta text-foreground-muted">
                    {a.checklist.length > 0
                      ? `${a.checklist.length} checklist ${a.checklist.length === 1 ? "step" : "steps"}`
                      : "No checklist"}
                    {a.visibility === "private"
                      ? ". Private, only you and your instructor can read your work."
                      : ". Collaborative, your class can read your work."}
                  </p>
                </div>
                {!open && (
                  <button
                    type="button"
                    onClick={() => onOpen(a)}
                    disabled={openingId === a.assignmentId}
                    className="shrink-0 rounded-md bg-brand-action px-4 py-2 text-body font-semibold text-white disabled:opacity-50"
                  >
                    {openingId === a.assignmentId ? "Opening..." : "Open notebook"}
                  </button>
                )}
              </div>

              {open && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="mb-2 text-meta text-foreground-muted">
                    Your notebook is ready. Edit it from your tasks, then submit it
                    here when you are done.
                  </p>
                  <SubmitNotebookButton
                    taskId={open.taskId}
                    submittedRev={open.rev}
                    submission={open.submission}
                    owner={currentUser}
                    onSubmitted={(next) =>
                      setOpened((prev) => ({
                        ...prev,
                        [a.assignmentId]: { ...open, submission: next },
                      }))
                    }
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
