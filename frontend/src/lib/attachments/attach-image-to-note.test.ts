// frontend/src/lib/attachments/attach-image-to-note.test.ts
//
// Coverage for the Note-attach path introduced alongside the Telegram
// note-attach work (telegram note-attach manager, 2026-05-26). The
// function lands an image blob inside `users/<owner>/notes/<id>/Images/`,
// appends a markdown image link to the note's latest entry, and creates
// a fresh entry for empty notes.

import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const memBlobs = new Map<string, Blob>();
  const memDirs = new Map<string, Set<string>>();
  const notesById = new Map<number, {
    id: number;
    username: string;
    entries: { id: string; title: string; date: string; content: string; created_at: string; updated_at: string }[];
    updated_at: string;
  }>();
  return {
    memBlobs,
    memDirs,
    notesById,
  };
});

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    fileExists: vi.fn(async (path: string) => hoisted.memBlobs.has(path)),
    writeFileFromBlob: vi.fn(async (path: string, blob: Blob) => {
      hoisted.memBlobs.set(path, blob);
      const lastSlash = path.lastIndexOf("/");
      const dir = path.slice(0, lastSlash);
      const file = path.slice(lastSlash + 1);
      const set = hoisted.memDirs.get(dir) ?? new Set<string>();
      set.add(file);
      hoisted.memDirs.set(dir, set);
    }),
    readJson: vi.fn(async () => null),
    writeJson: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/attachments/image-events", () => ({
  imageEvents: {
    emitAttached: vi.fn(),
  },
}));

vi.mock("@/lib/tasks/results-paths", () => ({
  taskResultsBase: (task: { id: number; owner: string }) =>
    `users/${task.owner}/results/task-${task.id}`,
}));

