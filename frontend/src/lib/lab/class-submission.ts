// Class Mode (CT-4): submit + review state machine, the minimal notebook
// submission lifecycle. NOT a gradebook.
//
// SCOPE (Tool 4 + Grant). Grading, scores, weighting, rubric math, and grade
// export all stay in the LMS (Owen grades in Moodle; we do not build a competing
// gradebook). ResearchOS stores ONLY the submission lifecycle and one freeform
// instructor note. No numeric score is ever stored.
//
// THE STATE MACHINE (the only legal transitions):
//   not_submitted --submit-->  submitted   (STUDENT action; stamps submitted_at
//                                            + submitted_rev)
//   submitted     --return-->  returned    (INSTRUCTOR action; writes
//                                            instructor_note)
//   returned      --submit-->  submitted   (STUDENT resubmit after feedback;
//                                            re-stamps at + rev, clears the prior
//                                            note so a stale note never reads as
//                                            current)
// Any other transition is illegal and throws, so a double-submit or an
// out-of-order return cannot corrupt the record.
//
// submitted_rev PINNING. The submit transition pins the notebook's
// version-history rev at submit time, so "what they submitted" is a fixed
// snapshot even if the student keeps editing afterward. The instructor reviews
// against that pinned rev, not the live head.
//
// AUTHORSHIP (ties to CT-2 + Stage 1). The submission lives ON the student's own
// notebook task (Task.submission), which the student OWNS (C2). The student drives
// submit on their own record; the instructor drives return via the PI owner-routed
// write, readable because the head co-owns the per-student subkey (Stage 1). No
// actor writes under another user's owner-prefix; the instructor's return is an
// audited PI write to the student-owned record, exactly like assignTask / flag.
//
// This module is the PURE transition + dashboard-join core (mirrors the sibling CT
// modules' pure-core discipline). Wiring it onto the live tasksApi.update +
// pi-actions audit path is a thin follow-up; the legality + pinning correctness is
// unit-provable here.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { ClassSubmission } from "@/lib/types";

/** The initial submission state for a freshly created notebook (or an absent
 *  submission, which is treated as not_submitted). */
export function initialSubmission(): ClassSubmission {
  return { status: "not_submitted" };
}

/**
 * Normalize a possibly-absent submission to a concrete one. A notebook created
 * before CT-4, or one that never carried a submission, reads as not_submitted, so
 * every consumer can treat the field as always-present.
 */
export function resolveSubmission(
  submission: ClassSubmission | null | undefined,
): ClassSubmission {
  return submission ?? initialSubmission();
}

// ---------------------------------------------------------------------------
// Student action: submit.
// ---------------------------------------------------------------------------

/**
 * The STUDENT submits their notebook. Legal from not_submitted or returned (a
 * resubmit after feedback). Stamps submitted_at + the pinned submitted_rev, and
 * on a resubmit CLEARS the prior instructor_note so a stale note never reads as
 * current feedback on the new submission.
 *
 * @param current the notebook's current submission (absent treated as initial).
 * @param submittedRev the notebook's version-history rev to pin (the snapshot id).
 * @param submittedAt ISO 8601 timestamp of the submit.
 * @returns the next submission state.
 * @throws if the notebook is already submitted (double-submit), the only illegal
 *   source state for submit.
 */
export function submitNotebook(
  current: ClassSubmission | null | undefined,
  submittedRev: string,
  submittedAt: string,
): ClassSubmission {
  const sub = resolveSubmission(current);
  if (sub.status === "submitted") {
    throw new Error(
      "submitNotebook: already submitted (resubmit only after it is returned)",
    );
  }
  if (!submittedRev) {
    throw new Error("submitNotebook: submitted_rev is required to pin the snapshot");
  }
  return {
    status: "submitted",
    submitted_at: submittedAt,
    submitted_rev: submittedRev,
    // A resubmit drops the previous return's note; new submission, fresh review.
  };
}

// ---------------------------------------------------------------------------
// Instructor action: return.
// ---------------------------------------------------------------------------

/**
 * The INSTRUCTOR returns a submitted notebook, writing freeform feedback. Legal
 * ONLY from submitted (you cannot return work that was never submitted, nor
 * re-return already-returned work without a fresh submission). Preserves the
 * pinned submitted_at + submitted_rev so the record of what was submitted survives
 * the return.
 *
 * @param current the notebook's current submission.
 * @param instructorNote the freeform feedback (no score).
 * @returns the next submission state (status returned).
 * @throws if the notebook is not currently submitted.
 */
export function returnNotebook(
  current: ClassSubmission | null | undefined,
  instructorNote: string,
): ClassSubmission {
  const sub = resolveSubmission(current);
  if (sub.status !== "submitted") {
    throw new Error(
      `returnNotebook: can only return a submitted notebook, current status is ${sub.status}`,
    );
  }
  return {
    status: "returned",
    // Keep the pinned snapshot so "what was submitted" stays fixed post-return.
    submitted_at: sub.submitted_at,
    submitted_rev: sub.submitted_rev,
    instructor_note: instructorNote,
  };
}

// ---------------------------------------------------------------------------
// Instructor dashboard: roster joined with each student's submission status.
// ---------------------------------------------------------------------------

/** One row of the instructor's per-assignment submission dashboard. */
export interface SubmissionDashboardRow {
  /** The student this row is for. */
  student: string;
  /** The student's submission status (not_submitted when they never opened it). */
  status: ClassSubmission["status"];
  /** When they submitted, if at all. */
  submittedAt?: string;
  /** The pinned rev, if submitted. */
  submittedRev?: string;
  /** The instructor's note, if returned. */
  instructorNote?: string;
  /** True iff the student has created a notebook for this assignment at all. */
  hasNotebook: boolean;
}

/**
 * The minimal shape the dashboard join needs from a student notebook. The live
 * caller maps each student-owned notebook task onto this (owner -> student,
 * Task.submission -> submission). A student with no notebook yet contributes no
 * entry and the join renders them not_submitted, so the instructor sees the WHOLE
 * roster, not just the students who have started.
 */
export interface NotebookSubmissionEntry {
  student: string;
  submission?: ClassSubmission | null;
}

/**
 * Build the instructor's per-assignment dashboard rows by joining the full roster
 * (every student) with the notebooks that exist. The result has exactly one row
 * per roster student, in roster order, so a student who never opened the
 * assignment still appears as not_submitted (no silent gaps). This is the data
 * layer for the dashboard surface; the UI is a thin list over these rows.
 *
 * @param roster every student username in the class (roster order preserved).
 * @param notebooks the student notebooks that exist for THIS assignment.
 * @returns one row per roster student.
 */
export function buildSubmissionDashboard(
  roster: string[],
  notebooks: NotebookSubmissionEntry[],
): SubmissionDashboardRow[] {
  const byStudent = new Map<string, ClassSubmission | null | undefined>();
  const hasNotebook = new Set<string>();
  for (const nb of notebooks) {
    byStudent.set(nb.student, nb.submission);
    hasNotebook.add(nb.student);
  }

  const seen = new Set<string>();
  const rows: SubmissionDashboardRow[] = [];
  for (const student of roster) {
    if (seen.has(student)) continue; // a duplicated roster name yields one row
    seen.add(student);
    const sub = resolveSubmission(byStudent.get(student));
    rows.push({
      student,
      status: sub.status,
      submittedAt: sub.submitted_at,
      submittedRev: sub.submitted_rev,
      instructorNote: sub.instructor_note,
      hasNotebook: hasNotebook.has(student),
    });
  }
  return rows;
}
