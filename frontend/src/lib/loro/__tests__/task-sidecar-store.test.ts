// Tests for the task markdown-surface sidecar store (experiment collab chunk 1).
// fileService + taskResultsBase are mocked with an in-memory file map.

import { describe, it, expect, vi, beforeEach } from "vitest";

const files = new Map<string, Uint8Array>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    ensureDir: vi.fn(async () => null),
    readFileAsBlob: vi.fn(async (path: string) => {
      const v = files.get(path);
      if (v === undefined) return null;
      return new Blob([v.buffer as ArrayBuffer]);
    }),
    writeFileFromBlob: vi.fn(async (path: string, blob: Blob) => {
      files.set(path, new Uint8Array(await blob.arrayBuffer()));
    }),
  },
}));

// resolveTaskResultsBase is the resolver the legacy experiment tabs use. Here
// it stands in for a legacy-only task: it returns the global pre-namespacing
// path, which DIVERGES from the bare per-user taskResultsBase. The sidecar
// store must follow it when a currentUser is supplied so the `.loro` sidecar +
// `.md` mirror land beside the legacy `.md` the user actually sees.
vi.mock("@/lib/tasks/results-paths", () => ({
  taskResultsBase: (task: { id: number; owner: string }) =>
    `users/${task.owner}/tasks/${task.id}`,
  resolveTaskResultsBase: vi.fn(
    async (task: { id: number; owner: string }) => `results/task-${task.id}`,
  ),
}));

import { LoroDoc } from "loro-crdt";
import { seedTaskDoc, getTaskContentText, setTaskContentText } from "../task-doc";
import { loadOrRebuildTaskDoc, persistTaskDoc } from "../task-sidecar-store";

const TASK = { id: 7, owner: "manny" };
const decode = (b: Uint8Array | undefined) =>
  b ? new TextDecoder().decode(b) : undefined;

describe("task-sidecar-store", () => {
  beforeEach(() => files.clear());

  it("rebuilds from the .md mirror when no sidecar exists", async () => {
    files.set(
      "users/manny/tasks/7/notes.md",
      new TextEncoder().encode("# Lab Notes\nstep 1"),
    );
    const doc = await loadOrRebuildTaskDoc(TASK, "notes");
    expect(getTaskContentText(doc)).toBe("# Lab Notes\nstep 1");
  });

  it("returns empty content when neither sidecar nor mirror exists", async () => {
    const doc = await loadOrRebuildTaskDoc(TASK, "results");
    expect(getTaskContentText(doc)).toBe("");
  });

  it("persists the .loro sidecar and syncs the .md mirror", async () => {
    const doc = new LoroDoc();
    doc.import(seedTaskDoc("initial"));
    setTaskContentText(doc, "updated body");
    doc.commit();

    await persistTaskDoc(TASK, "notes", doc);

    // The readable .md mirror is updated.
    expect(decode(files.get("users/manny/tasks/7/notes.md"))).toBe("updated body");
    // The .loro sidecar exists and round-trips back to the same content.
    expect(files.has("users/manny/tasks/7/.researchos/notes.loro")).toBe(true);
    const reloaded = await loadOrRebuildTaskDoc(TASK, "notes");
    expect(getTaskContentText(reloaded)).toBe("updated body");
  });

  it("prefers the sidecar over the mirror when both exist", async () => {
    const doc = new LoroDoc();
    doc.import(seedTaskDoc("from sidecar"));
    doc.commit();
    await persistTaskDoc(TASK, "results", doc);
    // Tamper the mirror so we can tell which source loadOrRebuild used.
    files.set(
      "users/manny/tasks/7/results.md",
      new TextEncoder().encode("STALE MIRROR"),
    );
    const reloaded = await loadOrRebuildTaskDoc(TASK, "results");
    expect(getTaskContentText(reloaded)).toBe("from sidecar");
  });

  // Regression (experiment-collab follow-up, item 2): for a legacy-only task,
  // passing currentUser routes both load and persist through
  // resolveTaskResultsBase, so the sidecar seeds from the legacy `.md` the user
  // sees and writes back beside it -- not into a blank per-user path.
  it("follows resolveTaskResultsBase when currentUser is supplied", async () => {
    // Data lives ONLY at the legacy global path.
    files.set(
      "results/task-7/notes.md",
      new TextEncoder().encode("legacy body"),
    );

    // Without currentUser: bare per-user base -> blank (the divergence bug).
    const blank = await loadOrRebuildTaskDoc(TASK, "notes");
    expect(getTaskContentText(blank)).toBe("");

    // With currentUser: seeds from the legacy mirror.
    const doc = await loadOrRebuildTaskDoc(TASK, "notes", "manny");
    expect(getTaskContentText(doc)).toBe("legacy body");

    // Persist writes back to the legacy path, co-located with the .md.
    setTaskContentText(doc, "edited body");
    doc.commit();
    await persistTaskDoc(TASK, "notes", doc, "manny");
    expect(decode(files.get("results/task-7/notes.md"))).toBe("edited body");
    expect(files.has("results/task-7/.researchos/notes.loro")).toBe(true);
    // The per-user path is untouched.
    expect(files.has("users/manny/tasks/7/notes.md")).toBe(false);
  });
});
