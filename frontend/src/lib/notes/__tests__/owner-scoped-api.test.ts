// Lab Head Phase 5 R1 (lab head Phase 5 R1 manager, 2026-05-23): tests for
// the owner-scoped notes API wrapper.
//
// Coverage:
//   - Owner-scoped update writes to the target owner's notes folder, not
//     the current viewer's.
//   - Audit entries are appended to the target owner's _pi_audit.json.
//   - Multi-field updates produce multi-entry audit logs.
//   - No-op writes (no changed fields) produce no audit entries.
//   - When session args are missing, the wrapper falls through to the
//     unwrapped API (no owner routing, no audit).
//   - Entry-level updates (updateEntry / addEntry / deleteEntry) emit
//     audit entries scoped to the touched entry.

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
  describe("active session (owner-routed + audit)", () => {
    const args = {
      targetOwner: "alex",
      actor: "mira",
      sessionId: "session-1",
    };

    it("update writes to the target owner's folder, not the current user's", async () => {
      seedNote("alex");
      const api = ownerScopedNotesApi(args);
      await api.update(11, { title: "New Title" });

      // Wrote to alex's folder.
      expect(fakeFiles["users/alex/notes/11.json"]).toMatchObject({
        title: "New Title",
      });
      // Did NOT write to mira's folder.
      expect(fakeFiles["users/mira/notes/11.json"]).toBeUndefined();
    });

    it("update appends one audit entry per changed field to the owner's audit log", async () => {
      seedNote("alex");
      const api = ownerScopedNotesApi(args);
      await api.update(11, {
        title: "New Title",
        description: "New description",
      });

      const audit = fakeFiles["users/alex/_pi_audit.json"] as {
        entries: Array<{
          actor: string;
          target_user: string;
          field_path: string;
          old_value: unknown;
          new_value: unknown;
          record_type: string;
          record_id: number;
          session_id: string;
        }>;
      };
      expect(audit).toBeDefined();
      expect(audit.entries).toHaveLength(2);
      const fieldPaths = audit.entries.map((e) => e.field_path).sort();
      expect(fieldPaths).toEqual(["description", "title"]);
      for (const entry of audit.entries) {
        expect(entry.actor).toBe("mira");
        expect(entry.target_user).toBe("alex");
        expect(entry.record_type).toBe("note");
        expect(entry.record_id).toBe(11);
        expect(entry.session_id).toBe("session-1");
      }
    });

    it("update with no actually-changed fields produces no audit entries", async () => {
      seedNote("alex", { title: "Same" });
      const api = ownerScopedNotesApi(args);
      // Write the same title back — buildFieldDiffEntries should skip it.
      await api.update(11, { title: "Same" });

      const audit = fakeFiles["users/alex/_pi_audit.json"];
      expect(audit).toBeUndefined();
    });

    it("updateEntry writes the entry-scoped diff to the owner's audit log", async () => {
      seedNote("alex");
      const api = ownerScopedNotesApi(args);
      await api.updateEntry(11, "entry-a", { content: "new content" });

      // Note file persisted to alex.
      const alexNote = fakeFiles["users/alex/notes/11.json"] as Note;
      expect(alexNote.entries[0].content).toBe("new content");
      expect(fakeFiles["users/mira/notes/11.json"]).toBeUndefined();

      // Audit log shows the entry-scoped change.
      const audit = fakeFiles["users/alex/_pi_audit.json"] as {
        entries: Array<{ field_path: string; old_value: unknown; new_value: unknown }>;
      };
      expect(audit.entries).toHaveLength(1);
      expect(audit.entries[0].field_path).toBe("entries.entry-a.content");
      expect(audit.entries[0].old_value).toBe("old content");
      expect(audit.entries[0].new_value).toBe("new content");
    });

    it("addEntry emits an audit entry for the new entry", async () => {
      seedNote("alex");
      const api = ownerScopedNotesApi(args);
      await api.addEntry(11, {
        title: "Entry B",
        date: "2026-05-15",
        content: "fresh",
      });

      const audit = fakeFiles["users/alex/_pi_audit.json"] as {
        entries: Array<{ field_path: string; old_value: unknown; new_value: unknown }>;
      };
      expect(audit.entries).toHaveLength(1);
      expect(audit.entries[0].field_path).toMatch(/^entries\.[^.]+$/);
      expect(audit.entries[0].old_value).toBeNull();
      expect(audit.entries[0].new_value).toMatchObject({
        title: "Entry B",
        date: "2026-05-15",
        content: "fresh",
      });
    });

    it("deleteEntry emits an audit entry capturing the removed entry", async () => {
      seedNote("alex");
      const api = ownerScopedNotesApi(args);
      await api.deleteEntry(11, "entry-a");

      const alexNote = fakeFiles["users/alex/notes/11.json"] as Note;
      expect(alexNote.entries).toHaveLength(0);

      const audit = fakeFiles["users/alex/_pi_audit.json"] as {
        entries: Array<{ field_path: string; old_value: unknown; new_value: unknown }>;
      };
      expect(audit.entries).toHaveLength(1);
      expect(audit.entries[0].field_path).toBe("entries.entry-a");
      expect(audit.entries[0].old_value).toMatchObject({
        title: "Entry A",
        content: "old content",
      });
      expect(audit.entries[0].new_value).toBeNull();
    });

    it("multi-call same-session audit log is append-only", async () => {
      seedNote("alex");
      const api = ownerScopedNotesApi(args);
      await api.update(11, { title: "First" });
      await api.update(11, { description: "Second" });

      const audit = fakeFiles["users/alex/_pi_audit.json"] as {
        entries: Array<{ field_path: string }>;
      };
      expect(audit.entries).toHaveLength(2);
      expect(audit.entries[0].field_path).toBe("title");
      expect(audit.entries[1].field_path).toBe("description");
    });
  });

  describe("inactive session (falls through to raw notesApi)", () => {
    it("missing targetOwner: writes to current user's folder, no audit", async () => {
      seedNote("mira"); // current user
      const api = ownerScopedNotesApi({
        targetOwner: undefined,
        actor: "mira",
        sessionId: "session-1",
      });
      await api.update(11, { title: "Self Edit" });

      expect(fakeFiles["users/mira/notes/11.json"]).toMatchObject({
        title: "Self Edit",
      });
      expect(fakeFiles["users/mira/_pi_audit.json"]).toBeUndefined();
    });

    it("missing sessionId: same fallthrough behavior", async () => {
      seedNote("mira");
      const api = ownerScopedNotesApi({
        targetOwner: "alex",
        actor: "mira",
        sessionId: undefined,
      });
      await api.update(11, { title: "Fallback" });

      // Wrote to current user's folder (mira's), NOT to alex.
      expect(fakeFiles["users/mira/notes/11.json"]).toMatchObject({
        title: "Fallback",
      });
      expect(fakeFiles["users/alex/notes/11.json"]).toBeUndefined();
      // No audit emitted.
      expect(fakeFiles["users/alex/_pi_audit.json"]).toBeUndefined();
    });
  });
});
