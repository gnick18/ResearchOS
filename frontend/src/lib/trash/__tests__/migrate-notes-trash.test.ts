// VCP R1 trash MVP notes (2026-05-26): migration round-trip from the
// legacy `notes_trash/<id>.json` shape into the new `_trash/notes/<id>-<slug>.json`
// shape with a `_trash` metadata block.

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

vi.mock("@/lib/settings/user-settings", () => ({
  readUserSettings: vi.fn(async () => ({})),
  DEFAULT_SETTINGS: {},
}));

import { migrateLegacyNotesTrashForUser, readTrashIndex } from "..";

const OWNER = "mira";

beforeEach(() => {
  memFs.clear();
});

function findTrashedFor(id: number): string | undefined {
  const prefix = `users/${OWNER}/_trash/notes/${id}-`;
  for (const key of memFs.keys()) {
    if (key.startsWith(prefix) && key.endsWith(".json")) return key;
  }
  return undefined;
}

describe("migrateLegacyNotesTrashForUser", () => {
  it("moves a legacy notes_trash/<id>.json file into _trash/notes/<id>-<slug>.json with a _trash block", async () => {
    memFs.set(`users/${OWNER}/notes_trash/47.json`, {
      id: 47,
      title: "PCR setup",
      username: OWNER,
      deleted_at: "2026-05-20T00:00:00.000Z",
    });

    const summary = await migrateLegacyNotesTrashForUser(OWNER);

    expect(summary.scanned).toBe(1);
    expect(summary.migrated).toBe(1);
    expect(summary.errors).toBe(0);
    // Legacy file removed; new path written.
    expect(memFs.has(`users/${OWNER}/notes_trash/47.json`)).toBe(false);
    const newPath = findTrashedFor(47);
    expect(newPath).toBeDefined();
    const trashed = memFs.get(newPath!) as {
      id: number;
      _trash: { deleted_at: string; deleted_by: string; original_path: string };
    };
    expect(trashed._trash.deleted_at).toBe("2026-05-20T00:00:00.000Z");
    expect(trashed._trash.deleted_by).toBe(OWNER);
    expect(trashed._trash.original_path).toBe(`users/${OWNER}/notes/47.json`);
    // Index has the entry.
    const index = await readTrashIndex(OWNER);
    expect(index.entries.find((e) => e.id === 47)).toBeDefined();
  });

  it("is idempotent — re-running over the same disk state is a no-op", async () => {
    memFs.set(`users/${OWNER}/notes_trash/47.json`, {
      id: 47,
      title: "PCR",
      username: OWNER,
      deleted_at: "2026-05-20T00:00:00.000Z",
    });
    await migrateLegacyNotesTrashForUser(OWNER);
    const firstSnapshot = JSON.stringify(
      Array.from(memFs.entries()).sort(([a], [b]) => a.localeCompare(b)),
    );

    const secondSummary = await migrateLegacyNotesTrashForUser(OWNER);
    expect(secondSummary.scanned).toBe(0);
    const secondSnapshot = JSON.stringify(
      Array.from(memFs.entries()).sort(([a], [b]) => a.localeCompare(b)),
    );
    expect(secondSnapshot).toBe(firstSnapshot);
  });

  it("skips files whose id already migrated under a prior pass", async () => {
    // Pre-seed the NEW path AND the legacy path with the same id.
    memFs.set(
      `users/${OWNER}/_trash/notes/47-already-migrated.json`,
      {
        id: 47,
        _trash: {
          deleted_at: "2026-05-19T00:00:00.000Z",
          deleted_by: OWNER,
          auto_expires_at: "2026-06-19T00:00:00.000Z",
          original_path: `users/${OWNER}/notes/47.json`,
        },
      },
    );
    memFs.set(`users/${OWNER}/notes_trash/47.json`, {
      id: 47,
      title: "Stale",
      username: OWNER,
      deleted_at: "2026-05-20T00:00:00.000Z",
    });

    const summary = await migrateLegacyNotesTrashForUser(OWNER);
    expect(summary.skipped).toBe(1);
    // Legacy file gone; new file unchanged.
    expect(memFs.has(`users/${OWNER}/notes_trash/47.json`)).toBe(false);
    expect(
      memFs.has(`users/${OWNER}/_trash/notes/47-already-migrated.json`),
    ).toBe(true);
  });
});
