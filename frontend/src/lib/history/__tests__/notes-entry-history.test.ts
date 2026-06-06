// VC Phase 2 (vc-entry-history sub-bot of HR, 2026-05-30). Bug 1 fix: note
// CONTENT lives in entries[], edited via notesApi.addEntry / updateEntry /
// deleteEntry.
//
// Pilot update (HR, 2026-06-05): LORO_PILOT_ENABLED is now true in production
// (lib/loro/config.ts), so the Loro doc's native history is the SOLE notes
// history source. Both recordEntryHistory and notesApi.update short-circuit
// before the legacy recordNoteHistory call under the flag, and the version
// sidebar reads from makeLoroHistoryEngine (the Phase 2 VC suite covers that
// Loro-history path; it cannot be re-asserted here, where no Loro doc runs).
// These tests therefore pin what is still real under the pilot, that each entry
// mutation persists the correct note state, AND that the legacy recordNoteHistory
// path stays dormant so there is no double-write.
//
// We mock `@/lib/history` so `recordNoteHistory` is a spy (the engine itself is
// covered elsewhere) and force HISTORY_ENGINE_ENABLED on. The fileService +
// indexeddb-store mocks mirror owner-scoped-api.test.ts so the real notesApi /
// JsonStore run against an in-memory file map.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/types";

// Shape of the single argument recordNoteHistory receives (see notes-history.ts).
interface RecordArgs {
  type: string;
  id: number;
  owner: string;
  actor: string;
  prevState: Note;
  nextState: Note;
}

// Spy on recordNoteHistory; keep the flag ON so the entry paths take the
// history branch. `vi.hoisted` lets the spy exist before the hoisted vi.mock
// factory runs. The spy is typed with a one-arg signature so
// `.mock.calls[0][0]` reads as a typed RecordArgs (no undefined-cast). Nothing
// else from the module is exercised by these tests.
const { recordNoteHistory } = vi.hoisted(() => ({
  recordNoteHistory: vi.fn(async (_args: RecordArgs): Promise<void> => undefined),
}));
vi.mock("@/lib/history", () => ({
  HISTORY_ENGINE_ENABLED: true,
  recordNoteHistory,
}));

// In-memory file system shared between the file-service mock and assertions.
const fakeFiles: Record<string, unknown> = {};

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => fakeFiles[path] ?? null),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      fakeFiles[path] = data;
    }),
    ensureDir: vi.fn(async () => undefined),
    listFiles: vi.fn(async () => []),
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

// Deterministic uuids for stable assertions.
let uuidCounter = 0;
const realCrypto = globalThis.crypto;
Object.defineProperty(globalThis, "crypto", {
  value: {
    ...realCrypto,
    randomUUID: () =>
      `test-uuid-${++uuidCounter}` as `${string}-${string}-${string}-${string}-${string}`,
  },
  configurable: true,
});

import { notesApi } from "@/lib/local-api";
import { clearCurrentUserCache } from "@/lib/storage/json-store";

function seedNote(owner: string, overrides: Partial<Note> = {}): Note {
  const note: Note = {
    id: 11,
    title: "Old Title",
    description: "Old description",
    is_running_log: false,
    is_shared: false,
    entries: [
      {
        id: "entry-a",
        title: "Entry A",
        date: "2026-05-01",
        content: "old content",
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-01T00:00:00Z",
      },
    ],
    comments: [],
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    username: owner,
    ...overrides,
  };
  fakeFiles[`users/${owner}/notes/${note.id}.json`] = note;
  return note;
}

beforeEach(() => {
  for (const k of Object.keys(fakeFiles)) delete fakeFiles[k];
  uuidCounter = 0;
  recordNoteHistory.mockClear();
  clearCurrentUserCache();
});

describe("notes entry mutations under the Loro pilot (Bug 1, pilot update)", () => {
  it("updateEntry persists the new content; the legacy history path stays dormant", async () => {
    seedNote("mira");
    const updated = await notesApi.updateEntry(11, "entry-a", {
      content: "new content",
    });
    expect(updated?.entries[0].content).toBe("new content");

    // Loro owns notes history under the pilot, so the legacy recordNoteHistory
    // path never fires (no double-write).
    expect(recordNoteHistory).not.toHaveBeenCalled();
  });

  it("addEntry appends the new entry; the legacy history path stays dormant", async () => {
    seedNote("mira");
    const updated = await notesApi.addEntry(11, {
      title: "Entry B",
      date: "2026-05-15",
      content: "fresh",
    });
    expect(updated?.entries).toHaveLength(2);
    expect(updated?.entries[1]).toMatchObject({
      title: "Entry B",
      content: "fresh",
    });

    expect(recordNoteHistory).not.toHaveBeenCalled();
  });

  it("deleteEntry drops the entry; the legacy history path stays dormant", async () => {
    seedNote("mira");
    const updated = await notesApi.deleteEntry(11, "entry-a");
    expect(updated?.entries).toHaveLength(0);

    expect(recordNoteHistory).not.toHaveBeenCalled();
  });

  it("owner-routed entry edits persist under the TARGET owner's folder", async () => {
    seedNote("alex");
    await notesApi.updateEntry(11, "entry-a", { content: "pi edit" }, "alex");

    // The note lives under the OWNER's folder, not the actor's (signed-in mira).
    const onDisk = fakeFiles["users/alex/notes/11.json"] as Note;
    expect(onDisk.entries[0].content).toBe("pi edit");
    expect(recordNoteHistory).not.toHaveBeenCalled();
  });

  it("two sequential saves persist the latest content; the legacy path stays dormant", async () => {
    // The editor body persists through updateEntry; title/description through
    // notesApi.update. The popup never calls both for one logical save. Each
    // save now flows into the Loro doc rather than recordNoteHistory.
    seedNote("mira");
    await notesApi.updateEntry(11, "entry-a", { content: "first save" });
    const updated = await notesApi.updateEntry(11, "entry-a", {
      content: "second save",
    });
    expect(updated?.entries[0].content).toBe("second save");
    expect(recordNoteHistory).not.toHaveBeenCalled();
  });

  it("a missing note short-circuits without recording history", async () => {
    // No seed: the note does not exist.
    const result = await notesApi.updateEntry(404, "nope", { content: "x" });
    expect(result).toBeNull();
    expect(recordNoteHistory).not.toHaveBeenCalled();
  });
});

describe("notesApi.create stamps the creator as the author (Bug 2)", () => {
  it("sets username to the signed-in user instead of an empty string", async () => {
    const created = await notesApi.create({
      title: "My New Note",
      entries: [{ title: "Day 1", date: "2026-05-30", content: "hello" }],
    });
    expect(created.username).toBe("mira");
    // Persisted into the creator's own folder with the author stamp intact.
    const onDisk = fakeFiles[`users/mira/notes/${created.id}.json`] as Note;
    expect(onDisk.username).toBe("mira");
  });
});
