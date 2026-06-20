// Tests for Class Mode CT-2 assignment fan-out (class-assignment.ts).
//
// The load-bearing assertions encode scope critic C2:
//   - the fan-out authors ONLY an instructor-owned record (never a student's
//     owner-prefix);
//   - a student opening an assignment creates a STUDENT-owned notebook;
//   - the no-cross-owner-prefix invariant holds across the whole plan;
//   - private notebooks are flagged for the Stage 1 subkey, collaborative ones
//     are not.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { LabMember } from "./lab-membership";
import {
  planAssignmentFanout,
  planStudentNotebook,
  fanoutHonorsOwnerPrefixInvariant,
  CLASS_ASSIGNMENT_RECORD_TYPE,
  type ClassAssignmentRecord,
} from "./class-assignment";

function makeStudent(username: string): LabMember {
  return {
    username,
    x25519PublicKey: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
    ed25519PublicKey: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
    role: "member",
  };
}

const STUDENTS = ["alice", "bob", "carol"].map(makeStudent);
const INSTRUCTOR = "prof";

function baseArgs(overrides?: Partial<Parameters<typeof planAssignmentFanout>[0]>) {
  return {
    assignmentId: "asg-1",
    title: "Assignment 3",
    description: "Run the PCR protocol and record your results.",
    templateMethodId: 42,
    checklist: [
      { id: "s1", label: "Prepare master mix" },
      { id: "s2", label: "Run thermocycler" },
    ],
    visibility: "private" as const,
    instructor: INSTRUCTOR,
    students: STUDENTS,
    assignedAt: "2026-06-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("CT-2: the fan-out authors ONLY an instructor-owned record", () => {
  it("produces exactly one instructor-owned shared write", () => {
    const plan = planAssignmentFanout(baseArgs({ wholeClass: true }));
    expect(plan.instructorWrite.owner).toBe(INSTRUCTOR);
    expect(plan.instructorWrite.recordType).toBe(CLASS_ASSIGNMENT_RECORD_TYPE);
    expect(plan.instructorWrite.record.instructor).toBe(INSTRUCTOR);
    // Whole-class share is the "*" sentinel, not a per-student fan-out write.
    expect(plan.instructorWrite.sharedWith).toEqual(["*"]);
  });

  it("never writes a record under a student's owner-prefix", () => {
    const plan = planAssignmentFanout(baseArgs());
    // The plan carries exactly ONE write, and it is the instructor's.
    expect(plan.instructorWrite.owner).toBe(INSTRUCTOR);
    // Every student gets a NOTIFICATION, not a record write.
    const notifiedOwners = plan.notifications.map((n) => n.toUser).sort();
    expect(notifiedOwners).toEqual(["alice", "bob", "carol"]);
    // No notification names the instructor as a recipient (no self-notify case
    // because the instructor is excluded from students).
    expect(plan.notifications.some((n) => n.toUser === INSTRUCTOR)).toBe(false);
  });

  it("per-student share lists the roster usernames, not '*'", () => {
    const plan = planAssignmentFanout(baseArgs({ wholeClass: false }));
    expect(plan.instructorWrite.sharedWith.sort()).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
  });

  it("de-duplicates students and refuses the instructor-as-student roster", () => {
    const dupes = [...STUDENTS, makeStudent("alice")];
    const plan = planAssignmentFanout(baseArgs({ students: dupes }));
    expect(plan.notifications.length).toBe(3);

    expect(() =>
      planAssignmentFanout(
        baseArgs({ students: [...STUDENTS, makeStudent(INSTRUCTOR)] }),
      ),
    ).toThrow(/cannot be a student of their own class/);
  });
});

describe("CT-2: a student opening an assignment creates a STUDENT-owned notebook", () => {
  const assignment: ClassAssignmentRecord = {
    assignmentId: "asg-1",
    title: "Assignment 3",
    templateMethodId: 42,
    checklist: [{ id: "s1", label: "Prepare master mix" }],
    visibility: "private",
    instructor: INSTRUCTOR,
    assignedAt: "2026-06-19T00:00:00.000Z",
  };

  it("the notebook is owned by the opening student, linked by assignment_id", () => {
    const nb = planStudentNotebook(assignment, "alice");
    expect(nb.owner).toBe("alice");
    expect(nb.assignmentId).toBe("asg-1");
    expect(nb.templateMethodId).toBe(42);
    expect(nb.checklist).toEqual(assignment.checklist);
  });

  it("a private assignment flags the notebook for the Stage 1 subkey", () => {
    const nb = planStudentNotebook(assignment, "alice");
    expect(nb.subkeySealed).toBe(true);
  });

  it("a collaborative assignment does NOT subkey-seal the notebook", () => {
    const collab: ClassAssignmentRecord = {
      ...assignment,
      visibility: "collaborative",
    };
    const nb = planStudentNotebook(collab, "bob");
    expect(nb.subkeySealed).toBe(false);
  });

  it("the instructor does NOT author a student notebook for their own assignment", () => {
    expect(() => planStudentNotebook(assignment, INSTRUCTOR)).toThrow(
      /does not author a student notebook/,
    );
  });
});

describe("CT-2: the no-cross-owner-prefix invariant holds across the plan", () => {
  it("instructor owns the shared record, every student owns their own notebook", () => {
    const plan = planAssignmentFanout(baseArgs({ wholeClass: true }));
    const notebooks = STUDENTS.map((s) =>
      planStudentNotebook(plan.instructorWrite.record, s.username),
    );
    expect(fanoutHonorsOwnerPrefixInvariant(plan, notebooks)).toBe(true);
  });

  it("an injected notebook owned by the instructor breaks the invariant", () => {
    const plan = planAssignmentFanout(baseArgs({ wholeClass: true }));
    const notebooks = STUDENTS.map((s) =>
      planStudentNotebook(plan.instructorWrite.record, s.username),
    );
    // Forge a notebook owned by the instructor (the C2 violation we forbid).
    const forged = { ...notebooks[0], owner: INSTRUCTOR };
    expect(
      fanoutHonorsOwnerPrefixInvariant(plan, [...notebooks, forged]),
    ).toBe(false);
  });

  it("a mismatched record.instructor breaks the invariant", () => {
    const plan = planAssignmentFanout(baseArgs({ wholeClass: true }));
    const broken = {
      ...plan,
      instructorWrite: {
        ...plan.instructorWrite,
        record: { ...plan.instructorWrite.record, instructor: "someone-else" },
      },
    };
    expect(fanoutHonorsOwnerPrefixInvariant(broken, [])).toBe(false);
  });
});
