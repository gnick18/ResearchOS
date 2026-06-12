// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the persistence layer so we can assert exactly which document the
// reference is routed into, without touching a real folder.
const readFile = vi.fn();
const writeFile = vi.fn();
const notesGet = vi.fn();
const notesUpdateEntry = vi.fn();
const notesAddEntry = vi.fn();

vi.mock("@/lib/local-api", () => ({
  filesApi: {
    readFile: (...a: unknown[]) => readFile(...a),
    writeFile: (...a: unknown[]) => writeFile(...a),
  },
  notesApi: {
    get: (...a: unknown[]) => notesGet(...a),
    updateEntry: (...a: unknown[]) => notesUpdateEntry(...a),
    addEntry: (...a: unknown[]) => notesAddEntry(...a),
  },
}));

// activeTask is mutable per test so we can exercise the open vs not-open branch.
let activeTask: { id: number; owner: string } | null = null;
vi.mock("@/lib/store", () => ({
  useAppStore: { getState: () => ({ activeTask }) },
}));

vi.mock("@/lib/tasks/results-paths", () => ({
  taskResultsBase: (t: { id: number; owner: string }) =>
    `users/${t.owner}/results/task-${t.id}`,
}));

import { sendReferenceToTarget } from "../send-to-target";

const REF = "[Plasmid pUC19](/sequences?seq=12)";

beforeEach(() => {
  vi.clearAllMocks();
  activeTask = null;
});

describe("sendReferenceToTarget", () => {
  it("appends to a not-open experiment's results.md", async () => {
    readFile.mockResolvedValue({ content: "Old results" });
    await sendReferenceToTarget(
      { kind: "experiment-results", id: 7, owner: "alex", name: "Exp 7" },
      REF,
    );
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, content] = writeFile.mock.calls[0];
    expect(path).toBe("users/alex/results/task-7/results.md");
    expect(content).toBe(`Old results\n\n${REF}`);
  });

  it("routes lab-notes to notes.md, not results.md", async () => {
    readFile.mockResolvedValue({ content: "" });
    await sendReferenceToTarget(
      { kind: "experiment-labnotes", id: 7, owner: "alex", name: "Exp 7" },
      REF,
    );
    const [path, content] = writeFile.mock.calls[0];
    expect(path).toBe("users/alex/results/task-7/notes.md");
    // Empty existing doc starts with just the reference, no leading blank lines.
    expect(content).toBe(REF);
  });

  it("hands off to the open popup via event and does not write to disk", async () => {
    activeTask = { id: 7, owner: "alex" };
    const dispatch = vi.spyOn(window, "dispatchEvent");
    await sendReferenceToTarget(
      { kind: "experiment-results", id: 7, owner: "alex", name: "Exp 7" },
      REF,
    );
    expect(writeFile).not.toHaveBeenCalled();
    const ev = dispatch.mock.calls.find(
      ([e]) => (e as CustomEvent).type === "notebook:append-line",
    )?.[0] as CustomEvent;
    expect(ev).toBeTruthy();
    expect(ev.detail).toMatchObject({ taskId: 7, owner: "alex", tab: "results", text: REF });
    dispatch.mockRestore();
  });

  it("appends to a note's most-recently-updated entry", async () => {
    notesGet.mockResolvedValue({
      id: 3,
      username: "alex",
      entries: [
        { id: "e1", content: "first", updated_at: "2026-06-01" },
        { id: "e2", content: "latest", updated_at: "2026-06-10" },
      ],
    });
    await sendReferenceToTarget(
      { kind: "note", id: 3, owner: "alex", name: "My note" },
      REF,
    );
    expect(notesUpdateEntry).toHaveBeenCalledTimes(1);
    const [noteId, entryId, patch, owner] = notesUpdateEntry.mock.calls[0];
    expect(noteId).toBe(3);
    expect(entryId).toBe("e2");
    expect(patch).toEqual({ content: `latest\n\n${REF}` });
    expect(owner).toBe("alex");
  });

  it("creates an entry when a note has none", async () => {
    notesGet.mockResolvedValue({ id: 3, username: "alex", entries: [] });
    notesAddEntry.mockResolvedValue({
      id: 3,
      username: "alex",
      entries: [{ id: "new", content: "", updated_at: "2026-06-11" }],
    });
    await sendReferenceToTarget(
      { kind: "note", id: 3, owner: "alex", name: "Empty note" },
      REF,
    );
    expect(notesAddEntry).toHaveBeenCalledTimes(1);
    const [, entryId, patch] = notesUpdateEntry.mock.calls[0];
    expect(entryId).toBe("new");
    expect(patch).toEqual({ content: REF });
  });

  it("appends to a method's markdown body at its source path", async () => {
    readFile.mockResolvedValue({ content: "## Protocol" });
    await sendReferenceToTarget(
      {
        kind: "method",
        id: 5,
        owner: "alex",
        name: "Gibson",
        sourcePath: "methods/gibson/method.md",
      },
      REF,
    );
    const [path, content] = writeFile.mock.calls[0];
    expect(path).toBe("methods/gibson/method.md");
    expect(content).toBe(`## Protocol\n\n${REF}`);
  });

  it("throws if a method target has no body path", async () => {
    await expect(
      sendReferenceToTarget(
        { kind: "method", id: 5, owner: "alex", name: "PDF method", sourcePath: null },
        REF,
      ),
    ).rejects.toThrow();
  });
});