vi.mock("@/lib/local-api", () => ({
  notesApi: {
    get: vi.fn(async (id: number) => hoisted.notesById.get(id) ?? null),
    addEntry: vi.fn(
      async (
        id: number,
        data: { title: string; date: string; content?: string },
      ) => {
        const note = hoisted.notesById.get(id);
        if (!note) return null;
        const entry = {
          id: `entry-${Math.random().toString(36).slice(2, 8)}`,
          title: data.title,
          date: data.date,
          content: data.content ?? "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        note.entries.push(entry);
        note.updated_at = entry.updated_at;
        return { ...note, entries: [...note.entries] };
      },
    ),
    updateEntry: vi.fn(
      async (
        id: number,
        entryId: string,
        data: { content?: string },
      ) => {
        const note = hoisted.notesById.get(id);
        if (!note) return null;
        const entry = note.entries.find((e) => e.id === entryId);
        if (!entry) return note;
        if (data.content !== undefined) entry.content = data.content;
        entry.updated_at = new Date().toISOString();
        note.updated_at = entry.updated_at;
        return { ...note, entries: [...note.entries] };
      },
    ),
  },
}));

import { attachImageToNote } from "./attach-image";

beforeEach(() => {
  hoisted.memBlobs.clear();
  hoisted.memDirs.clear();
  hoisted.notesById.clear();
});

describe("attachImageToNote: file landing", () => {
  it("writes the image to users/<owner>/notes/<id>/Images/<filename>", async () => {
    hoisted.notesById.set(7, {
      id: 7,
      username: "grant",
      entries: [
        {
          id: "e1",
          title: "Day 1",
          date: "2026-05-15",
          content: "First entry body.",
          created_at: "2026-05-15T10:00:00Z",
          updated_at: "2026-05-15T10:00:00Z",
        },
      ],
      updated_at: "2026-05-15T10:00:00Z",
    });
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const result = await attachImageToNote({
      ownerUsername: "grant",
      noteId: 7,
      blob,
      suggestedFilename: "plate.jpg",
    });
    expect(result.absolutePath).toBe("users/grant/notes/7/Images/plate.jpg");
    expect(result.relativePath).toBe("Images/plate.jpg");
    expect(hoisted.memBlobs.has("users/grant/notes/7/Images/plate.jpg")).toBe(true);
  });

  it("dedupes on filename collision with a numeric suffix", async () => {
    hoisted.notesById.set(7, {
      id: 7,
      username: "grant",
      entries: [
        {
          id: "e1",
          title: "Day 1",
          date: "2026-05-15",
          content: "",
          created_at: "2026-05-15T10:00:00Z",
          updated_at: "2026-05-15T10:00:00Z",
        },
      ],
      updated_at: "2026-05-15T10:00:00Z",
    });
    // Pre-seed an existing file at the target name.
    hoisted.memBlobs.set(
      "users/grant/notes/7/Images/plate.jpg",
      new Blob([]),
    );
    const result = await attachImageToNote({
      ownerUsername: "grant",
      noteId: 7,
      blob: new Blob([new Uint8Array([1])]),
      suggestedFilename: "plate.jpg",
    });
    expect(result.finalFilename).toBe("plate-1.jpg");
  });
});

describe("attachImageToNote: markdown link append", () => {
  it("appends the markdown link to the latest entry's content (by updated_at)", async () => {
    hoisted.notesById.set(8, {
      id: 8,
      username: "grant",
      entries: [
        {
          id: "older",
          title: "Older",
          date: "2026-05-01",
          content: "older body",
          created_at: "2026-05-01T10:00:00Z",
          updated_at: "2026-05-01T10:00:00Z",
        },
        {
          id: "newer",
          title: "Newer",
          date: "2026-05-15",
          content: "newer body",
          created_at: "2026-05-15T10:00:00Z",
          updated_at: "2026-05-15T10:00:00Z",
        },
      ],
      updated_at: "2026-05-15T10:00:00Z",
    });
    const result = await attachImageToNote({
      ownerUsername: "grant",
      noteId: 8,
      blob: new Blob([new Uint8Array([1])]),
      suggestedFilename: "plate.jpg",
      altText: "Yeast plate",
    });
    expect(result.appendedToEntryId).toBe("newer");
    const note = hoisted.notesById.get(8)!;
    const newer = note.entries.find((e) => e.id === "newer")!;
    expect(newer.content).toContain("![Yeast plate](Images/plate.jpg)");
    expect(newer.content.startsWith("newer body")).toBe(true);
    // Older entry untouched.
    const older = note.entries.find((e) => e.id === "older")!;
    expect(older.content).toBe("older body");
  });

  it("creates a fresh entry when the note has no entries yet", async () => {
    hoisted.notesById.set(9, {
      id: 9,
      username: "grant",
      entries: [],
      updated_at: "2026-05-01T10:00:00Z",
    });
    const result = await attachImageToNote({
      ownerUsername: "grant",
      noteId: 9,
      blob: new Blob([new Uint8Array([1])]),
      suggestedFilename: "plate.jpg",
    });
    expect(result.appendedToEntryId).not.toBeNull();
    const note = hoisted.notesById.get(9)!;
    expect(note.entries).toHaveLength(1);
    expect(note.entries[0].content).toContain("![plate.jpg](Images/plate.jpg)");
  });

  it("bumps note.updated_at via the updateEntry call", async () => {
    hoisted.notesById.set(10, {
      id: 10,
      username: "grant",
      entries: [
        {
          id: "e1",
          title: "Only",
          date: "2026-05-01",
          content: "body",
          created_at: "2026-05-01T10:00:00Z",
          updated_at: "2026-05-01T10:00:00Z",
        },
      ],
      updated_at: "2026-05-01T10:00:00Z",
    });
    const before = hoisted.notesById.get(10)!.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    await attachImageToNote({
      ownerUsername: "grant",
      noteId: 10,
      blob: new Blob([new Uint8Array([1])]),
      suggestedFilename: "plate.jpg",
    });
    const after = hoisted.notesById.get(10)!.updated_at;
    expect(after).not.toBe(before);
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });
});
