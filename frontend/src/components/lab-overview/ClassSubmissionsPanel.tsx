"use client";

// ClassSubmissionsPanel (CT-4 live wiring): the INSTRUCTOR submission review
// surface. For one assignment, it joins the signed relay roster (every student)
// with each student's notebook submission status and renders a thin per-student
// table with a Return action. NOT a gradebook, grading stays in the LMS, no score
// is ever stored, the instructor only writes a freeform note on return.
//
// FLAG + GATE: rendered only behind CLASS_MODE_ENABLED AND useIsClassMode (the
// instructor-only "this folder is a class I head" predicate), so it is invisible
// on a research lab, a student folder, and a flag-off build. The roster + return
// path need a LIVE lab session (the relay roster + the instructor's signing keys);
// while the session is not live the table explains why and the Return action is
// disabled (no soft-lock, the form still renders).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState, useCallback } from "react";
import { useLabSession } from "@/hooks/useLabSession";
import { getLabRemote } from "@/lib/lab/lab-do-client";
import { gatherSubmissionDashboard } from "@/lib/lab/class-submission-dashboard";
import { returnNotebookForStudent } from "@/lib/lab/pi-actions";
import type { SubmissionDashboardRow } from "@/lib/lab/class-submission";

interface LiveSession {
  labId: string;
  instructor: string;
}

/** Pull the live lab session identity, or null when the session is not live. */
function useLiveSession(): LiveSession | null {
  const session = useLabSession();
  const [live, setLive] = useState<LiveSession | null>(null);

  useEffect(() => {
    if (!session || session.loading) {
      setLive(null);
      return;
    }
    const { controller } = session;
    const read = () => {
      const state = controller.getState();
      if (state.kind === "live") {
        setLive({ labId: state.labId, instructor: state.member.username });
      } else {
        setLive(null);
      }
    };
    read();
    const unsub = controller.subscribe(read);
    return unsub;
  }, [session]);

  return live;
}

const STATUS_LABEL: Record<SubmissionDashboardRow["status"], string> = {
  not_submitted: "Not submitted",
  submitted: "Submitted",
  returned: "Returned",
};

export default function ClassSubmissionsPanel() {
  const live = useLiveSession();

  const [assignmentId, setAssignmentId] = useState("");
  const [roster, setRoster] = useState<string[] | null>(null);
  const [rows, setRows] = useState<SubmissionDashboardRow[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Per-student in-progress return note text.
  const [noteByStudent, setNoteByStudent] = useState<Record<string, string>>({});
  const [returning, setReturning] = useState<string | null>(null);

  // Load the relay roster (non-head students) once the session is live. The
  // roster MUST come from the signed relay roster, not the folder-bound users.
  useEffect(() => {
    if (!live) {
      setRoster(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await getLabRemote(live.labId);
        if (cancelled) return;
        const students = (result?.record.members ?? [])
          .filter((m) => m.role !== "head" && m.username !== live.instructor)
          .map((m) => m.username);
        setRoster(students);
      } catch {
        if (!cancelled) setRoster([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live]);

  const gather = useCallback(async () => {
    if (!roster || !assignmentId.trim()) return;
    setStatus("loading");
    setErrorMsg(null);
    try {
      const next = await gatherSubmissionDashboard({
        roster,
        assignmentId: assignmentId.trim(),
      });
      setRows(next);
      setStatus("idle");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Could not load submissions.",
      );
      setStatus("error");
    }
  }, [roster, assignmentId]);

  const onReturn = async (student: string) => {
    if (!live) return;
    const note = (noteByStudent[student] ?? "").trim();
    setReturning(student);
    setErrorMsg(null);
    // The notebook task id is not on the dashboard row (the row keys by student).
    // We re-resolve it by re-gathering after the return; the action itself takes a
    // task id, so we look it up via the roster gather's source. To keep this panel
    // thin we read the student's notebook task id at return time.
    try {
      const { tasksApi } = await import("@/lib/local-api");
      const tasks = await tasksApi.listAllForUser(student);
      const notebook = tasks.find(
        (t) => t.assignment_id === assignmentId.trim(),
      );
      if (!notebook) {
        throw new Error("No notebook found for this student and assignment.");
      }
      const result = await returnNotebookForStudent({
        actor: live.instructor,
        targetOwner: student,
        taskId: notebook.id,
        instructorNote: note,
        taskName: notebook.name,
      });
      if (!result.ok) {
        throw result.error instanceof Error
          ? result.error
          : new Error("Could not return the notebook.");
      }
      await gather();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Could not return the notebook.",
      );
    } finally {
      setReturning(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-meta font-semibold text-foreground">
            Assignment id
          </label>
          <input
            type="text"
            value={assignmentId}
            onChange={(e) => setAssignmentId(e.target.value)}
            placeholder="e.g. asg-3"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-body text-foreground"
          />
        </div>
        <button
          type="button"
          onClick={gather}
          disabled={!live || !roster || !assignmentId.trim() || status === "loading"}
          className="rounded-md bg-brand-action px-4 py-2 text-body font-semibold text-white disabled:opacity-50"
        >
          {status === "loading" ? "Loading..." : "Load submissions"}
        </button>
      </div>

      {!live && (
        <p className="text-meta text-foreground-muted">
          Sign in to your class to review submissions.
        </p>
      )}
      {errorMsg && (
        <p className="text-meta text-red-600 dark:text-red-400">{errorMsg}</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-border text-left text-meta text-foreground-muted">
                <th className="py-2 pr-4 font-semibold">Student</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 pr-4 font-semibold">Submitted</th>
                <th className="py-2 pr-4 font-semibold">Feedback + return</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.student} className="border-b border-border align-top">
                  <td className="py-2 pr-4 font-medium text-foreground">
                    {row.student}
                  </td>
                  <td className="py-2 pr-4 text-foreground-muted">
                    {STATUS_LABEL[row.status]}
                  </td>
                  <td className="py-2 pr-4 text-foreground-muted">
                    {row.submittedAt
                      ? new Date(row.submittedAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="py-2 pr-4">
                    {row.instructorNote && (
                      <p className="mb-1 text-meta text-foreground-muted">
                        Last note: {row.instructorNote}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={noteByStudent[row.student] ?? ""}
                        onChange={(e) =>
                          setNoteByStudent((prev) => ({
                            ...prev,
                            [row.student]: e.target.value,
                          }))
                        }
                        placeholder="Feedback (no score)"
                        disabled={row.status !== "submitted"}
                        className="rounded-md border border-border bg-surface px-2 py-1 text-meta text-foreground disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={() => onReturn(row.student)}
                        disabled={
                          !live ||
                          row.status !== "submitted" ||
                          returning === row.student
                        }
                        className="rounded-md border border-border px-3 py-1 text-meta font-medium text-foreground hover:bg-surface-sunken disabled:opacity-50"
                      >
                        {returning === row.student ? "Returning..." : "Return"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-meta text-foreground-muted">
            Return is available only for a submitted notebook. Grading and scores
            stay in your LMS, ResearchOS records only the submit and return
            lifecycle plus your note.
          </p>
        </div>
      )}
    </div>
  );
}
