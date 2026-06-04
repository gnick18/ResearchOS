// Unified Share verifier follow-up (2026-06-04): a pre-R1 note from the
// coarse-toggle era could carry `is_shared = true` WITHOUT the "*" whole-lab
// sentinel in `shared_with`. The unified canRead / ACL surfaces read ONLY
// `shared_with`, so such a note rendered as "only you" in the new per-person
// ACL tab AND was silently unreadable by labmates. notesApi heals the
// invariant on read (materializes the sentinel). These tests lock that in.

import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory file system shared between the file-service mock and the test.
const fakeFiles: Record<string, unknown> = {};
// Per-directory listing the mock returns for listFiles.
const fakeDirs: Record<string, string[]> = {};

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => fakeFiles[path] ?? null),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      fakeFiles[path] = data;
    }),
    ensureDir: vi.fn(async () => undefined),
    listFiles: vi.fn(async (dir: string) => fakeDirs[dir] ?? []),
    deleteFile: vi.fn(async (path: string) => {
      const had = path in fakeFiles;
      delete fakeFiles[path];
      return had;
    }),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("@/lib/file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "mira"),
}));

import { notesApi } from "@/lib/local-api";
import { canRead, isWholeLabShared } from "@/lib/sharing/unified";
import type { Note, SharedUser } from "@/lib/types";

function seedNote(id: number, overrides: Partial<Note> = {}): Note {
  const note: Note = {
    id,
    title: `Note ${id}`,
    description: "",
    is_running_log: false,
    is_shared: false,
    entries: [],
    comments: [],
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    username: "mira",
    ...overrides,
  };
  fakeFiles[`users/mira/notes/${id}.json`] = note;
  fakeDirs["users/mira/notes"] = [
    ...(fakeDirs["users/mira/notes"] ?? []),
    `${id}.json`,
  ];
  return note;
}

beforeEach(() => {
  for (const k of Object.keys(fakeFiles)) delete fakeFiles[k];
  for (const k of Object.keys(fakeDirs)) delete fakeDirs[k];
});

describe("notesApi legacy-share heal", () => {
  it("get() materializes the '*' sentinel for a legacy is_shared note", async () => {
    seedNote(11, { is_shared: true, shared_with: [] });
    const note = await notesApi.get(11);
    expect(note).not.toBeNull();
    expect(isWholeLabShared(note!.shared_with ?? [])).toBe(true);
  });

  it("get() heals when shared_with is missing entirely (undefined)", async () => {
    // Drop shared_with from the on-disk shape: an old note never had the field.
    seedNote(12, { is_shared: true });
    const seeded = fakeFiles["users/mira/notes/12.json"] as Note;
    delete (seeded as { shared_with?: unknown }).shared_with;

    const note = await notesApi.get(12);
    expect(isWholeLabShared(note!.shared_with ?? [])).toBe(true);
  });

  it("does NOT touch an owner-only note (is_shared: false)", async () => {
    seedNote(13, { is_shared: false, shared_with: [] });
    const note = await notesApi.get(13);
    expect(note!.shared_with ?? []).toHaveLength(0);
    expect(isWholeLabShared(note!.shared_with ?? [])).toBe(false);
  });

  it("is idempotent: a note already carrying '*' gets exactly one sentinel", async () => {
    const sentinel: SharedUser[] = [{ username: "*", level: "read" }];
    seedNote(14, { is_shared: true, shared_with: sentinel });
    const note = await notesApi.get(14);
    const stars = (note!.shared_with ?? []).filter((s) => s.username === "*");
    expect(stars).toHaveLength(1);
  });

  it("preserves explicit per-person entries while adding the sentinel", async () => {
    const explicit: SharedUser[] = [{ username: "alex", level: "edit" }];
    seedNote(15, { is_shared: true, shared_with: explicit });
    const note = await notesApi.get(15);
    const names = (note!.shared_with ?? []).map((s) => s.username).sort();
    expect(names).toEqual(["*", "alex"]);
  });

  it("list() heals every legacy note in the collection", async () => {
    seedNote(21, { is_shared: true, shared_with: [] });
    seedNote(22, { is_shared: false, shared_with: [] });
    const notes = await notesApi.list();
    const byId = new Map(notes.map((n) => [n.id, n]));
    expect(isWholeLabShared(byId.get(21)!.shared_with ?? [])).toBe(true);
    expect(isWholeLabShared(byId.get(22)!.shared_with ?? [])).toBe(false);
  });

  it("a healed note is readable by a labmate via canRead (access fix)", async () => {
    seedNote(31, { is_shared: true, shared_with: [], username: "mira" });
    const note = await notesApi.get(31);
    const labmate = { username: "bob", account_type: "lab" as const };
    // canRead checks record.owner; notes route by folder owner ("mira" here).
    expect(
      canRead(
        { ...note!, owner: "mira", shared_with: note!.shared_with ?? [] },
        labmate,
      ),
    ).toBe(true);
  });
});
