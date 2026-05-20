// frontend/src/lib/user-tombstone.test.ts
//
// Regression tests for the user-tombstone register (INVESTIGATION_USER_LEAKS.md).
//
// The bug class this guards against: ResearchOS treated
// `fileService.listDirectories("users")` as the complete enumeration of real
// users. Cloud-sync providers (OneDrive Files On-Demand, Dropbox, Google
// Drive) can repopulate placeholder directory entries after a hard delete,
// surfacing as ghost users in the picker (cosmetic `alex` leak, recurring
// `KritikaChopra` after delete).
//
// The fix introduces a `deleted_at` tombstone field in `_user_metadata.json`
// that:
//   1. usersApi.delete writes BEFORE the FSA recursive removeEntry — so the
//      logical delete record is durable even if the bytes-removal fails.
//   2. discoverUsers / usersApi.list filter out — so cloud-restored stubs
//      stay hidden.
//   3. ensureLabUserMetadata preserves (it already short-circuits on any
//      existing entry; the test below pins that invariant against future
//      refactors).

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── In-memory FS mock ───────────────────────────────────────────────────────
const memFs = new Map<string, unknown>();
const removeEntryCalls: { username: string; tsAtCall: number }[] = [];
const writeJsonCalls: { path: string; tsAtCall: number }[] = [];
let opCounter = 0;
const nextOpTs = () => ++opCounter;

vi.mock("./file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      writeJsonCalls.push({ path, tsAtCall: nextOpTs() });
      memFs.set(path, data);
    }),
    isConnected: vi.fn(() => true),
    getDirectory: vi.fn(async () => ({
      removeEntry: vi.fn(async (username: string) => {
        removeEntryCalls.push({ username, tsAtCall: nextOpTs() });
      }),
    })),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async () => []),
    listDirectories: vi.fn(async () => []),
    deleteFile: vi.fn(async () => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => ""),
  storeCurrentUser: vi.fn(async () => {}),
  clearCurrentUser: vi.fn(async () => {}),
  clearCurrentUserCache: vi.fn(() => {}),
  getMainUser: vi.fn(async () => ""),
  storeMainUser: vi.fn(async () => {}),
  clearMainUser: vi.fn(async () => {}),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { usersApi } from "./local-api";
import { discoverUsers } from "./file-system/user-discovery";
import { ensureLabUserMetadata, readAllUserMetadata } from "./file-system/user-metadata";

beforeEach(() => {
  memFs.clear();
  removeEntryCalls.length = 0;
  writeJsonCalls.length = 0;
  opCounter = 0;
});

