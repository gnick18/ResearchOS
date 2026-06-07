// Tests for the owner-scoped notes API wrapper.
//
// The PI edit-session audited soft-write branch was removed with the PI
// edit-mode feature, so this now only covers the notebook PEER-edit routing
// (a shared-notebook member editing the other member's note routes the write
// to the owner's folder, with no audit).

import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory file system shared between the file-service mock and the test
// assertions. Every JSON file the app touches goes through this map.
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

// crypto.randomUUID — deterministic-ish in test, just enough to keep
// generated ids unique within a test run.
let uuidCounter = 0;
const realCrypto = globalThis.crypto;
beforeEach(() => {
  // Reset between tests so ids don't bleed across cases.
  uuidCounter = 0;
});
// Lock down crypto.randomUUID for stable test ids.
Object.defineProperty(globalThis, "crypto", {
  value: {
    ...realCrypto,
    randomUUID: () => `test-uuid-${++uuidCounter}` as `${string}-${string}-${string}-${string}-${string}`,
  },
  configurable: true,
});

import { ownerScopedNotesApi } from "../owner-scoped-api";
import type { Note } from "@/lib/types";

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
});

describe("ownerScopedNotesApi", () => {
  // Shared 1:1 notebooks (notebook-note-edit sub-bot of HR, 2026-06-02): a
  // notebook PEER edit routes the write to the note OWNER's folder so it lands
  // where the owner reads it. The current user is mocked as "mira"; the note is
  // owned by "alex".
  describe("notebook peer (owner-routed)", () => {
    it("update routes the OTHER member's notebook note to the owner's folder", async () => {
      seedNote("alex");
      const api = ownerScopedNotesApi({ notebookPeerOwner: "alex" });
      await api.update(11, { title: "Peer-edited Title" });

      // Wrote to the OWNER's (alex's) folder, not the editor's (mira's).
      expect(fakeFiles["users/alex/notes/11.json"]).toMatchObject({
        title: "Peer-edited Title",
      });
      expect(fakeFiles["users/mira/notes/11.json"]).toBeUndefined();
      // No PI audit log is written.
      expect(fakeFiles["users/alex/_pi_audit.json"]).toBeUndefined();
      expect(fakeFiles["users/mira/_pi_audit.json"]).toBeUndefined();
    });

    it("updateEntry (the note body) also routes to the owner's folder", async () => {
      seedNote("alex");
      const api = ownerScopedNotesApi({ notebookPeerOwner: "alex" });
      await api.updateEntry(11, "entry-a", { content: "peer body edit" });

      const alexNote = fakeFiles["users/alex/notes/11.json"] as Note;
      expect(alexNote.entries[0].content).toBe("peer body edit");
      expect(fakeFiles["users/mira/notes/11.json"]).toBeUndefined();
    });

    it("addEntry / deleteEntry route to the owner's folder too", async () => {
      seedNote("alex");
      const api = ownerScopedNotesApi({ notebookPeerOwner: "alex" });
      await api.addEntry(11, { title: "Peer Entry", date: "2026-06-02" });
      let alexNote = fakeFiles["users/alex/notes/11.json"] as Note;
      expect(alexNote.entries.map((e) => e.title)).toContain("Peer Entry");
      expect(fakeFiles["users/mira/notes/11.json"]).toBeUndefined();

      await api.deleteEntry(11, "entry-a");
      alexNote = fakeFiles["users/alex/notes/11.json"] as Note;
      expect(alexNote.entries.find((e) => e.id === "entry-a")).toBeUndefined();
    });

    it("an empty notebookPeerOwner falls through to the current-user folder (own note)", async () => {
      // The popup leaves notebookPeerOwner undefined for an OWN notebook note;
      // an empty string is defensively treated the same way.
      seedNote("mira");
      const api = ownerScopedNotesApi({ notebookPeerOwner: "" });
      await api.update(11, { title: "Own Notebook Note" });

      expect(fakeFiles["users/mira/notes/11.json"]).toMatchObject({
        title: "Own Notebook Note",
      });
    });

    it("no args writes to the current-user folder (plain own-note edit)", async () => {
      seedNote("mira");
      const api = ownerScopedNotesApi({});
      await api.update(11, { title: "Self Edit" });

      expect(fakeFiles["users/mira/notes/11.json"]).toMatchObject({
        title: "Self Edit",
      });
      expect(fakeFiles["users/mira/_pi_audit.json"]).toBeUndefined();
    });
  });
});
