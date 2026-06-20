// Class assignment relay-record I/O (CT-2 live wiring).
//
// The instructor PUBLISHES one INSTRUCTOR-OWNED shared assignment record per
// assignment, over the SAME server-blind relay store the class dashboard and
// announcements ride. The record lives at
// `${labId}/<instructor>/class_assignment/<assignmentId>`, E2E under the class
// team key, surfaced to every roster member per the assignment's shared_with
// (whole class "*" or a per-student list). Students READ it; they never write it.
// This module is the thin transport glue over putLabRecord / getLabRecord; the
// fan-out shape + C2 invariant live in class-assignment.ts (the pure planner).
//
// WHY team key, not a subkey. The assignment PROMPT is not secret from
// classmates, only each student's ANSWER is. So the assignment record is sealed
// under the team key exactly like the dashboard. The per-student PRIVATE notebook
// is what gets the subkey (lab-subkey.ts), authored separately by the student.
//
// The payload is published RAW (the assignment record + its inline shared_with),
// exactly like the class dashboard (class-dashboard-store.ts). putLabRecord's own
// lab-key AEAD is the ONE team-key seal, so a student's pull yields the assignment
// payload directly after the team-key decrypt, with nothing left to peel. There is
// no inner SubkeyedRecord wrapper: the prompt is not secret from classmates (only a
// student's private ANSWER gets the subkey, in their own notebook), so a second
// team-key layer bought nothing and the read path never unwrapped it.
//
// FLAG (data-shape): the `class_assignment` relay record type (additive, E2E,
// instructor-owned). An unknown record type was invisible to pullLabView before,
// so introducing it is safe and renders nothing with NEXT_PUBLIC_CLASS_MODE off.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { putLabRecord } from "./lab-data-client";
import {
  CLASS_ASSIGNMENT_RECORD_TYPE,
  type InstructorAssignmentWrite,
} from "./class-assignment";

/**
 * Serialize an InstructorAssignmentWrite payload into the plaintext bytes
 * putLabRecord stores. The payload is the assignment record PLUS its shared_with
 * list (so the lab-read.ts shared_with gate can surface it to the right students,
 * and the materializer can cache it for the student workbench). putLabRecord
 * AEAD-seals these bytes under the lab key, so the relay stays server-blind. No
 * inner wrapper: this matches the class-dashboard publish shape exactly.
 */
export function encodeAssignmentRecord(
  write: InstructorAssignmentWrite,
): Uint8Array {
  // The record carries its shared_with inline so pullLabView's per-record gate
  // can read the sharing intent after it decrypts the team-key layer. This
  // mirrors how every other shared record carries shared_with in its body.
  const payload = {
    ...write.record,
    shared_with: write.sharedWith,
  };
  return new TextEncoder().encode(JSON.stringify(payload));
}

/**
 * Publish (create or overwrite) one instructor-owned shared assignment record.
 * The instructor writes under their OWN owner-prefix; the relay verifies the
 * signer is on the roster, the team key encrypts the payload so the relay stays
 * blind. INVARIANT (C2): owner is ALWAYS the instructor, never a student.
 */
export async function publishAssignmentRecord(params: {
  labId: string;
  write: InstructorAssignmentWrite;
  teamKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  putImpl?: typeof putLabRecord;
}): Promise<void> {
  const put = params.putImpl ?? putLabRecord;
  await put({
    labId: params.labId,
    // INVARIANT: the owner is the instructor, exactly as the planner stamped it.
    owner: params.write.owner,
    recordType: CLASS_ASSIGNMENT_RECORD_TYPE,
    recordId: params.write.recordId,
    plaintext: encodeAssignmentRecord(params.write),
    labKey: params.teamKey,
    signerEd25519Priv: params.signerEd25519Priv,
    signerEd25519Pub: params.signerEd25519Pub,
  });
}
