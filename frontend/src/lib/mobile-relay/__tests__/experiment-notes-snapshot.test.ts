// Experiment-notes snapshot builder tests (phone-notes P1, read — 2026-06-15).
//
// Covers:
//   buildExperimentNotesSnapshot — reads notes.md + results.md from the focused
//     experiment's results base and projects them into the phone's wire shape.
//   buildExperimentNotesSnapshot — a missing / empty file projects as null
//     (the phone shows an empty-state, never crashes).
//   buildExperimentNotesSnapshot — an unreadable task returns null so the
//     publisher skips a stale focus rather than sealing an empty shell.
//   experimentNotesVersion — stable over generatedAt, flips on a content edit,
//     flips when the focused task id / owner changes.
//
// Mirrors calculators-snapshot.test.ts (mock the data deps, exercise the build).
// We mock the results-base resolver + local-api readers so the test pins the
// projection logic, not the on-disk migration/path machinery (covered elsewhere).

// ── Mocks (must precede the imports under test) ───────────────────────────────

const memFs = new Map<string, { content: string; sha?: string }>();
let resolvedBase: string | null = "users/alice/results/task-1";
let taskRecord: { id: number; owner: string; name: string } | null = {
  id: 1,
  owner: "alice",
  name: "fakeGFP expression (chapter 2)",
};

import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/local-api", () => ({
  tasksApi: {
    get: vi.fn(async () => taskRecord),
  },
  filesApi: {
    readFile: vi.fn(async (path: string) => {
      const f = memFs.get(path);
      if (!f) throw new Error(`not found: ${path}`);
      return f;
    }),
  },
}));

vi.mock("@/lib/tasks/results-paths", () => ({
  findExistingTaskResultsBase: vi.fn(async () => resolvedBase),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  buildExperimentNotesSnapshot,
  experimentNotesVersion,
} from "../experiment-notes-snapshot";

beforeEach(() => {
  memFs.clear();
  resolvedBase = "users/alice/results/task-1";
  taskRecord = { id: 1, owner: "alice", name: "fakeGFP expression (chapter 2)" };
});

// ── Builder ───────────────────────────────────────────────────────────────────

describe("buildExperimentNotesSnapshot", () => {
  it("projects notes.md + results.md into the phone wire shape", async () => {
    memFs.set("users/alice/results/task-1/notes.md", {
      content: "# Lab notes\n\nDay 1 colony pick.",
      sha: "n1",
    });
    memFs.set("users/alice/results/task-1/results.md", {
      content: "# Results\n\nBand at 1.2 kb.",
      sha: "r1",
    });

    const snap = await buildExperimentNotesSnapshot(1, "alice");
    expect(snap).not.toBeNull();
    expect(snap!.taskId).toBe(1);
    expect(snap!.owner).toBe("alice");
    expect(snap!.experimentName).toBe("fakeGFP expression (chapter 2)");
    expect(snap!.notes).toEqual({ markdown: "# Lab notes\n\nDay 1 colony pick." });
    expect(snap!.results).toEqual({ markdown: "# Results\n\nBand at 1.2 kb." });
    expect(snap!.generatedAt).toEqual(expect.any(String));
  });

  it("projects a missing file as null (phone shows an empty-state)", async () => {
    // Only notes exist; results.md is absent.
    memFs.set("users/alice/results/task-1/notes.md", { content: "just notes" });

    const snap = await buildExperimentNotesSnapshot(1, "alice");
    expect(snap!.notes).toEqual({ markdown: "just notes" });
    expect(snap!.results).toBeNull();
  });

  it("projects a whitespace-only file as null", async () => {
    memFs.set("users/alice/results/task-1/notes.md", { content: "   \n\n  " });

    const snap = await buildExperimentNotesSnapshot(1, "alice");
    expect(snap!.notes).toBeNull();
  });

  it("returns a snapshot with both sections null when no results base exists", async () => {
    resolvedBase = null;
    const snap = await buildExperimentNotesSnapshot(1, "alice");
    expect(snap).not.toBeNull();
    expect(snap!.notes).toBeNull();
    expect(snap!.results).toBeNull();
  });

  it("returns null when the task cannot be read", async () => {
    taskRecord = null;
    const snap = await buildExperimentNotesSnapshot(1, "alice");
    expect(snap).toBeNull();
  });
});

// ── Version gate ────────────────────────────────────────────────────────────────

describe("experimentNotesVersion", () => {
  it("is stable across rebuilds (ignores generatedAt) and flips on a content edit", async () => {
    memFs.set("users/alice/results/task-1/notes.md", { content: "v1" });
    const a = await buildExperimentNotesSnapshot(1, "alice");
    const b = await buildExperimentNotesSnapshot(1, "alice");
    // Same content, different generatedAt -> same version (cheap no-op republish).
    expect(experimentNotesVersion(a!)).toBe(experimentNotesVersion(b!));

    memFs.set("users/alice/results/task-1/notes.md", { content: "v2 edited" });
    const c = await buildExperimentNotesSnapshot(1, "alice");
    expect(experimentNotesVersion(c!)).not.toBe(experimentNotesVersion(a!));
  });

  it("flips when the focused task id or owner changes", () => {
    const base = {
      taskId: 1,
      owner: "alice",
      notes: { markdown: "same" },
      results: null,
      generatedAt: "x",
    };
    const v1 = experimentNotesVersion(base);
    expect(experimentNotesVersion({ ...base, taskId: 2 })).not.toBe(v1);
    expect(experimentNotesVersion({ ...base, owner: "bob" })).not.toBe(v1);
  });
});
