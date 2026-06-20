// Class Mode (CT-2): assignment fan-out, the instructor-owned shared assignment
// record + the student-owned per-student notebook.
//
// WHY THIS SHAPE (scope critic C2). The first-pass design ("the instructor writes
// a task into users/<student>/tasks/<id>.json") self-destructs: under folder
// residency the student keeps their OWN folder, the head has no subdir on the
// student's disk, and the only path that reaches the student is a relay write
// under owner=<student>, which is an un-audited cross-owner write that the
// student's next sync TOMBSTONE-DELETES anyway (the student's manifest never
// contained that key). So:
//
//   THE INVARIANT (C2): no actor ever authors a record under another user's
//   owner-prefix. The assignment is ONE INSTRUCTOR-OWNED shared record under the
//   instructor's OWN owner-prefix (shared_with "*" for the whole class, or
//   per-student), carrying the method/template + checklist. The per-student
//   NOTEBOOK is a SEPARATE student-owned task the STUDENT creates on FIRST OPEN,
//   linked back to the assignment by assignment_id. The head never writes into a
//   student's space; the student never writes into the head's space.
//
// This module is the PURE planner for that fan-out. It produces the descriptors
// the live writers consume (the instructor's putLabRecord for the assignment
// record, the student's tasksApi.create for their notebook), so the C2 invariant
// is unit-provable in isolation, exactly like the sibling CT modules
// (class-materials, class-dashboard) ship as pure, I/O-free, flag-off-safe cores.
// Wiring these descriptors into pi-actions.ts + the student open path is a thin
// follow-up gated on the contended store layer; the correctness lives here.
//
// PRIVACY (Stage 1 tie-in). When the assignment's visibility is "private", the
// student's notebook is encrypted under the student's per-student subkey
// (lab-subkey.ts), sealed only to the student and the head, so no classmate can
// read it even though they hold the team key. This planner FLAGS which notebooks
// must be subkey-sealed; the live student-open writer calls encryptPrivateRecord.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { LabMember } from "./lab-membership";

// ---------------------------------------------------------------------------
// 1. The instructor-owned shared assignment record.
// ---------------------------------------------------------------------------

/** The reserved lab-record type for a class assignment (instructor-owned). */
export const CLASS_ASSIGNMENT_RECORD_TYPE = "class_assignment";

/**
 * One checklist step copied from the instructor's method onto the assignment, so
 * every student's notebook seeds the same sub-task list. Structurally a subset of
 * SubTask, kept minimal here so this module stays dependency-light.
 */
export interface AssignmentChecklistItem {
  id: string;
  label: string;
}

/**
 * The visibility of student work for an assignment. "private" (the exam default)
 * means each student's notebook is sealed under their per-student subkey, readable
 * only by the student and the instructor. "collaborative" (the CURE default) means
 * the notebook uses the team key and is shared per the class visibility policy.
 */
export type AssignmentVisibility = "private" | "collaborative";

/**
 * The instructor-owned shared assignment record payload. Authored ONCE by the
 * instructor under the instructor's own owner-prefix and shared to the roster
 * (whole-class "*" or a per-student list). The students READ it; they never write
 * to it. E2E under the class team key (the assignment prompt is not secret from
 * classmates, only each student's ANSWER is).
 *
 * FLAG (data-shape): a NEW lab-record type class_assignment, additive + E2E. An
 * unknown record type was invisible to pullLabView before, so introducing it is
 * safe and renders nothing with NEXT_PUBLIC_CLASS_MODE off.
 */
export interface ClassAssignmentRecord {
  /** Stable assignment id (a string portable id, the link target for notebooks). */
  assignmentId: string;
  /** Display title shown to students. */
  title: string;
  /** Optional longer prompt / instructions. */
  description?: string;
  /** The method the protocol was authored as (copied by reference into notebooks). */
  templateMethodId?: number;
  /** Checklist steps seeded into each student notebook's sub_tasks. */
  checklist: AssignmentChecklistItem[];
  /** Whether student work is private (subkey-sealed) or collaborative (team key). */
  visibility: AssignmentVisibility;
  /** The instructor (head) username, the sole author. */
  instructor: string;
  /** ISO 8601 author timestamp. */
  assignedAt: string;
}

