// Lab head UX polish manager Bug 3 (2026-05-25): soft-delete + restore
// contract for notes.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Inline in-memory FS so the trash helper exercises real read/write
// semantics without touching disk. Layout mirrors the production paths
// the helper uses: `users/<owner>/notes/<id>.json` for live notes and
// `users/<owner>/notes_trash/<id>.json` for soft-deleted ones.
const memFs = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    ensureDir: vi.fn(async () => null),
    deleteFile: vi.fn(async (path: string) => {
      const had = memFs.has(path);
      memFs.delete(path);
      return had;
    }),
    isConnected: vi.fn(() => true),
  },
}));

// Import after the mock so the helper picks up the mocked module.
import { trashNote, restoreTrashedNote } from "../notes-trash";

const OWNER = "mira";

function makeNote(id: number) {
  return {
    id,
    title: `Note ${id}`,
    description: "",
    is_running_log: false,
    is_shared: false,
    entries: [],
    comments: [],
    created_at: "2026-05-25T00:00:00.000Z",
    updated_at: "2026-05-25T00:00:00.000Z",
    username: OWNER,
  };
}

describe("notes-trash", () => {
  beforeEach(() => {
    memFs.clear();
  });

  it("moves a live note into notes_trash and stamps deleted_at", async () => {
    memFs.set(`users/${OWNER}/notes/7.json`, makeNote(7));

    const trashed = await trashNote(OWNER, 7);

    expect(trashed).not.toBeNull();
    expect(trashed?.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Live copy is gone, trash copy is present.
    expect(memFs.has(`users/${OWNER}/notes/7.json`)).toBe(false);
    expect(memFs.has(`users/${OWNER}/notes_trash/7.json`)).toBe(true);
  });

  it("returns null when the live note is missing (no trash entry written)", async () => {
    const trashed = await trashNote(OWNER, 999);

    expect(trashed).toBeNull();
    expect(memFs.has(`users/${OWNER}/notes_trash/999.json`)).toBe(false);
  });

  it("restoreTrashedNote brings the note back at the same id and strips deleted_at", async () => {
    memFs.set(`users/${OWNER}/notes/7.json`, makeNote(7));
    await trashNote(OWNER, 7);

    const restored = await restoreTrashedNote(OWNER, 7);

    expect(restored).not.toBeNull();
    expect(restored?.id).toBe(7);
    expect(restored?.title).toBe("Note 7");
    expect("deleted_at" in (restored ?? {})).toBe(false);
    // Live copy is back; trash copy is gone.
    expect(memFs.has(`users/${OWNER}/notes/7.json`)).toBe(true);
    expect(memFs.has(`users/${OWNER}/notes_trash/7.json`)).toBe(false);
  });

  it("restore is a no-op when the trash entry is missing", async () => {
    const restored = await restoreTrashedNote(OWNER, 42);

    expect(restored).toBeNull();
    expect(memFs.has(`users/${OWNER}/notes/42.json`)).toBe(false);
  });

  it("trash then restore preserves the full note shape (round-trip)", async () => {
    const original = {
      ...makeNote(11),
      title: "Plasmid prep",
      entries: [
        {
          id: "e1",
          title: "Day 1",
          date: "2026-05-25",
          content: "Initial culture inoculated",
          created_at: "2026-05-25T01:00:00.000Z",
          updated_at: "2026-05-25T01:00:00.000Z",
        },
      ],
    };
    memFs.set(`users/${OWNER}/notes/11.json`, original);

    await trashNote(OWNER, 11);
    const restored = await restoreTrashedNote(OWNER, 11);

    expect(restored).toEqual(original);
  });
});
