// frontend/src/lib/file-system/__tests__/lab-roster-ghost-cleanup.test.ts
//
// Regression tests for the "Lab Roster shows ghosts" bug class
// (lab-roster ghost cleanup, 2026-05-26). Three bugs in scope:
//
//   1. Tombstoned users still appeared in the Lab Roster — fix routes
//      the roster through `discoverUsers()` which already filters
//      `deleted_at` tombstones + the `lab` / `public` sentinels.
//
//   2. A literal `"undefined"` username appeared in the roster, the
//      result of an upstream caller passing `undefined` (which got
//      string-templated into a username slot). Fix adds an
//      `isInvalidUsername` guard on the metadata write paths so a
//      defective caller cannot pollute `_user_metadata.json`.
//
//   3. Pre-existing pollution in Grant's `_user_metadata.json`
//      (alex, GrantNickles, KritikaChopra, Test-1, undefined) still
//      bloated the file even after Fix 1. A new
//      `pruneOrphanUserMetadataEntries` self-heal sweep drops orphan
//      entries on folder-connect while preserving tombstones.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory FS mock ───────────────────────────────────────────────────────
const memFs = new Map<string, unknown>();
const writeJsonCalls: { path: string; data: unknown }[] = [];
let listDirsResult: string[] = [];

vi.mock("../file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      writeJsonCalls.push({ path, data });
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    isConnected: vi.fn(() => true),
    listDirectories: vi.fn(async () => listDirsResult),
  },
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import {
  ensureLabUserMetadata,
  readAllUserMetadata,
  pruneOrphanUserMetadataEntries,
  setUserMetadataField,
} from "../user-metadata";
import { discoverUsers } from "../user-discovery";

beforeEach(() => {
  memFs.clear();
  writeJsonCalls.length = 0;
  listDirsResult = [];
  vi.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// Fix 1: discoverUsers filters tombstones + sentinels — these are what
// `LabRoster.tsx` now reads from. The roster test pins the helper's
// behavior since the component just `await discoverUsers()`-es.
// ────────────────────────────────────────────────────────────────────────────
describe("Fix 1: discoverUsers filters ghosts (Lab Roster source)", () => {
  it("filters tombstoned users (deleted_at set)", async () => {
    listDirsResult = ["alice", "bob", "carol", "public", "lab"];
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
        bob: {
          color: "#ef4444",
          created_at: "2026-01-02T00:00:00.000Z",
          deleted_at: "2026-02-01T00:00:00.000Z",
        },
        carol: { color: "#10b981", created_at: "2026-01-03T00:00:00.000Z" },
      },
    });

    const result = await discoverUsers();
    expect(result).toEqual(["alice", "carol"]);
    expect(result).not.toContain("bob"); // tombstoned
    expect(result).not.toContain("lab"); // sentinel
    expect(result).not.toContain("public"); // sentinel
  });

  it("filters the `lab` and `public` sentinels even with no metadata file", async () => {
    listDirsResult = ["alice", "lab", "public"];
    // No _user_metadata.json present.

    const result = await discoverUsers();
    expect(result).toEqual(["alice"]);
  });

  it("filters _no_user_ and JSON sentinel entries", async () => {
    listDirsResult = [
      "alice",
      "_no_user_",
      "_global_counters.json",
      "_user_metadata.json",
    ];

    const result = await discoverUsers();
    expect(result).toEqual(["alice"]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Fix 2: write-side guards. `ensureLabUserMetadata` and
// `setUserMetadataField` must reject invalid usernames so a defective
// upstream caller can't pollute the file again.
// ────────────────────────────────────────────────────────────────────────────
describe("Fix 2: ensureLabUserMetadata guards invalid usernames", () => {
  it("no-ops on undefined entries (does not write to disk)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // TypeScript would normally reject this — but the real upstream
    // bug was a string templated from an undefined value. The test
    // simulates a defective caller bypassing the type check.
    const usernames = [undefined as unknown as string];
    const result = await ensureLabUserMetadata(usernames);

    // No metadata written.
    expect(writeJsonCalls).toHaveLength(0);
    // No entry created.
    expect(Object.keys(result)).toEqual([]);
    // Warning surfaced for the bad call site.
    expect(warnSpy).toHaveBeenCalled();
    const warnMsg = warnSpy.mock.calls[0]?.[0];
    expect(String(warnMsg)).toMatch(/invalid username/i);
  });

  it("no-ops on the literal string 'undefined' (the actual on-disk pollution)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await ensureLabUserMetadata(["undefined"]);

    expect(writeJsonCalls).toHaveLength(0);
    expect(result.undefined).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("no-ops on null, empty string, and 'null' too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await ensureLabUserMetadata([null as unknown as string]);
    await ensureLabUserMetadata([""]);
    await ensureLabUserMetadata(["null"]);

    expect(writeJsonCalls).toHaveLength(0);
  });

  it("still processes valid usernames in a mixed batch (one bad entry doesn't poison the rest)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await ensureLabUserMetadata([
      "alice",
      undefined as unknown as string,
      "bob",
    ]);

    expect(result.alice).toBeDefined();
    expect(result.bob).toBeDefined();
    expect(Object.keys(result)).not.toContain("undefined");
  });
});

