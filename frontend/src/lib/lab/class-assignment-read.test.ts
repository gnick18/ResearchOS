// Tests for the CT-2 student-side assignment reader (class-assignment-read.ts).
//
// The load-bearing assertions:
//   1. Parses the root cache file into assignments, newest first.
//   2. Defends against a missing file, malformed JSON, and malformed entries.
//   3. Flag OFF returns an empty list with no file read.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./class-mode-config", () => ({ CLASS_MODE_ENABLED: true }));

const readText = vi.fn<(path: string) => Promise<string | null>>();
vi.mock("../file-system/file-service", () => ({
  fileService: { readText: (p: string) => readText(p) },
}));

import { listStudentAssignments } from "./class-assignment-read";

function fileBody(assignments: unknown[]): string {
  return JSON.stringify({ version: 1, assignments });
}

beforeEach(() => {
  readText.mockReset();
});

describe("listStudentAssignments", () => {
  it("parses assignments and returns them newest first", async () => {
    readText.mockResolvedValue(
      fileBody([
        { assignmentId: "asg-1", title: "Older", instructor: "prof", visibility: "private", checklist: [{ id: "a", label: "x" }], assignedAt: "2026-06-01T00:00:00.000Z" },
        { assignmentId: "asg-2", title: "Newer", instructor: "prof", visibility: "collaborative", checklist: [], assignedAt: "2026-06-10T00:00:00.000Z" },
      ]),
    );
    const out = await listStudentAssignments();
    expect(out.map((a) => a.assignmentId)).toEqual(["asg-2", "asg-1"]);
    expect(out[0].visibility).toBe("collaborative");
    expect(out[1].checklist).toEqual([{ id: "a", label: "x" }]);
  });

  it("returns an empty list when the file is absent", async () => {
    readText.mockResolvedValue(null);
    expect(await listStudentAssignments()).toEqual([]);
  });

  it("returns an empty list on malformed JSON", async () => {
    readText.mockResolvedValue("{not json");
    expect(await listStudentAssignments()).toEqual([]);
  });

  it("drops malformed entries but keeps the valid ones", async () => {
    readText.mockResolvedValue(
      fileBody([
        { title: "no id", instructor: "prof" }, // missing assignmentId
        { assignmentId: "asg-ok", title: "Good", instructor: "prof", checklist: [] },
        "garbage",
      ]),
    );
    const out = await listStudentAssignments();
    expect(out.map((a) => a.assignmentId)).toEqual(["asg-ok"]);
    // Defaults applied for absent optional fields.
    expect(out[0].visibility).toBe("private");
    expect(out[0].checklist).toEqual([]);
  });

  it("flag OFF returns [] with no file read", async () => {
    vi.resetModules();
    vi.doMock("./class-mode-config", () => ({ CLASS_MODE_ENABLED: false }));
    const localRead = vi.fn();
    vi.doMock("../file-system/file-service", () => ({
      fileService: { readText: localRead },
    }));
    const { listStudentAssignments: readOff } = await import("./class-assignment-read");
    expect(await readOff()).toEqual([]);
    expect(localRead).not.toHaveBeenCalled();
    vi.doUnmock("./class-mode-config");
    vi.doUnmock("../file-system/file-service");
    vi.resetModules();
  });
});
