// VCP R1 trash MVP notes (2026-05-26): the new trash subsystem's
// public contract — write, read, restore, permanent-delete, auto-
// expire, index rebuild from disk, settings round-trip.

import { beforeEach, describe, expect, it, vi } from "vitest";

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

const settingsState: { trash_cleanup_days?: number | null } = {};
vi.mock("@/lib/settings/user-settings", () => ({
  readUserSettings: vi.fn(async () => ({ ...settingsState })),
  DEFAULT_SETTINGS: {},
}));

import {
  trashEntity,
  restoreEntity,
  permanentlyDelete,
  listTrash,
  runAutoCleanupPass,
  readTrashIndex,
  buildTrashIndexFromDisk,
  readOrRebuildTrashIndex,
  computeAutoExpiresAt,
  getUserTrashCleanupDays,
  NEVER_EXPIRES_SENTINEL,
} from "..";

const OWNER = "mira";

interface Note {
  id: number;
  title: string;
  username: string;
}

function makeNote(id: number, title = `Note ${id}`): Note {
  return { id, title, username: OWNER };
}

function trashedFilenameFor(id: number): string | undefined {
  const prefix = `users/${OWNER}/_trash/notes/${id}-`;
  for (const key of memFs.keys()) {
    if (key.startsWith(prefix) && key.endsWith(".json")) return key;
  }
  return undefined;
}

beforeEach(() => {
  memFs.clear();
  for (const k of Object.keys(settingsState)) {
    delete (settingsState as Record<string, unknown>)[k];
  }
});

describe("trashEntity + restoreEntity round-trip", () => {
  it("moves a note into _trash/notes/, stamps the _trash block, and writes the index entry", async () => {
    memFs.set(`users/${OWNER}/notes/47.json`, makeNote(47, "PCR setup"));

    const trashed = await trashEntity<Note>({
      owner: OWNER,
      entityType: "note",
      id: 47,
      deletedBy: OWNER,
    });

    expect(trashed).not.toBeNull();
    expect(trashed?._trash.deleted_by).toBe(OWNER);
    expect(trashed?._trash.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(trashed?._trash.original_path).toBe(`users/${OWNER}/notes/47.json`);

    // Live copy gone, trash file present (with slug suffix), index has it.
    expect(memFs.has(`users/${OWNER}/notes/47.json`)).toBe(false);
    expect(trashedFilenameFor(47)).toBeDefined();
    const index = await readTrashIndex(OWNER);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].id).toBe(47);
    expect(index.entries[0].entity_type).toBe("note");
  });

  it("restoreEntity writes back to original_path, removes _trash block + index entry", async () => {
    const original = makeNote(47, "PCR setup");
    memFs.set(`users/${OWNER}/notes/47.json`, original);
    await trashEntity<Note>({
      owner: OWNER,
      entityType: "note",
      id: 47,
      deletedBy: OWNER,
    });

    const restored = await restoreEntity<Note>(OWNER, "note", 47);

    expect(restored).not.toBeNull();
    expect(restored).toEqual(original);
    expect(memFs.has(`users/${OWNER}/notes/47.json`)).toBe(true);
    expect(trashedFilenameFor(47)).toBeUndefined();
    const index = await readTrashIndex(OWNER);
    expect(index.entries).toHaveLength(0);
  });
});

describe("Auto-cleanup pass", () => {
  it("hard-deletes expired entries and leaves survivors intact", async () => {
    memFs.set(`users/${OWNER}/notes/1.json`, makeNote(1));
    memFs.set(`users/${OWNER}/notes/2.json`, makeNote(2));

    // Trash both notes with the default 30-day window (settings reader
    // returns {} → falls back to DEFAULT_CLEANUP_DAYS).
    await trashEntity<Note>({
      owner: OWNER,
      entityType: "note",
      id: 1,
      deletedBy: OWNER,
    });
    await trashEntity<Note>({
      owner: OWNER,
      entityType: "note",
      id: 2,
      deletedBy: OWNER,
    });

    // Walk the clock forward 31 days past the SECOND note's deletion.
    const future = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    const summary = await runAutoCleanupPass(OWNER, future);

    expect(summary.expired).toBe(2);
    expect(summary.hardDeleted).toBe(2);
    expect(trashedFilenameFor(1)).toBeUndefined();
    expect(trashedFilenameFor(2)).toBeUndefined();
    const index = await readTrashIndex(OWNER);
    expect(index.entries).toHaveLength(0);
    expect(index.last_cleanup_at).toBeTruthy();
  });

  it("respects the user's cleanup_days setting", async () => {
    settingsState.trash_cleanup_days = 7;
    memFs.set(`users/${OWNER}/notes/1.json`, makeNote(1));
    await trashEntity<Note>({
      owner: OWNER,
      entityType: "note",
      id: 1,
      deletedBy: OWNER,
    });

    // 5 days later: should NOT have expired.
    let summary = await runAutoCleanupPass(
      OWNER,
      new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    );
    expect(summary.expired).toBe(0);
    expect(trashedFilenameFor(1)).toBeDefined();

    // 8 days later: SHOULD have expired (7-day window).
    summary = await runAutoCleanupPass(
      OWNER,
      new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
    );
    expect(summary.expired).toBe(1);
    expect(trashedFilenameFor(1)).toBeUndefined();
  });

  it("Never window keeps records forever", async () => {
    settingsState.trash_cleanup_days = null;
    memFs.set(`users/${OWNER}/notes/1.json`, makeNote(1));
    const trashed = await trashEntity<Note>({
      owner: OWNER,
      entityType: "note",
      id: 1,
      deletedBy: OWNER,
    });
    expect(trashed?._trash.auto_expires_at).toBe(NEVER_EXPIRES_SENTINEL);

    // Walk the clock decades forward.
    const future = new Date(Date.now() + 50 * 365 * 24 * 60 * 60 * 1000);
    const summary = await runAutoCleanupPass(OWNER, future);
    expect(summary.expired).toBe(0);
    expect(trashedFilenameFor(1)).toBeDefined();
  });
});

