// Class Mode CT-4 live wiring: the instructor submission-dashboard gather.
//
// Joins the relay roster (every student) with each student's notebook submission
// status for ONE assignment, then hands the rows to the pure buildSubmissionDashboard
// (class-submission.ts) so a student who never opened the assignment still appears
// as not_submitted (no silent gaps). The roster MUST come from the signed relay
// roster (getLabRemote(labId).record.members filtered to non-head), NOT the
// folder-bound useLabData().users, because the students live in their own folders.
//
// The per-student notebook is the student-owned task carrying assignment_id ===
// the assignment. The instructor reads each student's tasks (cross-owner) via
// tasksApi.listAllForUser, which the instructor can do because the materialized
// shared-with-me records and the subkey co-ownership (Stage 1) make a student's
// notebook readable to the head. Defensive: a student folder the head cannot read
// yet contributes no entry and the pure join renders them not_submitted.
//
// Gated behind NEXT_PUBLIC_CLASS_MODE so a flag-off build never gathers.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { tasksApi } from "@/lib/local-api";
import {
  buildSubmissionDashboard,
  type SubmissionDashboardRow,
  type NotebookSubmissionEntry,
} from "./class-submission";
import { CLASS_MODE_ENABLED } from "./class-mode-config";

/**
 * Gather the per-assignment submission dashboard rows for the instructor. For each
 * roster student, finds their notebook task for the assignment (assignment_id
 * match) and reads its submission; the pure join then renders one row per student
 * in roster order, not_submitted for anyone without a notebook.
 *
 * Flag off, returns [] (no gather), so a flag-off build never reads student
 * folders. A per-student read failure is swallowed so one unreadable folder does
 * not blank the whole dashboard; that student simply renders not_submitted.
 *
 * @param roster the relay-roster student usernames (non-head, roster order).
 * @param assignmentId the assignment whose notebooks to gather.
 */
export async function gatherSubmissionDashboard(args: {
  roster: string[];
  assignmentId: string;
}): Promise<SubmissionDashboardRow[]> {
  if (!CLASS_MODE_ENABLED) return [];

  const entries: NotebookSubmissionEntry[] = [];
  for (const student of args.roster) {
    try {
      const tasks = await tasksApi.listAllForUser(student);
      const notebook = tasks.find((t) => t.assignment_id === args.assignmentId);
      if (notebook) {
        entries.push({ student, submission: notebook.submission });
      }
    } catch {
      // Unreadable student folder: contribute no entry. The pure join renders the
      // student not_submitted so the instructor still sees the WHOLE roster.
    }
  }

  return buildSubmissionDashboard(args.roster, entries);
}
