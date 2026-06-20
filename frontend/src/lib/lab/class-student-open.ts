// Class Mode CT-2: the STUDENT-open action (the last wiring gap of the student loop).
//
// When a student opens an assignment for the first time, they create their OWN
// per-student notebook task, linked back to the instructor-owned assignment by
// assignment_id (the C2 invariant: no actor authors under another user's
// owner-prefix, so the student authors their own notebook in their own folder).
// Subsequent opens REUSE that notebook (idempotent, one notebook per assignment
// per student), so re-opening never spawns a duplicate.
//
// PRIVACY. The notebook's shared_with is seeded from the ASSIGNMENT's visibility
// (private => no whole-class "*" entry; collaborative => "*"), via the CT-2
// class_visibility arg on tasksApi.create. A private notebook therefore satisfies
// isPrivateClassNotebookRecord, so the lab-sync partition routes it through the
// per-student subkey write path automatically on the next sync, sealing it to the
// student and the head only. This module does NOT seal anything itself; it just
// creates a correctly-seeded local task and lets the established sync path encrypt
// it (the Stage C fence is already closed). That keeps the student-open path a
// plain owner-scoped create, not a bespoke crypto write.
//
// FLAG: behind CLASS_MODE_ENABLED. Flag off, refuses cleanly (no create), so a
// non-class build never authors a notebook.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { tasksApi } from "@/lib/local-api";
import { CLASS_MODE_ENABLED } from "./class-mode-config";
import { planStudentNotebook } from "./class-assignment";
import type { ClassAssignmentRecord } from "./class-assignment";
import type { Task } from "@/lib/types";

/** Minimal slice of tasksApi this action needs, so tests can inject a fake. */
export interface StudentOpenTasksApi {
  listAllForUser: (owner: string) => Promise<Task[]>;
  create: typeof tasksApi.create;
}

export type OpenAssignmentResult =
  | { ok: true; task: Task; created: boolean }
  | { ok: false; error: unknown };

/**
 * Open (find-or-create) the student's per-student notebook for an assignment.
 *
 * Idempotent: if the student already has a notebook task carrying this
 * assignment_id, it is returned untouched (created: false). Otherwise a new
 * student-owned notebook is created (created: true), seeded with the assignment's
 * title, checklist (copied into sub_tasks), template method, and per-assignment
 * visibility.
 *
 * @param params.assignment the instructor-authored assignment the student opened.
 * @param params.student the opening student's username (the notebook owner). MUST
 *   be the current user (tasksApi.create records the current user as owner); this
 *   is also used to scan for an existing notebook.
 * @param params.today optional ISO date (YYYY-MM-DD) for the notebook start_date;
 *   defaults to the current date. Injected in tests for determinism.
 * @param params.tasksApiImpl injected tasks API (defaults to the real one).
 */
export async function openAssignmentNotebook(params: {
  assignment: ClassAssignmentRecord;
  student: string;
  today?: string;
  tasksApiImpl?: StudentOpenTasksApi;
}): Promise<OpenAssignmentResult> {
  if (!CLASS_MODE_ENABLED) {
    return {
      ok: false,
      error: new Error(
        "openAssignmentNotebook: class mode is disabled (NEXT_PUBLIC_CLASS_MODE off)",
      ),
    };
  }

  const api = params.tasksApiImpl ?? tasksApi;

  try {
    // The planner enforces the C2 rule (the instructor never authors a student
    // notebook for their own assignment) and stamps owner = student. It throws on
    // a malformed call, which we surface as a clean failure.
    const plan = planStudentNotebook(params.assignment, params.student);

    // Idempotent: reuse an existing notebook for this assignment if one exists.
    const existing = await api.listAllForUser(params.student);
    const already = existing.find(
      (t) => t.assignment_id === params.assignment.assignmentId,
    );
    if (already) {
      return { ok: true, task: already, created: false };
    }

    const startDate =
      params.today ?? new Date().toISOString().slice(0, 10);

    const task = await api.create({
      name: plan.name,
      start_date: startDate,
      task_type: "experiment",
      assignment_id: plan.assignmentId,
      template_method_id: plan.templateMethodId,
      class_visibility: params.assignment.visibility,
      method_ids:
        plan.templateMethodId !== undefined ? [plan.templateMethodId] : [],
      sub_tasks: plan.checklist.map((c) => ({
        id: c.id,
        text: c.label,
        is_complete: false,
      })),
    });

    return { ok: true, task, created: true };
  } catch (error) {
    return { ok: false, error };
  }
}
