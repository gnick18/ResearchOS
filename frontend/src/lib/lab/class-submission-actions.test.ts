// Tests for the CT-4 student submit action + the dashboard gather (live wiring).
//
// The load-bearing assertions:
//   - submit stamps submitted_at + submitted_rev via an OWNER-scoped update;
//   - a double submit refuses (the pure state machine throws, surfaced as ok:false);
//   - the dashboard gather joins the roster with the notebooks correctly, rendering
//     a student with no notebook as not_submitted;
//   - flag OFF is a clean no-op (no read, no write, empty gather).
//
// The instructor RETURN action lives in pi-actions.ts and is covered by its own
// adversarial harness; the legal transition itself is tested in class-submission.test.ts.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the flag so each suite can pin a deterministic state. Default ON; the
// flag-off suite re-mocks per its own describe via vi.doMock + dynamic import.
vi.mock("./class-mode-config", () => ({ CLASS_MODE_ENABLED: true }));

const tasksGet = vi.fn();
const tasksUpdate = vi.fn();
const tasksListAllForUser = vi.fn();
vi.mock("@/lib/local-api", () => ({
  tasksApi: {
    get: (...a: unknown[]) => tasksGet(...a),
    update: (...a: unknown[]) => tasksUpdate(...a),
    listAllForUser: (...a: unknown[]) => tasksListAllForUser(...a),
  },
}));

import { submitNotebookForStudent } from "./class-submission-actions";
import { gatherSubmissionDashboard } from "./class-submission-dashboard";

beforeEach(() => {
  tasksGet.mockReset();
  tasksUpdate.mockReset();
  tasksListAllForUser.mockReset();
});

describe("submitNotebookForStudent: stamps the submission via an owner-scoped update", () => {
  it("submits a not_submitted notebook, stamping submitted_at + submitted_rev", async () => {
    tasksGet.mockResolvedValue({ id: 5, name: "Notebook", submission: undefined });
    tasksUpdate.mockImplementation(async (_id, data) => ({
      id: 5,
      name: "Notebook",
      submission: data.submission,
    }));

    const result = await submitNotebookForStudent({
      taskId: 5,
      submittedRev: "rev-abc",
      owner: "alice",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.task.submission?.status).toBe("submitted");
    expect(result.task.submission?.submitted_rev).toBe("rev-abc");
    expect(result.task.submission?.submitted_at).toBeTruthy();

    // Owner-scoped write: the student writes their OWN record.
    expect(tasksUpdate).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ submission: expect.objectContaining({ status: "submitted" }) }),
      "alice",
    );
  });

  it("refuses a double submit (the pure state machine throws, surfaced as ok:false)", async () => {
    tasksGet.mockResolvedValue({
      id: 5,
      name: "Notebook",
      submission: { status: "submitted", submitted_rev: "rev-1", submitted_at: "t" },
    });

    const result = await submitNotebookForStudent({ taskId: 5, submittedRev: "rev-2", owner: "alice" });
    expect(result.ok).toBe(false);
    expect(tasksUpdate).not.toHaveBeenCalled();
  });
});

describe("gatherSubmissionDashboard: joins the roster with the notebooks", () => {
  it("renders one row per roster student, not_submitted for a student with no notebook", async () => {
    tasksListAllForUser.mockImplementation(async (student: string) => {
      if (student === "alice") {
        return [
          {
            id: 1,
            assignment_id: "asg-1",
            submission: { status: "submitted", submitted_rev: "r", submitted_at: "t" },
          },
        ];
      }
      if (student === "bob") {
        return [{ id: 2, assignment_id: "other-asg", submission: undefined }];
      }
      return [];
    });

    const rows = await gatherSubmissionDashboard({
      roster: ["alice", "bob", "carol"],
      assignmentId: "asg-1",
    });

    expect(rows.map((r) => r.student)).toEqual(["alice", "bob", "carol"]);
    expect(rows.find((r) => r.student === "alice")!.status).toBe("submitted");
    expect(rows.find((r) => r.student === "alice")!.hasNotebook).toBe(true);
    // bob's only notebook is for a different assignment, so not_submitted here.
    expect(rows.find((r) => r.student === "bob")!.status).toBe("not_submitted");
    expect(rows.find((r) => r.student === "bob")!.hasNotebook).toBe(false);
    // carol never opened the assignment.
    expect(rows.find((r) => r.student === "carol")!.status).toBe("not_submitted");
  });

  it("swallows a per-student read failure (that student renders not_submitted)", async () => {
    tasksListAllForUser.mockImplementation(async (student: string) => {
      if (student === "alice") throw new Error("unreadable folder");
      return [
        {
          id: 9,
          assignment_id: "asg-1",
          submission: { status: "submitted", submitted_rev: "r", submitted_at: "t" },
        },
      ];
    });

    const rows = await gatherSubmissionDashboard({ roster: ["alice", "bob"], assignmentId: "asg-1" });
    expect(rows.find((r) => r.student === "alice")!.status).toBe("not_submitted");
    expect(rows.find((r) => r.student === "bob")!.status).toBe("submitted");
  });
});

describe("CT-4 wiring: flag OFF is a clean no-op", () => {
  it("submit refuses and never reads or writes; gather returns []", async () => {
    vi.resetModules();
    vi.doMock("./class-mode-config", () => ({ CLASS_MODE_ENABLED: false }));
    const offGet = vi.fn();
    const offList = vi.fn();
    vi.doMock("@/lib/local-api", () => ({
      tasksApi: { get: offGet, update: vi.fn(), listAllForUser: offList },
    }));

    const { submitNotebookForStudent: submitOff } = await import(
      "./class-submission-actions"
    );
    const { gatherSubmissionDashboard: gatherOff } = await import(
      "./class-submission-dashboard"
    );

    const result = await submitOff({ taskId: 1, submittedRev: "r", owner: "alice" });
    expect(result.ok).toBe(false);
    expect(offGet).not.toHaveBeenCalled();

    const rows = await gatherOff({ roster: ["alice"], assignmentId: "asg-1" });
    expect(rows).toEqual([]);
    expect(offList).not.toHaveBeenCalled();

    vi.doUnmock("./class-mode-config");
    vi.doUnmock("@/lib/local-api");
    vi.resetModules();
  });
});
