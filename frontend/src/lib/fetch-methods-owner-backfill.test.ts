// frontend/src/lib/fetch-methods-owner-backfill.test.ts
//
// Regression guard for 17329da7 ("own methods misfiled under Shared with
// Lab"). The unified-sharing / Lab Mode migration added `owner` /
// `created_by` attribution fields. Methods (and other records) created
// BEFORE that migration carry NEITHER field on disk. `isOwnMethod`
// (frontend/src/lib/methods/library-sections.ts) classifies a method as
// "mine" only when it is NOT `is_shared_with_me` AND (`created_by` ===
// currentUser OR `owner` === currentUser). A pre-migration own method with
// neither stamp therefore reads as NOT mine and the Methods page files it
// under "Shared with Lab", where it looks un-editable.
//
// `fetchAllMethodsIncludingShared` reads the current user's OWN methods
// folder via `methodsApi.list()`, so provenance proves ownership: every
// record returned by that read belongs to the current user. The fix
// backfills `owner: m.owner ?? currentUser` and stamps
// `is_shared_with_me: false` on those own-folder records before any
// owner-based classification runs. Records pulled from another user's
// folder via `_shared_with_me.json` keep `is_shared_with_me: true` and the
// sharer as `owner`.
//
// This test mirrors the in-memory fileService harness in
// `frontend/src/lib/share-task-as.test.ts` (memFs Map + a path-aware
// `listFiles` + mocked `getCurrentUser`). It asserts:
//   1. A pre-migration own method (no `owner`, no `created_by`) comes back
//      with `owner === currentUser` and `is_shared_with_me === false`, so
//      `isOwnMethod` is true (My Methods, editable).
//   2. A method shared IN via `_shared_with_me.json` keeps
//      `is_shared_with_me === true` and `owner` === the sharer, so
//      `isOwnMethod` is false (Shared with Lab).

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Method } from "./types";

const memFs = new Map<string, unknown>();
let currentUserMock = "alex";

// Path-aware `listFiles`: `JsonStore.listAll()` lists a directory then reads
// each `<id>.json` inside it. Derive the directory listing from the memFs
// keys so seeding a method at `users/<u>/methods/<id>.json` is enough for the
// store to surface it. Direct shared-method reads
// (`users/<owner>/methods/<id>.json`) go through `readJson` and don't need
// the directory listing.
vi.mock("./file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async (dirPath: string) => {
      const prefix = `${dirPath}/`;
      const names = new Set<string>();
      for (const key of memFs.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        // Only direct children (no nested dirs), mirroring the FSA file lister.
        if (rest.includes("/")) continue;
        names.add(rest);
      }
      return [...names];
    }),
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => currentUserMock),
}));

// Imports must come after the mocks.
import { fetchAllMethodsIncludingShared } from "./local-api";
import { clearCurrentUserCache } from "./storage/json-store";
import { isOwnMethod } from "./methods/library-sections";

function setCurrentUser(name: string) {
  currentUserMock = name;
  clearCurrentUserCache();
}

// Seed a method file under `users/<owner>/methods/<id>.json`. Defaults omit
// `owner` / `created_by` so callers can opt INTO them (the pre-migration
// shape is the default the regression cares about).
function seedMethod(
  owner: string,
  overrides: Partial<Method> & { id: number },
): Method {
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
  memFs.set(`users/${owner}/methods/${method.id}.json`, method);
  return method;
}

beforeEach(() => {
  memFs.clear();
  setCurrentUser("alex");
});

