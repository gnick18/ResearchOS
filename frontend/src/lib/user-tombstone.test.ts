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

describe("usersApi.listLocalIdentities — materialized co-member exclusion", () => {
  // The identity chooser (UserLoginScreen) must only offer real local accounts
  // a person can sign in as. A lab member's folder materializes co-member
  // scaffolds (the PI + labmates) for People/colors/attribution display, with a
  // `materialized_member` flag in _user_metadata.json. Those are NOT identities
  // and must never appear in the "who are you" picker (the live finding: a lone
  // member was offered to sign in as their PI). The broad usersApi.list keeps
  // returning the full roster for display + sharing surfaces.
  it("excludes materialized co-members while the broad list keeps them", async () => {
    const { fileService } = await import("./file-system/file-service");
    (fileService.listDirectories as ReturnType<typeof vi.fn>).mockResolvedValue([
      "viewer",
      "emile",
      "_user_metadata.json",
    ]);
    memFs.set("users/_user_metadata.json", {
      users: {
        viewer: { color: "#1283C9", created_at: "2026-06-19T00:00:00.000Z" },
        emile: {
          color: "#5B47D6",
          created_at: "2026-06-19T00:00:00.000Z",
          materialized_member: true,
        },
      },
    });

    // The broad roster still shows both (display/sharing surfaces need the PI).
    const broad = await usersApi.list();
    expect(broad.users).toEqual(["emile", "viewer"]);

    // The identity chooser shows only the real local account.
    const identities = await usersApi.listLocalIdentities();
    expect(identities.users).toEqual(["viewer"]);
  });

  it("still hides tombstoned users in the identity chooser too", async () => {
    const { fileService } = await import("./file-system/file-service");
    (fileService.listDirectories as ReturnType<typeof vi.fn>).mockResolvedValue([
      "viewer",
      "ghost",
      "emile",
      "_user_metadata.json",
    ]);
    memFs.set("users/_user_metadata.json", {
      users: {
        viewer: { color: "#1283C9", created_at: "2026-06-19T00:00:00.000Z" },
        ghost: {
          color: "#ef4444",
          created_at: "2026-06-19T00:00:00.000Z",
          deleted_at: "2026-06-18T00:00:00.000Z",
        },
        emile: {
          color: "#5B47D6",
          created_at: "2026-06-19T00:00:00.000Z",
          materialized_member: true,
        },
      },
    });

    const identities = await usersApi.listLocalIdentities();
    expect(identities.users).toEqual(["viewer"]);
  });
});