describe("usersApi.delete — tombstone register", () => {
  it("writes deleted_at to _user_metadata.json BEFORE calling FSA removeEntry", async () => {
    // Pre-seed an existing user entry so we're testing the merge path, not the
    // auto-create path. (The bug fix has to work in both cases, but the
    // "user was already metadata-tracked" path is the realistic one for a
    // user deletion.)
    memFs.set("users/_user_metadata.json", {
      users: { alice: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" } },
    });

    const result = await usersApi.delete("alice", 2, true);
    expect(result.status).toBe("ok");

    // Tombstone was persisted with an ISO timestamp.
    const meta = await readAllUserMetadata();
    expect(meta.alice?.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Original fields preserved (color, created_at).
    expect(meta.alice?.color).toBe("#3b82f6");
    expect(meta.alice?.created_at).toBe("2026-01-01T00:00:00.000Z");

    // Ordering invariant: the tombstone write (writeJson on
    // _user_metadata.json) happened BEFORE the FSA removeEntry call.
    expect(removeEntryCalls).toHaveLength(1);
    expect(removeEntryCalls[0].username).toBe("alice");
    const tombstoneWrite = writeJsonCalls.find((c) => c.path === "users/_user_metadata.json");
    expect(tombstoneWrite).toBeDefined();
    expect(tombstoneWrite!.tsAtCall).toBeLessThan(removeEntryCalls[0].tsAtCall);
  });

  it("returns ok and keeps the tombstone even when FSA removeEntry throws (cloud-locked stub case)", async () => {
    // Simulates OneDrive Files On-Demand: the placeholder folder may be
    // unremovable (locked, permission-denied) but the tombstone write
    // succeeded, so the logical delete is durable.
    memFs.set("users/_user_metadata.json", {
      users: { kritika: { color: "#ef4444", created_at: "2026-01-01T00:00:00.000Z" } },
    });

    const { fileService } = await import("./file-system/file-service");
    (fileService.getDirectory as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      removeEntry: vi.fn(async () => {
        throw new Error("NotAllowedError: cloud-only file");
      }),
    });

    const result = await usersApi.delete("kritika", 2, true);
    // The tombstone IS the authoritative delete record; bytes-removal failing
    // should not abort the delete flow.
    expect(result.status).toBe("ok");

    const meta = await readAllUserMetadata();
    expect(meta.kritika?.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("discoverUsers filters out tombstoned users even when the directory exists on disk", async () => {
    // Same surface as usersApi.list but exercised through the other public
    // entry point. discoverUsers feeds the user-picker UI; usersApi.list feeds
    // the lab Users panel. Pin both paths to prevent a future refactor from
    // splitting the filter behavior.
    const { fileService } = await import("./file-system/file-service");
    (fileService.listDirectories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      "alice",
      "alex",
      "_user_metadata.json",
    ]);
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
        alex: {
          color: "#10b981",
          created_at: "2026-01-01T00:00:00.000Z",
          deleted_at: "2026-05-15T12:00:00.000Z",
        },
      },
    });

    const users = await discoverUsers();
    expect(users).toEqual(["alice"]);
  });

  it("usersApi.list filters out tombstoned users (cloud-restored stub stays hidden)", async () => {
    const { fileService } = await import("./file-system/file-service");
    // Simulate OneDrive having restored a placeholder for `kritika/` after a
    // prior tombstone — FSA listing surfaces her, but the tombstone hides her.
    (fileService.listDirectories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      "alice",
      "kritika",
      "_user_metadata.json",
    ]);
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
        kritika: {
          color: "#ef4444",
          created_at: "2026-01-01T00:00:00.000Z",
          deleted_at: "2026-05-15T12:00:00.000Z",
        },
      },
    });

    const { users } = await usersApi.list();
    expect(users).toEqual(["alice"]);
  });
});