describe("Fix 2: setUserMetadataField guards invalid usernames", () => {
  it("returns null and skips write on undefined username", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await setUserMetadataField(
      undefined as unknown as string,
      "hide_goals_from_lab",
      true,
    );

    expect(result).toBeNull();
    expect(writeJsonCalls).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("returns null and skips write on the literal string 'undefined'", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await setUserMetadataField(
      "undefined",
      "hide_goals_from_lab",
      true,
    );

    expect(result).toBeNull();
    expect(writeJsonCalls).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("returns null and skips write on empty string", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await setUserMetadataField(
      "",
      "hide_goals_from_lab",
      true,
    );

    expect(result).toBeNull();
    expect(writeJsonCalls).toHaveLength(0);
  });

  it("still writes for valid usernames", async () => {
    const result = await setUserMetadataField(
      "alice",
      "hide_goals_from_lab",
      true,
    );

    expect(result).not.toBeNull();
    expect(result?.hide_goals_from_lab).toBe(true);
    expect(writeJsonCalls).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Fix 3: self-heal sweep removes orphan entries but preserves
// tombstones (the rename-collision blocker).
// ────────────────────────────────────────────────────────────────────────────
describe("Fix 3: pruneOrphanUserMetadataEntries", () => {
  it("removes the literal 'undefined' key and other invalid usernames", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
        undefined: { color: "#ef4444", created_at: "2026-01-02T00:00:00.000Z" },
        null: { color: "#10b981", created_at: "2026-01-03T00:00:00.000Z" },
      },
    });

    const result = await pruneOrphanUserMetadataEntries(["alice"]);

    expect(result.pruned).toContain("undefined");
    expect(result.pruned).toContain("null");
    expect(result.pruned).not.toContain("alice");

    const after = await readAllUserMetadata();
    expect(after.alice).toBeDefined();
    expect(after.undefined).toBeUndefined();
    expect(after.null).toBeUndefined();
    expect(infoSpy).toHaveBeenCalled();
  });

  it("removes orphan entries (no on-disk dir, no tombstone)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
        // Folder deleted years ago, no tombstone written (pre-tombstone-era data).
        GrantNickles: {
          color: "#ef4444",
          created_at: "2024-01-01T00:00:00.000Z",
        },
        KritikaChopra: {
          color: "#10b981",
          created_at: "2024-01-02T00:00:00.000Z",
        },
        "Test-1": {
          color: "#f59e0b",
          created_at: "2024-01-03T00:00:00.000Z",
        },
      },
    });

    // Only `alice` actually has a folder on disk.
    const result = await pruneOrphanUserMetadataEntries(["alice"]);

    expect(result.pruned.sort()).toEqual(
      ["GrantNickles", "KritikaChopra", "Test-1"].sort(),
    );

    const after = await readAllUserMetadata();
    expect(after.alice).toBeDefined();
    expect(after.GrantNickles).toBeUndefined();
    expect(after.KritikaChopra).toBeUndefined();
    expect(after["Test-1"]).toBeUndefined();
  });

  it("PRESERVES tombstoned entries (the rename-collision blocker)", async () => {
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
        // Tombstoned: soft-deleted, must stay so the name can't be
        // silently reclaimed via rename (per local-api.ts:5005-5008).
        bob: {
          color: "#ef4444",
          created_at: "2026-01-02T00:00:00.000Z",
          deleted_at: "2026-02-01T00:00:00.000Z",
        },
      },
    });

    // discoverUsers result excludes `bob` (tombstones filtered upstream),
    // so the sweep sees `bob` only via the metadata read — it must NOT
    // misread that as orphan-and-prune.
    const result = await pruneOrphanUserMetadataEntries(["alice"]);

    expect(result.pruned).not.toContain("bob");
    const after = await readAllUserMetadata();
    expect(after.bob).toBeDefined();
    expect(after.bob?.deleted_at).toBeDefined();
  });

  it("is idempotent — running twice on a clean file is a no-op", async () => {
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
      },
    });

    const first = await pruneOrphanUserMetadataEntries(["alice"]);
    expect(first.pruned).toEqual([]);
    const writesAfterFirst = writeJsonCalls.length;

    const second = await pruneOrphanUserMetadataEntries(["alice"]);
    expect(second.pruned).toEqual([]);
    // No additional disk writes on the second pass.
    expect(writeJsonCalls.length).toBe(writesAfterFirst);
  });

  it("does NOT write to disk when nothing needs pruning", async () => {
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
        bob: {
          color: "#ef4444",
          created_at: "2026-01-02T00:00:00.000Z",
          deleted_at: "2026-02-01T00:00:00.000Z",
        },
      },
    });

    await pruneOrphanUserMetadataEntries(["alice"]);

    expect(writeJsonCalls).toHaveLength(0);
  });

  it("returns empty pruned list when no folder is connected (graceful no-op)", async () => {
    // No metadata file at all; discoverUsers result is empty.
    const result = await pruneOrphanUserMetadataEntries([]);
    expect(result.pruned).toEqual([]);
  });

  it("handles the realistic Grant-folder scenario (mix of orphans, valid users, undefined, tombstone)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    memFs.set("users/_user_metadata.json", {
      users: {
        // Valid users — keep.
        Grant: { color: "#3b82f6", created_at: "2026-05-01T00:00:00.000Z" },
        Mira: { color: "#ef4444", created_at: "2026-05-02T00:00:00.000Z" },
        // Tombstoned — keep (collision blocker).
        FormerUser: {
          color: "#10b981",
          created_at: "2026-01-01T00:00:00.000Z",
          deleted_at: "2026-04-01T00:00:00.000Z",
        },
        // Orphans — prune.
        alex: { color: "#f59e0b", created_at: "2024-01-01T00:00:00.000Z" },
        GrantNickles: {
          color: "#8b5cf6",
          created_at: "2024-01-02T00:00:00.000Z",
        },
        KritikaChopra: {
          color: "#ec4899",
          created_at: "2024-01-03T00:00:00.000Z",
        },
        "Test-1": {
          color: "#06b6d4",
          created_at: "2024-01-04T00:00:00.000Z",
        },
        // Bad-data pollution — prune.
        undefined: {
          color: "#84cc16",
          created_at: "2024-01-05T00:00:00.000Z",
        },
      },
    });

    const result = await pruneOrphanUserMetadataEntries(["Grant", "Mira"]);

    expect(result.pruned.sort()).toEqual(
      ["alex", "GrantNickles", "KritikaChopra", "Test-1", "undefined"].sort(),
    );

    const after = await readAllUserMetadata();
    expect(after.Grant).toBeDefined();
    expect(after.Mira).toBeDefined();
    expect(after.FormerUser).toBeDefined();
    expect(after.FormerUser?.deleted_at).toBeDefined();
    expect(after.alex).toBeUndefined();
    expect(after.undefined).toBeUndefined();
  });
});