describe("Index rebuild from disk", () => {
  it("rebuilds the index when _index.json is missing", async () => {
    memFs.set(`users/${OWNER}/notes/1.json`, makeNote(1));
    await trashEntity<Note>({
      owner: OWNER,
      entityType: "note",
      id: 1,
      deletedBy: OWNER,
    });

    // Corrupt the index by deleting it.
    memFs.delete(`users/${OWNER}/_trash/_index.json`);

    const rebuilt = await readOrRebuildTrashIndex(OWNER);
    expect(rebuilt.entries).toHaveLength(1);
    expect(rebuilt.entries[0].id).toBe(1);
    // Index file is back on disk.
    expect(memFs.has(`users/${OWNER}/_trash/_index.json`)).toBe(true);
  });

  it("buildTrashIndexFromDisk picks up every trash subdirectory", async () => {
    // Drop a fake task entry directly into the FS — even though the
    // writer didn't put it there. This mirrors a hand-edit or a partial
    // crash recovery scenario.
    memFs.set(`users/${OWNER}/_trash/tasks/100-Sample-task.json`, {
      id: 100,
      _trash: {
        deleted_at: "2026-05-25T00:00:00.000Z",
        deleted_by: OWNER,
        auto_expires_at: "2026-06-25T00:00:00.000Z",
        original_path: `users/${OWNER}/tasks/100.json`,
      },
    });

    const built = await buildTrashIndexFromDisk(OWNER);
    expect(built.entries).toHaveLength(1);
    expect(built.entries[0].entity_type).toBe("task");
    expect(built.entries[0].id).toBe(100);
  });
});

describe("Permanent delete", () => {
  it("removes the trash file + index entry", async () => {
    memFs.set(`users/${OWNER}/notes/9.json`, makeNote(9));
    await trashEntity<Note>({
      owner: OWNER,
      entityType: "note",
      id: 9,
      deletedBy: OWNER,
    });

    const ok = await permanentlyDelete(OWNER, "note", 9);
    expect(ok).toBe(true);
    expect(trashedFilenameFor(9)).toBeUndefined();
    expect((await readTrashIndex(OWNER)).entries).toHaveLength(0);
  });
});

describe("Listing", () => {
  it("listTrash filters by entity type when requested", async () => {
    memFs.set(`users/${OWNER}/notes/1.json`, makeNote(1));
    memFs.set(`users/${OWNER}/notes/2.json`, makeNote(2));
    await trashEntity<Note>({
      owner: OWNER,
      entityType: "note",
      id: 1,
      deletedBy: OWNER,
    });
    await trashEntity<Note>({
      owner: OWNER,
      entityType: "note",
      id: 2,
      deletedBy: OWNER,
    });

    const all = await listTrash(OWNER);
    expect(all).toHaveLength(2);
    const notes = await listTrash(OWNER, "note");
    expect(notes).toHaveLength(2);
    const tasks = await listTrash(OWNER, "task");
    expect(tasks).toHaveLength(0);
  });
});

describe("PI unlock-and-delete attribution", () => {
  it("records the session_id on the trash entry when a PI deletes during a Phase 5 unlock", async () => {
    memFs.set(`users/${OWNER}/notes/77.json`, makeNote(77));
    const SESSION_ID = "session-abc";
    const PI = "morgan";

    const trashed = await trashEntity<Note>({
      owner: OWNER,
      entityType: "note",
      id: 77,
      deletedBy: PI,
      sessionId: SESSION_ID,
    });

    expect(trashed?._trash.deleted_by).toBe(PI);
    expect(trashed?._trash.deleted_during_session).toBe(SESSION_ID);
  });
});

describe("Settings helpers", () => {
  it("getUserTrashCleanupDays falls back to 30 when missing", () => {
    expect(getUserTrashCleanupDays({})).toBe(30);
    expect(getUserTrashCleanupDays(null)).toBe(30);
    expect(getUserTrashCleanupDays({ trash_cleanup_days: 7 })).toBe(7);
    expect(getUserTrashCleanupDays({ trash_cleanup_days: null })).toBeNull();
    // Garbage shape falls back.
    expect(getUserTrashCleanupDays({ trash_cleanup_days: -3 })).toBe(30);
  });

  it("computeAutoExpiresAt yields a sensible ISO timestamp", () => {
    const base = "2026-05-26T00:00:00.000Z";
    const got = computeAutoExpiresAt(base, 30);
    expect(got).toMatch(/^2026-06-25T/);
    expect(computeAutoExpiresAt(base, null)).toBe(NEVER_EXPIRES_SENTINEL);
  });
});