// ---------------------------------------------------------------------------
// 2. The fan-out plan, what each side must write.
// ---------------------------------------------------------------------------

/**
 * The single instructor-owned write: the assignment record + the share list. The
 * live writer calls putLabRecord(owner=instructor, recordType=class_assignment,
 * shared_with=sharedWith). owner is ALWAYS the instructor, never a student, which
 * is the C2 invariant made explicit.
 */
export interface InstructorAssignmentWrite {
  /** The record owner. INVARIANT: always the instructor, never a student. */
  owner: string;
  recordType: typeof CLASS_ASSIGNMENT_RECORD_TYPE;
  recordId: string;
  record: ClassAssignmentRecord;
  /** The roster usernames the record is shared to ("*" for whole class). */
  sharedWith: string[];
}

/**
 * One bell notification descriptor for a student. The live writer maps this to the
 * existing appendNotification fan-out. Carried in the plan so the planner can be
 * tested for "every student is notified exactly once" without the I/O.
 */
export interface AssignmentNotification {
  toUser: string;
  fromUser: string;
  assignmentId: string;
  title: string;
}

/**
 * The complete, C2-correct fan-out plan for assigning a method to a class. It is
 * exactly ONE instructor-owned write plus one notification per student. There is
 * deliberately NO per-student record write here: the student notebooks come into
 * existence later, student-owned, via planStudentNotebook on first open.
 */
export interface AssignmentFanoutPlan {
  instructorWrite: InstructorAssignmentWrite;
  notifications: AssignmentNotification[];
}

/**
 * Plan the fan-out for assigning a method/template to a whole class. Models the
 * role + audit + notification posture of assignTask (pi-actions.ts) but, per C2,
 * fans OUT as ONE instructor-owned shared record plus a per-student notification,
 * NOT a write into each student's folder.
 *
 * The roster MUST come from the relay roster (getLabRemote(labId).record.members
 * filtered to non-head members), NOT the folder-bound useLabData().users, because
 * the students live in their own folders and only the signed relay roster names
 * them. The caller passes that filtered student list as `students`.
 *
 * @param args.assignmentId stable id for this assignment.
 * @param args.title display title.
 * @param args.description optional prompt.
 * @param args.templateMethodId the method the protocol was authored as.
 * @param args.checklist checklist steps to seed into each notebook.
 * @param args.visibility private (subkey) or collaborative (team key).
 * @param args.instructor the head username (sole author).
 * @param args.students the relay-roster students (non-head members).
 * @param args.assignedAt ISO timestamp.
 * @param args.wholeClass when true, share to "*"; otherwise share per-student.
 * @throws if instructor is empty, or if any student equals the instructor (a head
 *   is never a student of their own class), so the invariant cannot be violated
 *   by a malformed roster.
 */
export function planAssignmentFanout(args: {
  assignmentId: string;
  title: string;
  description?: string;
  templateMethodId?: number;
  checklist: AssignmentChecklistItem[];
  visibility: AssignmentVisibility;
  instructor: string;
  students: LabMember[];
  assignedAt: string;
  wholeClass?: boolean;
}): AssignmentFanoutPlan {
  if (!args.instructor) {
    throw new Error("planAssignmentFanout: instructor username is required");
  }
  // De-duplicate students by username and refuse to treat the instructor as a
  // student of their own class (would let the head's own notebook be "assigned").
  const seen = new Set<string>();
  const students: string[] = [];
  for (const s of args.students) {
    if (s.username === args.instructor) {
      throw new Error(
        `planAssignmentFanout: instructor ${args.instructor} cannot be a student of their own class`,
      );
    }
    if (!seen.has(s.username)) {
      seen.add(s.username);
      students.push(s.username);
    }
  }

  const record: ClassAssignmentRecord = {
    assignmentId: args.assignmentId,
    title: args.title,
    description: args.description,
    templateMethodId: args.templateMethodId,
    checklist: args.checklist,
    visibility: args.visibility,
    instructor: args.instructor,
    assignedAt: args.assignedAt,
  };

  const instructorWrite: InstructorAssignmentWrite = {
    // INVARIANT: the owner is the instructor, full stop. The assignment never
    // lands under a student's owner-prefix.
    owner: args.instructor,
    recordType: CLASS_ASSIGNMENT_RECORD_TYPE,
    recordId: args.assignmentId,
    record,
    sharedWith: args.wholeClass ? ["*"] : students,
  };

  const notifications: AssignmentNotification[] = students.map((u) => ({
    toUser: u,
    fromUser: args.instructor,
    assignmentId: args.assignmentId,
    title: args.title,
  }));

  return { instructorWrite, notifications };
}

