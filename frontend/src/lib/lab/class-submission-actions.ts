// Class Mode CT-4 live wiring: the student submit action.
//
// The submission lives ON the student's own notebook task (Task.submission), which
// the student OWNS (C2). The student drives the not_submitted -> submitted (and
// returned -> submitted resubmit) transition on their OWN record, so this is a
// plain owner-scoped tasksApi.update, NOT a cross-owner PI write. The instructor's
// RETURN is the only cross-owner half and lives in pi-actions.ts
// (returnNotebookForStudent), audited like every other PI write.
//
// The pure transition + legality (submitNotebook) lives in class-submission.ts;
// this module is the thin live writer over tasksApi.update. Gated behind
// NEXT_PUBLIC_CLASS_MODE so a flag-off build never stamps a submission.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { tasksApi } from "@/lib/local-api";
import { submitNotebook } from "./class-submission";
import { CLASS_MODE_ENABLED } from "./class-mode-config";
import type { Task } from "@/lib/types";

export type SubmitNotebookResult =
  | { ok: true; task: Task }
  | { ok: false; error: unknown };

/**
 * The STUDENT submits their own notebook. Reads the current submission off the
 * task, runs the pure legal transition (throws on a double-submit), and persists
 * the next submission via an OWNER-SCOPED tasksApi.update (the student writes their
 * own record). submittedRev pins the notebook's version-history rev so "what they
 * submitted" is a fixed snapshot even if they keep editing.
 *
 * Flag off, refuses cleanly (no write), so a stray caller in a flag-off build is a
 * no-op exactly like today.
 *
 * @param taskId the student's own notebook task id.
 * @param submittedRev the version-history rev to pin at submit time.
 * @param owner the student's username (the owner-scoped write target). Optional;
 *   omitted uses the current-user solo path inside tasksApi.update.
 */
export async function submitNotebookForStudent(args: {
  taskId: number;
  submittedRev: string;
  owner?: string;
}): Promise<SubmitNotebookResult> {
  if (!CLASS_MODE_ENABLED) {
    return {
      ok: false,
      error: new Error(
        "submitNotebookForStudent: class mode is disabled (NEXT_PUBLIC_CLASS_MODE off)",
      ),
    };
  }
  try {
    const current = await tasksApi.get(args.taskId, args.owner);
    if (!current) {
      throw new Error(
        `submitNotebookForStudent: task ${args.taskId} not found`,
      );
    }
    const next = submitNotebook(
      current.submission,
      args.submittedRev,
      new Date().toISOString(),
    );
    const updated = await tasksApi.update(
      args.taskId,
      { submission: next },
      args.owner,
    );
    if (!updated) {
      throw new Error("submitNotebookForStudent: tasksApi.update returned null");
    }
    return { ok: true, task: updated };
  } catch (error) {
    return { ok: false, error };
  }
}