describe("usersApi.getMainUser — per-folder storage + tombstone validation", () => {
  // Bug 2 fix 2026-05-23 (login bug fix manager): Main user moved from
  // a per-machine IndexedDB key (`research-os-main-user`) into the
  // per-folder `users/_user_metadata.json` file. The IDB key still
  // exists as a migration fallback for legacy pins, but ONLY gets
  // promoted to the file when the candidate username actually exists
  // in the current folder — that's the cross-folder-leak guard.
  //
  // The tombstone-aware validation from 3f83e157 carries forward: when
  // a persisted main_user no longer exists in discoverUsers (manually
  // deleted directory, OneDrive resurrection of a tombstoned user,
  // etc.), the field is cleared on disk so the picker doesn't try to
  // log in as a vanished user.

  let store: typeof import("./file-system/indexeddb-store");

  beforeEach(async () => {
    store = await import("./file-system/indexeddb-store");
    (store.getMainUser as ReturnType<typeof vi.fn>).mockClear();
    (store.clearMainUser as ReturnType<typeof vi.fn>).mockClear();
    (store.storeMainUser as ReturnType<typeof vi.fn>).mockClear();
    (store.getCurrentUser as ReturnType<typeof vi.fn>).mockClear();
    const { fileService } = await import("./file-system/file-service");
    (fileService.listDirectories as ReturnType<typeof vi.fn>).mockClear();
  });

  it("returns the per-folder main_user field when it points at a valid user", async () => {
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
      main_user: "alex",
    });

    const result = await usersApi.getMainUser();
    expect(result.main_user).toBe("alex");
  });

  it("migrates a legacy IDB pin to the per-folder file when the candidate exists in this folder", async () => {
    // Folder has no main_user field on disk yet, but IDB holds an
    // honest-to-goodness legacy pin from before per-folder storage.
    // discoverUsers confirms the candidate is real → migrate.
    (store.getMainUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce("alex");
    const { fileService } = await import("./file-system/file-service");
    (fileService.listDirectories as ReturnType<typeof vi.fn>).mockResolvedValue([
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
    // Migration write should have happened.
    const persisted = memFs.get("users/_user_metadata.json") as {
      main_user?: string;
    };
    expect(persisted.main_user).toBe("alex");
  });

  it("does NOT migrate a leaked cross-folder IDB pin (Bug 2 — the candidate is unknown to this folder)", async () => {
    // IDB still holds "Grant" from a previous folder. This folder has
    // users "alex" + "morgan". Promoting "Grant" would surface a (Main)
    // badge on whoever happens to share a name; ignoring the IDB
    // candidate entirely is the fix.
    (store.getMainUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce("Grant");
    const { fileService } = await import("./file-system/file-service");
    (fileService.listDirectories as ReturnType<typeof vi.fn>).mockResolvedValue([
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
    expect(result.main_user).toBe("");
    // The IDB candidate stayed put (no migration, no clear). Disconnect
    // is the place that wipes the IDB key; getMainUser leaves it alone
    // to avoid racing concurrent reads.
    const persisted = memFs.get("users/_user_metadata.json") as {
      main_user?: string;
    };
    expect(persisted.main_user).toBeUndefined();
  });

  it("clears the persisted main_user when it no longer points at a real folder user (deleted directory)", async () => {
    const { fileService } = await import("./file-system/file-service");
    (fileService.listDirectories as ReturnType<typeof vi.fn>).mockResolvedValue([
      "morgan",
      "GrantNickles",
    ]);
    memFs.set("users/_user_metadata.json", {
      users: {
        morgan: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
        GrantNickles: { color: "#a855f7", created_at: "2026-01-01T00:00:00.000Z" },
      },
      main_user: "alex", // alex was deleted; main_user is stale
    });

    const result = await usersApi.getMainUser();
    expect(result.main_user).toBe("");
    // Stale pin cleared on disk.
    const persisted = memFs.get("users/_user_metadata.json") as {
      main_user?: string;
    };
    expect(persisted.main_user).toBeUndefined();
  });

  it("clears the persisted main_user when it points at a tombstoned user (deleted_at set)", async () => {
    const { fileService } = await import("./file-system/file-service");
    // OneDrive Files On-Demand restored `kritika/` as a placeholder.
    // discoverUsers filters her out via deleted_at, so main_user
    // pointing at her is stale.
    (fileService.listDirectories as ReturnType<typeof vi.fn>).mockResolvedValue([
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
      main_user: "kritika",
    });

    const result = await usersApi.getMainUser();
    expect(result.main_user).toBe("");
    const persisted = memFs.get("users/_user_metadata.json") as {
      main_user?: string;
    };
    expect(persisted.main_user).toBeUndefined();
  });

  it("returns empty without writing anything when neither the file nor the IDB key has a candidate", async () => {
    (store.getMainUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce("");
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
      },
    });

    const result = await usersApi.getMainUser();
    expect(result.main_user).toBe("");
    // No tombstone-clear write fired (nothing to clear).
    const writes = writeJsonCalls.filter(
      (c) => c.path === "users/_user_metadata.json",
    );
    expect(writes).toHaveLength(0);
  });

  it("preserves a persisted main_user when discoverUsers returns an empty list (transient FS hiccup)", async () => {
    // Same conservative behavior as the legacy validation: an empty
    // discoverUsers can mean either a genuinely fresh folder OR a
    // transient FS error. Clearing on [] caused a 2026-05-20 regression
    // where Grant's valid pin was wiped on browser refresh.
    const { fileService } = await import("./file-system/file-service");
    (fileService.listDirectories as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    memFs.set("users/_user_metadata.json", {
      users: {
        alex: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
      },
      main_user: "alex",
    });

    const result = await usersApi.getMainUser();
    expect(result.main_user).toBe("alex");
    const persisted = memFs.get("users/_user_metadata.json") as {
      main_user?: string;
    };
    expect(persisted.main_user).toBe("alex");
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
