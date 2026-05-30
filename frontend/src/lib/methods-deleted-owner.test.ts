// frontend/src/lib/methods-deleted-owner.test.ts
//
// delete-affordances bot, 2026-05-29. Two regressions for the "ghost
// method from a deleted user" bug class on the Methods page:
//
//   CASE A — a method whose owner is a tombstoned (deleted_at) user must
//     NOT render in the lab-wide list. `labApi.getMethods` already routes
//     the private branch through `discoverUsers()` (which filters
//     tombstones), but the extra guard here covers a method physically
//     stored in a LIVE user's folder yet stamped with an explicit `owner`
//     that is itself a deleted user.
//
//   CASE B — a PUBLIC (lab-wide) method legitimately persists after its
//     creator is deleted (the public namespace is ownerless), but there
//     was no way to remove an unwanted one. The retire path the Methods
//     page now exposes reuses `methodsApi.delete(id)`, which hard-deletes
//     the public record via `publicMethodsStore.delete` →
//     `fileService.deleteFile("users/public/methods/<id>.json")`.
//
// Harness mirrors the in-memory fileService mock used by
// `fetch-methods-owner-backfill.test.ts` + `lab-roster-ghost-cleanup.test.ts`
// (memFs Map + path-aware listFiles + listDirectories + a mocked
// getCurrentUser).

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Method } from "./types";

const memFs = new Map<string, unknown>();
let listDirsResult: string[] = [];
let currentUserMock = "alex";

vi.mock("./file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async (dirPath: string) => {
      const prefix = `${dirPath}/`;
      const names = new Set<string>();
      for (const key of memFs.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest.includes("/")) continue; // direct children only
        names.add(rest);
      }
      return [...names];
    }),
    listDirectories: vi.fn(async () => listDirsResult),
    deleteFile: vi.fn(async (path: string) => {
      const existed = memFs.has(path);
      memFs.delete(path);
      return existed;
    }),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => currentUserMock),
}));

// Imports after the mocks.
import { labApi, methodsApi } from "./local-api";
import { clearCurrentUserCache } from "./storage/json-store";

function setCurrentUser(name: string) {
  currentUserMock = name;
  clearCurrentUserCache();
}

function seedPrivateMethod(
  username: string,
  overrides: Partial<Method> & { id: number },
): void {
  const method = {
    name: "PCR cleanup",
    source_path: null,
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: false,
    created_by: null,
    shared_with: [],
    ...overrides,
  } as Method;
  memFs.set(`users/${username}/methods/${method.id}.json`, method);
}

function seedPublicMethod(overrides: Partial<Method> & { id: number }): void {
  const method = {
    name: "Lab-wide qubit",
    source_path: null,
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: true,
    created_by: null,
    owner: "public",
    shared_with: [{ username: "*", level: "read" }],
    ...overrides,
  } as Method;
  memFs.set(`users/public/methods/${method.id}.json`, method);
}

function seedMetadata(
  users: Record<string, { color: string; created_at: string; deleted_at?: string }>,
): void {
  memFs.set("users/_user_metadata.json", { users });
}

beforeEach(() => {
  memFs.clear();
  listDirsResult = [];
  setCurrentUser("alex");
});

describe("labApi.getMethods — CASE A: tombstoned owner exclusion", () => {
  it("excludes a private method stamped with a tombstoned owner", async () => {
    // alex is live; ghost-user is tombstoned. alex's folder holds two
    // methods: one she owns, and a stray one stamped owner = ghost-user
    // (the deleted user). The deleted owner no longer exists, so the stray
    // must not appear in the lab-wide list.
    listDirsResult = ["alex", "public", "lab"];
    seedMetadata({
      alex: { color: "#111111", created_at: "2026-01-01T00:00:00Z" },
      "ghost-user": {
        color: "#222222",
        created_at: "2026-01-01T00:00:00Z",
        deleted_at: "2026-05-20T00:00:00Z",
      },
    });
    seedPrivateMethod("alex", { id: 1, name: "alex western blot", owner: "alex" });
    seedPrivateMethod("alex", { id: 2, name: "ghost stray", owner: "ghost-user" });

    const methods = await labApi.getMethods();
    expect(methods.some((m) => m.id === 1)).toBe(true);
    expect(methods.some((m) => m.id === 2)).toBe(false);
  });

  it("does not over-filter: a live owner's method still renders", async () => {
    listDirsResult = ["alex", "public", "lab"];
    seedMetadata({
      alex: { color: "#111111", created_at: "2026-01-01T00:00:00Z" },
    });
    seedPrivateMethod("alex", { id: 1, name: "alex western blot", owner: "alex" });

    const methods = await labApi.getMethods();
    expect(methods.some((m) => m.id === 1)).toBe(true);
  });
});

describe("methodsApi.delete — CASE B: public-method retire path", () => {
  it("hard-deletes a public (lab-wide) method via the public store", async () => {
    // A public method whose creator was since deleted persists in the
    // ownerless public namespace. The retire control reuses
    // methodsApi.delete(id), which must remove the public record from disk.
    setCurrentUser("alex");
    seedMetadata({
      alex: { color: "#111111", created_at: "2026-01-01T00:00:00Z" },
    });
    seedPublicMethod({ id: 42, name: "ghost public method" });
    expect(memFs.has("users/public/methods/42.json")).toBe(true);

    await methodsApi.delete(42);

    // The public record is gone from disk.
    expect(memFs.has("users/public/methods/42.json")).toBe(false);
  });

  it("retiring a public method does not touch a same-id private method of another user", async () => {
    // methodsApi.delete probes the current user's private store first, then
    // the public store. With no private method at id 7 for alex, the public
    // one is the target. Confirm only the public file is removed.
    setCurrentUser("alex");
    seedMetadata({
      alex: { color: "#111111", created_at: "2026-01-01T00:00:00Z" },
    });
    seedPublicMethod({ id: 7, name: "public seven" });

    await methodsApi.delete(7);
    expect(memFs.has("users/public/methods/7.json")).toBe(false);
  });
});
