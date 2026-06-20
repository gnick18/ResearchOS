// Tests for Class Mode CT-4 submit + review (class-submission.ts).
//
// Covers the state-machine legality, the submitted_rev pinning, the resubmit
// note-clear, and the roster-join dashboard (every roster student appears).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import type { ClassSubmission } from "@/lib/types";
import {
  initialSubmission,
  resolveSubmission,
  submitNotebook,
  returnNotebook,
  buildSubmissionDashboard,
} from "./class-submission";

describe("CT-4: initial + resolve", () => {
  it("a fresh notebook is not_submitted", () => {
    expect(initialSubmission().status).toBe("not_submitted");
  });

  it("an absent submission resolves to not_submitted", () => {
    expect(resolveSubmission(undefined).status).toBe("not_submitted");
    expect(resolveSubmission(null).status).toBe("not_submitted");
  });
});

describe("CT-4: student submit pins the rev", () => {
  it("submit from not_submitted stamps at + the pinned rev", () => {
    const next = submitNotebook(undefined, "rev-abc", "2026-06-19T01:00:00.000Z");
    expect(next.status).toBe("submitted");
    expect(next.submitted_rev).toBe("rev-abc");
    expect(next.submitted_at).toBe("2026-06-19T01:00:00.000Z");
  });

  it("the pinned rev is fixed even though the student keeps editing", () => {
    // Submit pins rev-1. A later edit advances the live rev to rev-2, but the
    // submission still points at the pinned rev-1 snapshot.
    const submitted = submitNotebook(undefined, "rev-1", "2026-06-19T01:00:00.000Z");
    expect(submitted.submitted_rev).toBe("rev-1");
    // The instructor reviews against submitted_rev, not the live head.
    expect(submitted.submitted_rev).not.toBe("rev-2");
  });

  it("a submit with no rev throws (the snapshot must be pinned)", () => {
    expect(() =>
      submitNotebook(undefined, "", "2026-06-19T01:00:00.000Z"),
    ).toThrow(/submitted_rev is required/);
  });

  it("double-submit is illegal", () => {
    const submitted = submitNotebook(undefined, "rev-1", "2026-06-19T01:00:00.000Z");
    expect(() =>
      submitNotebook(submitted, "rev-2", "2026-06-19T02:00:00.000Z"),
    ).toThrow(/already submitted/);
  });
});

describe("CT-4: instructor return", () => {
  it("return from submitted writes the note and keeps the pinned rev", () => {
    const submitted = submitNotebook(undefined, "rev-1", "2026-06-19T01:00:00.000Z");
    const returned = returnNotebook(submitted, "Good work, fix step 2.");
    expect(returned.status).toBe("returned");
    expect(returned.instructor_note).toBe("Good work, fix step 2.");
    // The pinned snapshot survives the return.
    expect(returned.submitted_rev).toBe("rev-1");
    expect(returned.submitted_at).toBe("2026-06-19T01:00:00.000Z");
  });

  it("returning a not_submitted notebook is illegal", () => {
    expect(() => returnNotebook(undefined, "note")).toThrow(
      /can only return a submitted notebook/,
    );
  });

  it("re-returning an already-returned notebook is illegal", () => {
    const submitted = submitNotebook(undefined, "rev-1", "2026-06-19T01:00:00.000Z");
    const returned = returnNotebook(submitted, "first note");
    expect(() => returnNotebook(returned, "second note")).toThrow(
      /can only return a submitted notebook/,
    );
  });

  it("NO numeric score is ever stored", () => {
    const submitted = submitNotebook(undefined, "rev-1", "2026-06-19T01:00:00.000Z");
    const returned = returnNotebook(submitted, "feedback only");
    expect(Object.keys(returned).sort()).toEqual([
      "instructor_note",
      "status",
      "submitted_at",
      "submitted_rev",
    ]);
    expect("score" in returned).toBe(false);
    expect("grade" in returned).toBe(false);
  });
});

describe("CT-4: resubmit after a return", () => {
  it("a returned notebook can be resubmitted, re-pinning and clearing the stale note", () => {
    const submitted = submitNotebook(undefined, "rev-1", "2026-06-19T01:00:00.000Z");
    const returned = returnNotebook(submitted, "please revise step 2");
    expect(returned.instructor_note).toBe("please revise step 2");

    const resubmitted = submitNotebook(
      returned,
      "rev-2",
      "2026-06-19T03:00:00.000Z",
    );
    expect(resubmitted.status).toBe("submitted");
    expect(resubmitted.submitted_rev).toBe("rev-2");
    // The stale instructor note must NOT carry over onto the new submission.
    expect(resubmitted.instructor_note).toBeUndefined();
  });
});

describe("CT-4: dashboard join shows the WHOLE roster", () => {
  const roster = ["alice", "bob", "carol"];

  it("every roster student gets a row, in roster order, even if no notebook", () => {
    const aliceSub: ClassSubmission = {
      status: "submitted",
      submitted_at: "2026-06-19T01:00:00.000Z",
      submitted_rev: "rev-a",
    };
    const rows = buildSubmissionDashboard(roster, [
      { student: "alice", submission: aliceSub },
      // bob has a notebook but has not submitted
      { student: "bob", submission: { status: "not_submitted" } },
      // carol never opened the assignment, no notebook entry at all
    ]);

    expect(rows.map((r) => r.student)).toEqual(["alice", "bob", "carol"]);
    expect(rows[0].status).toBe("submitted");
    expect(rows[0].submittedRev).toBe("rev-a");
    expect(rows[0].hasNotebook).toBe(true);
    expect(rows[1].status).toBe("not_submitted");
    expect(rows[1].hasNotebook).toBe(true);
    // carol surfaces as not_submitted with no notebook, no silent gap.
    expect(rows[2].status).toBe("not_submitted");
    expect(rows[2].hasNotebook).toBe(false);
  });

  it("surfaces a returned status with the instructor note", () => {
    const returnedSub: ClassSubmission = {
      status: "returned",
      submitted_at: "2026-06-19T01:00:00.000Z",
      submitted_rev: "rev-a",
      instructor_note: "nice",
    };
    const rows = buildSubmissionDashboard(["alice"], [
      { student: "alice", submission: returnedSub },
    ]);
    expect(rows[0].status).toBe("returned");
    expect(rows[0].instructorNote).toBe("nice");
  });

  it("a duplicated roster name yields exactly one row", () => {
    const rows = buildSubmissionDashboard(["alice", "alice"], []);
    expect(rows.length).toBe(1);
    expect(rows[0].student).toBe("alice");
  });
});