// ---------------------------------------------------------------------------
// 3. The student-owned per-student notebook (created on FIRST OPEN).
// ---------------------------------------------------------------------------

/**
 * The descriptor for the student-owned notebook task the student creates the
 * first time they open an assignment. The live writer calls tasksApi.create with
 * owner=student, linking assignment_id + template_method_id (the new Task fields),
 * and, when the assignment is private, sealing the notebook under the student's
 * per-student subkey (encryptPrivateRecord, lab-subkey.ts).
 *
 * INVARIANT (C2): owner is ALWAYS the student. The notebook is created in the
 * STUDENT's own folder/namespace, never authored by the head.
 */
export interface StudentNotebookPlan {
  /** The record owner. INVARIANT: always the student who opened the assignment. */
  owner: string;
  /** The assignment this notebook answers (the back-link, a Task.assignment_id). */
  assignmentId: string;
  /** The method copied by reference (a Task.template_method_id). */
  templateMethodId?: number;
  /** Checklist steps copied into the notebook task's sub_tasks. */
  checklist: AssignmentChecklistItem[];
  /** Display name for the notebook task. */
  name: string;
  /**
   * True iff the notebook must be sealed under the student's per-student subkey
   * (lab-subkey.ts encryptPrivateRecord), because the assignment is private. When
   * false, the notebook uses the team key and the class visibility policy seeds
   * its shared_with. This is the Stage 1 <-> Stage 2 bridge.
   */
  subkeySealed: boolean;
}

/**
 * Plan the student-owned notebook for a given student opening a given assignment.
 * Pure: returns the descriptor the student's own device writes (owner=student).
 * The head is NEVER the owner here, enforcing the C2 no-cross-owner-prefix rule
 * from the student side too.
 *
 * @param assignment the instructor-authored assignment record the student opened.
 * @param student the opening student's username.
 * @throws if student is empty, or if the student IS the assignment's instructor
 *   (the instructor does not create a student notebook for their own assignment).
 */
export function planStudentNotebook(
  assignment: ClassAssignmentRecord,
  student: string,
): StudentNotebookPlan {
  if (!student) {
    throw new Error("planStudentNotebook: student username is required");
  }
  if (student === assignment.instructor) {
    throw new Error(
      `planStudentNotebook: the instructor ${assignment.instructor} does not author a student notebook for their own assignment`,
    );
  }
  return {
    // INVARIANT: the student owns their own notebook.
    owner: student,
    assignmentId: assignment.assignmentId,
    templateMethodId: assignment.templateMethodId,
    checklist: assignment.checklist,
    name: assignment.title,
    // Private assignment => subkey-sealed notebook (Stage 1). Collaborative =>
    // team key + the class visibility policy.
    subkeySealed: assignment.visibility === "private",
  };
}

/**
 * The C2 cross-owner-prefix invariant, exposed as a checkable predicate over a
 * complete fan-out plus all the student notebooks it spawned. Returns true iff:
 *   - the single shared record is owned by the instructor, and
 *   - every student notebook is owned by a NON-instructor student, and
 *   - no notebook owner equals the instructor.
 * No actor ever authors a record under another user's owner-prefix.
 */
export function fanoutHonorsOwnerPrefixInvariant(
  plan: AssignmentFanoutPlan,
  notebooks: StudentNotebookPlan[],
): boolean {
  const instructor = plan.instructorWrite.owner;
  if (plan.instructorWrite.record.instructor !== instructor) return false;
  for (const nb of notebooks) {
    if (nb.owner === instructor) return false;
    if (!nb.owner) return false;
  }
  return true;
}
