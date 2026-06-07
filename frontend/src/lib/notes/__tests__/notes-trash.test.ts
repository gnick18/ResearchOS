// VCP R1 trash MVP notes (2026-05-26): legacy notes-trash test surface.
//
// `notes-trash.ts` is now a deprecation shim that delegates into the
// new `@/lib/trash` layer. The on-disk layout moved from
// `users/<u>/notes_trash/<id>.json` to
// `users/<u>/_trash/notes/<id>-<slug>.json`. This test file pins the
// shim's public contract (same function names, same return shapes) so
// existing call sites in local-api.ts + NoteDetailPopup keep working.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Inline in-memory FS shared across the trash modules under test.
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
    listFiles: vi.fn(async (dirPath: string) => {
      const prefix = `${dirPath}/`;
      const out: string[] = [];
      for (const key of memFs.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          if (!rest.includes("/")) out.push(rest);
        }
      }
      return out.sort();
    }),
    fileExists: vi.fn(async (path: string) => memFs.has(path)),
  },
}));

// Settings reader gets mocked to return DEFAULT_SETTINGS so the writer
// doesn't try to walk a real user-settings.json file.
vi.mock("@/lib/settings/user-settings", () => ({
  readUserSettings: vi.fn(async () => ({})),
  DEFAULT_SETTINGS: {},
}));

// The round-trip asserts the legacy jsonl notes-history path, which notesApi
// skips once LORO_PILOT_ENABLED is on (now the prod default). Force it off so
// the legacy engine this test targets actually records.
vi.mock("@/lib/loro/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/loro/config")>()),
  LORO_PILOT_ENABLED: false,
}));

// Import after the mocks so the helper picks up the mocked modules.
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

/** Find the trash file path for a given id by scanning the mock FS.
 *  Needed because the filename now includes a slug suffix. */
function trashFilePathForId(owner: string, id: number): string | undefined {
  const prefix = `users/${owner}/_trash/notes/${id}-`;
  for (const key of memFs.keys()) {
    if (key.startsWith(prefix) && key.endsWith(".json")) return key;
  }
  return undefined;
}

describe("notes-trash shim", () => {
  beforeEach(() => {
    memFs.clear();
  });

  it("moves a live note into _trash/notes and surfaces the deleted_at field for legacy readers", async () => {
    memFs.set(`users/${OWNER}/notes/7.json`, makeNote(7));

    const trashed = await trashNote(OWNER, 7);

    expect(trashed).not.toBeNull();
    expect(trashed?.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Live copy is gone, trash copy is present at the new path.
    expect(memFs.has(`users/${OWNER}/notes/7.json`)).toBe(false);
    expect(trashFilePathForId(OWNER, 7)).toBeDefined();
  });

  it("returns null when the live note is missing (no trash entry written)", async () => {
    const trashed = await trashNote(OWNER, 999);

    expect(trashed).toBeNull();
    expect(trashFilePathForId(OWNER, 999)).toBeUndefined();
  });

  it("restoreTrashedNote brings the note back at the same id and strips deleted_at + _trash", async () => {
    memFs.set(`users/${OWNER}/notes/7.json`, makeNote(7));
    await trashNote(OWNER, 7);

    const restored = await restoreTrashedNote(OWNER, 7);

    expect(restored).not.toBeNull();
    expect(restored?.id).toBe(7);
    expect(restored?.title).toBe("Note 7");
    expect("deleted_at" in (restored ?? {})).toBe(false);
    expect("_trash" in (restored ?? {})).toBe(false);
    expect(memFs.has(`users/${OWNER}/notes/7.json`)).toBe(true);
    expect(trashFilePathForId(OWNER, 7)).toBeUndefined();
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

    // The restore path stamps an additive `_restore_audit` provenance blob
    // (deleted/restored by+at, surfaced by RestoredBadge). The note CONTENT must
    // round-trip unchanged; the audit blob is extra metadata, so compare the
    // content with it stripped, then assert the audit was recorded.
    const { _restore_audit, ...restoredContent } = (restored ?? {}) as Record<
      string,
      unknown
    >;
    expect(restoredContent).toEqual(original);
    expect(_restore_audit).toMatchObject({
      deleted_by: OWNER,
      restored_by: OWNER,
    });
  });
});