describe("usersApi.getMainUser — tombstone-aware validation", () => {
  // The user-tombstone work at 3f83e157 filtered discoverUsers + usersApi.list
  // but left getMainUser returning the raw IDB candidate without validation.
  // Symptom: Grant exited Lab Mode and landed on user `alex` — a deleted user
  // whose folder no longer existed but whose username still sat in IDB's
  // mainUser key (carryover from an old demo lab copy). The fix validates the
  // candidate against discoverUsers and clears the stale IDB key when invalid.
  // See app/lab/page.tsx:164 (handleLogout) for the calling site.

  let store: typeof import("./file-system/indexeddb-store");

  beforeEach(async () => {
    store = await import("./file-system/indexeddb-store");
    (store.getMainUser as ReturnType<typeof vi.fn>).mockClear();
    (store.clearMainUser as ReturnType<typeof vi.fn>).mockClear();
    (store.getCurrentUser as ReturnType<typeof vi.fn>).mockClear();
    const { fileService } = await import("./file-system/file-service");
    (fileService.listDirectories as ReturnType<typeof vi.fn>).mockClear();
  });

  it("returns the candidate unchanged when it is a valid (non-tombstoned) user", async () => {
    (store.getMainUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce("alex");
    const { fileService } = await import("./file-system/file-service");
    (fileService.listDirectories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      "alex",
      "morgan",
    ]);
    memFs.set("users/_user_metadata.json", {
      users: {
        alex: { color: "#10b981", created_at: "2026-01-01T00:00:00.000Z" },
        morgan: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
      },
    });

    const result = await usersApi.getMainUser();
    expect(result.main_user).toBe("alex");
    expect(store.clearMainUser).not.toHaveBeenCalled();
  });

  it("clears the stale IDB key and returns empty when the candidate no longer exists on disk", async () => {
    (store.getMainUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce("alex");
    const { fileService } = await import("./file-system/file-service");
    (fileService.listDirectories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      "morgan",
      "GrantNickles",
    ]);
    memFs.set("users/_user_metadata.json", {
      users: {
        morgan: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
        GrantNickles: { color: "#a855f7", created_at: "2026-01-01T00:00:00.000Z" },
      },
    });

    const result = await usersApi.getMainUser();
    expect(result.main_user).toBe("");
    expect(store.clearMainUser).toHaveBeenCalledTimes(1);
  });

  it("clears the IDB key when the candidate is tombstoned (deleted_at set)", async () => {
    (store.getMainUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce("kritika");
    const { fileService } = await import("./file-system/file-service");
    // OneDrive Files On-Demand has restored `kritika/` as a placeholder — the
    // directory listing surfaces her, but the deleted_at tombstone hides her
    // from discoverUsers. getMainUser should still treat the candidate as
    // invalid and clear the IDB key.
    (fileService.listDirectories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      "alice",
      "kritika",
    ]);
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
        kritika: {
          color: "#ef4444",
          created_at: "2026-01-01T00:00:00.000Z",
          deleted_at: "2026-05-15T12:00:00.000Z",
        },
      },
    });

    const result = await usersApi.getMainUser();
    expect(result.main_user).toBe("");
    expect(store.clearMainUser).toHaveBeenCalledTimes(1);
  });

  it("returns empty without validation when the IDB key is already empty", async () => {
    (store.getMainUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce("");
    const { fileService } = await import("./file-system/file-service");

    const result = await usersApi.getMainUser();
    expect(result.main_user).toBe("");
    // Skip the validation path entirely — no discoverUsers call, no clear.
    expect(store.clearMainUser).not.toHaveBeenCalled();
    expect(fileService.listDirectories).not.toHaveBeenCalled();
  });

  it("does NOT clear the IDB key when discoverUsers returns an empty list (ambiguous: fresh folder vs transient FS error)", async () => {
    // Originally this test asserted that an empty discoverUsers should clear
    // the stale candidate. Grant hit a regression 2026-05-20 where his
    // GrantNickles "set as main" pin was wiped on browser refresh — root
    // cause was a concurrent listDirectories call hiccupping and returning
    // [], which triggered this clear path against a valid candidate.
    //
    // discoverUsers returns [] both for (a) genuinely empty folders and
    // (b) any transient FS error (listDirectories or readAllUserMetadata
    // throwing — discoverUsers swallows). We can't tell those apart from
    // the outside, so the conservative call is to keep the IDB key in the
    // ambiguous case. A stale key in a genuinely empty folder costs
    // nothing (next set-as-main overwrites); a wiped valid key costs a UX
    // regression.
    (store.getMainUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce("alex");
    const { fileService } = await import("./file-system/file-service");
    (fileService.listDirectories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const result = await usersApi.getMainUser();
    expect(result.main_user).toBe("alex");
    expect(store.clearMainUser).not.toHaveBeenCalled();
  });
});

describe("ensureLabUserMetadata — tombstone preservation", () => {
  it("does NOT wipe deleted_at when discovery re-encounters a tombstoned user", async () => {
    // The re-resurrection hazard: cloud sync restores `users/alice/` as a
    // placeholder, the next loadLabUsers walks user dirs and calls
    // ensureLabUserMetadata(["alice"]). The existing
    // `if (file.users[username]) continue` short-circuit must skip alice and
    // leave her tombstone intact.
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: {
          color: "#3b82f6",
          created_at: "2026-01-01T00:00:00.000Z",
          deleted_at: "2026-05-15T12:00:00.000Z",
        },
      },
    });

    await ensureLabUserMetadata(["alice"]);

    const meta = await readAllUserMetadata();
    expect(meta.alice?.deleted_at).toBe("2026-05-15T12:00:00.000Z");
    // Color + created_at preserved too.
    expect(meta.alice?.color).toBe("#3b82f6");
    expect(meta.alice?.created_at).toBe("2026-01-01T00:00:00.000Z");
  });
});
