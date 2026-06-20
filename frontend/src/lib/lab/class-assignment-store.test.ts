// Tests for the CT-2 assignment store transport glue (class-assignment-store.ts).
//
// The load-bearing assertions:
//   - the published record is ALWAYS instructor-owned (C2 invariant) and carries
//     the class_assignment record type + the planner's recordId;
//   - the assignment is sealed under the TEAM key (the prompt is not secret from
//     classmates), so the wrapper carries NO subkey envelope (backward-compatible
//     shape) and round-trips under the team key;
//   - the shared_with list rides inline on the payload so the lab-read.ts gate can
//     surface it to the right students.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateLabKey, encryptLabData, decryptLabData } from "./lab-key";
import {
  planAssignmentFanout,
  CLASS_ASSIGNMENT_RECORD_TYPE,
} from "./class-assignment";
import type { LabMember } from "./lab-membership";
import {
  encodeAssignmentRecord,
  publishAssignmentRecord,
} from "./class-assignment-store";

function makeStudent(username: string): LabMember {
  return {
    username,
    x25519PublicKey: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
    ed25519PublicKey: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
    role: "member",
  };
}

const STUDENTS = ["alice", "bob"].map(makeStudent);
const INSTRUCTOR = "prof";

function plan(wholeClass: boolean) {
  return planAssignmentFanout({
    assignmentId: "asg-7",
    title: "Assignment 7",
    description: "Run the protocol.",
    templateMethodId: 42,
    checklist: [{ id: "s1", label: "Prepare master mix" }],
    visibility: "private",
    instructor: INSTRUCTOR,
    students: STUDENTS,
    assignedAt: "2026-06-20T00:00:00.000Z",
    wholeClass,
  });
}

describe("encodeAssignmentRecord", () => {
  it("emits the RAW assignment payload (no inner wrapper), matching the dashboard shape", () => {
    const bytes = encodeAssignmentRecord(plan(true).instructorWrite);
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    // No SubkeyedRecord wrapper: the payload IS the assignment record fields.
    expect(payload.blob).toBeUndefined();
    expect(payload.subkey).toBeUndefined();
    expect(payload.assignmentId).toBe("asg-7");
    expect(payload.instructor).toBe(INSTRUCTOR);
  });

  it("carries the shared_with list inline so the read gate can surface it", () => {
    const perStudent = encodeAssignmentRecord(plan(false).instructorWrite);
    const payload = JSON.parse(new TextDecoder().decode(perStudent));
    expect([...payload.shared_with].sort()).toEqual(["alice", "bob"]);

    const wholeClass = encodeAssignmentRecord(plan(true).instructorWrite);
    const payload2 = JSON.parse(new TextDecoder().decode(wholeClass));
    expect(payload2.shared_with).toEqual(["*"]);
  });

  it("round-trips under the team key exactly as putLabRecord stores it", () => {
    const teamKey = generateLabKey();
    // putLabRecord AEAD-seals the raw bytes; a student peels that one layer.
    const bytes = encodeAssignmentRecord(plan(true).instructorWrite);
    const sealed = encryptLabData(bytes, teamKey);
    const back = JSON.parse(new TextDecoder().decode(decryptLabData(sealed, teamKey)));
    expect(back.assignmentId).toBe("asg-7");
    expect(back.title).toBe("Assignment 7");
  });
});

describe("publishAssignmentRecord", () => {
  it("writes the INSTRUCTOR-owned record under the class_assignment type + planner recordId", async () => {
    const teamKey = generateLabKey();
    const ed25519Priv = crypto.getRandomValues(new Uint8Array(32));
    const ed25519Pub = crypto.getRandomValues(new Uint8Array(32));
    const putImpl = vi.fn().mockResolvedValue(undefined);
    const p = plan(true);

    await publishAssignmentRecord({
      labId: "lab-1",
      write: p.instructorWrite,
      teamKey,
      signerEd25519Priv: ed25519Priv,
      signerEd25519Pub: ed25519Pub,
      putImpl,
    });

    expect(putImpl).toHaveBeenCalledTimes(1);
    const call = putImpl.mock.calls[0][0];
    expect(call.owner).toBe(INSTRUCTOR);
    expect(call.recordType).toBe(CLASS_ASSIGNMENT_RECORD_TYPE);
    expect(call.recordId).toBe("asg-7");
    expect(call.labId).toBe("lab-1");

    // The plaintext is the RAW assignment payload (no inner wrapper); putLabRecord
    // seals it under the team key (call.labKey).
    const payload = JSON.parse(new TextDecoder().decode(call.plaintext));
    expect(payload.blob).toBeUndefined();
    expect(payload.assignmentId).toBe("asg-7");
    expect(payload.shared_with).toEqual(["*"]);
  });
});