describe("fetchAllMethodsIncludingShared — owner provenance backfill (guards 17329da7)", () => {
  it("backfills owner from provenance on a pre-migration own method (no owner, no created_by)", async () => {
    // Pre-migration shape: the file on disk carries neither attribution stamp.
    seedMethod("alex", { id: 1, name: "legacy western blot" });
    // The own method has no on-disk owner field.
    expect(
      (memFs.get("users/alex/methods/1.json") as Method).owner,
    ).toBeUndefined();

    const all = await fetchAllMethodsIncludingShared();
    const own = all.find((m) => m.id === 1);
    expect(own).toBeDefined();

    // Provenance: read from alex's own folder => alex owns it.
    expect(own!.owner).toBe("alex");
    // Own-folder records are NOT shared-in.
    expect(own!.is_shared_with_me).toBe(false);
    // The classifier the Methods page uses now files it under "My Methods".
    expect(isOwnMethod(own!, "alex")).toBe(true);
  });

  it("preserves an explicit owner stamp on an own method (never reassigns)", async () => {
    // A post-migration own method already carries owner === currentUser; the
    // `?? currentUser` fallback must leave it untouched.
    seedMethod("alex", { id: 2, owner: "alex", created_by: "alex" });

    const all = await fetchAllMethodsIncludingShared();
    const own = all.find((m) => m.id === 2);
    expect(own!.owner).toBe("alex");
    expect(own!.is_shared_with_me).toBe(false);
    expect(isOwnMethod(own!, "alex")).toBe(true);
  });

  it("excludes a shared-in method whose owner was deleted (tombstoned deleted_at)", async () => {
    // delete-affordances bot, 2026-05-29 — CASE A guard. A shared-in
    // manifest entry can point at an owner who was since deleted (their
    // `_user_metadata.json` row carries `deleted_at`). That method used to
    // slip into "Shared with Lab" with no way to remove it. The tombstone
    // gate in fetchAllMethodsIncludingShared must drop it.
    seedMethod("alex", { id: 1, name: "legacy western blot" });
    // ghost-user authored method 9 and shared it with alex, then ghost-user
    // was deleted. The method file still lingers on disk.
    seedMethod("ghost-user", { id: 9, name: "ghost's qPCR", owner: "ghost-user" });
    memFs.set("users/alex/_shared_with_me.json", {
      version: 1,
      projects: [],
      tasks: [],
      methods: [{ id: 9, owner: "ghost-user", permission: "view" }],
    });
    // Tombstone ghost-user.
    memFs.set("users/_user_metadata.json", {
      users: {
        alex: { color: "#111111", created_at: "2026-01-01T00:00:00Z" },
        "ghost-user": {
          color: "#222222",
          created_at: "2026-01-01T00:00:00Z",
          deleted_at: "2026-05-20T00:00:00Z",
        },
      },
    });

    const all = await fetchAllMethodsIncludingShared();

    // Alex's own method is still there.
    expect(all.some((m) => m.id === 1 && !m.is_shared_with_me)).toBe(true);
    // The tombstoned owner's shared-in method must NOT render.
    expect(all.some((m) => m.id === 9)).toBe(false);
  });

  it("keeps a shared-in method whose owner is still active", async () => {
    // delete-affordances bot, 2026-05-29 — the tombstone gate must NOT
    // over-filter: an active owner's shared-in method still shows.
    // ACL hardening (2026-06-08): the source method must actually share with
    // alex for the manifest entry to be honored (no more manifest-only trust).
    seedMethod("morgan", {
      id: 9,
      name: "morgan's qPCR",
      owner: "morgan",
      shared_with: [{ username: "alex", level: "read", permission: "view" }],
    });
    memFs.set("users/alex/_shared_with_me.json", {
      version: 1,
      projects: [],
      tasks: [],
      methods: [{ id: 9, owner: "morgan", permission: "view" }],
    });
    memFs.set("users/_user_metadata.json", {
      users: {
        alex: { color: "#111111", created_at: "2026-01-01T00:00:00Z" },
        morgan: { color: "#222222", created_at: "2026-01-01T00:00:00Z" },
      },
    });

    const all = await fetchAllMethodsIncludingShared();
    const shared = all.find((m) => m.id === 9);
    expect(shared).toBeDefined();
    expect(shared!.is_shared_with_me).toBe(true);
    expect(shared!.owner).toBe("morgan");
  });

  it("keeps a shared-in method as Shared with Lab (owner = sharer, is_shared_with_me true)", async () => {
    // Alex owns a pre-migration method. Morgan has shared method 9 with Alex
    // via Alex's _shared_with_me manifest; the file lives in Morgan's folder.
    seedMethod("alex", { id: 1, name: "legacy western blot" });
    // ACL hardening (2026-06-08): the source method genuinely shares with alex.
    seedMethod("morgan", {
      id: 9,
      name: "morgan's qPCR",
      owner: "morgan",
      shared_with: [{ username: "alex", level: "read", permission: "view" }],
    });
    memFs.set("users/alex/_shared_with_me.json", {
      version: 1,
      projects: [],
      tasks: [],
      methods: [{ id: 9, owner: "morgan", permission: "view" }],
    });

    const all = await fetchAllMethodsIncludingShared();

    const own = all.find((m) => m.id === 1 && !m.is_shared_with_me);
    expect(own).toBeDefined();
    expect(own!.owner).toBe("alex");
    expect(isOwnMethod(own!, "alex")).toBe(true);

    // The shared-in method keeps the overlay: sharer is owner, marked shared.
    const shared = all.find((m) => m.is_shared_with_me);
    expect(shared).toBeDefined();
    expect(shared!.id).toBe(9);
    expect(shared!.owner).toBe("morgan");
    expect(shared!.is_shared_with_me).toBe(true);
    expect(shared!.shared_permission).toBe("view");
    // The classifier files it under "Shared with Lab" for Alex.
    expect(isOwnMethod(shared!, "alex")).toBe(false);
  });
});
