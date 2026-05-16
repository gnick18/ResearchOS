// frontend/src/lib/methods-api-create.test.ts
//
// Regression test for `methodsApi.create`'s owner derivation.
//
// Before the fix the create path hard-coded `owner: ""` on the persisted
// record (a leftover from the ownership-by-file-location convention that
// predates the explicit owner field). That left runtime-created methods
// inconsistent with fixture-seeded methods, which set `owner` to the
// current user (personal) or `"public"` (public). Downstream consumers
// that key off `(id, owner)` — notably the compound-graph component
// resolver — would silently fall through to the wrong namespace.
//
// The fix derives owner at create time:
//   - public method  → owner: "public"   (stored at users/public/methods/<id>.json)
//   - personal       → owner: currentUser (stored at users/<user>/methods/<id>.json)
//
// The on-disk shape and the storage path now agree, matching the fixture
// convention emitted by `scripts/generate-demo-data.mjs`.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Method } from "./types";

// ── Mock surface ────────────────────────────────────────────────────────────

const memFs = new Map<string, unknown>();

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
    listFiles: vi.fn(async () => []),
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { methodsApi } from "./local-api";
import { clearCurrentUserCache } from "./storage/json-store";

beforeEach(() => {
  memFs.clear();
  // The json-store memoizes the current user across calls; clear so each
  // test reads from the mocked indexeddb-store fresh.
  clearCurrentUserCache();
});

describe("methodsApi.create — owner derivation", () => {
  it("personal method gets owner: <currentUser>", async () => {
    const result = await methodsApi.create({
      name: "personal test",
      is_public: false,
    });

    expect(result.owner).toBe("alex");
  });

  it("public method gets owner: 'public'", async () => {
    const result = await methodsApi.create({
      name: "public test",
      is_public: true,
    });

    expect(result.owner).toBe("public");
  });

  it("persists the correct owner on the on-disk record (personal)", async () => {
    const result = await methodsApi.create({
      name: "persisted personal",
      is_public: false,
    });

    const persisted = memFs.get(`users/alex/methods/${result.id}.json`) as Method;
    expect(persisted).toBeDefined();
    expect(persisted.owner).toBe("alex");
    expect(persisted.is_public).toBe(false);
  });

  it("persists the correct owner on the on-disk record (public)", async () => {
    const result = await methodsApi.create({
      name: "persisted public",
      is_public: true,
    });

    const persisted = memFs.get(`users/public/methods/${result.id}.json`) as Method;
    expect(persisted).toBeDefined();
    expect(persisted.owner).toBe("public");
    expect(persisted.is_public).toBe(true);
  });

  it("defaults to personal (owner: <currentUser>) when is_public is omitted", async () => {
    const result = await methodsApi.create({
      name: "defaulted",
    });

    expect(result.owner).toBe("alex");
    expect(result.is_public).toBe(false);

    const persisted = memFs.get(`users/alex/methods/${result.id}.json`) as Method;
    expect(persisted.owner).toBe("alex");
  });
});
