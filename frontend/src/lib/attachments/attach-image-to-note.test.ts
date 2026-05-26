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

// note-attach R2 regression: NoteDetailPopup used to push `note.username`
// (sometimes ""), and the empty segment was silently dropped by
// `path.split("/").filter(Boolean)` in `atomicWrite`. Result: the file
// landed at `users/notes/<id>/Images/...` (a top-level garbage folder),
// while the popup's image-strip kept reading from
// `users/<currentUser>/notes/<id>/Images/...`. The helper now throws on
// an empty owner so the same regression is loud, not silent.
describe("attachImageToNote: empty-owner guard", () => {
  it("throws when ownerUsername is empty", async () => {
    hoisted.notesById.set(20, {
      id: 20,
      username: "",
      entries: [],
      updated_at: "2026-05-15T10:00:00Z",
    });
    await expect(
      attachImageToNote({
        ownerUsername: "",
        noteId: 20,
        blob: new Blob([new Uint8Array([1])]),
        suggestedFilename: "plate.jpg",
      }),
    ).rejects.toThrow(/ownerUsername/);
    // File MUST NOT have landed anywhere.
    expect(hoisted.memBlobs.size).toBe(0);
    // And the entry MUST NOT have been touched (the contract is
    // write-first, append-second).
    const note = hoisted.notesById.get(20)!;
    expect(note.entries).toHaveLength(0);
  });
});

// note-attach R2 path-canonicalization lock. Asserts the bytes land at the
// EXACT path NoteDetailPopup's image-strip reads from (basePath =
// `users/<currentUser ?? note.username>/notes/<id>`, image-strip looks
// inside `${basePath}/Images/`). Prior chip's test stubbed
// writeFileFromBlob and asserted the call argument, which couldn't catch
// the empty-owner collapse bug — this version checks the keyed-by-path
// memBlobs map directly.
describe("attachImageToNote: canonical path landing", () => {
  it("the written file's path matches NoteDetailPopup's image-strip read path", async () => {
    hoisted.notesById.set(30, {
      id: 30,
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
    const result = await attachImageToNote({
      ownerUsername: "grant",
      noteId: 30,
      blob: new Blob([new Uint8Array([42])]),
      suggestedFilename: "plate.jpg",
    });
    // NoteDetailPopup builds basePath as `users/<currentUser ?? note.username>/notes/<id>`
    // and renders image src `Images/<file>` relative to that. Resolved
    // read path = `users/<owner>/notes/<id>/Images/<file>`.
    const popupReadPath = `users/grant/notes/30/Images/plate.jpg`;
    expect(result.absolutePath).toBe(popupReadPath);
    // The file MUST be at that exact key in the mock FS.
    expect(hoisted.memBlobs.has(popupReadPath)).toBe(true);
    // And the markdown link uses the same `Images/<file>` relative form
    // the popup's `imageBasePath` prop resolves against.
    expect(result.relativePath).toBe("Images/plate.jpg");
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

  it("respects an entryId override (multi-entry picker path)", async () => {
    hoisted.notesById.set(11, {
      id: 11,
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
    // Pick the OLDER entry (default would be "newer").
    const result = await attachImageToNote({
      ownerUsername: "grant",
      noteId: 11,
      blob: new Blob([new Uint8Array([1])]),
      suggestedFilename: "plate.jpg",
      entryId: "older",
    });
    expect(result.appendedToEntryId).toBe("older");
    const note = hoisted.notesById.get(11)!;
    const older = note.entries.find((e) => e.id === "older")!;
    expect(older.content).toContain("![plate.jpg](Images/plate.jpg)");
    // Newer entry left untouched.
    const newer = note.entries.find((e) => e.id === "newer")!;
    expect(newer.content).toBe("newer body");
  });

  it("falls back to latest entry when entryId is stale / unknown", async () => {
    hoisted.notesById.set(12, {
      id: 12,
      username: "grant",
      entries: [
        {
          id: "only",
          title: "Only",
          date: "2026-05-15",
          content: "body",
          created_at: "2026-05-15T10:00:00Z",
          updated_at: "2026-05-15T10:00:00Z",
        },
      ],
      updated_at: "2026-05-15T10:00:00Z",
    });
    // entryId points at an entry that doesn't exist (e.g. user deleted it
    // between the picker prompt and the commit click).
    const result = await attachImageToNote({
      ownerUsername: "grant",
      noteId: 12,
      blob: new Blob([new Uint8Array([1])]),
      suggestedFilename: "plate.jpg",
      entryId: "ghost-id",
    });
    expect(result.appendedToEntryId).toBe("only");
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
